import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readSync, realpathSync, unlinkSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { writeFileAtomic, writeJsonAtomic } from './fs-safe'
import type { TelegramExpiredNotice, TelegramMessageNotice, TelegramStatus } from '@shared/telegram'

const CREDENTIALS_FILE = 'telegram-credentials.bin'
const OFFSET_FILE = 'telegram-offset.json'
const MAX_CREDENTIAL_FILE = 16 * 1024
const MAX_SECRET_FILE = 16 * 1024
const MAX_UPDATE_AGE = 24 * 60 * 60
const POLL_TIMEOUT = 25

interface SafeStorage {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
  getSelectedStorageBackend?: () => string
}

interface Credentials {
  token: string
  userId: number
  botId: number
  botName: string
}

interface OffsetState {
  botId: number
  updateId: number
}

interface TelegramUpdate {
  update_id?: unknown
  message?: {
    date?: unknown
    text?: unknown
    from?: { id?: unknown }
    chat?: { id?: unknown; type?: unknown }
  }
}

type UpdateNotice = { type: 'message'; value: TelegramMessageNotice } | { type: 'expired'; value: TelegramExpiredNotice } | null

interface TelegramServiceOptions {
  dataDirectory: string
  vaultPath: () => string | undefined
  safeStorage: SafeStorage
  fetcher?: typeof fetch
  now?: () => number
  onMessage?: (message: TelegramMessageNotice) => void
  onExpired?: (message: TelegramExpiredNotice) => void
}

const inside = (root: string, path: string): boolean => {
  const rel = relative(root, path)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}

/** Telegram Bot API transport. Credentials are encrypted at rest and messages stay in memory only. */
export class TelegramService {
  private readonly credentialsFile: string
  private readonly offsetFile: string
  private readonly fetcher: typeof fetch
  private readonly now: () => number
  private readonly onMessage: (message: TelegramMessageNotice) => void
  private readonly onExpired: (message: TelegramExpiredNotice) => void
  private credentials: Credentials | null = null
  private running = false
  private polling = false
  private controller: AbortController | null = null
  private lastWarning = ''

  constructor(private readonly options: TelegramServiceOptions) {
    this.credentialsFile = join(options.dataDirectory, CREDENTIALS_FILE)
    this.offsetFile = join(options.dataDirectory, OFFSET_FILE)
    this.fetcher = options.fetcher ?? fetch
    this.now = options.now ?? Date.now
    this.onMessage = options.onMessage ?? (() => undefined)
    this.onExpired = options.onExpired ?? (() => undefined)
  }

  status(): TelegramStatus {
    try {
      const credentials = this.credentials ?? this.readCredentials()
      return {
        linked: !!credentials,
        polling: this.running,
        ...(credentials ? { botName: credentials.botName, authorizedUserId: credentials.userId } : {}),
        ...(this.lastWarning ? { warning: this.lastWarning } : {}),
      }
    } catch {
      return {
        linked: false,
        polling: false,
        warning: 'A credencial local do Telegram não pôde ser aberta com segurança. Revincule a conta.',
      }
    }
  }

  /** Imports a token file in the main process; the token never crosses IPC or enters the vault. */
  async linkFromFile(path: string): Promise<TelegramStatus> {
    this.requireSecureStorage()
    const realFile = this.checkedCredentialFile(path)
    const parsed = parseCredentialFile(readSmallFile(realFile, MAX_CREDENTIAL_FILE))
    const bot = await this.getMe(parsed.token)
    const credentials: Credentials = { ...parsed, botId: bot.id, botName: bot.username }
    const encrypted = this.options.safeStorage.encryptString(JSON.stringify(credentials))
    writeJsonLikeEncrypted(this.credentialsFile, encrypted)
    this.stop()
    this.credentials = credentials
    this.lastWarning = ''
    return this.status()
  }

  unlink(): void {
    this.stop()
    this.credentials = null
    try {
      if (existsSync(this.credentialsFile)) unlinkSync(this.credentialsFile)
    } catch {
      throw new Error('Não foi possível remover a vinculação local do Telegram.')
    }
    this.lastWarning = ''
  }

  start(): void {
    if (this.running) return
    try {
      this.requireSecureStorage()
      this.credentials = this.readCredentials()
    } catch {
      this.credentials = null
      this.lastWarning = 'A credencial local do Telegram não está disponível com segurança. Revincule a conta.'
    }
    if (!this.credentials) return
    this.running = true
    this.lastWarning = ''
    void this.pollLoop()
  }

  stop(): void {
    this.running = false
    this.controller?.abort()
    this.controller = null
  }

  /** One testable polling cycle. The app's loop calls this only while its process is open. */
  async pollOnce(): Promise<void> {
    if (this.polling) return
    const credentials = this.credentials ?? this.readCredentials()
    if (!credentials) return
    this.polling = true
    const controller = new AbortController()
    this.controller = controller
    const timeout = setTimeout(() => controller.abort(), (POLL_TIMEOUT + 10) * 1000)
    timeout.unref?.()
    try {
      const offset = this.readOffset(credentials.botId)
      const response = await this.fetcher(`https://api.telegram.org/bot${credentials.token}/getUpdates`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          timeout: POLL_TIMEOUT,
          allowed_updates: ['message'],
          ...(offset === undefined ? {} : { offset: offset + 1 }),
        }),
        signal: controller.signal,
      })
      if (!response.ok) {
        if (response.status === 401) {
          this.running = false
          this.lastWarning = 'O Telegram revogou o token do bot. O polling foi interrompido; revincule uma credencial válida.'
        }
        throw new Error('Telegram temporariamente indisponível.')
      }
      const payload: unknown = await response.json()
      if (!isObject(payload) || payload.ok !== true || !Array.isArray(payload.result))
        throw new Error('Telegram devolveu uma resposta inválida.')
      let lastUpdateId = offset
      for (const raw of payload.result) {
        const update = validUpdate(raw)
        if (!update) continue
        if (lastUpdateId !== undefined && update.updateId <= lastUpdateId) continue
        const notice = this.processUpdate(credentials, update)
        this.writeOffset({ botId: credentials.botId, updateId: update.updateId })
        lastUpdateId = update.updateId
        if (notice?.type === 'message') this.onMessage(notice.value)
        if (notice?.type === 'expired') this.onExpired(notice.value)
      }
      this.lastWarning = ''
    } catch (error) {
      if (this.running && !controller.signal.aborted)
        this.lastWarning = 'Telegram temporariamente indisponível; o Office tentará novamente.'
      throw error instanceof Error
        ? new Error(this.lastWarning || 'A consulta ao Telegram foi interrompida.')
        : new Error('Telegram temporariamente indisponível.')
    } finally {
      clearTimeout(timeout)
      if (this.controller === controller) this.controller = null
      this.polling = false
    }
  }

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        await this.pollOnce()
      } catch {
        // The generic status is visible in Settings; raw API errors may contain the bot-token URL.
      }
      if (this.running)
        await new Promise<void>((resolvePromise) => {
          const delay = setTimeout(resolvePromise, this.lastWarning ? 5000 : 250)
          delay.unref?.()
        })
    }
  }

  private processUpdate(credentials: Credentials, update: { updateId: number; message?: TelegramUpdate['message'] }): UpdateNotice {
    const message = update.message
    if (!message || message.from?.id !== credentials.userId || message.chat?.type !== 'private' || message.chat.id !== credentials.userId)
      return null
    if (typeof message.date !== 'number' || !Number.isFinite(message.date)) return null
    const ageSeconds = Math.floor(this.now() / 1000) - message.date
    if (ageSeconds > MAX_UPDATE_AGE) return { type: 'expired', value: { receivedAt: this.now() } }
    if (ageSeconds < -5 * 60) return null
    if (typeof message.text !== 'string' || !message.text.trim() || message.text.length > 4096) return null
    return { type: 'message', value: { text: redactBotTokens(message.text), receivedAt: this.now() } }
  }

  private async getMe(token: string): Promise<{ id: number; username: string }> {
    let response: Response
    try {
      response = await this.fetcher(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(10_000) })
    } catch {
      throw new Error('Não foi possível validar o bot no Telegram. Confira a conexão e tente novamente.')
    }
    if (!response.ok) throw new Error('O token informado não foi aceito pelo Telegram.')
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new Error('O Telegram devolveu uma resposta inválida ao validar o bot.')
    }
    if (
      !isObject(payload) ||
      payload.ok !== true ||
      !isObject(payload.result) ||
      !Number.isSafeInteger(payload.result.id) ||
      typeof payload.result.username !== 'string'
    )
      throw new Error('O Telegram não reconheceu esse token como um bot válido.')
    return { id: payload.result.id as number, username: payload.result.username }
  }

  private requireSecureStorage(): void {
    if (!this.options.safeStorage.isEncryptionAvailable()) throw new Error('A criptografia local não está disponível neste sistema.')
    const backend = this.options.safeStorage.getSelectedStorageBackend?.()
    if (backend === 'basic_text' || backend === 'unknown')
      throw new Error('O sistema não oferece armazenamento seguro de credenciais. O token não foi salvo.')
  }

  private checkedCredentialFile(path: string): string {
    const info = lstatSync(path)
    if (info.isSymbolicLink() || !info.isFile() || info.size > MAX_CREDENTIAL_FILE)
      throw new Error('Escolha um arquivo JSON regular de credenciais do Telegram com até 16 KiB.')
    const real = realpathSync(path)
    const vault = this.options.vaultPath()
    if (vault && inside(realpathSync(resolve(vault)), real))
      throw new Error('O arquivo do token não pode ficar dentro do vault do Obsidian.')
    if (inside(realpathSync(this.options.dataDirectory), real))
      throw new Error('O arquivo de importação não pode ficar na pasta de dados do aplicativo.')
    return real
  }

  private readCredentials(): Credentials | null {
    if (!existsSync(this.credentialsFile)) return null
    this.requireSecureStorage()
    const encrypted = readSmallFile(this.credentialsFile, MAX_SECRET_FILE)
    let raw: string
    try {
      raw = this.options.safeStorage.decryptString(Buffer.from(encrypted, 'binary'))
    } catch {
      throw new Error('A credencial local do Telegram não pode ser descriptografada.')
    }
    const parsed = parseCredentialJson(raw)
    return parsed
  }

  private readOffset(botId: number): number | undefined {
    if (!existsSync(this.offsetFile)) return undefined
    try {
      const state = JSON.parse(readSmallFile(this.offsetFile, 4096)) as unknown
      return isObject(state) && state.botId === botId && Number.isSafeInteger(state.updateId) ? (state.updateId as number) : undefined
    } catch {
      return undefined
    }
  }

  private writeOffset(state: OffsetState): void {
    writeJsonAtomic(this.offsetFile, state, { mode: 0o600, newline: true })
  }
}

function parseCredentialFile(text: string): { token: string; userId: number } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('O arquivo de credenciais deve ser JSON com botToken e userId.')
  }
  if (!isObject(raw) || Object.keys(raw).length !== 2 || typeof raw.botToken !== 'string' || !Number.isSafeInteger(raw.userId))
    throw new Error('O arquivo precisa conter somente botToken e userId numérico.')
  if (!/^[0-9]{5,15}:[A-Za-z0-9_-]{20,128}$/.test(raw.botToken) || (raw.userId as number) <= 0)
    throw new Error('O token ou Telegram user ID não tem formato válido.')
  return { token: raw.botToken, userId: raw.userId as number }
}

function parseCredentialJson(text: string): Credentials {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('A credencial criptografada não está num formato válido.')
  }
  if (
    !isObject(raw) ||
    typeof raw.token !== 'string' ||
    !/^[0-9]{5,15}:[A-Za-z0-9_-]{20,128}$/.test(raw.token) ||
    !Number.isSafeInteger(raw.userId) ||
    (raw.userId as number) <= 0 ||
    !Number.isSafeInteger(raw.botId) ||
    typeof raw.botName !== 'string'
  )
    throw new Error('A credencial criptografada não está num formato válido.')
  return { token: raw.token, userId: raw.userId as number, botId: raw.botId as number, botName: raw.botName }
}

function validUpdate(raw: unknown): { updateId: number; message?: TelegramUpdate['message'] } | null {
  if (!isObject(raw) || !Number.isSafeInteger(raw.update_id) || (raw.update_id as number) < 0) return null
  const message = isObject(raw.message) ? (raw.message as TelegramUpdate['message']) : undefined
  return { updateId: raw.update_id as number, ...(message ? { message } : {}) }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function redactBotTokens(text: string): string {
  return text.replace(/\b[0-9]{5,15}:[A-Za-z0-9_-]{20,128}\b/g, '[token oculto]')
}

function readSmallFile(path: string, maxBytes: number): string {
  let fd: number | undefined
  try {
    const noFollow = (constants as typeof constants & { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0
    fd = openSync(path, constants.O_RDONLY | noFollow)
    const opened = fstatSync(fd)
    const linked = lstatSync(path)
    if (!opened.isFile() || linked.isSymbolicLink() || !linked.isFile() || opened.dev !== linked.dev || opened.ino !== linked.ino)
      throw new Error('O arquivo precisa ser regular, não um link simbólico.')
    if (opened.size > maxBytes) throw new Error('O arquivo de credenciais excede o limite seguro.')
    const buffer = Buffer.allocUnsafe(opened.size)
    let offset = 0
    while (offset < buffer.length) {
      const count = readSync(fd, buffer, offset, buffer.length - offset, offset)
      if (!count) throw new Error('O arquivo mudou durante a leitura.')
      offset += count
    }
    const after = fstatSync(fd)
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) throw new Error('O arquivo mudou durante a leitura.')
    return buffer.toString('binary')
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

function writeJsonLikeEncrypted(path: string, encrypted: Buffer): void {
  writeFileAtomic(path, encrypted, 0o600)
}
