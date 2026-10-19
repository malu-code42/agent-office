import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { query, type Query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { describeTool, toolDetail } from '@shared/describe'
import { MAIN_ACCOUNT } from '@shared/accounts'
import { projectFor } from '@shared/projects'
import type { AgentSummary } from '@shared/types'
import { accountEnv } from '../accounts'
import { claudeNotFoundMessage } from '../claude-messages'
import { findClaude } from '../claude-path'
import { findSquad, memberAgents, orchestratorPrompt, teamGuard, validateSquad, type SquadDefinition } from '../squads'
import { takeSnapshot } from '../git'
import { InputQueue, kTokens, toMs, WRITE_TOOLS, type Agent, type Prompt } from './types'
import { AgentOffice } from './office'
import { randomUUID } from 'node:crypto'
import { OpenCodeRuntime } from '../opencode/runtime'
import { decide, type PolicyDecision } from '../permissions/policy'
import { lenientRealpath } from './decisions'
import { mapOpenCodePermission } from '../opencode/judge'
import type { OpenCodePermission } from '../opencode/runtime'

/** Runs on the Claude Agent SDK: starting the query and turning its messages into status, activity and log. */
export abstract class AgentSdk extends AgentOffice {
  protected openCode = new OpenCodeRuntime()
  protected interruptOpenCode(sessionID: string): Promise<void> {
    return this.openCode.interrupt(sessionID)
  }
  /** CLI processes closed on purpose to move to another account: their end is not an error. */
  protected replaced = new WeakSet<Query>()

  protected run(agent: Agent, prompt: Prompt): void {
    const s = agent.summary
    if (this.simulate) return this.simulate(s.id, typeof prompt === 'string' ? prompt : '(mensagem com anexos)')
    if (s.engine === 'opencode' && s.role !== 'orchestrator') {
      if (typeof prompt !== 'string') {
        this.deliver(agent, { text: 'O agente OpenCode ainda não aceita anexos. Envie o conteúdo como texto ou use Claude Code.', isError: true, costUsd: s.costUsd, durationMs: 0, turns: 0 })
        return
      }
      void this.runOpenCode(agent, prompt)
      return
    }
    const claude = findClaude()
    if (!claude) {
      this.deliver(agent, {
        text: claudeNotFoundMessage(process.platform),
        isError: true,
        costUsd: s.costUsd,
        durationMs: 0,
        turns: 0,
      })
      return
    }
    // Orchestrators read the squad again, so edits to squad.yaml count from the next run.
    const squad = s.role === 'orchestrator' && s.squad ? findSquad(s.cwd, s.squad) : undefined
    if (s.role === 'orchestrator') {
      const squadCode = s.squad ?? 'desconhecido'
      if (!squad) {
        this.deliver(agent, {
          text: `A definição do squad \`${squadCode}\` não está disponível em ${join(s.cwd, 'squads', squadCode, 'squad.yaml')}. Restaure ou corrija esse arquivo manualmente e tente novamente; o Agent Office não recria definições.`,
          isError: true,
          costUsd: s.costUsd,
          durationMs: 0,
          turns: 0,
        })
        return
      }
      try {
        validateSquad(squad)
      } catch (err) {
        this.deliver(agent, {
          text: `O squad \`${squadCode}\` está indisponível: ${err instanceof Error ? err.message : String(err)}. Corrija ${join(s.cwd, 'squads', squadCode, 'squad.yaml')} e tente novamente.`,
          isError: true,
          costUsd: s.costUsd,
          durationMs: 0,
          turns: 0,
        })
        return
      }
      agent.squad = squad
      // A corrupt/restored orchestrator record must never turn a squad into a bypass.
      if (s.permissionMode === 'bypassPermissions') {
        this.deliver(agent, {
          text: 'Squads nunca podem rodar no modo "Sem pedir nada". Escolha outro modo e tente novamente.',
          isError: true,
          costUsd: s.costUsd,
          durationMs: 0,
          turns: 0,
        })
        return
      }
    }
    if (this.overBudget(agent)) return
    const wt = s.worktree
    const workDir = wt?.path ?? s.cwd
    if (wt && !existsSync(workDir)) {
      this.deliver(agent, {
        text: `A cópia isolada (worktree) deste agente não existe mais: \`${wt.root}\`.\n\nDispense o agente e contrate outro; o branch \`${wt.branch}\` continua no repositório se tiver commits.`,
        isError: true,
        costUsd: s.costUsd,
        durationMs: 0,
        turns: 0,
      })
      return
    }
    // A new task (not a failover or a /compact): remember the folder as it is now, so the
    // card can show what this task changed. The CLI only starts once the snapshot is done:
    // anything it writes before that would count as the player's own earlier change.
    if (!agent.task && !agent.compacting && !agent.demo)
      agent.task = { snapshot: takeSnapshot(workDir).catch(() => null), touched: new Map() }
    const input = new InputQueue()
    input.push(prompt)
    agent.input = input
    const task = agent.task
    if (task && !task.ready) {
      // Messages sent meanwhile go into this same queue (sendMessage checks awaitingSnapshot).
      agent.awaitingSnapshot = true
      this.setStatus(agent, 'starting', s.status === 'starting' ? s.activity : 'Voltando ao trabalho')
      void task.snapshot.then(() => {
        task.ready = true
        if (agent.input !== input) return // fired, cleared or replaced while waiting
        agent.awaitingSnapshot = false
        if (this.agents.get(s.id) === agent) this.startQuery(agent, input, claude, workDir, squad)
      })
      return
    }
    this.startQuery(agent, input, claude, workDir, squad)
  }

  private async runOpenCode(agent: Agent, prompt: string): Promise<void> {
    const summary = agent.summary
    if (!this.store.settings.openCodeDataConsentAt) {
      this.deliver(agent, {
        text: 'Antes de usar OpenCode, aceite o aviso de envio de dados ao contratar um agente individual no modo OpenCode. Nenhum conteúdo foi enviado.',
        isError: true,
        costUsd: summary.costUsd,
        costUnknown: true,
        durationMs: 0,
        turns: 0,
      })
      return
    }
    const controller = new AbortController()
    agent.opencodeAbort = controller
    agent.started = true
    this.setStatus(agent, 'starting', 'Conectando ao OpenCode')
    this.addLog(agent, 'system', 'Roteamento OpenCode: somente GPT-6 Luna high está aprovado. Se estiver indisponível, a execução pausa; não há troca silenciosa de modelo.')
    let textBuffer = ''
    const flushText = () => {
      if (!textBuffer) return
      this.addLog(agent, 'assistant', textBuffer)
      textBuffer = ''
    }
    try {
      const turn = await this.openCode.run(
        summary,
        prompt,
        controller.signal,
        (request) => this.askOpenCodePermission(agent, request),
        (child) => this.updateOpenCodeChild(agent, child),
        (delta) => {
          textBuffer += delta
          if (textBuffer.length >= 280 || textBuffer.includes('\n')) flushText()
          else this.setStatus(agent, 'working', 'Escrevendo resposta')
        },
        this.store.settings.maxSubagents,
        (audit) => {
          this.addLog(agent, 'system', `Julgador selecionou ${audit.providerID}/${audit.model} · ${audit.variant}: ${audit.rationale}`)
          for (const delegation of audit.decisions)
            this.addLog(
              agent,
              'system',
              `Julgador validou "${delegation.task}" para \`${delegation.profile}\` em ${delegation.providerID}/${delegation.modelID} (${delegation.variant}): ${delegation.rationale} · confiança ${(delegation.confidence * 100).toFixed(0)}%.`,
            )
          if (audit.decisions.length === 0)
            this.addLog(agent, 'system', 'Julgador validou o plano: nenhuma delegação; o agente conduz a tarefa direto.')
        },
      )
      flushText()
      if (controller.signal.aborted || !this.agents.has(summary.id)) return
      summary.model = turn.model
      summary.effort = turn.variant as AgentSummary['effort']
      if (!turn.streamed && turn.text) this.addLog(agent, 'assistant', turn.text)
      summary.opencodeUsage = {
        inputTokens: (summary.opencodeUsage?.inputTokens ?? 0) + turn.inputTokens,
        outputTokens: (summary.opencodeUsage?.outputTokens ?? 0) + turn.outputTokens,
        ...(turn.costUsd !== undefined ? { costUsd: (summary.opencodeUsage?.costUsd ?? 0) + turn.costUsd } : summary.opencodeUsage?.costUsd !== undefined ? { costUsd: summary.opencodeUsage.costUsd } : {}),
      }
      summary.costUnknown = turn.costUsd === undefined || summary.costUnknown === true
      if (turn.costUsd !== undefined) {
        summary.costUsd += turn.costUsd
        summary.spentUsd = (summary.spentUsd ?? 0) + turn.costUsd
      }
      this.book?.recordOpenCode(
        summary,
        summary.sessionId ?? '',
        `${turn.providerID}/${turn.model}`,
        turn.inputTokens,
        turn.outputTokens,
        turn.costUsd,
      )
      this.deliver(agent, { text: turn.text, isError: false, costUsd: summary.costUsd, costUnknown: summary.costUnknown, durationMs: 0, turns: 1 })
    } catch (err) {
      if (!this.agents.has(summary.id)) return
      const cancelled = controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')
      const text = cancelled ? 'Interrompido por você.' : err instanceof Error ? err.message : String(err)
      if (!cancelled) summary.costUnknown = true
      this.addLog(agent, cancelled ? 'system' : 'error', text)
      if (cancelled) this.setStatus(agent, 'stopped', 'Interrompido')
      else this.deliver(agent, { text: `A execução OpenCode foi pausada: ${text}`, isError: true, costUsd: summary.costUsd, costUnknown: true, durationMs: 0, turns: 0 })
    } finally {
      if (agent.opencodeAbort === controller) {
        agent.opencodeAbort = undefined
        const next = agent.opencodeQueue?.shift()
        if (next && this.agents.has(summary.id)) this.run(agent, next)
        else {
          agent.opencodeQueue = []
          agent.summary.subagents = undefined
          this.upsert(agent)
        }
      }
    }
  }

  private updateOpenCodeChild(agent: Agent, child: NonNullable<Agent['summary']['subagents']>[number]): void {
    agent.opencodeChildren ??= new Map()
    const previous = agent.opencodeChildren.get(child.id)
    if (!previous) this.subLogs(agent).start(child.id)
    agent.opencodeChildren.set(child.id, child)
    const children = [...agent.opencodeChildren.values()]
    agent.summary.subagents = children.filter((entry) => !entry.status)
    agent.summary.subagentsDone = children.filter((entry) => !!entry.status).slice(-20)
    if (child.status === 'completed' && child.summary && previous?.status !== 'completed') {
      this.addLog(agent, 'assistant', `${child.description}: ${child.summary}`)
      const entry = { id: randomUUID(), t: Date.now(), kind: 'assistant' as const, text: child.summary }
      this.subLogs(agent).add(child.id, [entry])
      this.send({ type: 'agent:sublog', agentId: agent.summary.id, logs: [{ subId: child.id, entries: [entry] }] })
    }
    if (child.status && previous?.status !== child.status && child.model) {
      this.book?.recordOpenCode(
        agent.summary,
        child.id,
        child.model,
        child.inputTokens ?? 0,
        child.outputTokens ?? 0,
        child.costUsd,
      )
      if (child.costUnknown) agent.summary.costUnknown = true
      agent.summary.opencodeUsage = {
        inputTokens: (agent.summary.opencodeUsage?.inputTokens ?? 0) + (child.inputTokens ?? 0),
        outputTokens: (agent.summary.opencodeUsage?.outputTokens ?? 0) + (child.outputTokens ?? 0),
        ...(child.costUsd !== undefined
          ? { costUsd: (agent.summary.opencodeUsage?.costUsd ?? 0) + child.costUsd }
          : agent.summary.opencodeUsage?.costUsd !== undefined
            ? { costUsd: agent.summary.opencodeUsage.costUsd }
            : {}),
      }
      if (child.costUsd !== undefined) {
        agent.summary.costUsd += child.costUsd
        agent.summary.spentUsd = (agent.summary.spentUsd ?? 0) + child.costUsd
      }
    }
    this.upsert(agent)
  }

  private async askOpenCodePermission(agent: Agent, request: OpenCodePermission): Promise<'once' | 'always' | 'reject'> {
    const summary = agent.summary
    const action = request.action.toLowerCase()
    if (action === 'subagent' && request.approvedSubagent !== true) {
      this.addLog(agent, 'error', request.rejectionReason ?? `Bloqueei o perfil filho OpenCode não aprovado: ${request.resources.join(', ') || '(desconhecido)'}.`)
      return 'reject'
    }
    const mapped = mapOpenCodePermission(request.action, request.resources, summary.worktree?.path ?? summary.cwd)
    const tool = mapped?.tool ?? `OpenCode:${request.action}`
    const input = mapped?.input ?? { resources: request.resources, action: request.action }
    const project = projectFor(this.store.settings.projects, summary.cwd)
    const scope = { cwd: summary.worktree?.path ?? summary.cwd, realpath: lenientRealpath, rules: project?.alwaysAllow }
    const verdict: PolicyDecision = mapped
      ? decide(summary.permissionMode, tool, input, scope)
      : { verdict: 'ask', why: 'Ação OpenCode não classificada pela política do Office.' }
    if (verdict.verdict === 'allow') return 'once'
    const canAlwaysAllow = !!project && !!mapped && summary.permissionMode !== 'plan' && decide('auto', tool, input, scope).verdict === 'allow'
    return new Promise((resolve) => {
      const req = {
        kind: 'tool' as const,
        toolName: `OpenCode:${request.action}`,
        title: `OpenCode quer ${request.action}`,
        detail: [request.message, ...request.resources].filter(Boolean).join('\n').slice(0, 1200),
        input,
        reason: verdict.why ?? request.message ?? 'Ação OpenCode não classificada pela política; revisão necessária.',
        canAlwaysAllow,
        ...(request.subagent ? { subagent: request.subagent } : {}),
      }
      this.requestDecision(
        summary.id,
        req,
        (decision) => {
          if (decision.behavior === 'deny') return resolve('reject')
          if (decision.behavior === 'allow_always' && canAlwaysAllow && project && mapped)
            this.saveOpenCodeAlwaysAllow(project.id, tool, input)
          // Rules are stored only by the Office; never use OpenCode's persistent `always` reply.
          resolve('once')
        },
      )
    })
  }

  private saveOpenCodeAlwaysAllow(projectId: string, tool: string, input: Record<string, unknown>): void {
    const settings = this.store.settings
    const floor = settings.projects.find((project) => project.id === projectId)
    if (!floor) return
    const command = tool === 'Bash' && typeof input.command === 'string' ? input.command : undefined
    const kind: 'command' | 'tool' = command ? 'command' : 'tool'
    const value = command ?? tool
    const rules = floor.alwaysAllow ?? []
    if (rules.some((rule) => rule.kind === kind && rule.value === value)) return
    const updated = { ...floor, alwaysAllow: [...rules, { id: randomUUID(), createdAt: Date.now(), kind, value }].slice(0, 100) }
    this.store.settings = { ...settings, projects: settings.projects.map((project) => (project.id === projectId ? updated : project)) }
    this.send({ type: 'settings', settings: this.store.settings })
  }

  /** Starts the CLI process for `run`, reading `input`. */
  protected startQuery(agent: Agent, input: InputQueue, claude: string, workDir: string, squad: SquadDefinition | undefined): void {
    const s = agent.summary
    const wt = s.worktree
    // Each run starts a new CLI process, so it can move to another account between turns.
    const before = s.account
    const account = squad && s.account && this.accounts ? this.accounts.get(s.account) : this.accounts?.pick(s, agent.borrowed)
    if (squad && s.account && this.accounts && !account) {
      this.deliver(agent, {
        text: `A conta Claude fixa deste squad (${s.account}) não está mais configurada. Reconfigure a mesma conta antes de retomar; não vou trocar de conta automaticamente.`,
        isError: true,
        costUsd: s.costUsd,
        durationMs: 0,
        turns: 0,
      })
      return
    }
    if (account) s.account = account.id
    const resumed = agent.started
    if (s.sessionId) {
      this.book?.begin(s.sessionId, resumed, s.costUsd)
      this.book?.switched(s, s.sessionId, s.account ?? MAIN_ACCOUNT, before, 'start')
    }
    const limits = this.store.settings
    const budget = limits.agentBudgetUsd > 0 ? limits.agentBudgetUsd - (s.spentUsd ?? 0) : undefined
    this.setStatus(agent, 'starting', s.status === 'starting' ? s.activity : 'Voltando ao trabalho')

    const q = query({
      prompt: input,
      options: {
        cwd: workDir,
        model: s.model,
        effort: s.effort,
        pathToClaudeCodeExecutable: claude,
        permissionMode: s.permissionMode,
        // Fontes de settings em arquivo ficam fechadas (modo isolado do SDK): regra
        // salva de fora não executa antes do canUseTool — quem decide aqui é o Office.
        settingSources: [],
        // Subagent text comes too (not only tools), for the helper's own log (AO-46).
        forwardSubagentText: true,
        allowDangerouslySkipPermissions: s.permissionMode === 'bypassPermissions',
        // Counts only what this query spends, so it gets what is left of the agent's cap.
        ...(budget !== undefined ? { maxBudgetUsd: budget } : {}),
        ...(agent.started ? { resume: s.sessionId } : { sessionId: s.sessionId }),
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append:
            `Your name in this office is ${s.name}. Your final message for each task is handed to the user in person as a report: ` +
            'open with the outcome in one or two sentences, then list the key details. Reply in the language the user wrote in. ' +
            'The office has a kanban board of tickets (keys like AO-12); use the mcp__office__ tools to read, open, comment on and move tickets when asked or when you are working on one.' +
            (wt
              ? `\n\nYou work in your own git worktree at ${wt.root} on branch ${wt.branch}, so other agents never touch your files. ` +
                `Make every change here; do not edit the main checkout at ${wt.repo}. The user reviews, commits and opens the pull request from the office.`
              : '') +
            (squad ? `\n\n${orchestratorPrompt(squad)}` : ''),
        },
        ...(squad ? { agents: memberAgents(squad), hooks: { PreToolUse: teamGuard(squad) } } : {}),
        ...(this.officeTools ? { mcpServers: { office: this.officeTools(s) } } : {}),
        // Lets the terminal bridge ignore hook events coming from office-managed sessions.
        env: {
          ...accountEnv(account),
          AGENT_OFFICE_MANAGED: '1',
          // The cap the CLI enforces on subagents running at once (its default is 20).
          ...(limits.maxSubagents > 0 ? { CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: String(limits.maxSubagents) } : {}),
        },
        canUseTool: (tool, toolInput, opts) => this.askPlayer(agent, tool, toolInput, opts),
        stderr: (data) => {
          if (/error/i.test(data)) this.addLog(agent, 'error', data.trim().slice(0, 500))
        },
      },
    })
    agent.query = q
    agent.started = true
    // A resumed session the book never saw starts from the total its transcript saved:
    // read it now so that part is not booked as today's spend. Experimental API, best effort;
    // without it the first result only sets the mark.
    const sid = s.sessionId
    if (resumed && sid && this.book && !this.book.isMarked(sid)) {
      q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true })
        .then((u) => this.book?.markResumed(sid, u.session.total_cost_usd, u.session.model_usage ?? {}))
        .catch(() => undefined)
    }
    this.consume(agent, q)
  }

  protected async consume(agent: Agent, q: Query): Promise<void> {
    try {
      for await (const msg of q) this.handle(agent, msg)
    } catch (err) {
      // Closed on purpose to move to another account: the new process carries on.
      if (this.replaced.has(q) || (agent.query && agent.query !== q)) return
      const text = err instanceof Error ? err.message : String(err)
      this.addLog(agent, 'error', text)
      if (this.agents.has(agent.summary.id)) {
        this.deliver(agent, {
          text: `Tive um problema e parei:\n\n${text}`,
          isError: true,
          costUsd: agent.summary.costUsd,
          durationMs: 0,
          turns: 0,
        })
      }
    } finally {
      if (agent.query === q) {
        agent.query = undefined
        agent.input = undefined
        // Subagents live inside the CLI process, so they ended with it.
        this.clearSubagents(agent)
        if (agent.summary.status === 'working' || agent.summary.status === 'starting')
          this.setStatus(agent, 'idle', 'Aguardando instruções')
      }
    }
  }

  protected handle(agent: Agent, msg: SDKMessage): void {
    switch (msg.type) {
      case 'system':
        if (msg.subtype === 'init') {
          agent.summary.model = msg.model
          if (agent.summary.status === 'starting') this.setStatus(agent, 'working', 'Lendo a tarefa')
        } else if (msg.subtype === 'status' && msg.status === 'compacting') {
          this.setStatus(agent, agent.summary.status, 'Organizando a memória')
        } else if (msg.subtype === 'compact_boundary') {
          const { trigger, pre_tokens, post_tokens } = msg.compact_metadata
          const freed = post_tokens !== undefined ? ` de ${kTokens(pre_tokens)} para ${kTokens(post_tokens)}` : ''
          this.addLog(
            agent,
            'system',
            `${trigger === 'auto' ? 'O contexto encheu e foi compactado sozinho' : 'Conversa compactada'}${freed}.`,
          )
          if (post_tokens !== undefined && agent.summary.context) this.setContext(agent, post_tokens, agent.summary.context.max)
        } else {
          this.trackSubagents(agent, msg)
        }
        return
      case 'rate_limit_event': {
        const info = msg.rate_limit_info
        if (info.status === 'rejected') agent.limitHit = { resetsAt: toMs(info.resetsAt) }
        return
      }
      case 'assistant': {
        // Subagents share the process and its account, so their limit is ours too.
        if (msg.error === 'rate_limit') agent.limitHit ??= {}
        // A subagent's message goes to its own log, never to the parent's.
        if (msg.parent_tool_use_id) return this.subagentMessage(agent, msg.parent_tool_use_id, 'assistant', msg.message.content)
        // Live estimate between the exact readings taken after each turn.
        const u = msg.message.usage
        if (u && agent.summary.context) {
          this.setContext(
            agent,
            u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + u.output_tokens,
            agent.summary.context.max,
          )
        }
        for (const block of msg.message.content) {
          if (block.type === 'text' && block.text.trim()) {
            this.addLog(agent, 'assistant', block.text)
          } else if (block.type === 'thinking') {
            this.setActivity(agent, 'Pensando…')
          } else if (block.type === 'tool_use') {
            const input = (block.input ?? {}) as Record<string, unknown>
            const line = describeTool(block.name, input)
            const file = input.file_path ?? input.notebook_path
            if (agent.task && WRITE_TOOLS.has(block.name) && typeof file === 'string' && file.length < 4096)
              agent.task.touched.set(file, block.name)
            this.addLog(agent, 'tool', toolDetail(block.name, input) || line, block.name)
            this.setActivity(agent, line)
          }
        }
        if (agent.summary.status !== 'waiting') this.setStatus(agent, 'working', agent.summary.activity)
        return
      }
      case 'user': {
        if (msg.parent_tool_use_id) return this.subagentMessage(agent, msg.parent_tool_use_id, 'user', msg.message.content)
        const content = msg.message.content
        if (!Array.isArray(content)) return
        for (const block of content) {
          if (block.type !== 'tool_result') continue
          const text =
            typeof block.content === 'string' ? block.content : (block.content ?? []).map((c) => ('text' in c ? c.text : '')).join('\n')
          if (text.trim()) this.addLog(agent, 'tool_result', text.slice(0, 1200), undefined, block.is_error === true)
        }
        return
      }
      case 'result': {
        const hit = agent.limitHit
        agent.limitHit = undefined
        const isError = msg.subtype !== 'success' || msg.is_error
        if (agent.summary.sessionId && this.book) {
          const spent = this.book.record(agent.summary, agent.summary.sessionId, agent.summary.account, msg)
          if (spent > 0) agent.summary.spentUsd = (agent.summary.spentUsd ?? 0) + spent
        }
        const text =
          msg.subtype === 'success'
            ? msg.result
            : msg.subtype === 'error_max_budget_usd'
              ? this.budgetText(agent)
              : msg.errors.join('\n') || `Parei: ${msg.subtype}`
        agent.summary.costUsd = msg.total_cost_usd
        this.readContext(agent)
        // The turn is over, so no foreground subagent can still be running (covers an interrupt that lost its notification).
        for (const sub of agent.summary.subagents ?? []) if (!sub.background) this.retire(agent, sub, 'completed')
        if (agent.compacting) {
          agent.compacting = false
          if (isError) this.addLog(agent, 'error', `Não consegui compactar: ${text}`)
          this.setStatus(agent, 'idle', isError ? 'Não conseguiu compactar' : 'Memória organizada, esperando instruções')
          return
        }
        // A squad cycle is pinned to one Claude account for its whole lifecycle.
        if (hit && agent.summary.role === 'orchestrator') {
          if (agent.summary.account) this.accounts?.limitHit(agent.summary.account, hit.resetsAt)
        }
        else if (hit && this.failover(agent, hit)) return
        const limit = hit ? { accountId: agent.summary.account, resetsAt: hit.resetsAt } : undefined
        this.deliver(agent, { text, isError, costUsd: msg.total_cost_usd, durationMs: msg.duration_ms, turns: msg.num_turns, limit })
        return
      }
      default:
        return
    }
  }
}
