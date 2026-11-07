// AO-112: VERIFICAÇÃO DE POSSE do chat_id. Antes de a ponte ligar, o bot envia ao chat configurado um código de uso único; a usuária
// o digita nos Ajustes do app. Só com o código certo o chat_id passa a valer. Quem digitou um chat_id alheio não recebe o código
// e não consegue ligar a ponte.
//
// - O código vem de crypto.randomInt (6 dígitos), vale CODE_TTL_MS (5 min) e 3 tentativas, e é de uso único.
// - O código NUNCA é registrado em log e nunca vai ao renderer: só viaja ao chat do Telegram; a tela apenas devolve o que a usuária digitou.
// - Erros de rede viram textos fixos: a URL da Bot API carrega o token.
// - Nada aqui aprova nada: o código só liga a ponte; pedidos continuam sendo confirmados no app.

import { randomInt, timingSafeEqual } from 'node:crypto'
import {
  MSG_CODE_COOLDOWN,
  MSG_CODE_EXHAUSTED,
  MSG_CODE_EXPIRED,
  MSG_CODE_NONE,
  MSG_CODE_SEND_FAILED,
  msgCodeWrong,
} from '@shared/telegram'

export const CODE_TTL_MS = 5 * 60_000
export const CODE_MAX_ATTEMPTS = 3
/** Intervalo mínimo entre dois envios, para a tela não virar um disparador de mensagens ao chat. */
export const CODE_COOLDOWN_MS = 30_000
const SEND_TIMEOUT_MS = 15_000
const API = 'https://api.telegram.org'

export const MSG_CODE_TEXT = (code: string): string =>
  `Agent Office: seu código de verificação é ${code}. Digite-o nos Ajustes do app para ligar o Telegram. Vale por 5 minutos. ` +
  'Se não foi você, ignore esta mensagem.'

export interface ChatVerificationDeps {
  /** Entrega o texto ao chat; deve lançar se não conseguir. Padrão: sendMessage da Bot API. */
  send: (chatId: number, text: string) => Promise<void>
  now?: () => number
  /** Os testes fixam o código; em produção é crypto.randomInt. */
  newCode?: () => string
}

interface Pending {
  code: string
  chatId: string
  expiresAt: number
  attempts: number
}

export function randomCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

function sameCode(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export class ChatVerification {
  private pending: Pending | undefined
  private lastSent = Number.NEGATIVE_INFINITY

  constructor(private readonly deps: ChatVerificationDeps) {}

  private now(): number {
    return (this.deps.now ?? Date.now)()
  }

  /** Há um código vivo esperando. */
  hasPending(): boolean {
    if (this.pending && this.now() > this.pending.expiresAt) this.pending = undefined
    return this.pending !== undefined
  }

  /** Descarta o código (chat_id ou token mudou, ou deu certo). */
  clear(): void {
    this.pending = undefined
  }

  /** Gera e envia um código novo ao chat; o anterior deixa de valer. Se o envio falhar, nada fica pendente. */
  async request(chatId: string): Promise<void> {
    if (this.now() - this.lastSent < CODE_COOLDOWN_MS) throw new Error(MSG_CODE_COOLDOWN)
    const code = (this.deps.newCode ?? randomCode)()
    this.pending = undefined
    this.lastSent = this.now()
    try {
      await this.deps.send(Number(chatId), MSG_CODE_TEXT(code))
    } catch {
      throw new Error(MSG_CODE_SEND_FAILED)
    }
    this.pending = { code, chatId, expiresAt: this.now() + CODE_TTL_MS, attempts: 0 }
  }

  /** Confere o que a usuária digitou. Certo: consome o código (uso único) e devolve o chat_id. Errado/expirado/esgotado: lança mensagem fixa. */
  check(typed: string, chatId: string): string {
    const open = this.pending
    if (!open) throw new Error(MSG_CODE_NONE)
    if (this.now() > open.expiresAt || open.chatId !== chatId) {
      this.pending = undefined
      throw new Error(MSG_CODE_EXPIRED)
    }
    if (sameCode(typed, open.code)) {
      this.pending = undefined
      return open.chatId
    }
    open.attempts += 1
    if (open.attempts >= CODE_MAX_ATTEMPTS) {
      this.pending = undefined
      throw new Error(MSG_CODE_EXHAUSTED)
    }
    throw new Error(msgCodeWrong(CODE_MAX_ATTEMPTS - open.attempts))
  }
}

/** sendMessage da Bot API com timeout. Nenhuma mensagem de erro original sai daqui (a URL carrega o token). */
export function botSender(token: string, fetchImpl: typeof fetch = fetch): ChatVerificationDeps['send'] {
  return async (chatId, text) => {
    let ok: boolean
    try {
      const response = await fetchImpl(`${API}/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      })
      ok = response.ok && ((await response.json()) as { ok?: boolean }).ok === true
    } catch {
      ok = false
    }
    if (!ok) throw new Error('send-failed')
  }
}
