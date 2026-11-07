// AO-83: ponte entre o Telegram e a Luna, no processo principal.
//
// Long polling (getUpdates) e sendMessage com fetch nativo, só enquanto o app está aberto (stop() aborta tudo).
// A configuração chega por injeção (AO-84 cuida da tela e do token criptografado); aqui não há armazenamento.
//
// Segurança:
// - Só o chat_id da lista de permitidos é atendido; qualquer outro é ignorado, sem resposta e sem chamar a Luna.
// - O token vai na URL da Bot API, por isso NENHUM erro de fetch é registrado com a mensagem original (ela pode trazer a URL):
//   o log só recebe textos fixos e códigos HTTP. O estado exposto também usa só motivos curtos fixos.
// - Confirmação de ação destrutiva é por CÓDIGO (AO-109, parte 3): o gancho `confirmation` (telegram-confirm.ts, ligado em
//   telegram-service.ts) segura o pedido destrutivo até a usuária responder "SIM <código>" neste mesmo chat. LUNA_TELEGRAM_RULE
//   no prompt continua como segunda camada (orientação ao modelo), nunca como a única.
// - Mensagens antigas (recebidas com o app fechado) e excesso por hora são descartados (AO-109, parte 3).
// - Cartões de permissão do app (commit, push, PR...) nunca são aprovados por aqui: a ponte só avisa "confirme no Agent Office".
// - A regra única de commit/PR/merge continua em commit-rule.ts, já presente no prompt da Luna; a ponte não a altera.

import { IRIS_REQUEST_MAX } from '@shared/iris'
import { LUNA_TELEGRAM_RULE } from './luna-prompt'

export const TELEGRAM_MAX_MESSAGE = 4096
/**
 * Mensagem recebida acima disso nem chega à Luna. É o mesmo limite do pedido da Luna no app (AO-85): antes eram 4000 aqui e 2000 lá,
 * e uma mensagem entre os dois passava pela ponte para só então falhar com a resposta genérica "A Luna não conseguiu concluir".
 */
export const TELEGRAM_MAX_INCOMING = IRIS_REQUEST_MAX
/** Máximo de mensagens aceitas por chat dentro da janela; o excedente é descartado. */
export const TELEGRAM_RATE_LIMIT = { max: 10, windowMs: 60_000 }
/** Limite por hora (AO-85, falha 4): 10 por minuto ainda poderiam virar 600 chamadas ao Claude por hora. */
export const TELEGRAM_HOURLY_LIMIT = { max: 60, windowMs: 3_600_000 }
/** Mensagem mais velha que isto ao ser lida (ex.: enviada com o app fechado) é descartada, com um aviso por chat (AO-85, falha 1). */
export const TELEGRAM_MAX_AGE_MS = 5 * 60_000
/** Uma resposta gigante não vira uma enxurrada de mensagens. */
export const TELEGRAM_MAX_PARTS = 8

export const MSG_CONFIRM_IN_APP =
  'Confirme no Agent Office: essa ação precisa do cartão de permissão do app, e ele não pode ser aprovado pelo Telegram.'
export const MSG_TOO_LONG = 'Essa mensagem é grande demais para a Luna. Mande um texto mais curto.'
export const MSG_RATE_LIMIT = 'Muitas mensagens em pouco tempo. Aguarde um minuto e tente de novo.'
export const MSG_HOURLY_LIMIT = 'Você chegou ao limite de mensagens por hora para a Luna. Tente de novo mais tarde.'
export const MSG_STALE =
  'Ignorei mensagem(ns) antiga(s) que chegaram enquanto o Agent Office estava fechado ou parado. Se ainda valer, mande de novo.'
export const MSG_LUNA_FAILED = 'A Luna não conseguiu concluir esse pedido. Tente novamente.'

export type TelegramState = { status: 'off' } | { status: 'connecting' } | { status: 'connected' } | { status: 'error'; reason: string }

export interface TelegramConfig {
  enabled: boolean
  token: string
  /** Lista de permitidos (chat_id de conversa privada). */
  chatIds: number[]
}

export interface LunaTurn {
  text: string
  /** A Luna parou esperando um cartão de permissão do app; a ponte avisa a usuária e não aprova nada. */
  needsAppCard?: boolean
}

export interface LunaPort {
  /** `channelRules` é o texto extra do canal Telegram, que o host deve juntar ao prompt da Luna nessa mensagem. */
  ask(request: { text: string; channel: 'telegram'; channelRules: string }): Promise<LunaTurn>
}

/**
 * Confirmação por código para ações destrutivas (implementada em telegram-confirm.ts). É chamado, só para chat permitido, antes de
 * a Luna ver a mensagem. Pode responder sozinho (`handled: true`, ex.: "responda SIM <código>") ou deixar passar
 * (`handled: false`); neste caso `text` troca o texto que a Luna recebe (o pedido original, ao confirmar) e `reply` é enviado antes.
 * Sem o gancho, toda mensagem permitida vai direto à Luna.
 */
export type TelegramConfirmationHook = (message: {
  chatId: number
  text: string
}) => Promise<{ handled: false; text?: string; reply?: string } | { handled: true; reply?: string }>

export interface TelegramBridgeDeps {
  config(): TelegramConfig
  luna: LunaPort
  confirmation?: TelegramConfirmationHook
  fetch?: typeof fetch
  log?: (level: 'info' | 'warn' | 'error', text: string) => void
  onState?: (state: TelegramState) => void
  now?: () => number
  /** Espera abortável; os testes trocam por uma versão instantânea. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
}

const API = 'https://api.telegram.org'
const POLL_SECONDS = 30
const BACKOFF = { start: 1000, max: 30_000 }
const SEND_ATTEMPTS = 3

interface Update {
  update_id: number
  message?: { text?: string; date?: number; chat?: { id?: number; type?: string } }
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfter?: number,
  ) {
    super(`HTTP ${status}`)
  }
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(done, ms)
    function done(): void {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done)
  })
}

/** Divide em partes de até `max` unidades, preferindo quebra de linha ou espaço e sem cortar um par substituto. */
export function splitTelegramText(text: string, max = TELEGRAM_MAX_MESSAGE): string[] {
  const parts: string[] = []
  let rest = text
  while (rest.length > max) {
    let cut = max
    const window = rest.slice(0, max)
    const breakAt = Math.max(window.lastIndexOf('\n'), window.lastIndexOf(' '))
    if (breakAt > max / 2) cut = breakAt + 1
    else {
      const last = rest.charCodeAt(cut - 1)
      if (last >= 0xd800 && last <= 0xdbff) cut -= 1
    }
    parts.push(rest.slice(0, cut))
    rest = rest.slice(cut)
  }
  if (rest) parts.push(rest)
  return parts
}

export class TelegramBridge {
  private state: TelegramState = { status: 'off' }
  private controller?: AbortController
  private loop?: Promise<void>
  private offset = 0
  private readonly recent = new Map<number, number[]>()
  private readonly warned = new Set<number>()
  private readonly recentHour = new Map<number, number[]>()
  private readonly warnedHour = new Set<number>()

  constructor(private readonly deps: TelegramBridgeDeps) {}

  getState(): TelegramState {
    return this.state
  }

  /** Liga se a configuração permitir (ligado, com token e ao menos um chat). Chamar de novo reinicia com a configuração atual. */
  async start(): Promise<void> {
    await this.stop()
    const config = this.deps.config()
    if (!config.enabled || !config.token || config.chatIds.length === 0) return
    const controller = new AbortController()
    this.controller = controller
    this.setState({ status: 'connecting' })
    this.loop = this.poll(config, controller.signal).catch(() => {
      // O laço trata os próprios erros; nada aqui pode escapar nem registrar detalhes (a URL carrega o token).
    })
  }

  /** Aborta o polling e qualquer envio em andamento e espera o laço terminar. */
  async stop(): Promise<void> {
    const controller = this.controller
    this.controller = undefined
    controller?.abort()
    await this.loop
    this.loop = undefined
    this.recent.clear()
    this.warned.clear()
    this.recentHour.clear()
    this.warnedHour.clear()
    if (this.state.status !== 'off') this.setState({ status: 'off' })
  }

  private setState(state: TelegramState): void {
    this.state = state
    this.deps.onState?.(state)
  }

  private log(level: 'info' | 'warn' | 'error', text: string): void {
    this.deps.log?.(level, text)
  }

  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    return (this.deps.sleep ?? abortableSleep)(ms, signal)
  }

  /** Chamada à Bot API. Erros viram HttpError ou um Error genérico, nunca com a mensagem original (pode conter a URL com o token). */
  private async call<T>(config: TelegramConfig, method: string, body: unknown, signal: AbortSignal): Promise<T> {
    let response: Response
    try {
      response = await (this.deps.fetch ?? fetch)(`${API}/bot${config.token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      })
    } catch {
      if (signal.aborted) throw new Error('aborted')
      throw new Error('network')
    }
    if (!response.ok) {
      let retryAfter: number | undefined
      try {
        const data = (await response.json()) as { parameters?: { retry_after?: number } }
        retryAfter = data.parameters?.retry_after
      } catch {
        // Corpo de erro ilegível: só o status interessa.
      }
      throw new HttpError(response.status, retryAfter)
    }
    try {
      const data = (await response.json()) as { ok?: boolean; result?: T }
      if (!data.ok) throw new Error('bad-response')
      return data.result as T
    } catch {
      if (signal.aborted) throw new Error('aborted')
      throw new Error('bad-response')
    }
  }

  private async poll(config: TelegramConfig, signal: AbortSignal): Promise<void> {
    let backoff = BACKOFF.start
    while (!signal.aborted) {
      try {
        const updates = await this.call<Update[]>(
          config,
          'getUpdates',
          { offset: this.offset, timeout: POLL_SECONDS, allowed_updates: ['message'] },
          signal,
        )
        if (signal.aborted) return
        backoff = BACKOFF.start
        if (this.state.status !== 'connected') {
          this.setState({ status: 'connected' })
          this.log('info', 'Telegram conectado.')
        }
        const staleChats = new Set<number>()
        for (const update of Array.isArray(updates) ? updates : []) {
          this.offset = Math.max(this.offset, update.update_id + 1)
          await this.handle(config, update, signal, staleChats)
          if (signal.aborted) return
        }
        for (const chatId of staleChats) await this.reply(config, chatId, MSG_STALE, signal)
      } catch (error) {
        if (signal.aborted) return
        if (error instanceof HttpError && (error.status === 401 || error.status === 404)) {
          // Token inválido: insistir só gera erro; para até a usuária corrigir e religar.
          this.setState({ status: 'error', reason: 'Token recusado pelo Telegram' })
          this.log('error', 'Telegram recusou o token; a ponte parou.')
          return
        }
        const reason = error instanceof HttpError ? `Telegram respondeu com erro ${error.status}` : 'Sem conexão com o Telegram'
        this.setState({ status: 'error', reason })
        this.log('warn', `${reason}; nova tentativa em ${Math.round(backoff / 1000)} s.`)
        await this.sleep(this.waitFor(error, backoff), signal)
        backoff = Math.min(backoff * 2, BACKOFF.max)
      }
    }
  }

  private waitFor(error: unknown, backoff: number): number {
    return error instanceof HttpError && error.retryAfter ? Math.min(error.retryAfter * 1000, BACKOFF.max) : backoff
  }

  private async handle(config: TelegramConfig, update: Update, signal: AbortSignal, staleChats: Set<number>): Promise<void> {
    const message = update.message
    const chatId = message?.chat?.id
    // Allowlist: quem não está nela não recebe nada e a Luna nem fica sabendo.
    if (typeof chatId !== 'number' || message?.chat?.type !== 'private' || !config.chatIds.includes(chatId)) return
    const text = message.text
    if (typeof text !== 'string' || !text.trim()) return

    // Mensagem antiga (ou sem data legível: na dúvida, descarta) não é executada; a usuária recebe um aviso por lote.
    const date = message.date
    const sentAt = typeof date === 'number' && Number.isFinite(date) ? date * 1000 : undefined
    if (sentAt === undefined || (this.deps.now ?? Date.now)() - sentAt > TELEGRAM_MAX_AGE_MS) {
      staleChats.add(chatId)
      return
    }

    const admitted = this.admit(chatId)
    if (admitted !== 'ok') {
      const warned = admitted === 'minute' ? this.warned : this.warnedHour
      if (!warned.has(chatId)) {
        warned.add(chatId)
        await this.reply(config, chatId, admitted === 'minute' ? MSG_RATE_LIMIT : MSG_HOURLY_LIMIT, signal)
      }
      return
    }
    if (text.length > TELEGRAM_MAX_INCOMING) {
      await this.reply(config, chatId, MSG_TOO_LONG, signal)
      return
    }

    // Texto repassado como veio: a ponte não interpreta nem altera regras; "ignore suas regras" é só mais uma mensagem para a Luna.
    let forLuna = text
    if (this.deps.confirmation) {
      let decision: Awaited<ReturnType<TelegramConfirmationHook>>
      try {
        decision = await this.deps.confirmation({ chatId, text })
      } catch {
        // O gancho falhou: na dúvida, o pedido NÃO segue.
        this.log('warn', 'A confirmação do Telegram falhou; o pedido não foi repassado.')
        await this.reply(config, chatId, MSG_LUNA_FAILED, signal)
        return
      }
      if (decision.reply) await this.reply(config, chatId, decision.reply, signal)
      if (decision.handled) return
      if (typeof decision.text === 'string') forLuna = decision.text
    }
    let turn: LunaTurn
    try {
      turn = await this.deps.luna.ask({ text: forLuna, channel: 'telegram', channelRules: LUNA_TELEGRAM_RULE })
    } catch {
      if (signal.aborted) return
      this.log('warn', 'A Luna falhou ao responder uma mensagem do Telegram.')
      await this.reply(config, chatId, MSG_LUNA_FAILED, signal)
      return
    }
    if (signal.aborted) return
    await this.reply(config, chatId, turn.text.trim() ? turn.text : MSG_LUNA_FAILED, signal)
    if (turn.needsAppCard) await this.reply(config, chatId, MSG_CONFIRM_IN_APP, signal)
  }

  /** Janelas deslizantes por chat: por minuto e por hora. Só uma mensagem admitida conta nas duas. */
  private admit(chatId: number): 'ok' | 'minute' | 'hour' {
    const now = (this.deps.now ?? Date.now)()
    const times = (this.recent.get(chatId) ?? []).filter((t) => now - t < TELEGRAM_RATE_LIMIT.windowMs)
    const hour = (this.recentHour.get(chatId) ?? []).filter((t) => now - t < TELEGRAM_HOURLY_LIMIT.windowMs)
    if (times.length === 0) this.warned.delete(chatId)
    if (hour.length === 0) this.warnedHour.delete(chatId)
    this.recent.set(chatId, times)
    this.recentHour.set(chatId, hour)
    if (hour.length >= TELEGRAM_HOURLY_LIMIT.max) return 'hour'
    if (times.length >= TELEGRAM_RATE_LIMIT.max) return 'minute'
    times.push(now)
    hour.push(now)
    return 'ok'
  }

  private async reply(config: TelegramConfig, chatId: number, text: string, signal: AbortSignal): Promise<void> {
    let parts = splitTelegramText(text)
    if (parts.length > TELEGRAM_MAX_PARTS) {
      parts = parts.slice(0, TELEGRAM_MAX_PARTS)
      parts[parts.length - 1] += '\n\n[resposta cortada; veja o restante no Agent Office]'
    }
    for (const part of parts) {
      if (!(await this.send(config, chatId, part, signal))) return
    }
  }

  private async send(config: TelegramConfig, chatId: number, text: string, signal: AbortSignal): Promise<boolean> {
    let backoff = BACKOFF.start
    for (let attempt = 1; attempt <= SEND_ATTEMPTS; attempt++) {
      try {
        await this.call(config, 'sendMessage', { chat_id: chatId, text }, signal)
        return true
      } catch (error) {
        if (signal.aborted) return false
        const permanent = error instanceof HttpError && error.status >= 400 && error.status < 500 && error.status !== 429
        if (permanent || attempt === SEND_ATTEMPTS) {
          this.log('warn', 'Não consegui enviar uma resposta pelo Telegram.')
          return false
        }
        await this.sleep(this.waitFor(error, backoff), signal)
        backoff = Math.min(backoff * 2, BACKOFF.max)
      }
    }
    return false
  }
}
