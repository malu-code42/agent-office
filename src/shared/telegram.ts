// AO-84: tipos e validação da configuração do Telegram, compartilhados entre o processo principal e a tela.
// O token NUNCA aparece em nenhum tipo que volta ao renderer: a tela só sabe "configurado: sim/não".

export type TelegramStatus = 'off' | 'connecting' | 'connected' | 'error'

/** O que a tela recebe. Sem token. */
export interface TelegramView {
  enabled: boolean
  tokenConfigured: boolean
  /** O chat_id não é segredo; volta para preencher o campo. */
  chatId: string
  status: TelegramStatus
  /** Motivo curto e fixo quando status é 'error'. */
  reason?: string
  /** safeStorage indisponível neste sistema: não dá para guardar o token com segurança. */
  storageAvailable: boolean
}

/** O que a tela envia ao salvar. `token` vazio ou ausente mantém o token já guardado. */
export interface TelegramSaveInput {
  token?: string
  chatId: string
  enabled: boolean
}

export const MSG_TOKEN_REQUIRED = 'Informe o token do bot para ligar o Telegram.'
export const MSG_TOKEN_INVALID = 'O token não parece válido. Ele tem o formato 123456789:ABC… e vem do @BotFather.'
export const MSG_CHAT_REQUIRED = 'Informe o chat_id permitido para ligar o Telegram.'
export const MSG_CHAT_INVALID = 'O chat_id deve ser um número inteiro positivo (a conversa privada com o bot), sem letras nem espaços.'
export const MSG_STORAGE_UNAVAILABLE = 'Este computador não oferece armazenamento criptografado; o token não pode ser guardado com segurança.'

const TOKEN_RE = /^\d{6,12}:[A-Za-z0-9_-]{30,60}$/
const CHAT_RE = /^[1-9]\d{0,14}$/

export function isValidTelegramToken(token: string): boolean {
  return TOKEN_RE.test(token)
}

/** Conversa privada: chat_id positivo. Grupos (negativos) ficam de fora de propósito. */
export function isValidTelegramChatId(chatId: string): boolean {
  return CHAT_RE.test(chatId)
}
