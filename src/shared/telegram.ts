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
  /** AO-112: a posse do chat_id foi verificada. Sem isso a ponte não liga. */
  verified: boolean
  /** AO-112: há um código enviado ao chat esperando ser digitado (o código em si nunca vem para a tela). */
  codePending: boolean
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

export const MSG_CHANGE_DECLINED = 'Alteração não confirmada. Nada foi salvo e a ponte continua como estava.'
export const MSG_NEEDS_VERIFICATION = 'Falta verificar o chat_id: peça o código, digite-o aqui e só então a ponte liga.'
export const MSG_ALREADY_VERIFIED = 'Este chat_id já foi verificado.'
export const MSG_VERIFY_NEEDS_CONFIG = 'Salve o token e o chat_id antes de pedir o código.'
export const MSG_CODE_SEND_FAILED = 'Não consegui enviar o código ao chat. Confira o token e se você já mandou uma mensagem ao bot.'
export const MSG_CODE_COOLDOWN = 'Aguarde um pouco antes de pedir outro código.'
export const MSG_CODE_NONE = 'Não há código pendente. Peça um novo código.'
export const MSG_CODE_EXPIRED = 'O código expirou. Peça um novo código.'
export const MSG_CODE_EXHAUSTED = 'Três tentativas erradas. Peça um novo código.'
export const MSG_CODE_FORMAT = 'O código tem 6 números.'
export const msgCodeWrong = (left: number): string => `Código incorreto. Restam ${left} ${left === 1 ? 'tentativa' : 'tentativas'}.`

const TOKEN_RE = /^\d{6,12}:[A-Za-z0-9_-]{30,60}$/
const CHAT_RE = /^[1-9]\d{0,14}$/

export function isValidTelegramToken(token: string): boolean {
  return TOKEN_RE.test(token)
}

/** Conversa privada: chat_id positivo. Grupos (negativos) ficam de fora de propósito. */
export function isValidTelegramChatId(chatId: string): boolean {
  return CHAT_RE.test(chatId)
}

/** O código de verificação: 6 dígitos, como a usuária o digita. */
export function isValidVerificationCode(code: string): boolean {
  return /^\d{6}$/.test(code)
}
