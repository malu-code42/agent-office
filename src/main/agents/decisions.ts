import { randomUUID } from 'node:crypto'
import { lstatSync, realpathSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { type PermissionResult, type PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'
import type { AgentResult, AgentSummary, PermissionDecision, PermissionRequest, ResultChanges } from '@shared/types'
import { projectFor } from '@shared/projects'
import { outsideTeam, readProgress, type SquadDefinition } from '../squads'
import { changesSince, displayPath } from '../git'
import { decide } from '../permissions/policy'
import { permissionFromTool } from './permissions'
import { LUNA_CONFIRM_TOOLS, LUNA_SERVER } from '../luna-tools'
import { EMI_CONFIRM_TOOLS, EMI_SERVER } from '../emi-tools'

const LUNA_READ_TOOLS = new Set(['Read', 'Grep', 'Glob'])
import { type Agent } from './types'
import { AgentSubagents } from './subagents'

/**
 * Caminho real (symlinks e caixa de letra resolvidos) sem exigir que o arquivo exista:
 * a pasta existente mais perto resolve e o resto fica relativo (Write/ManageEdits de
 * arquivo novo precisa). Sobe só por ENOENT de componente ausente; link quebrado
 * (o próprio link existe, o destino não) e caminho inacessível falham e propagam:
 * a política vira pergunta dura. Windows (drive) e POSIX.
 */
export function lenientRealpath(p: string): string {
  let head = resolve(p)
  const tail: string[] = []
  for (;;) {
    try {
      lstatSync(head)
    } catch (err) {
      if ((err as { code?: string }).code !== 'ENOENT') throw err // EACCES e afins: fail-closed
      const parent = dirname(head)
      if (parent === head) return resolve(p) // nada existe até a raiz: fica lexical, a política julga
      tail.unshift(basename(head))
      head = parent
      continue
    }
    // O componente existe (symlink incluso): o caminho real tem de resolver.
    // Link quebrado falha aqui e propaga — pergunta dura na política.
    return tail.length ? join(realpathSync(head), ...tail) : realpathSync(head)
  }
}

/** Permissions (asking the player, decisions) and results, shared by office and terminal agents. */
export abstract class AgentDecisions extends AgentSubagents {
  private readonly changesSettled = new Map<string, Promise<void>>()
  protected askPlayer(
    agent: Agent,
    tool: string,
    input: Record<string, unknown>,
    opts: { signal: AbortSignal; suggestions?: PermissionUpdate[]; decisionReason?: string; agentID?: string; toolUseID?: string },
  ): Promise<PermissionResult> {
    // The board is the office's own tool: no need to walk over and ask.
    if (tool.startsWith('mcp__office__')) return Promise.resolve({ behavior: 'allow', updatedInput: input })
    const luna = agent.summary.builtIn === 'luna'
    // #101: Luna's own tools run on a clear request; only taking something away comes to the card.
    if (luna && tool.startsWith(`mcp__${LUNA_SERVER}__`) && !LUNA_CONFIRM_TOOLS.has(tool))
      return Promise.resolve({ behavior: 'allow', updatedInput: input })
    const emi = agent.summary.builtIn === 'emi'
    // Emi reads her floor's plan and squads freely; approving the plan and creating a squad come to the card.
    if (emi && tool.startsWith(`mcp__${EMI_SERVER}__`) && !EMI_CONFIRM_TOOLS.has(tool))
      return Promise.resolve({ behavior: 'allow', updatedInput: input })
    // Built-in confirm tools always reach the card, whatever the mode, and never become an "always allow" rule.
    const confirm = (luna && LUNA_CONFIRM_TOOLS.has(tool)) || (emi && EMI_CONFIRM_TOOLS.has(tool))
    const squad = agent.squad
    if (squad && (tool === 'Agent' || tool === 'Task')) {
      // Handing a step to a member is the orchestrator's job; anyone else is out (the hook already says so).
      const why = outsideTeam(squad, tool, input)
      return Promise.resolve(why ? { behavior: 'deny', message: why } : { behavior: 'allow', updatedInput: input })
    }
    // A política do Office é a autoridade: o que ela provou seguro nem chega no cartão.
    // O escopo é a pasta em que este comando roda (a worktree, quando há).
    const s = agent.summary
    const project = projectFor(this.store.settings.projects, s.cwd)
    const scope = {
      cwd: luna ? this.lunaHome() : (s.worktree?.path ?? s.cwd),
      realpath: lenientRealpath,
      rules: project?.alwaysAllow,
    }
    const check = decide(s.permissionMode, tool, input, scope)
    if (check.verdict === 'allow' && !confirm) return Promise.resolve({ behavior: 'allow', updatedInput: input })
    // #101: Luna reads every project floor without asking, as the policy would in each folder; writes still ask.
    if (
      luna &&
      LUNA_READ_TOOLS.has(tool) &&
      this.lunaRoots().some((cwd) => decide(s.permissionMode, tool, input, { ...scope, cwd }).verdict === 'allow')
    )
      return Promise.resolve({ behavior: 'allow', updatedInput: input })
    // O que pede é o risco classificado (o porquê da política), não a sugestão do CLI.
    const canAlwaysAllow = !confirm && !!project && s.permissionMode !== 'plan' && decide('auto', tool, input, scope).verdict === 'allow'
    const req = permissionFromTool(tool, input, check.why ?? opts.decisionReason, canAlwaysAllow)
    if (opts.agentID) req.subagent = this.subagentLabel(agent, opts.agentID)
    if (squad) req.context = this.squadContext(agent, squad, tool === 'AskUserQuestion')
    return new Promise((resolve) => {
      const id = this.requestDecision(agent.summary.id, req, (d) => {
        if (d.behavior === 'deny') {
          // A spawn that never starts gives its slot at the desk back.
          if (opts.toolUseID && (tool === 'Agent' || tool === 'Task')) this.releaseHelperSlot(agent, opts.toolUseID)
          resolve({ behavior: 'deny', message: d.message?.trim() || 'O usuário negou esta ação.' })
        } else if (tool === 'AskUserQuestion') {
          resolve({ behavior: 'allow', updatedInput: { ...input, answers: d.answers ?? {} } })
        } else {
          // Persist an exact, re-classified project rule only when the Office offered it.
          // The SDK never receives updatedPermissions; approval is one-shot for this call.
          if (d.behavior === 'allow_always' && req.canAlwaysAllow && project) this.saveAlwaysAllow(project.id, tool, input)
          resolve({ behavior: 'allow', updatedInput: input })
        }
      })
      opts.signal.addEventListener('abort', () => this.cancelRequest(id, 'Cancelado.'), { once: true })
    })
  }

  protected saveAlwaysAllow(projectId: string, tool: string, input: Record<string, unknown>): void {
    const settings = this.store.settings
    const floor = settings.projects.find((p) => p.id === projectId)
    if (!floor) return
    const command = tool === 'Bash' && typeof input.command === 'string' ? input.command : undefined
    const kind: 'command' | 'tool' = command ? 'command' : 'tool'
    const value = command ?? tool
    const rules = floor.alwaysAllow ?? []
    if (rules.some((rule) => rule.kind === kind && rule.value === value)) return
    const updated = { ...floor, alwaysAllow: [...rules, { id: randomUUID(), createdAt: Date.now(), kind, value }].slice(0, 100) }
    this.store.settings = { ...settings, projects: settings.projects.map((p) => (p.id === projectId ? updated : p)) }
    this.send({ type: 'settings', settings: this.store.settings })
  }

  /** "Ciclo de Produto · Passo 1 · Foco da semana": read fresh, the watcher may still be debouncing. */
  protected squadContext(agent: Agent, squad: SquadDefinition, question: boolean): string {
    const step = readProgress(squad) ?? agent.summary.squadStep
    if (step && JSON.stringify(step) !== JSON.stringify(agent.summary.squadStep)) {
      agent.summary.squadStep = step
      this.upsert(agent)
    }
    if (!step?.current) return squad.name
    const who = !question && step.agent ? squad.members.find((m) => m.id === step.agent) : undefined
    return [squad.name, `Passo ${step.current}${step.total ? `/${step.total}` : ''}`, step.label, who ? `${who.icon} ${who.name}` : '']
      .filter(Boolean)
      .join(' · ')
  }

  // ---------- decisions (shared by office and terminal agents) ----------

  requestDecision(
    agentId: string,
    req: Omit<PermissionRequest, 'id' | 'agentId' | 'createdAt'>,
    onDecision: (d: PermissionDecision) => void,
  ): string {
    const agent = this.agents.get(agentId)
    const request: PermissionRequest = { ...req, id: randomUUID(), agentId, createdAt: Date.now() }
    this.pending.set(request.id, { request, resolve: onDecision })
    if (agent) {
      this.setStatus(
        agent,
        'waiting',
        req.kind === 'question'
          ? 'Com uma pergunta para você'
          : req.kind === 'plan'
            ? 'Com um plano para você'
            : 'Precisa da sua permissão',
      )
    }
    this.send({ type: 'permission:new', request })
    return request.id
  }

  respond(d: PermissionDecision): void {
    const p = this.pending.get(d.requestId)
    if (!p) return
    this.pending.delete(d.requestId)
    const agent = this.agents.get(p.request.agentId)
    if (agent) {
      const verdict = d.behavior === 'deny' ? 'Negado' : d.behavior === 'allow_always' ? 'Sempre permitido' : 'Permitido'
      const answers = d.answers ? Object.values(d.answers).join(', ') : ''
      this.addLog(
        agent,
        'decision',
        p.request.kind === 'question'
          ? `Você respondeu: ${answers}`
          : `${verdict}: ${p.request.title}${d.message ? ` — ${d.message}` : ''}`,
      )
      if (!this.hasPending(agent.summary.id)) this.setStatus(agent, 'working', 'Voltando ao trabalho')
    }
    this.send({ type: 'permission:resolved', requestId: d.requestId, agentId: p.request.agentId })
    p.resolve(d)
  }

  cancelRequest(requestId: string, message: string): void {
    const p = this.pending.get(requestId)
    if (!p) return
    this.pending.delete(requestId)
    this.send({ type: 'permission:resolved', requestId, agentId: p.request.agentId })
    p.resolve({ requestId, behavior: 'deny', message })
    const agent = this.agents.get(p.request.agentId)
    if (agent && agent.summary.status === 'waiting' && !this.hasPending(agent.summary.id))
      this.setStatus(agent, 'working', 'Voltando ao trabalho')
  }

  cancelAgentRequests(agentId: string, message = 'Interrompido pelo usuário.'): void {
    for (const [id, p] of this.pending) if (p.request.agentId === agentId) this.cancelRequest(id, message)
  }

  protected hasPending(agentId: string): boolean {
    for (const p of this.pending.values()) if (p.request.agentId === agentId) return true
    return false
  }

  ackResult(resultId: string): void {
    const r = this.results.find((x) => x.id === resultId)
    if (!r) return
    this.results = this.results.filter((x) => x.id !== resultId)
    this.store.results = this.results
    this.changesSettled.delete(resultId)
    this.send({ type: 'result:acked', resultId, agentId: r.agentId })
    const agent = this.agents.get(r.agentId)
    const temporaryDelivered = agent?.summary.temporary === true && agent.summary.homeResident !== true
    if (agent && (agent.summary.status === 'done' || agent.summary.status === 'error')) {
      if (agent.summary.source === 'terminal' && !agent.query && agent.summary.activity === 'Sessão encerrada') {
        this.removeTerminal(agent.summary.id)
      } else {
        this.setStatus(agent, 'idle', agent.summary.source === 'terminal' ? 'Esperando no terminal' : 'Aguardando instruções')
      }
    }
    // AO-42: acknowledgement is the explicit handoff. Leave the live office, but keep the
    // conversation in the persisted agent history for later inspection.
    if (temporaryDelivered && agent) {
      agent.input?.close()
      agent.query?.close()
      agent.watcher?.close()
      agent.subFlush?.cancel()
      agent.summary.departed = true
      agent.summary.status = 'stopped'
      agent.summary.activity = 'Foi embora após entregar; conversa arquivada'
      this.persist()
      this.send({ type: 'agent:removed', agentId: r.agentId })
    }
  }

  protected dropResults(agentId: string): void {
    for (const r of this.results.filter((x) => x.agentId === agentId)) {
      this.send({ type: 'result:acked', resultId: r.id, agentId })
      this.changesSettled.delete(r.id)
    }
    this.results = this.results.filter((x) => x.agentId !== agentId)
    this.store.results = this.results
  }

  protected deliver(agent: Agent, r: Omit<AgentResult, 'id' | 'agentId' | 'createdAt'>): void {
    this.dropResults(agent.summary.id)
    const result: AgentResult = {
      ...r,
      id: randomUUID(),
      agentId: agent.summary.id,
      ...(agent.summary.ticketId ? { ticketId: agent.summary.ticketId } : {}),
      createdAt: Date.now(),
    }
    this.results.push(result)
    this.store.results = this.results
    this.addLog(agent, 'result', r.text, undefined, r.isError, undefined, r.limit)
    this.setStatus(agent, r.isError ? 'error' : 'done', r.isError ? 'Deu problema' : 'Trazendo o resultado')
    let settleChanges!: () => void
    const settled = new Promise<void>((resolve) => {
      settleChanges = resolve
    })
    this.changesSettled.set(result.id, settled)
    this.send({ type: 'result:new', result })
    const task = agent.task
    agent.task = undefined
    if (task) void this.attachChanges(agent, result, task).finally(settleChanges)
    else settleChanges()
  }

  /** Resolves after this run's late snapshot is attached, or immediately after restart. */
  async resultChangesSettled(resultId: string): Promise<void> {
    await this.changesSettled.get(resultId)
  }

  /** Works out what the task changed and hangs it on the result card (a moment after it arrives). */
  protected async attachChanges(agent: Agent, result: AgentResult, task: NonNullable<Agent['task']>): Promise<void> {
    const s = agent.summary
    let changes: ResultChanges | null = null
    try {
      const snap = await task.snapshot
      if (snap) changes = await changesSince(snap, s.worktree ? { branch: s.worktree.branch } : undefined)
    } catch (err) {
      this.addLog(agent, 'error', `Não consegui ler as mudanças do git: ${err instanceof Error ? err.message : String(err)}`)
    }
    // No git: what the Edit/Write tools wrote, as the log has it.
    if (!changes && task.touched.size) {
      const root = s.worktree?.path ?? s.cwd
      changes = {
        git: false,
        root,
        files: [...task.touched].map(([file, tool]) => {
          return { path: displayPath(root, file), status: 'modified' as const, tool }
        }),
      }
    }
    if (changes) this.setChanges(result.id, changes)
  }

  /** The result as the main process holds it (the renderer only ever sends its id). */
  result(resultId: string): AgentResult | undefined {
    return this.results.find((r) => r.id === resultId)
  }

  agent(agentId: string): AgentSummary | undefined {
    return this.agents.get(agentId)?.summary
  }

  /** Persists the individual board ticket so later result actions can link to it exactly. */
  setTicketId(agentId: string, ticketId: string | undefined): void {
    const agent = this.agents.get(agentId)
    if (!agent || agent.summary.role === 'orchestrator') return
    if (ticketId) agent.summary.ticketId = ticketId
    else delete agent.summary.ticketId
    this.persist()
  }

  setChanges(resultId: string, changes: ResultChanges): void {
    const r = this.results.find((x) => x.id === resultId)
    if (!r) return
    // A delayed snapshot must not erase the commit marker already persisted for retry/recovery.
    if (r.changes?.committed && !changes.committed) return
    r.changes = changes
    this.store.results = this.results
    this.send({ type: 'result:changes', resultId, agentId: r.agentId, changes })
  }
}
