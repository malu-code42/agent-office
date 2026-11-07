// AO-84: onde ficam o token do bot, o chat_id permitido e o interruptor da ponte Telegram.
//
// Um arquivo próprio (telegram-secret.json) na pasta de dados, FORA de settings.json: as configurações são enviadas inteiras
// ao renderer a cada mudança, e o token nunca pode ir junto. O token é criptografado com safeStorage (no Windows, DPAPI)
// antes de tocar o disco; sem armazenamento criptografado disponível, o token não é guardado (nada de texto puro).
// O piso de permissões (permissions/floor.ts) trata esse nome de arquivo como credencial.
// Este módulo não importa o Electron: a criptografia entra por injeção, para rodar nos testes.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomic } from './fs-safe'
import {
  MSG_CHAT_INVALID,
  MSG_CHAT_REQUIRED,
  MSG_STORAGE_UNAVAILABLE,
  MSG_TOKEN_INVALID,
  MSG_TOKEN_REQUIRED,
  isValidTelegramChatId,
  isValidTelegramToken,
  type TelegramSaveInput,
} from '@shared/telegram'
import type { TelegramConfig } from './telegram-bridge'

export const TELEGRAM_FILE = 'telegram-secret.json'

export interface TokenCrypto {
  isAvailable(): boolean
  encrypt(plain: string): Uint8Array
  decrypt(data: Uint8Array): string
}

interface Stored {
  enabled: boolean
  chatId: string
  /** Token criptografado (base64), nunca em texto puro. */
  token: string
  /** AO-112: a usuária provou que o chat_id é dela (código enviado pelo bot). Qualquer mudança de chat_id ou token zera. */
  verified: boolean
}

/** AO-111: o que mudaria ao salvar. Nunca carrega o token. */
export interface TelegramChange {
  chat?: { from: string; to: string }
  token: boolean
}

export class TelegramSettingsStore {
  private readonly file: string
  private cache: Stored | undefined

  constructor(
    dataDir: string,
    private readonly crypto: TokenCrypto,
  ) {
    this.file = join(dataDir, TELEGRAM_FILE)
  }

  private read(): Stored {
    if (this.cache) return this.cache
    let stored: Stored = { enabled: false, chatId: '', token: '', verified: false }
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Stored>
      stored = {
        enabled: raw.enabled === true,
        chatId: typeof raw.chatId === 'string' && isValidTelegramChatId(raw.chatId) ? raw.chatId : '',
        token: typeof raw.token === 'string' ? raw.token : '',
        verified: raw.verified === true,
      }
    } catch {
      // Sem arquivo (ou ilegível): começa desligado e vazio.
    }
    this.cache = stored
    return stored
  }

  get storageAvailable(): boolean {
    try {
      return this.crypto.isAvailable()
    } catch {
      return false
    }
  }

  /** O que a tela pode saber. Nunca o token. */
  summary(): { enabled: boolean; tokenConfigured: boolean; chatId: string } {
    const s = this.read()
    return { enabled: s.enabled, tokenConfigured: s.token !== '', chatId: s.chatId }
  }

  /** AO-112: a posse do chat_id atual foi provada. Sem isso a ponte não liga. */
  isVerified(): boolean {
    const s = this.read()
    return s.verified && s.chatId !== '' && s.token !== ''
  }

  /** AO-112: chamado só depois que o código certo foi digitado. */
  markVerified(): void {
    const current = this.read()
    const next: Stored = { ...current, verified: true }
    writeFileAtomic(this.file, JSON.stringify(next), 0o600)
    this.cache = next
  }

  /** AO-111: compara a entrada com o que está guardado, sem gravar nada. Token igual ao guardado não conta como mudança. */
  changes(input: TelegramSaveInput): TelegramChange {
    const current = this.read()
    const chatId = (input.chatId ?? '').trim()
    const newToken = (input.token ?? '').trim()
    return {
      ...(chatId !== current.chatId ? { chat: { from: current.chatId, to: chatId } } : {}),
      token: newToken !== '' && newToken !== this.token(),
    }
  }

  /** O token decifrado, só para a ponte no processo principal. Vazio se não há ou se não decifra. */
  private token(): string {
    const s = this.read()
    if (!s.token || !this.storageAvailable) return ''
    try {
      return this.crypto.decrypt(Buffer.from(s.token, 'base64'))
    } catch {
      return ''
    }
  }

  /** A configuração para a ponte; token vazio impede que ela ligue. */
  config(): TelegramConfig {
    const s = this.read()
    const chat = isValidTelegramChatId(s.chatId) ? Number(s.chatId) : undefined
    return { enabled: s.enabled, token: this.token(), chatIds: chat === undefined ? [] : [chat] }
  }

  /** O token cru, para registrar no redator de logs. */
  tokenForRedaction(): string {
    return this.token()
  }

  /**
   * Valida e grava. Lança uma mensagem clara (sem repetir o token) e não grava nada se algo estiver errado.
   * Ligado exige token (novo ou já guardado) e chat_id válidos; desligado aceita campos vazios, mas o que vier preenchido tem de ser válido.
   */
  save(input: TelegramSaveInput): void {
    this.validate(input)
    const current = this.read()
    const chatId = (input.chatId ?? '').trim()
    const newToken = (input.token ?? '').trim()
    const change = this.changes(input)
    const next: Stored = {
      enabled: input.enabled,
      chatId,
      token: newToken ? Buffer.from(this.crypto.encrypt(newToken)).toString('base64') : current.token,
      // AO-112: trocar chat_id ou token exige verificar de novo.
      verified: current.verified && !change.chat && !change.token,
    }
    writeFileAtomic(this.file, JSON.stringify(next), 0o600)
    this.cache = next
  }

  /** Só as validações de save, sem gravar: o serviço valida antes de abrir o diálogo de confirmação (AO-111). */
  validate(input: TelegramSaveInput): void {
    const current = this.read()
    const chatId = (input.chatId ?? '').trim()
    const newToken = (input.token ?? '').trim()
    if (chatId && !isValidTelegramChatId(chatId)) throw new Error(MSG_CHAT_INVALID)
    if (newToken && !isValidTelegramToken(newToken)) throw new Error(MSG_TOKEN_INVALID)
    if (newToken && !this.storageAvailable) throw new Error(MSG_STORAGE_UNAVAILABLE)
    const hasToken = newToken !== '' || current.token !== ''
    if (input.enabled) {
      if (!hasToken) throw new Error(MSG_TOKEN_REQUIRED)
      if (!chatId) throw new Error(MSG_CHAT_REQUIRED)
      if (!newToken && !this.token()) throw new Error(MSG_STORAGE_UNAVAILABLE)
    }
  }
}
