// AO-84: liga a ponte Telegram (telegram-bridge.ts) ao app: configuração guardada, start/stop, estado para a tela e a Luna real.
//
// AO-109, parte 3: liga o gancho `confirmation` da ponte (telegram-confirm.ts): pedido destrutivo só segue com "SIM <código>" no mesmo chat.

import { log, secret } from './log'
import { createTelegramConfirmation } from './telegram-confirm'
import { TelegramBridge, type LunaPort, type TelegramState } from './telegram-bridge'
import type { TelegramSettingsStore } from './telegram-settings'
import type { TelegramSaveInput, TelegramView } from '@shared/telegram'

const MSG_LUNA_OFF = 'A Luna ainda não está pronta.'
const REASON_TOKEN_UNREADABLE = 'Não consegui ler o token guardado; informe o token de novo'

export interface TelegramServiceDeps {
  store: TelegramSettingsStore
  fetch?: typeof fetch
  /** Avisa a tela (e qualquer outro ouvinte) que o estado mudou. */
  onChange?: (view: TelegramView) => void
}

export class TelegramService {
  private readonly bridge: TelegramBridge
  private luna: LunaPort | undefined
  private chain: Promise<unknown> = Promise.resolve()

  constructor(private readonly deps: TelegramServiceDeps) {
    this.bridge = new TelegramBridge({
      config: () => deps.store.config(),
      luna: { ask: (request) => (this.luna ? this.luna.ask(request) : Promise.reject(new Error(MSG_LUNA_OFF))) },
      confirmation: createTelegramConfirmation().hook,
      fetch: deps.fetch,
      // A ponte só entrega textos fixos; mesmo assim passam pelo redator do log.
      log: (level, text) => log[level](`Telegram: ${text}`),
      onState: () => deps.onChange?.(this.view()),
    })
  }

  /** Quem fala com a Luna de verdade (ipc/iris.ts) se registra aqui quando o chat existe. */
  attachLuna(port: LunaPort): void {
    this.luna = port
  }

  /** A tela só vê isto: nunca o token. */
  view(): TelegramView {
    const summary = this.deps.store.summary()
    const state: TelegramState = this.bridge.getState()
    let status = state.status
    let reason = state.status === 'error' ? state.reason : undefined
    if (summary.enabled && status === 'off' && summary.tokenConfigured && !this.deps.store.config().token) {
      status = 'error'
      reason = REASON_TOKEN_UNREADABLE
    }
    return {
      enabled: summary.enabled,
      tokenConfigured: summary.tokenConfigured,
      chatId: summary.chatId,
      status,
      ...(reason ? { reason } : {}),
      storageAvailable: this.deps.store.storageAvailable,
    }
  }

  /** Valida, guarda e (re)aplica sem reiniciar o app. Lança a mensagem de validação e não liga nada se algo estiver errado. */
  save(input: TelegramSaveInput): Promise<TelegramView> {
    return this.serial(async () => {
      this.deps.store.save(input)
      await this.apply()
      return this.view()
    })
  }

  /** Na abertura do app: liga se a configuração guardada mandar. */
  startFromSettings(): Promise<void> {
    return this.serial(() => this.apply())
  }

  /** Ao fechar o app: aborta o polling e qualquer envio em andamento. O aborto é imediato (sem fila), pois o app já está saindo. */
  stop(): Promise<void> {
    return this.bridge.stop()
  }

  private async apply(): Promise<void> {
    secret(this.deps.store.tokenForRedaction())
    await this.bridge.start()
    this.deps.onChange?.(this.view())
  }

  private serial<T>(job: () => Promise<T>): Promise<T> {
    const next = this.chain.then(job, job)
    this.chain = next.catch(() => undefined)
    return next
  }
}
