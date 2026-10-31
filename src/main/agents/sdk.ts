import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { query, type HookCallbackMatcher, type Query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { describeTool, toolDetail } from '@shared/describe'
import { MAIN_ACCOUNT } from '@shared/accounts'
import { HELPER_MAX, helperLimit, helperLimitReason } from '@shared/subagents'
import { homedir } from 'node:os'
import { accountEnv } from '../accounts'
import { agentPlugins } from '../agent-plugins'
import { LUNA_PROMPT } from '../luna-prompt'
import { LUNA_SERVER } from '../luna-tools'
import { emiPrompt } from '../emi-prompt'
import { EMI_SERVER } from '../emi-tools'
import { claudeNotFoundMessage } from '../claude-messages'
import { findClaude } from '../claude-path'
import { findSquad, memberAgents, orchestratorPrompt, teamGuard, validateSquad, type SquadDefinition } from '../squads'
import { takeSnapshot } from '../git'
import { InputQueue, kTokens, toMs, WRITE_TOOLS, type Agent, type Prompt } from './types'
import { AgentOffice } from './office'

/** Runs on the Claude Agent SDK: starting the query and turning its messages into status, activity and log. */
export abstract class AgentSdk extends AgentOffice {
  /** CLI processes closed on purpose to move to another account: their end is not an error. */
  protected replaced = new WeakSet<Query>()

  protected run(agent: Agent, prompt: Prompt): void {
    const s = agent.summary
    agent.lastPrompt = prompt
    if (s.engine === 'opencode') {
      this.setStatus(agent, 'stopped', 'Registro histórico OpenCode · somente leitura')
      return
    }
    if (s.quotaEnded) throw new Error('Esta tarefa foi encerrada após a pausa de cota. Limpe o contexto para iniciar outra.')
    if (s.quotaPaused && agent.resumeAccount !== s.quotaPaused.accountId)
      throw new Error(
        'Esta tarefa está pausada pela cota. Somente a espera pela conta fixa pode retomá-la; encerre-a para começar outra tarefa.',
      )
    if (this.simulate) return this.simulate(s.id, typeof prompt === 'string' ? prompt : '(mensagem com anexos)')
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
    const canonicalSquad = s.role === 'orchestrator' && s.squad ? findSquad(s.cwd, s.squad) : undefined
    const squad = canonicalSquad && s.worktree ? { ...canonicalSquad, cwd: s.worktree.path } : canonicalSquad
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
    const luna = s.builtIn === 'luna'
    const workDir = luna ? this.lunaHome() : (wt?.path ?? s.cwd)
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
    // A new task (not a continuation or a /compact): remember the folder as it is now, so the
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

  /** Starts the CLI process for `run`, reading `input`. */
  protected startQuery(agent: Agent, input: InputQueue, claude: string, workDir: string, squad: SquadDefinition | undefined): void {
    const s = agent.summary
    const wt = s.worktree
    const luna = s.builtIn === 'luna'
    const emiFloor = s.builtIn === 'emi' ? this.store.settings.projects.find((p) => p.id === s.project) : undefined
    const before = s.account
    const paused = s.quotaPaused
    let account: ReturnType<NonNullable<typeof this.accounts>['get']>
    if (paused) {
      account = agent.resumeAccount === paused.accountId ? this.accounts?.get(paused.accountId) : undefined
      if (!account || !this.accounts || this.accounts.out(paused.accountId)) {
        agent.resumeAccount = undefined
        this.deliver(agent, {
          text: `A conta fixa (${paused.accountId}) ainda não está disponível. A tarefa continua pausada nessa conta.`,
          isError: true,
          costUsd: s.costUsd,
          durationMs: 0,
          turns: 0,
          limit: paused,
        })
        return
      }
    } else {
      account = squad && s.account && this.accounts ? this.accounts.get(s.account) : this.accounts?.pick(s, agent.borrowed)
    }
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
    if (paused) {
      s.quotaPaused = undefined
      agent.resumeAccount = undefined
    }
    const resumed = agent.started
    if (s.sessionId) {
      this.book?.begin(s.sessionId, resumed, s.costUsd)
      this.book?.switched(s, s.sessionId, s.account ?? MAIN_ACCOUNT, before, 'start')
    }
    const limits = this.store.settings
    const budget = limits.agentBudgetUsd > 0 ? limits.agentBudgetUsd - (s.spentUsd ?? 0) : undefined
    // The cap of the desk, enforced in the runtime: a spawn that would put a fourth
    // helper at the desk is refused, and the reason shows up in the conversation.
    const helperMax = helperLimit(limits.maxSubagents)
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
        // Plugins (caveman, context-mode…) and the chosen skills come in explicitly instead (#106).
        plugins: agentPlugins(
          join(homedir(), '.claude'),
          join(this.store.dataDirectory, 'agent-skills'),
          limits.agentPluginsOff ?? [],
          limits.agentSkills ?? [],
        ),
        // Subagent text comes too (not only tools), for the helper's own log (AO-46).
        forwardSubagentText: true,
        allowDangerouslySkipPermissions: s.permissionMode === 'bypassPermissions',
        // Counts only what this query spends, so it gets what is left of the agent's cap.
        ...(budget !== undefined ? { maxBudgetUsd: budget } : {}),
        ...(agent.started ? { resume: s.sessionId } : { sessionId: s.sessionId }),
        ...(luna ? { additionalDirectories: this.lunaRoots().filter((dir) => dir !== workDir) } : {}),
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: luna
            ? LUNA_PROMPT
            : emiFloor
              ? emiPrompt(emiFloor)
              : `Your name in this office is ${s.name}. Your final message for each task is handed to the user in person as a report: ` +
                'open with the outcome in one or two sentences, then list the key details. Reply in the language the user wrote in. ' +
                'The office has a kanban board of tickets (keys like AO-12); use the mcp__office__ tools to read, open, comment on and move tickets when asked or when you are working on one.' +
                (wt
                  ? `\n\nYou work in your own git worktree at ${wt.root} on branch ${wt.branch}, so other agents never touch your files. ` +
                    `Make every change here; do not edit the main checkout at ${wt.repo}. The user reviews, commits and opens the pull request from the office.`
                  : '') +
                (squad ? `\n\n${orchestratorPrompt(squad)}` : ''),
        },
        ...(squad ? { agents: memberAgents(squad) } : {}),
        hooks: { PreToolUse: [...(squad ? teamGuard(squad) : []), this.helperCapHook(agent, helperMax)] },
        mcpServers: {
          ...(this.officeTools ? { office: this.officeTools(s) } : {}),
          ...(luna && this.lunaTools ? { [LUNA_SERVER]: this.lunaTools() } : {}),
          ...(emiFloor && this.emiTools ? { [EMI_SERVER]: this.emiTools(emiFloor.id) } : {}),
        },
        // Lets the terminal bridge ignore hook events coming from office-managed sessions.
        env: {
          ...accountEnv(account),
          AGENT_OFFICE_MANAGED: '1',
          // The cap the CLI enforces on subagents running at once (its default is 20).
          // Only when the player set one tighter than the room: otherwise the Office
          // refuses the call itself, so the reason is never silent.
          ...(helperMax < HELPER_MAX ? { CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: String(helperMax) } : {}),
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

  /**
   * The cap of the desk, applied to the real runtime: a spawn call that would put a
   * fourth helper at the desk is refused, and the reason is written in the
   * conversation of the agent (the model reads it in the refusal of the call).
   * The team of an orchestrator is closed and its members have a desk of their own
   * in the squad room, so they never take a slot here.
   */
  protected helperCapHook(agent: Agent, limit: number): HookCallbackMatcher {
    return {
      matcher: '^(Agent|Task)$',
      hooks: [
        async (input) => {
          if (input.hook_event_name !== 'PreToolUse') return {}
          if (agent.squad) return {}
          // Calls in the same message come before the CLI reports any of them: the
          // reserved ones already take a slot at the desk.
          const active = this.runningHelpers(agent) + (agent.helperReservations?.size ?? 0)
          if (active < limit) {
            if (input.tool_use_id) (agent.helperReservations ??= new Set()).add(input.tool_use_id)
            return {}
          }
          const reason = helperLimitReason(limit, active)
          this.addLog(agent, 'error', reason)
          return {
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: 'deny',
              permissionDecisionReason: reason,
            },
          }
        },
      ],
    }
  }

  /** Subagents that stand at the agent's desk: a squad member has a desk of its own. */
  protected runningHelpers(agent: Agent): number {
    return (agent.summary.subagents ?? []).filter((s) => !s.member).length
  }

  /** Gives back the slot of a spawn the CLI refused to start. */
  protected releaseHelperSlot(agent: Agent, toolUseId: string): void {
    agent.helperReservations?.delete(toolUseId)
  }

  protected async consume(agent: Agent, q: Query): Promise<void> {
    try {
      for await (const msg of q) this.handle(agent, msg)
    } catch (err) {
      // Closed on purpose to move to another account: the new process carries on.
      if (this.replaced.has(q) || (agent.query && agent.query !== q)) return
      const text = err instanceof Error ? err.message : String(err)
      this.addLog(agent, 'error', text)
      // The saved conversation is gone (other account folder, moved cwd, cleared ~/.claude):
      // start a fresh session once and re-send the message instead of failing every turn.
      if (isLostSession(text) && agent.lastPrompt && this.agents.has(agent.summary.id)) {
        const prompt = agent.lastPrompt
        agent.lastPrompt = undefined
        agent.started = false
        agent.summary.sessionId = randomUUID()
        agent.query = undefined
        this.addLog(agent, 'system', 'A conversa anterior não foi encontrada; comecei uma nova.')
        this.run(agent, prompt)
        return
      }
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
        // The turn is over: no spawn is waiting for a slot at the desk anymore.
        agent.helperReservations?.clear()
        const isError = msg.subtype !== 'success' || msg.is_error || (!!hit && agent.summary.role !== 'orchestrator')
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
        } else if (hit && this.pauseOnLimit(agent, hit)) return
        const limit = hit ? { accountId: agent.summary.account, resetsAt: hit.resetsAt } : undefined
        this.deliver(agent, { text, isError, costUsd: msg.total_cost_usd, durationMs: msg.duration_ms, turns: msg.num_turns, limit })
        return
      }
      default:
        return
    }
  }
}

/** Claude Code could not find the session it was asked to resume. */
export function isLostSession(message: string): boolean {
  return /No conversation found with session ID/i.test(message)
}
