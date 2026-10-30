import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import {
  type McpSdkServerConfigWithInstance,
  type PermissionResult,
  type PermissionUpdate,
  type SDKMessage,
} from '@anthropic-ai/claude-agent-sdk'
import type {
  AccountLimit,
  AgentResult,
  AgentStatus,
  AgentSummary,
  AttachmentInfo,
  LogEntry,
  OfficeEvent,
  PermissionDecision,
  PermissionRequest,
  SubagentInfo,
} from '@shared/types'
import { pickAgentName } from '@shared/describe'
import { emiAgentId, emiAgentSummary } from '@shared/emi'
import { lunaAgentSummary } from '@shared/luna'
import { projectFor } from '@shared/projects'
import { type Accounts } from '../accounts'
import type { CostBook } from '../ledger'
import type { Store } from '../store'
import { SubagentLogs } from '../subagent-log'
import { LOG_LIMIT, PERSISTED_LOG, type Agent, type Pending, type Prompt } from './types'

/**
 * State of the AgentManager, its queries and the bookkeeping helpers. Each part (office,
 * sdk, rotation, subagents, decisions) extends the previous one; AgentManager (index.ts) is the last.
 */
export abstract class AgentBase extends EventEmitter {
  protected agents = new Map<string, Agent>()
  protected pending = new Map<string, Pending>()
  protected results: AgentResult[]
  /** In-process tools every office agent gets (the ticket board), built per agent. */
  officeTools?: (agent: AgentSummary) => McpSdkServerConfigWithInstance
  /** Luna's own tools for the personal records (#101); set where the vault writers live. */
  lunaTools?: () => McpSdkServerConfigWithInstance
  /** The tools of a floor's Emi (plan and squads of that floor); set where the squad writers live. */
  emiTools?: (projectId: string) => McpSdkServerConfigWithInstance
  /** Picks the Claude account of each run; missing = the app's own login. */
  accounts?: Accounts
  /** The cost book: every SDK result is booked there. */
  book?: CostBook
  /**
   * Demo mode: plays office agents' runs instead of starting Claude Code, so hiring and
   * talking can be shown (and tested by keyboard, AO-38) without spending tokens.
   */
  simulate?: (agentId: string, prompt: string) => void

  constructor(protected store: Store) {
    super()
    for (const p of store.agents) {
      // An Emi whose floor was removed while the office was closed leaves with it.
      const emiFloor = p.summary.builtIn === 'emi' ? store.settings.projects.find((x) => emiAgentId(x.id) === p.summary.id) : undefined
      if (p.summary.builtIn === 'emi' && !emiFloor) continue
      const floor = p.summary.project
        ? store.settings.projects.find((x) => x.id === p.summary.project)
        : projectFor(store.settings.projects, p.summary.cwd)
      const summary: AgentSummary = {
        ...p.summary,
        ...(p.summary.builtIn === 'luna'
          ? {
              id: 'agent-office:luna',
              name: 'Luna',
              builtIn: 'luna' as const,
              engine: 'claude' as const,
              permissionMode: 'default' as const,
              look: store.settings.lunaLook,
              model: store.settings.lunaModel || undefined,
              effort: store.settings.lunaEffort || undefined,
            }
          : {}),
        ...(emiFloor
          ? {
              name: 'Emi',
              engine: 'claude' as const,
              permissionMode: 'default' as const,
              cwd: emiFloor.cwd,
              project: emiFloor.id,
            }
          : {}),
        // Legacy orchestrators must always reload their definition from the stable floor root,
        // never from a copied worktree or another transient working directory.
        ...(p.summary.role === 'orchestrator' && floor ? { cwd: floor.cwd, project: floor.id } : {}),
        status: p.summary.departed || p.summary.engine === 'opencode' ? 'stopped' : p.summary.status === 'done' ? 'done' : 'idle',
        activity: p.summary.departed
          ? 'Foi embora após entregar; conversa arquivada'
          : p.summary.engine === 'opencode'
            ? 'Registro histórico OpenCode · somente leitura'
            : 'Aguardando instruções',
        subagents: undefined,
        subagentsDone: undefined,
      }
      // #101: Luna's chat used to run without a Claude session; she gets one on her first message.
      const freshLuna = summary.builtIn === 'luna' && !summary.sessionId
      if (freshLuna) summary.sessionId = randomUUID()
      // An Emi nobody talked to yet has no Claude session to resume.
      const agent: Agent = { summary, log: p.log, started: emiFloor ? p.log.length > 0 : !freshLuna }
      this.agents.set(summary.id, agent)
      if (summary.role === 'orchestrator') this.watchSquad(agent)
    }
    if (![...this.agents.values()].some((agent) => agent.summary.builtIn === 'luna')) {
      const summary = { ...lunaAgentSummary(Date.now(), store.settings), sessionId: randomUUID() }
      this.agents.set(summary.id, { summary, log: [], started: false })
      this.persist()
    }
    this.results = store.results.filter((r) => this.agents.has(r.agentId))
    this.relocate()
  }

  protected send(e: OfficeEvent): void {
    this.emit('event', e)
  }

  // ---------- queries ----------

  list(): AgentSummary[] {
    return [...this.agents.values()].map((a) => a.summary).filter((a) => !a.departed)
  }

  /** AO-94: change only the durable house presence, never stopping the session. */
  setHomeResident(id: string, resident: boolean): void {
    const agent = this.agents.get(id)
    if (!agent || agent.summary.source !== 'office' || agent.summary.builtIn || agent.summary.departed)
      throw new Error('Este agente não pode ficar na Casa.')
    // #105: a called agent stays until its task is over; only then may it be sent away.
    if (!resident && this.busy(agent)) throw new Error(`${agent.summary.name} ainda está na tarefa. Mande embora depois que ele terminar.`)
    if (resident) agent.summary.homeResident = true
    else delete agent.summary.homeResident
    this.upsert(agent)
  }

  pendingRequests(): PermissionRequest[] {
    return [...this.pending.values()].map((p) => p.request)
  }

  pendingResults(): AgentResult[] {
    return this.results
  }

  getLog(id: string): LogEntry[] {
    return this.agents.get(id)?.log ?? []
  }

  getSubagentLog(agentId: string, subId: string): LogEntry[] {
    return this.agents.get(agentId)?.subs?.get(subId) ?? []
  }

  // ---------- helpers ----------

  /** Where Luna's session runs (#101): the vault when there is one, else the office's own data folder. */
  protected lunaHome(): string {
    return this.store.settings.vaultPath || this.store.dataDirectory
  }

  /** Folders Luna reads without asking (#101): her home and every project floor. */
  protected lunaRoots(): string[] {
    return [...new Set([this.lunaHome(), ...this.store.settings.projects.map((p) => p.cwd)])]
  }

  /** Picks agent names; tests replace it to make the pick deterministic. */
  protected random: () => number = Math.random

  protected freeName(fallback = 'Agente'): string {
    const all = [...this.agents.values()].map((a) => a.summary)
    const active = all.filter((a) => !a.departed).map((a) => a.name)
    return (
      pickAgentName(
        active,
        all.map((a) => a.name),
        this.random,
      ) ?? fallback
    )
  }

  /**
   * Floor and desk for a new agent in `cwd`: the project floor holding the folder
   * (ground floor when none does) and the first free number there. Orchestrators get
   * their own number (they sit at the coordinator's desk of their squad room),
   * everyone else a desk of the agents' room.
   */
  protected seat(cwd: string, orchestrator = false, except?: Agent): { project?: string; desk: number } {
    const project = projectFor(this.store.settings.projects, cwd)?.id
    const used = new Set(
      [...this.agents.values()]
        .filter(
          (a) =>
            a !== except && !a.summary.builtIn && a.summary.project === project && (a.summary.role === 'orchestrator') === orchestrator,
        )
        .map((a) => a.summary.desk),
    )
    let desk = 0
    while (used.has(desk)) desk++
    return { project, desk }
  }

  /**
   * Floors changed: agents whose folder now belongs to another floor (or to none)
   * move there and take a free desk. Returns whether anyone moved.
   */
  relocate(): boolean {
    let moved = this.syncEmis()
    for (const agent of this.agents.values()) {
      const s = agent.summary
      if (s.departed || s.builtIn) continue
      if (projectFor(this.store.settings.projects, s.cwd)?.id === s.project) continue
      Object.assign(s, this.seat(s.cwd, s.role === 'orchestrator', agent))
      this.upsert(agent)
      moved = true
    }
    return moved
  }

  /**
   * One resident Emi per project floor: she arrives with the floor, follows its folder and
   * leaves when the floor is removed. Returns whether anything changed.
   */
  private syncEmis(): boolean {
    const floors = this.store.settings.projects
    let changed = false
    for (const agent of [...this.agents.values()]) {
      const s = agent.summary
      if (s.builtIn !== 'emi') continue
      const floor = floors.find((f) => emiAgentId(f.id) === s.id)
      if (!floor) {
        this.cancelAgentRequests(s.id)
        this.dropResults(s.id)
        agent.input?.close()
        agent.query?.close()
        this.agents.delete(s.id)
        this.book?.dismissed(s.id)
        this.send({ type: 'agent:removed', agentId: s.id })
        this.persist()
        changed = true
      } else if (s.cwd !== floor.cwd) {
        // A Claude session belongs to its folder: a floor in another folder starts a new conversation.
        agent.input?.close()
        agent.query?.close()
        agent.query = undefined
        agent.started = false
        Object.assign(s, { cwd: floor.cwd, project: floor.id, sessionId: randomUUID() })
        this.upsert(agent)
        changed = true
      }
    }
    for (const floor of floors) {
      if (this.agents.has(emiAgentId(floor.id))) continue
      const agent: Agent = { summary: { ...emiAgentSummary(floor), sessionId: randomUUID() }, log: [], started: false }
      this.agents.set(agent.summary.id, agent)
      this.upsert(agent)
      changed = true
    }
    return changed
  }

  /** Exact reading, the same numbers /context shows. */
  protected readContext(agent: Agent): void {
    const q = agent.query
    q?.getContextUsage({ detail: 'summary' })
      .then((c) => {
        if (agent.query === q) this.setContext(agent, c.totalTokens, c.rawMaxTokens)
      })
      .catch(() => undefined)
  }

  protected setContext(agent: Agent, used: number, max: number): void {
    if (!(max > 0)) return
    const percent = Math.round((used / max) * 100)
    const prev = agent.summary.context
    if (prev && prev.percent === percent && prev.max === max) return
    agent.summary.context = { used, max, percent }
    this.upsert(agent)
  }

  protected setStatus(agent: Agent, status: AgentStatus, activity: string): void {
    if (agent.summary.status === status && agent.summary.activity === activity) return
    agent.summary.status = status
    agent.summary.activity = activity
    this.upsert(agent)
  }

  protected setActivity(agent: Agent, activity: string): void {
    if (agent.summary.status === 'waiting') return
    this.setStatus(agent, 'working', activity)
  }

  protected upsert(agent: Agent): void {
    this.send({ type: 'agent:upsert', agent: { ...agent.summary } })
    if (agent.summary.source === 'office') this.persist()
  }

  protected addLog(
    agent: Agent,
    kind: LogEntry['kind'],
    text: string,
    tool?: string,
    isError?: boolean,
    attachments?: AttachmentInfo[],
    limit?: AccountLimit,
  ): void {
    const entry: LogEntry = { id: randomUUID(), t: Date.now(), kind, text, tool, isError, attachments, limit }
    agent.log.push(entry)
    if (agent.log.length > LOG_LIMIT) agent.log.splice(0, agent.log.length - LOG_LIMIT)
    this.send({ type: 'agent:log', agentId: agent.summary.id, entry })
    if (agent.summary.source === 'office') this.persist()
  }

  protected persist(): void {
    this.store.agents = [...this.agents.values()]
      .filter((a) => a.summary.source === 'office' && !a.demo)
      .map((a) => ({ summary: { ...a.summary, subagentsDone: undefined }, log: a.log.slice(-PERSISTED_LOG) }))
  }

  // ---------- implemented by the later parts ----------
  protected abstract watchSquad(agent: Agent): void
  protected abstract run(agent: Agent, prompt: Prompt): void
  protected abstract busy(agent: Agent): boolean
  protected abstract pauseOnLimit(agent: Agent, hit: { resetsAt?: number }): boolean
  protected abstract trackSubagents(agent: Agent, msg: Extract<SDKMessage, { type: 'system' }>): void
  protected abstract subLogs(agent: Agent): SubagentLogs
  protected abstract subagentMessage(agent: Agent, parentToolUseId: string, role: 'assistant' | 'user', content: unknown): void
  protected abstract retire(agent: Agent, sub: SubagentInfo, status: NonNullable<SubagentInfo['status']>, line?: string): void
  protected abstract clearSubagents(agent: Agent): void
  protected abstract askPlayer(
    agent: Agent,
    tool: string,
    input: Record<string, unknown>,
    opts: { signal: AbortSignal; suggestions?: PermissionUpdate[]; decisionReason?: string; agentID?: string; toolUseID?: string },
  ): Promise<PermissionResult>
  protected abstract overBudget(agent: Agent): boolean
  protected abstract budgetText(agent: Agent): string
  abstract requestDecision(
    agentId: string,
    req: Omit<PermissionRequest, 'id' | 'agentId' | 'createdAt'>,
    onDecision: (d: PermissionDecision) => void,
  ): string
  abstract cancelRequest(requestId: string, message: string): void
  abstract cancelAgentRequests(agentId: string, message?: string): void
  protected abstract dropResults(agentId: string): void
  protected abstract deliver(agent: Agent, r: Omit<AgentResult, 'id' | 'agentId' | 'createdAt'>): void
  protected abstract removeTerminal(agentId: string): void
}
