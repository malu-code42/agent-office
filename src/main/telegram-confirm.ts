// AO-109, parte 3: a CONFIRMAÇÃO POR CÓDIGO do Telegram (implementa o gancho `confirmation` da ponte, telegram-bridge.ts).
//
// Regra, tratada em código e não por prompt: um pedido DESTRUTIVO vindo do Telegram NÃO chega à Luna. A ponte responde, no mesmo chat,
// "para confirmar, responda SIM <código>"; só quando o MESMO chat (o gancho só roda para chat_id da lista fixa) devolver exatamente
// esse código, dentro do prazo, o texto original é repassado à Luna. Código de uso único, 5 minutos, 3 tentativas, um pedido
// pendente por chat. Qualquer outra mensagem cancela o pedido pendente. Mesmo depois disso, o efeito continua sendo uma PROPOSTA
// que só o app confirma (a Luna do Telegram não tem ferramentas); esta camada impede que o pedido destrutivo sequer seja interpretado
// sem uma confirmação explícita da usuária.
//
// O que conta como destrutivo (DESTRUCTIVE_PATTERNS, abaixo, sem acento e sem maiúsculas): apagar/excluir/deletar/remover/tirar,
// descartar, cancelar, limpar/zerar, sobrescrever, destruir/formatar/resetar, e ações de publicação: commit, push, pull request/PR,
// merge/mesclar, deploy/publicar. Na dúvida (palavra ambígua), vale como destrutivo.

import { randomInt } from 'node:crypto'
import type { TelegramConfirmationHook } from './telegram-bridge'

export const CONFIRM_TTL_MS = 5 * 60_000
export const CONFIRM_MAX_ATTEMPTS = 3
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // sem 0/O, 1/I/L
const CODE_LENGTH = 5

export const MSG_NEED_CODE = (code: string): string =>
  `Esse pedido pode apagar ou alterar algo, então preciso da sua confirmação antes de passá-lo à Luna.\n` +
  `Para confirmar, responda exatamente: SIM ${code}\n` +
  `Vale por 5 minutos. Qualquer outra mensagem cancela o pedido.`
export const MSG_CONFIRMED = 'Confirmado. Passando o pedido à Luna.'
export const MSG_WRONG_CODE = 'Código incorreto. Responda exatamente: SIM e o código que enviei.'
export const MSG_CANCELLED = 'Pedido cancelado, nada foi feito.'
export const MSG_EXPIRED = 'O pedido pendente expirou (ou errou o código três vezes). Mande o pedido de novo.'

const normalize = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/**
 * As ações destrutivas. Cada padrão casa o começo de uma palavra (\b) do texto já sem acento. Lista fechada e exposta
 * para o PR e os testes citarem exatamente o que conta.
 */
export const DESTRUCTIVE_PATTERNS: readonly RegExp[] = [
  /\b(apag|exclu|delet|remov|remova|descart|cancel|limp|zer(a|e|ar|ei)\b|sobrescrev|sobrescrit|destru|format(a|e|ar)\b|reset|tir(a|e|ar|ei)\b)/,
  /\b(commit|push|merge|mescl|deploy|publi[cq]|pull request|pr\b)/,
  /\b(delete|remove|discard|cancel|erase|wipe|drop|overwrite|clear|destroy|purge|truncate|rm)\b/,
]

export function isDestructiveRequest(text: string): boolean {
  const t = normalize(text)
  return DESTRUCTIVE_PATTERNS.some((p) => p.test(t))
}

const CANCEL_WORDS = new Set(['nao', 'n', 'cancela', 'cancelar', 'cancelado'])

interface Pending {
  code: string
  text: string
  expiresAt: number
  attempts: number
}

export interface TelegramConfirmationOptions {
  now?: () => number
  /** Gera o código (os testes fixam). */
  newCode?: () => string
}

function randomCode(): string {
  let out = ''
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  return out
}

/** "SIM XXXXX" (qualquer caixa, espaços nas pontas); devolve o código ou undefined. */
function parseConfirmation(text: string): string | undefined {
  const m = /^\s*sim\s+([A-Za-z0-9]{3,12})\s*$/i.exec(normalize(text))
  return m ? m[1]!.toUpperCase() : undefined
}

export function createTelegramConfirmation(options: TelegramConfirmationOptions = {}): { hook: TelegramConfirmationHook; pending(): number } {
  const now = options.now ?? Date.now
  const newCode = options.newCode ?? randomCode
  const pending = new Map<number, Pending>()

  const hook: TelegramConfirmationHook = async ({ chatId, text }) => {
    const open = pending.get(chatId)
    pending.delete(chatId) // a pendência só vive até a próxima mensagem do chat; abaixo ela volta se ainda valer
    const alive = open && now() <= open.expiresAt ? open : undefined
    const given = parseConfirmation(text)
    if (given !== undefined) {
      // "SIM código" nunca vai à Luna: ou confirma o pedido pendente, ou é recusado.
      if (!alive) return { handled: true, reply: MSG_EXPIRED }
      if (given === alive.code) return { handled: false, text: alive.text, reply: MSG_CONFIRMED }
      alive.attempts += 1
      if (alive.attempts >= CONFIRM_MAX_ATTEMPTS) return { handled: true, reply: MSG_EXPIRED }
      pending.set(chatId, alive)
      return { handled: true, reply: MSG_WRONG_CODE }
    }
    if (alive && CANCEL_WORDS.has(normalize(text).trim())) return { handled: true, reply: MSG_CANCELLED }
    // Qualquer outra mensagem cancelou a pendência (já apagada acima) e segue o caminho normal.
    if (!isDestructiveRequest(text)) return { handled: false }
    const code = newCode()
    pending.set(chatId, { code, text, expiresAt: now() + CONFIRM_TTL_MS, attempts: 0 })
    return { handled: true, reply: MSG_NEED_CODE(code) }
  }
  return { hook, pending: () => pending.size }
}
