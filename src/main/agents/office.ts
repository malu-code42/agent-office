import { randomUUID } from 'node:crypto'
import { watch } from 'node:fs'
import { basename } from 'node:path'
import type {
  AgentBrain,
  AgentStatus,
  AgentSummary,
  AttachmentInput,
  HireRequest,
  LogEntry,
  OfficePermissionMode,
  SquadInfo,
  SquadProgress,
  SubagentInfo,
  Settings,
  WorktreeInfo,
} from '@shared/types'
import { lookFromSeed } from '@shared/describe'
import { projectFor } from '@shared/projects'
import { buildMessage } from '../attachments'
import { findSquad, readProgress, squadDir, type SquadDefinition } from '../squads'
import { createWorktree } from '../git'
import { endSubagent } from '../subagent-log'
import { type Agent } from './types'
import { AgentBase } from './base'
import { AgentCapReservations } from '@shared/agent-cap'
import { profileById, profileTaskInstructions } from '@shared/profiles'

/** Office agents: hire, summon, squads, messages, interrupt, fire. */
export abstract class AgentOffice extends AgentBase {
  /** AO-42: reserve synchronously so concurrent worktree creation cannot take the same seat. */
  private capReservations = new AgentCapReservations()
  private builtInMessageHandler?: (id: string, text: string, attachments: AttachmentInput[]) => void | Promise<void>

  setBuiltInMessageHandler(handler: (id: string, text: string, attachments: AttachmentInput[]) => void | Promise<void>): void {
    this.builtInMessageHandler = handler
  }

  /** Updates only the fixed Luna's personal preferences; office defaults remain untouched. */
  setLunaPreferences(settings: Pick<Settings, 'lunaLook' | 'lunaModel' | 'lunaEffort'>): void {
    const agent = this.agents.get('agent-office:luna')
    if (!agent?.summary.builtIn) return
    agent.summary.look = settings.lunaLook
    agent.summary.model = settings.lunaModel || undefined
    agent.summary.effort = settings.lunaEffort || undefined
    this.upsert(agent)
  }

  appendBuiltInLog(id: string, kind: LogEntry['kind'], text: string): void {
    const agent = this.agents.get(id)
    if (agent?.summary.builtIn) this.addLog(agent, kind, text)
  }

  setBuiltInStatus(id: string, status: AgentStatus, activity: string): void {
    const agent = this.agents.get(id)
    if (agent?.summary.builtIn) this.setStatus(agent, status, activity)
  }

  // ---------- office agents (Claude Agent SDK) ----------

  /**
   * `display` is what the log shows when the prompt itself is long (a ticket brief).
   * In a git repo the agent gets its own worktree unless `req.worktree` is false.
   */
  async hire(req: HireRequest, display?: string, beforeRun?: (summary: AgentSummary) => void): Promise<AgentSummary> {
    const seat = this.capReservations.reserve(this.list())
    try {
      const id = randomUUID()
      const engine = 'claude'
      const name = req.name.trim() || this.freeName()
      const { worktree, note } = await this.isolate(req.cwd, name, id, req.worktree)
      const summary: AgentSummary = {
        id,
        name,
        source: 'office',
        engine,
        cwd: req.cwd,
        model: req.model || undefined,
        effort: req.effort || undefined,
        accounts: engine === 'claude' && req.accounts?.length ? req.accounts : undefined,
        ...(req.profile ? { profile: req.profile } : {}),
        permissionMode: req.permissionMode,
        status: 'starting',
        activity: 'Chegando ao escritório',
        ...this.seat(req.cwd),
        look: req.look ?? lookFromSeed(req.name + id),
        costUsd: 0,
        createdAt: Date.now(),
        sessionId: randomUUID(),
        ...(worktree ? { worktree } : {}),
      }
      if (seat.temporary) summary.temporary = true
      // #105: an agent called to the house (by Luna) stays around it after the task until sent away.
      if (req.homeResident) summary.homeResident = true
      const agent: Agent = { summary, log: [], started: false }
      this.agents.set(id, agent)
      this.upsert(agent)
      this.addLog(agent, 'user', display ?? req.task)
      if (note) this.addLog(agent, 'system', note)
      beforeRun?.(summary)
      const task = req.profile ? `${req.task}\n\n[Approved profile scope]\n${profileTaskInstructions(req.profile)}` : req.task
      this.run(agent, task)
      return summary
    } finally {
      seat.release()
    }
  }

  /**
   * The worktree for a new agent in `cwd`. `wanted` false = none; missing or true = one
   * when `cwd` is in a git repo. A folder without git just works as before; a repo where
   * the worktree can't be made (no commit yet…) also falls back, with a note in the log.
   * Missing on a floor with worktrees turned off = none.
   */
  protected async isolate(
    cwd: string,
    name: string,
    id: string,
    wanted: boolean | undefined,
  ): Promise<{ worktree?: WorktreeInfo; note?: string }> {
    if (wanted === false) return {}
    // The floor turned worktrees off for new agents (Bastidores → Worktrees); an explicit yes still wins.
    if (wanted === undefined && projectFor(this.store.settings.projects, cwd)?.worktrees === false) return {}
    try {
      const worktree = await createWorktree(cwd, name, id)
      return worktree ? { worktree, note: `Trabalhando numa cópia isolada (worktree) no branch ${worktree.branch}: ${worktree.root}` } : {}
    } catch (err) {
      return {
        note: `Não deu para criar a cópia isolada (${err instanceof Error ? err.message : String(err)}). Trabalhando direto na pasta do projeto.`,
      }
    }
  }

  /** An office agent for a saved session; it waits in the lounge until it gets an instruction. */
  recall(
    sessionId: string,
    cwd: string,
    log: LogEntry[],
    defaults: AgentBrain & { permissionMode: OfficePermissionMode },
    worktree?: WorktreeInfo,
    helpers: { info: SubagentInfo; log: LogEntry[] }[] = [],
  ): AgentSummary {
    for (const a of this.agents.values()) if (a.summary.sessionId === sessionId) return a.summary
    // started = true: the next message resumes the saved conversation.
    const summary = this.idleAgent(sessionId, cwd, log, true, 'De volta, esperando instruções', defaults, worktree)
    const agent = this.agents.get(summary.id)
    if (agent && helpers.length) {
      // The helpers of the saved conversation come back as ended, each with its own log.
      const subs = this.subLogs(agent)
      const done: SubagentInfo[] = []
      for (const x of helpers) {
        subs.seed(x.info.id, x.log)
        for (const dropped of endSubagent(done, x.info)) subs.forget(dropped)
      }
      summary.subagentsDone = done
      this.upsert(agent)
    }
    return summary
  }

  /** A new agent with no task yet, like typing `claude` in a folder: it waits for your first message. */
  async summon(
    cwd: string,
    defaults: AgentBrain & { permissionMode: OfficePermissionMode },
    wantWorktree?: boolean,
    engine: 'claude' = 'claude',
    homeResident = false,
  ): Promise<AgentSummary> {
    const seat = this.capReservations.reserve(this.list())
    try {
      const sessionId = randomUUID()
      const name = this.freeName(basename(cwd) || 'Agente')
      const { worktree, note } = await this.isolate(cwd, name, sessionId, wantWorktree)
      const summary = this.idleAgent(sessionId, cwd, [], false, 'Esperando a primeira instrução', defaults, worktree, name, engine)
      if (homeResident) {
        const created = this.agents.get(summary.id)
        if (created) {
          created.summary.homeResident = true
          this.upsert(created)
        }
      }
      if (seat.temporary) {
        summary.temporary = true
        const created = this.agents.get(summary.id)
        if (created) this.upsert(created)
      }
      const agent = this.agents.get(summary.id)
      if (agent && note) this.addLog(agent, 'system', note)
      return summary
    } finally {
      seat.release()
    }
  }

  /**
   * An orchestrator for a squad: one Claude Code session that runs the squad's cycle
   * and can only call its own members. It lives on the squad floor.
   */
  runSquad(
    squad: SquadInfo,
    task: string,
    display: string,
    defaults: AgentBrain & { permissionMode: OfficePermissionMode },
    worktree?: WorktreeInfo,
    ticketId?: string,
  ): AgentSummary {
    const same = [...this.agents.values()].find((a) => {
      const s = a.summary
      return (
        s.role === 'orchestrator' && s.squad === squad.code && s.cwd === squad.cwd && (ticketId ? s.ticketId === ticketId : !s.ticketId)
      )
    })
    if (same) {
      if (this.busy(same)) throw new Error(`${same.summary.name} já está rodando um ciclo. Espere terminar ou interrompa pelo painel.`)
      if (worktree && same.summary.worktree?.branch !== worktree.branch)
        throw new Error('O ticket já está vinculado a outra cópia isolada; preserve o branch existente.')
      same.summary.permissionMode = defaults.permissionMode
      if (worktree) {
        same.summary.worktree = worktree
        same.summary.ticketId = ticketId
        this.watchSquad(same)
      }
      // Token economy: the squad keeps its memory in files, so re-reading every past cycle only costs tokens.
      if (this.store.settings.freshSquadCycle !== false)
        this.freshStart(same.summary.id, 'Ciclo novo, conversa nova: o squad guarda a memória nos arquivos dele.')
      this.sendMessage(same.summary.id, task, display)
      return same.summary
    }
    const id = randomUUID()
    const summary: AgentSummary = {
      id,
      name: squad.name,
      source: 'office',
      engine: 'claude',
      cwd: squad.cwd,
      model: defaults.model || undefined,
      effort: defaults.effort || undefined,
      accounts: defaults.accounts?.length ? defaults.accounts : undefined,
      permissionMode: defaults.permissionMode,
      status: 'starting',
      activity: 'Subindo para a sala do squad',
      ...this.seat(squad.cwd, true),
      look: lookFromSeed(`orquestrador:${squad.code}`),
      costUsd: 0,
      createdAt: Date.now(),
      sessionId: randomUUID(),
      role: 'orchestrator',
      squad: squad.code,
      ...(worktree ? { worktree } : {}),
      ...(ticketId ? { ticketId } : {}),
    }
    const agent: Agent = { summary, log: [], started: false }
    this.agents.set(id, agent)
    this.watchSquad(agent)
    this.upsert(agent)
    this.addLog(agent, 'user', display)
    this.run(agent, task)
    return summary
  }

  /** Demo mode: an orchestrator with no session behind it; demo.ts plays its cycle. */
  demoOrchestrator(squad: SquadDefinition): AgentSummary {
    const id = randomUUID()
    const summary: AgentSummary = {
      id,
      name: squad.name,
      source: 'office',
      cwd: squad.cwd,
      permissionMode: 'default',
      status: 'working',
      activity: 'Lendo o pipeline',
      ...this.seat(squad.cwd, true),
      look: lookFromSeed(`orquestrador:${squad.code}`),
      costUsd: 0,
      createdAt: Date.now(),
      role: 'orchestrator',
      squad: squad.code,
    }
    const agent: Agent = { summary, log: [], started: true, squad, demo: true }
    this.agents.set(id, agent)
    this.upsert(agent)
    return summary
  }

  /** Demo mode: an office agent with no session behind it; demo.ts plays its runs (routines). */
  demoAgent(name: string, cwd: string): AgentSummary {
    const id = randomUUID()
    const summary: AgentSummary = {
      id,
      name,
      source: 'office',
      cwd,
      permissionMode: 'default',
      status: 'idle',
      activity: 'Aguardando instruções',
      ...this.seat(cwd),
      look: lookFromSeed(`demo:${name}`),
      costUsd: 0,
      createdAt: Date.now(),
    }
    const agent: Agent = { summary, log: [], started: true, demo: true }
    this.agents.set(id, agent)
    this.upsert(agent)
    return summary
  }

  /**
   * A routine's own agent before its next run: freedom and brain as the routine says now.
   * They count from the next start of the CLI (the routine clears the context first).
   */
  configure(id: string, patch: { permissionMode?: OfficePermissionMode; model?: string; effort?: AgentBrain['effort'] }): void {
    const agent = this.agents.get(id)
    if (!agent || agent.summary.source !== 'office' || agent.summary.departed || this.busy(agent)) return
    if (agent.summary.engine === 'opencode') return
    const s = agent.summary
    if (patch.permissionMode) s.permissionMode = patch.permissionMode
    if ('model' in patch) s.model = patch.model || undefined
    if ('effort' in patch) s.effort = patch.effort || undefined
    this.upsert(agent)
  }

  /** Demo mode: moves a simulated cycle along. */
  demoStep(agentId: string, step: SquadProgress | undefined, status: AgentStatus, activity: string): void {
    const agent = this.agents.get(agentId)
    if (!agent?.demo) return
    agent.summary.squadStep = step
    agent.summary.status = status
    agent.summary.activity = activity
    this.upsert(agent)
  }

  /** Follows squads/<code>/state.json, which the runner rewrites before every step. */
  protected watchSquad(agent: Agent): void {
    const s = agent.summary
    agent.watcher?.close()
    const info = s.squad ? findSquad(s.worktree?.path ?? s.cwd, s.squad) : undefined
    if (!info) return
    agent.squad = info
    let timer: NodeJS.Timeout | null = null
    const read = () => {
      timer = null
      const step = readProgress(info)
      if (JSON.stringify(step) === JSON.stringify(s.squadStep)) return
      s.squadStep = step
      this.upsert(agent)
    }
    try {
      agent.watcher = watch(squadDir(info), (_e, file) => {
        if (file && file !== 'state.json') return
        if (!timer) timer = setTimeout(read, 250)
      })
      agent.watcher.on('error', () => agent.watcher?.close())
    } catch {
      // folder gone: the step line just stays empty
    }
    read()
  }

  protected idleAgent(
    sessionId: string,
    cwd: string,
    log: LogEntry[],
    started: boolean,
    activity: string,
    defaults: AgentBrain & { permissionMode: OfficePermissionMode },
    worktree?: WorktreeInfo,
    name?: string,
    engine: 'claude' = 'claude',
  ): AgentSummary {
    const id = randomUUID()
    const summary: AgentSummary = {
      id,
      name: name ?? this.freeName(basename(cwd) || 'Agente'),
      source: 'office',
      engine,
      cwd,
      model: defaults.model || undefined,
      effort: defaults.effort || undefined,
      accounts: defaults.accounts?.length ? defaults.accounts : undefined,
      permissionMode: defaults.permissionMode,
      status: 'idle',
      activity,
      ...this.seat(cwd),
      look: lookFromSeed(sessionId),
      costUsd: 0,
      createdAt: Date.now(),
      sessionId,
      ...(worktree ? { worktree } : {}),
    }
    const agent: Agent = { summary, log, started }
    this.agents.set(id, agent)
    this.upsert(agent)
    return summary
  }

  /** Throws, before anything is sent, when an attachment can't go. */
  sendMessage(id: string, text: string, display?: string, attachments: AttachmentInput[] = []): void | Promise<void> {
    const agent = this.agents.get(id)
    if (!agent || agent.summary.source !== 'office' || agent.summary.departed || agent.demo) return
    // #101: Luna talks through the ordinary agent session; only audio keeps its own local workflow.
    if (agent.summary.builtIn === 'luna' && (attachments.length || this.simulate)) {
      const userText = display ?? text
      this.addLog(agent, 'user', attachments.length ? `${userText || 'Áudio anexado para transcrição local.'}\n[Áudio anexado]` : userText)
      this.dropResults(id)
      if (this.simulate) {
        this.addLog(agent, 'assistant', 'A conversa com Luna está em modo de demonstração; nenhum pedido será enviado ou executado.')
        this.setStatus(agent, 'idle', 'Pronta para ajudar')
        return
      }
      if (!this.pendingRequests().some((request) => request.agentId === id)) this.setStatus(agent, 'working', 'Lendo seu pedido')
      if (!this.builtInMessageHandler) {
        this.addLog(agent, 'error', 'A conversa com Luna não está disponível agora. Tente novamente.')
        this.setStatus(agent, 'idle', 'Pronta para ajudar')
        return Promise.reject(new Error('A conversa com Luna não está disponível agora. Tente novamente.'))
      }
      return Promise.resolve(this.builtInMessageHandler(id, text, attachments)).catch((error: unknown) => {
        if (!this.pendingRequests().some((request) => request.agentId === id)) this.setStatus(agent, 'idle', 'Pronta para ajudar')
        throw error
      })
    }
    if (agent.summary.engine === 'opencode') throw new Error('Este é um registro histórico OpenCode, disponível somente para consulta.')
    if (agent.summary.quotaPaused)
      throw new Error(
        agent.summary.quotaEnded
          ? 'Esta tarefa foi encerrada após a pausa de cota. Limpe o contexto para começar uma conversa nova.'
          : 'Esta tarefa está pausada pela cota. Aguarde na conta fixa ou encerre o resultado antes de iniciar uma conversa nova.',
      )
    const { content, infos } = attachments.length ? buildMessage(text, attachments) : { content: text, infos: [] }
    this.addLog(agent, 'user', display ?? text, undefined, undefined, infos.length ? infos : undefined)
    // A new instruction replaces any undelivered result.
    this.dropResults(id)
    if (this.overBudget(agent)) return
    if (agent.input && (agent.query || agent.awaitingSnapshot)) {
      agent.input.push(content)
      this.setStatus(agent, 'working', 'Lendo suas instruções')
    } else {
      this.run(agent, content)
    }
  }

  compact(id: string): void {
    const agent = this.agents.get(id)
    if (!agent || agent.summary.source !== 'office' || !agent.started || this.busy(agent)) return
    if (agent.summary.engine === 'opencode') throw new Error('Registros históricos OpenCode são somente para consulta.')
    if (agent.summary.quotaPaused)
      throw new Error('Uma tarefa pausada ou encerrada pela cota não pode ser compactada. Comece uma conversa nova para continuar.')
    agent.compacting = true
    this.addLog(agent, 'system', 'Compactando: resumindo a conversa para liberar contexto…')
    this.dropResults(id)
    if (agent.input && (agent.query || agent.awaitingSnapshot)) agent.input.push('/compact')
    else this.run(agent, '/compact')
    this.setStatus(agent, 'working', 'Organizando a memória')
  }

  /**
   * Token economy: clears an agent that already talked, so the next message starts a new
   * conversation instead of re-reading the old one on every call; `note` says why. Never the fixed
   * agents (Luna, Emi, Bonnie), nor a busy one, an OpenCode record or a task paused by the quota
   * (that one must resume on its account; sendMessage explains). Returns true when it cleared.
   */
  freshStart(id: string, note: string): boolean {
    const agent = this.agents.get(id)
    if (!agent?.started || agent.summary.source !== 'office' || agent.summary.builtIn || agent.summary.engine === 'opencode') return false
    if (agent.summary.quotaPaused || this.busy(agent)) return false
    this.clearContext(id, note)
    return true
  }

  /** Same agent, brand-new conversation: closes the session and starts the next one from zero. */
  clearContext(id: string, note = 'Contexto limpo. A próxima mensagem começa uma conversa nova.'): void {
    const agent = this.agents.get(id)
    if (!agent || agent.summary.source !== 'office') return
    if (agent.summary.engine === 'opencode')
      throw new Error('Registros históricos OpenCode não podem ser retomados. Crie um novo agente Claude se quiser recomeçar.')
    if (agent.summary.quotaPaused && this.results.some((result) => result.agentId === id && result.limit))
      throw new Error('Leia e encerre o resultado pausado pela cota antes de começar uma conversa nova.')
    this.cancelAgentRequests(id)
    this.dropResults(id)
    agent.input?.close()
    agent.query?.close()
    agent.input = undefined
    agent.query = undefined
    agent.started = false
    agent.compacting = false
    agent.resumeAccount = undefined
    agent.summary.sessionId = randomUUID()
    agent.summary.context = undefined
    const hadProfile = agent.summary.profile
    agent.summary.profile = undefined
    agent.summary.quotaPaused = undefined
    agent.summary.quotaEnded = undefined
    agent.summary.clearedAt = Date.now()
    agent.summary.lastTurnAt = undefined
    this.addLog(agent, 'system', note)
    // AO-43: the memory of the profile is not touched here — nothing is written on its own, and no
    // task receives it; the person read, edits or erases it in Configurações → Memória dos perfis.
    if (hadProfile)
      this.addLog(
        agent,
        'system',
        `A memória do perfil ${profileById(hadProfile)?.name ?? hadProfile} não sai daqui: nada é escrito nela por conta própria, e nova conversa ou tarefa nenhuma a recebe sem pedido. Você lê, edita ou apaga em Configurações → Memória dos perfis.`,
      )
    this.setStatus(agent, 'idle', 'Memória limpa, esperando instruções')
    this.upsert(agent)
  }

  isBusy(id: string): boolean {
    const agent = this.agents.get(id)
    return !!agent && this.busy(agent)
  }

  protected busy(agent: Agent): boolean {
    const st = agent.summary.status
    return st === 'working' || st === 'starting' || st === 'waiting'
  }

  async interrupt(id: string): Promise<void> {
    const agent = this.agents.get(id)
    if (!agent) return
    if (agent.summary.engine === 'opencode') return
    this.cancelAgentRequests(id)
    if (!agent.query) return
    await agent.query.interrupt().catch(() => undefined)
    this.addLog(agent, 'system', 'Interrompido por você.')
  }

  fire(id: string): void {
    const agent = this.agents.get(id)
    if (!agent) return
    if (agent.summary.builtIn === 'emi') throw new Error('A Emi mora neste andar e só sai quando o andar for removido.')
    if (agent.summary.builtIn === 'bonnie') throw new Error('A Bonnie dirige o andar de estudos e não pode ser dispensada.')
    if (agent.summary.builtIn) throw new Error('Luna faz parte do Agent Office e não pode ser dispensada.')
    if (agent.summary.engine === 'opencode') throw new Error('Registros históricos OpenCode são preservados para consulta.')
    if (agent.summary.temporary && this.results.some((result) => result.agentId === id))
      throw new Error('Receba ou encerre a tarefa e leia o resultado antes de dispensar o agente temporário.')
    this.cancelAgentRequests(id)
    this.dropResults(id)
    agent.input?.close()
    agent.query?.close()
    agent.watcher?.close()
    agent.subFlush?.cancel()
    this.agents.delete(id)
    // Its spend stays in the cost book; reports show it as dismissed.
    this.book?.dismissed(id)
    this.send({ type: 'agent:removed', agentId: id })
    this.persist()
  }

  shutdown(): void {
    for (const a of this.agents.values()) {
      a.input?.close()
      a.query?.close()
      a.watcher?.close()
    }
    this.persist()
  }
}
