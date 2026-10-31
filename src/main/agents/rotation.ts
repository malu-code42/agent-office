import type { Settings } from '@shared/types'
import { CONTINUE_PROMPT, clock, usd, type Agent } from './types'
import { AgentSdk } from './sdk'

/** Fixed-account quota pauses and the per-agent spending cap. */
export abstract class AgentRotation extends AgentSdk {
  private limitWaiters = new Map<string, NodeJS.Timeout>()

  /**
   * A plan limit ends the current turn and pauses the task. The user's only choices are
   * wait for this account or end the task; another account is only valid for a new task.
   */
  protected pauseOnLimit(agent: Agent, hit: { resetsAt?: number }): boolean {
    if (agent.summary.engine === 'opencode') return false
    const accounts = this.accounts
    const from = agent.summary.account
    if (!from) return false
    agent.summary.quotaPaused = { accountId: from, ...(hit.resetsAt ? { resetsAt: hit.resetsAt } : {}) }
    if (!accounts) return false
    accounts.limitHit(from, hit.resetsAt)
    const renews = hit.resetsAt ? ` (renova às ${clock(hit.resetsAt)})` : ''
    this.addLog(
      agent,
      'system',
      `${accounts.name(from)} bateu o limite${renews}. A tarefa está pausada nesta conta; escolha aguardar ou encerrar.`,
    )
    return false
  }

  /**
   * Resume a paused conversation only on the account that started this task. A new account
   * can be selected for a new task, never for an in-flight conversation (AO-42).
   */
  continueOn(id: string, accountId: string): void {
    const agent = this.agents.get(id)
    const accounts = this.accounts
    if (!agent || agent.summary.source !== 'office' || agent.summary.departed || agent.demo || !accounts) return
    if (agent.summary.engine === 'opencode') throw new Error('Registros históricos OpenCode não podem ser retomados em outra conta.')
    if (agent.summary.quotaEnded) throw new Error('Esta tarefa foi encerrada. Limpe o contexto para iniciar uma conversa nova.')
    const next = accounts.get(accountId)
    if (!next) throw new Error('Essa conta não existe mais. Escolha outra.')
    if (agent.summary.role !== 'orchestrator' && !agent.summary.quotaPaused)
      throw new Error('Esta tarefa não está pausada por cota. Inicie outra tarefa para escolher uma conta.')
    if (agent.summary.quotaPaused && agent.summary.quotaPaused.accountId !== accountId)
      throw new Error('A tarefa está pausada na conta fixa. Não é possível retomá-la em outra conta.')
    if (agent.summary.account !== accountId) {
      if (agent.summary.role === 'orchestrator')
        throw new Error(
          'Este ciclo de squad está fixado à conta Claude escolhida ao iniciar. Retome com a mesma conta; uma troca exige encerrar o ciclo e iniciar outro.',
        )
      throw new Error('Esta tarefa está fixada à conta Claude escolhida ao iniciar. Encerre-a para começar uma nova tarefa em outra conta.')
    }
    if (this.busy(agent)) throw new Error(`${agent.summary.name} já voltou ao trabalho.`)
    if (accounts.out(accountId)) throw new Error(`${next.name} ainda está sem espaço. Aguarde nesta conta ou encerre a tarefa.`)
    this.dropResults(id)
    if (this.overBudget(agent)) return
    this.addLog(agent, 'system', `Continuando em ${next.name}, a seu pedido.`)
    this.closeProcess(agent)
    agent.borrowed = accountId
    if (agent.summary.quotaPaused) agent.resumeAccount = accountId
    this.setStatus(agent, 'starting', `Trocando para ${next.name}`)
    this.run(agent, CONTINUE_PROMPT)
  }

  /** The user's choice to wait retries only on the task's fixed account. */
  waitOnSameAccount(id: string): void {
    const agent = this.agents.get(id)
    const paused = agent?.summary.quotaPaused
    const accountId = paused?.accountId
    const accounts = this.accounts
    if (!agent || agent.summary.source !== 'office' || agent.summary.departed || agent.demo || !accounts || !accountId) return
    if (agent.summary.quotaEnded) throw new Error('Esta tarefa já foi encerrada e não será retomada.')
    if (this.busy(agent)) throw new Error(`${agent.summary.name} ainda está trabalhando.`)
    const limit = [...agent.log].reverse().find((entry) => entry.limit?.accountId === accountId)?.limit
    if (!limit) throw new Error('A pausa por limite não está mais ativa.')
    const old = this.limitWaiters.get(id)
    if (old) clearTimeout(old)
    this.addLog(agent, 'system', `Você escolheu aguardar a conta fixa ${accounts.name(accountId)}. A tarefa retomará somente nessa conta.`)

    let timer: NodeJS.Timeout
    const retry = () => {
      const current = this.agents.get(id)
      if (this.limitWaiters.get(id) !== timer) return
      if (!current) {
        this.limitWaiters.delete(id)
        return
      }
      if (accounts.out(accountId)) {
        const loggedOut = accounts.statuses().find((s) => s.id === accountId)?.loggedIn === false
        if (loggedOut) {
          void accounts
            .check()
            .catch(() => this.addLog(current, 'system', 'Não consegui verificar o login da conta fixa; a tarefa continua pausada.'))
        }
        timer = setTimeout(retry, 60_000)
        timer.unref?.()
        this.limitWaiters.set(id, timer)
        return
      }
      this.limitWaiters.delete(id)
      try {
        this.continueOn(id, accountId)
      } catch {
        // A concurrent user action may have ended or resumed the task.
      }
    }
    const knownReset = paused.resetsAt ?? limit.resetsAt ?? accounts.statuses().find((s) => s.id === accountId)?.limitedUntil
    timer = setTimeout(retry, Math.max(0, Math.min(knownReset ? knownReset - Date.now() : 60_000, 60_000)))
    timer.unref?.()
    this.limitWaiters.set(id, timer)
  }

  /** The explicit end action cancels any chosen wait but leaves the result available to acknowledge. */
  endQuotaTask(id: string): void {
    const agent = this.agents.get(id)
    if (!agent || agent.summary.source !== 'office' || agent.summary.departed || !agent.summary.quotaPaused) return
    this.clearLimitWaiter(id)
    agent.resumeAccount = undefined
    agent.summary.quotaEnded = true
    this.addLog(agent, 'system', 'Você encerrou esta tarefa pausada pela cota. Ela não será retomada; limpe o contexto para começar outra.')
    this.setStatus(agent, 'error', 'Tarefa encerrada após pausa por cota')
  }

  /**
   * Emi's model and effort (one setting for every floor). An idle Emi's process closes, so her
   * next turn resumes the same session with the new options; a working one switches model
   * live and takes the effort on her next process.
   */
  setEmiPreferences(settings: Pick<Settings, 'emiModel' | 'emiEffort'>): void {
    const model = settings.emiModel || undefined
    const effort = settings.emiEffort || undefined
    for (const agent of this.agents.values()) {
      const s = agent.summary
      if (s.builtIn !== 'emi') continue
      s.model = model
      s.effort = effort
      if (agent.query && s.status !== 'working' && s.status !== 'starting') this.closeProcess(agent)
      // a turn in flight keeps going; the model switches for its next message
      else void agent.query?.setModel(model).catch(() => undefined)
      this.upsert(agent)
    }
  }

  /** A CLI process is tied to one login: close it so the next run starts on another account. */
  private closeProcess(agent: Agent): void {
    this.clearLimitWaiter(agent.summary.id)
    if (agent.query) this.replaced.add(agent.query)
    agent.input?.close()
    agent.query?.close()
    agent.input = undefined
    agent.query = undefined
  }

  protected clearLimitWaiter(agentId: string): void {
    const waiter = this.limitWaiters.get(agentId)
    if (waiter) clearTimeout(waiter)
    this.limitWaiters.delete(agentId)
  }

  protected clearAllLimitWaiters(): void {
    for (const waiter of this.limitWaiters.values()) clearTimeout(waiter)
    this.limitWaiters.clear()
  }

  // ---------- spending cap ----------

  /** The agent already spent its cap: hands a card saying so instead of starting. */
  protected overBudget(agent: Agent): boolean {
    const cap = this.store.settings.agentBudgetUsd
    if (!(cap > 0) || (agent.summary.spentUsd ?? 0) < cap) return false
    this.deliver(agent, { text: this.budgetText(agent), isError: true, costUsd: agent.summary.costUsd, durationMs: 0, turns: 0 })
    return true
  }

  protected budgetText(agent: Agent): string {
    const cap = this.store.settings.agentBudgetUsd
    return (
      `Parei: cheguei ao teto de custo por agente (${usd(cap)}). Já gastei ${usd(agent.summary.spentUsd ?? 0)} neste escritório.\n\n` +
      'Para eu continuar, aumente o teto em Configurações › Limites dos agentes, ou deixe em 0 para tirar o limite.'
    )
  }
}
