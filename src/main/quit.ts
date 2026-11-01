import { app, dialog, type BrowserWindow } from 'electron'
import type { AgentSummary, QuitWait } from '@shared/types'
import { log } from './log'

/** A background task (subagent) an office agent still runs after its turn. */
export interface BackgroundTask {
  agentId: string
  agentName: string
  description: string
}

export interface QuitDeps {
  win: () => BrowserWindow | null
  /** Office agents working right now (terminal sessions are the terminal's to close). */
  working: () => AgentSummary[]
  /** Permission requests still waiting for you. */
  pending: () => number
  interrupt: (agentId: string) => Promise<void>
  /** Background subagents the office agents still run. */
  background: () => BackgroundTask[]
  /** No new routine runs while the app waits to leave. */
  holdRoutines: (hold: boolean) => void
  broadcast: (wait: QuitWait | null) => void
  /** Screenshot and bench runs quit on their own: never ask there. */
  headless?: boolean
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** Resolves when `p` settles or after `ms`, whichever comes first. */
const settle = (p: Promise<unknown>, ms: number) => Promise.race([p.catch(() => undefined), new Promise((r) => setTimeout(r, ms))])

/**
 * Leaving the office on purpose: the "Sair" button, ⌘Q or closing the window off macOS.
 * Asks first, then either waits for the agents to finish, interrupts them (each
 * conversation stays saved and comes back on the next start) or stays. Background
 * subagents can be stopped at once or waited for too. Only then does before-quit run
 * the usual stopAll.
 */
export class QuitFlow {
  private allowed = false
  private asking = false
  private wait: { stopBg: boolean; timer: NodeJS.Timeout } | null = null

  constructor(private deps: QuitDeps) {}

  /** Lets the next quit through without asking (the updater installing, a data restore). */
  allow(): void {
    this.allowed = true
  }

  /**
   * before-quit and the window's close: true = hold the quit and ask. A plain quit
   * (⌘Q, closing the window) with nobody working goes through as it always did; the Sair
   * button always asks.
   */
  intercept(): boolean {
    if (this.allowed || this.deps.headless) return false
    if (!this.deps.working().length && !this.deps.pending() && !this.deps.background().length) return false
    void this.ask()
    return true
  }

  async ask(): Promise<'quit' | 'waiting' | 'cancelled'> {
    if (this.asking) return 'cancelled'
    this.asking = true
    try {
      return await this.dialog()
    } finally {
      this.asking = false
    }
  }

  private async dialog(): Promise<'quit' | 'waiting' | 'cancelled'> {
    const working = this.deps.working()
    const pending = this.deps.pending()
    const bg = this.deps.background()
    const win = this.deps.win()
    const checkboxLabel = bg.length
      ? `Parar também ${plural(bg.length, 'tarefa em segundo plano', 'tarefas em segundo plano')} dos agentes, sem esperar por ${bg.length === 1 ? 'ela' : 'elas'}`
      : undefined
    const box = (opts: Electron.MessageBoxOptions) => (win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts))

    if (!working.length && !pending && !bg.length) {
      const r = await box({
        type: 'question',
        buttons: ['Sair', 'Cancelar'],
        defaultId: 0,
        cancelId: 1,
        message: 'Sair do Agent Office?',
        detail: 'Os agentes ficam salvos e voltam quando você abrir de novo, com a conversa onde parou.',
      })
      if (r.response !== 0) return 'cancelled'
      await this.leave(false)
      return 'quit'
    }

    const who = working.map((a) => `• ${a.name}: ${a.activity || 'trabalhando'}`)
    const tasks = bg.map((t) => `• ${t.agentName} (segundo plano): ${t.description}`)
    const waits = pending ? `\n\n${plural(pending, 'pedido de permissão espera', 'pedidos de permissão esperam')} você.` : ''
    const r = await box({
      type: 'warning',
      buttons: ['Esperar terminarem e sair', 'Interromper e sair', 'Cancelar'],
      defaultId: 0,
      cancelId: 2,
      message: working.length
        ? plural(working.length, 'agente está trabalhando', 'agentes estão trabalhando')
        : pending
          ? 'Tem pedido esperando você'
          : plural(bg.length, 'tarefa segue em segundo plano', 'tarefas seguem em segundo plano'),
      detail:
        `${[...who, ...tasks].slice(0, 12).join('\n')}${waits}\n\n` +
        'Esperar: o app sai sozinho quando o último terminar, e nenhuma rotina nova começa até lá.\n' +
        'Interromper: cada agente para onde está, com as tarefas em segundo plano. A conversa fica salva; quando você voltar, é só pedir para continuar.',
      checkboxLabel,
      checkboxChecked: false,
    })
    const stopBg = !!r.checkboxChecked && bg.length > 0
    if (r.response === 2) return 'cancelled'
    if (r.response === 1) {
      await this.interruptAll(true)
      await this.leave(false)
      return 'quit'
    }
    this.startWaiting(stopBg)
    return 'waiting'
  }

  /** What still holds the quit: background tasks count only when the player chose to wait for them. */
  private left(stopBg: boolean): QuitWait {
    return { working: this.deps.working().length, pending: this.deps.pending(), background: stopBg ? 0 : this.deps.background().length }
  }

  private startWaiting(stopBg: boolean): void {
    this.cancelWait()
    this.deps.holdRoutines(true)
    log.info('Saindo quando os agentes terminarem')
    const tick = () => {
      const w = this.left(stopBg)
      if (!w.working && !w.pending && !w.background) {
        void this.leave(stopBg)
        return
      }
      this.deps.broadcast(w)
    }
    this.wait = { stopBg, timer: setInterval(tick, 2000) }
    tick()
  }

  /** "Ficar" on the banner: the app goes on as before. */
  cancelWait(): void {
    if (!this.wait) return
    clearInterval(this.wait.timer)
    this.wait = null
    this.deps.holdRoutines(false)
    this.deps.broadcast(null)
    log.info('Saída cancelada')
  }

  /** "Interromper e sair agora" on the banner. */
  async now(): Promise<void> {
    await this.interruptAll(true)
    await this.leave(false)
  }

  /** Interrupts the working agents and, with `withBg`, the ones holding background tasks (the interrupt stops those too). */
  private async interruptAll(withBg: boolean): Promise<void> {
    const ids = new Set(this.deps.working().map((a) => a.id))
    if (withBg) for (const t of this.deps.background()) ids.add(t.agentId)
    if (!ids.size) return
    log.info(`Interrompendo ${ids.size} agente(s) para sair`)
    await settle(Promise.all([...ids].map((id) => this.deps.interrupt(id))), 5000)
  }

  private async leave(stopBg: boolean): Promise<void> {
    if (this.wait) clearInterval(this.wait.timer)
    this.wait = null
    if (stopBg) {
      const ids = new Set(this.deps.background().map((t) => t.agentId))
      if (ids.size) {
        log.info(`Parando as tarefas em segundo plano de ${ids.size} agente(s) antes de sair`)
        await settle(Promise.all([...ids].map((id) => this.deps.interrupt(id))), 5000)
      }
    }
    this.allowed = true
    this.deps.broadcast(null)
    // before-quit runs stopAll: sessions closed, everything written to disk.
    app.quit()
  }
}
