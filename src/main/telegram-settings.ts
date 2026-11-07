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
    let stored: Stored = { enabled: false, chatId: '', token: '' }
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Stored>
      stored = {
        enabled: raw.enabled === true,
        chatId: typeof raw.chatId === 'string' && isValidTelegramChatId(raw.chatId) ? raw.chatId : '',
        token: typeof raw.token === 'string' ? raw.token : '',
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
    const next: Stored = {
      enabled: input.enabled,
      chatId,
      token: newToken ? Buffer.from(this.crypto.encrypt(newToken)).toString('base64') : current.token,
    }
    writeFileAtomic(this.file, JSON.stringify(next), 0o600)
    this.cache = next
  }
}
