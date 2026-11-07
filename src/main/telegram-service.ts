// AO-84: liga a ponte Telegram (telegram-bridge.ts) ao app: configuração guardada, start/stop, estado para a tela e a Luna real.
//
// AO-109, parte 3: liga o gancho `confirmation` da ponte (telegram-confirm.ts): pedido destrutivo só segue com "SIM <código>" no mesmo chat.

import { log, secret } from './log'
import { createTelegramConfirmation } from './telegram-confirm'
import { TelegramBridge, type LunaPort, type TelegramState } from './telegram-bridge'
import type { TelegramChange, TelegramSettingsStore } from './telegram-settings'
import { ChatVerification, botSender, type ChatVerificationDeps } from './telegram-verify'
import {
  MSG_ALREADY_VERIFIED,
  MSG_CHANGE_DECLINED,
  MSG_CODE_FORMAT,
  MSG_NEEDS_VERIFICATION,
  MSG_VERIFY_NEEDS_CONFIG,
  isValidVerificationCode,
  type TelegramSaveInput,
  type TelegramView,
} from '@shared/telegram'

const MSG_LUNA_OFF = 'A Luna ainda não está pronta.'
const REASON_TOKEN_UNREADABLE = 'Não consegui ler o token guardado; informe o token de novo'

export interface TelegramServiceDeps {
  store: TelegramSettingsStore
  fetch?: typeof fetch
  /**
   * AO-111: pergunta no processo principal (diálogo nativo) se pode mudar chat_id ou token. Obrigatório de propósito:
   * sem quem pergunte, nada que mude destino é salvo.
   */
  confirmChange: (change: TelegramChange) => Promise<boolean>
  /** AO-112: troca o envio do código (os testes simulam; padrão é a Bot API). */
  sendCode?: (token: string) => ChatVerificationDeps['send']
  now?: () => number
  newCode?: () => string
  /** Avisa a tela (e qualquer outro ouvinte) que o estado mudou. */
  onChange?: (view: TelegramView) => void
}

export class TelegramService {
  private readonly bridge: TelegramBridge
  private luna: LunaPort | undefined
  private chain: Promise<unknown> = Promise.resolve()
  private readonly verification: ChatVerification
  private verifySend: ChatVerificationDeps['send'] = () => Promise.reject(new Error('no-token'))

  constructor(private readonly deps: TelegramServiceDeps) {
    this.verification = new ChatVerification({
      send: (chatId, text) => this.verifySend(chatId, text),
      now: deps.now,
      newCode: deps.newCode,
    })
    this.bridge = new TelegramBridge({
      // AO-112: sem chat_id verificado a ponte não liga, mesmo com tudo "ligado" no arquivo.
      config: () => {
        const config = deps.store.config()
        return { ...config, enabled: config.enabled && deps.store.isVerified() }
      },
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
    const verified = this.deps.store.isVerified()
    if (summary.enabled && !verified && status === 'off') {
      status = 'error'
      reason = MSG_NEEDS_VERIFICATION
    } else if (summary.enabled && status === 'off' && summary.tokenConfigured && !this.deps.store.config().token) {
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
      verified,
      codePending: this.verification.hasPending(),
    }
  }

  /** Valida, guarda e (re)aplica sem reiniciar o app. Lança a mensagem de validação e não liga nada se algo estiver errado. */
  save(input: TelegramSaveInput): Promise<TelegramView> {
    return this.serial(async () => {
      // AO-111: validar primeiro (erro claro, nada gravado); depois, se muda destino, o processo principal pergunta.
      const change = this.deps.store.changes(input)
      if (change.chat || change.token) {
        this.deps.store.validate(input)
        if (!(await this.deps.confirmChange(change))) throw new Error(MSG_CHANGE_DECLINED)
      }
      this.deps.store.save(input)
      if (change.chat || change.token) this.verification.clear()
      await this.apply()
      return this.view()
    })
  }

  /** AO-112: o bot envia um código de uso único ao chat_id salvo. O código não volta para a tela. */
  requestCode(): Promise<TelegramView> {
    return this.serial(async () => {
      const summary = this.deps.store.summary()
      const token = this.deps.store.tokenForRedaction()
      if (!summary.tokenConfigured || !summary.chatId || !token) throw new Error(MSG_VERIFY_NEEDS_CONFIG)
      if (this.deps.store.isVerified()) throw new Error(MSG_ALREADY_VERIFIED)
      this.verifySend = (this.deps.sendCode ?? ((t) => botSender(t, this.deps.fetch)))(token)
      try {
        await this.verification.request(summary.chatId)
      } finally {
        this.deps.onChange?.(this.view())
      }
      return this.view()
    })
  }

  /** AO-112: confere o código digitado; certo marca o chat_id como verificado e liga a ponte se estiver ligada. */
  submitCode(typed: string): Promise<TelegramView> {
    return this.serial(async () => {
      const code = typed.trim()
      if (!isValidVerificationCode(code)) throw new Error(MSG_CODE_FORMAT)
      try {
        this.verification.check(code, this.deps.store.summary().chatId)
      } catch (err) {
        this.deps.onChange?.(this.view())
        throw err
      }
      this.deps.store.markVerified()
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
