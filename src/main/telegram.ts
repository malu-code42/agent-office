import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readSync, realpathSync, unlinkSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { writeFileAtomic, writeJsonAtomic } from './fs-safe'
import { isAudioFile } from '@shared/audio'
import type { TelegramExpiredNotice, TelegramMessageNotice, TelegramStatus } from '@shared/telegram'

const CREDENTIALS_FILE = 'telegram-credentials.bin'
const OFFSET_FILE = 'telegram-offset.json'
const MAX_CREDENTIAL_FILE = 16 * 1024
const MAX_SECRET_FILE = 16 * 1024
const MAX_AUDIO_BYTES = 20 * 1024 * 1024
const MAX_PENDING_AUDIO = 20
const AUDIO_RETRY_DELAYS_MS = [2_000, 10_000, 30_000]
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
    caption?: unknown
    message_id?: unknown
    from?: { id?: unknown }
    chat?: { id?: unknown; type?: unknown }
    voice?: unknown
    audio?: unknown
    document?: unknown
  }
}

interface TelegramAudioReference {
  updateId: number
  fileId: string
  fileName: string
  mime?: string
  size?: number
  caption?: string
  chatId: number
  messageId: number
  receivedAt: number
  processed?: boolean
}

export interface TelegramAudioPayload extends TelegramAudioReference {
  bytes: Buffer
}

export type TelegramAudioDisposition = 'complete' | 'pending' | 'retry'

class TelegramAudioRejected extends Error {}

interface PendingAudioRecord {
  botId: number
  audio: TelegramAudioReference
  retryCount?: number
  exhausted?: boolean
}

type UpdateNotice =
  | { type: 'message'; value: TelegramMessageNotice }
  | { type: 'expired'; value: TelegramExpiredNotice }
  | { type: 'audio'; value: TelegramAudioReference }
  | { type: 'audio-error'; value: { receivedAt: number } }
  | null

interface TelegramServiceOptions {
  dataDirectory: string
  vaultPath: () => string | undefined
  safeStorage: SafeStorage
  fetcher?: typeof fetch
  now?: () => number
  onMessage?: (message: TelegramMessageNotice) => void
  onExpired?: (message: TelegramExpiredNotice) => void
  onAudio?: (audio: TelegramAudioPayload) => TelegramAudioDisposition | void | Promise<TelegramAudioDisposition | void>
  onAudioError?: (notice: { receivedAt: number }) => void
  /** Test seam for bounded retry scheduling. */
  audioRetryDelaysMs?: readonly number[]
}

const inside = (root: string, path: string): boolean => {
  const rel = relative(root, path)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}

/** Telegram Bot API transport. Credentials are encrypted at rest and messages stay in memory only. */
export class TelegramService {
  private readonly credentialsFile: string
  private readonly offsetFile: string
  private readonly pendingAudioFile: string
  private readonly fetcher: typeof fetch
  private readonly now: () => number
  private readonly onMessage: (message: TelegramMessageNotice) => void
  private readonly onExpired: (message: TelegramExpiredNotice) => void
  private readonly onAudio: (audio: TelegramAudioPayload) => TelegramAudioDisposition | void | Promise<TelegramAudioDisposition | void>
  private readonly onAudioError: (notice: { receivedAt: number }) => void
  private readonly audioRetryDelaysMs: readonly number[]
  private credentials: Credentials | null = null
  private running = false
  private polling = false
  private audioQueue: Promise<void> = Promise.resolve()
  private readonly queuedAudio = new Set<string>()
  private readonly audioRetryTimers = new Map<string, NodeJS.Timeout>()
  private controller: AbortController | null = null
  private lastWarning = ''

  constructor(private readonly options: TelegramServiceOptions) {
    this.credentialsFile = join(options.dataDirectory, CREDENTIALS_FILE)
    this.offsetFile = join(options.dataDirectory, OFFSET_FILE)
    this.pendingAudioFile = join(options.dataDirectory, 'telegram-audio-pending.json')
    this.fetcher = options.fetcher ?? fetch
    this.now = options.now ?? Date.now
    this.onMessage = options.onMessage ?? (() => undefined)
    this.onExpired = options.onExpired ?? (() => undefined)
    this.onAudio = options.onAudio ?? (() => 'pending')
    this.onAudioError = options.onAudioError ?? (() => undefined)
    this.audioRetryDelaysMs = options.audioRetryDelaysMs ?? AUDIO_RETRY_DELAYS_MS
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
      if (existsSync(this.pendingAudioFile)) unlinkSync(this.pendingAudioFile)
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
    void this.resumePendingAudio(this.credentials)
    void this.pollLoop()
  }

  stop(): void {
    this.running = false
    this.controller?.abort()
    this.controller = null
    for (const timer of this.audioRetryTimers.values()) clearTimeout(timer)
    this.audioRetryTimers.clear()
  }

  /** Deletes only an authorized private-chat message after the local audio review is complete. */
  async deleteAudioMessage(chatId: number, messageId: number): Promise<boolean> {
    const credentials = this.credentials ?? this.readCredentials()
    if (!credentials || chatId !== credentials.userId || !Number.isSafeInteger(messageId) || messageId <= 0) return false
    try {
      const response = await this.fetcher(`https://api.telegram.org/bot${credentials.token}/deleteMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
        signal: AbortSignal.timeout(10_000),
      })
      const payload: unknown = await response.json()
      if (isObject(payload) && isAlreadyDeletedDescription(payload.description)) return true
      return response.ok && isObject(payload) && payload.ok === true && payload.result === true
    } catch {
      // Telegram errors may include the credential URL; the caller only receives a generic failure.
      return false
    }
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
        if (notice?.type === 'audio' && !this.persistPendingAudio(credentials, notice.value)) {
          this.onAudioError({ receivedAt: notice.value.receivedAt })
          throw new Error('A fila local de áudios está cheia; a atualização não foi confirmada.')
        }
        this.writeOffset({ botId: credentials.botId, updateId: update.updateId })
        lastUpdateId = update.updateId
        if (notice?.type === 'message') this.onMessage(notice.value)
        if (notice?.type === 'expired') this.onExpired(notice.value)
        if (notice?.type === 'audio-error') this.onAudioError(notice.value)
        if (notice?.type === 'audio') this.enqueueAudio(credentials, notice.value)
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
    const audio = audioReference(message, credentials.userId, update.updateId, this.now())
    if (audio) {
      if (audio.size !== undefined && audio.size > MAX_AUDIO_BYTES) return { type: 'audio-error', value: { receivedAt: this.now() } }
      return { type: 'audio', value: audio }
    }
    if (typeof message.text !== 'string' || !message.text.trim() || message.text.length > 4096) return null
    return { type: 'message', value: { text: redactBotTokens(message.text), receivedAt: this.now() } }
  }

  private async deliverAudio(credentials: Credentials, ref: TelegramAudioReference): Promise<void> {
    try {
      if (ref.processed) {
        if (await this.deleteAudioMessage(ref.chatId, ref.messageId)) this.removePendingAudio(credentials.botId, ref.updateId)
        else this.scheduleAudioRetry(credentials, ref)
        return
      }
      const payload = await this.downloadAudio(credentials, ref)
      const disposition = (await this.onAudio(payload)) ?? 'complete'
      if (disposition === 'complete') {
        if (!this.markPendingAudioProcessed(credentials.botId, ref.updateId)) {
          this.scheduleAudioRetry(credentials, ref)
          return
        }
        ref.processed = true
        if (await this.deleteAudioMessage(ref.chatId, ref.messageId)) this.removePendingAudio(credentials.botId, ref.updateId)
        else this.scheduleAudioRetry(credentials, ref)
      } else if (disposition === 'pending') this.removePendingAudio(credentials.botId, ref.updateId)
      else if (disposition === 'retry') this.scheduleAudioRetry(credentials, ref)
    } catch (error) {
      if (error instanceof TelegramAudioRejected) {
        this.removePendingAudio(credentials.botId, ref.updateId)
        this.onAudioError({ receivedAt: ref.receivedAt })
        return
      }
      // Do not expose the Bot API URL, token, file path, or response body in renderer/logs.
      this.scheduleAudioRetry(credentials, ref)
    }
  }

  /** Keep at most one downloaded audio buffer alive while polling remains non-blocking. */
  private enqueueAudio(credentials: Credentials, ref: TelegramAudioReference): void {
    const key = `${credentials.botId}:${ref.updateId}`
    if (this.queuedAudio.has(key)) return
    this.queuedAudio.add(key)
    const next = this.audioQueue.then(() => this.deliverAudio(credentials, ref)).finally(() => this.queuedAudio.delete(key))
    this.audioQueue = next.catch(() => undefined)
  }

  private scheduleAudioRetry(credentials: Credentials, audio: TelegramAudioReference): void {
    if (!this.running) return
    const key = `${credentials.botId}:${audio.updateId}`
    if (this.audioRetryTimers.has(key)) return
    const pending = this.readPendingAudio()
    const record = pending.find((item) => item.botId === credentials.botId && item.audio.updateId === audio.updateId)
    if (!record || record.exhausted) return
    const attempt = (record.retryCount ?? 0) + 1
    if (attempt > this.audioRetryDelaysMs.length) {
      record.exhausted = true
      writeJsonAtomic(this.pendingAudioFile, { pending }, { mode: 0o600, newline: true })
      this.onAudioError({ receivedAt: audio.receivedAt })
      return
    }
    record.retryCount = attempt
    writeJsonAtomic(this.pendingAudioFile, { pending }, { mode: 0o600, newline: true })
    const timer = setTimeout(
      () => {
        this.audioRetryTimers.delete(key)
        this.enqueueAudio(credentials, audio)
      },
      this.audioRetryDelaysMs[attempt - 1],
    )
    timer.unref?.()
    this.audioRetryTimers.set(key, timer)
  }

  private persistPendingAudio(credentials: Credentials, audio: TelegramAudioReference): boolean {
    const botId = credentials.botId
    const pending = this.readPendingAudio()
    const existing = pending.find((record) => record.botId === botId && record.audio.updateId === audio.updateId)
    const duplicate = !!existing
    if (!duplicate && pending.length >= MAX_PENDING_AUDIO) return false
    if (!duplicate) {
      pending.push({ botId, audio })
      writeJsonAtomic(this.pendingAudioFile, { pending }, { mode: 0o600, newline: true })
    }
    this.enqueueAudio(credentials, existing?.audio ?? audio)
    return true
  }

  private readPendingAudio(): PendingAudioRecord[] {
    if (!existsSync(this.pendingAudioFile)) return []
    try {
      const raw: unknown = JSON.parse(readSmallFile(this.pendingAudioFile, 256 * 1024))
      if (!isObject(raw) || !Array.isArray(raw.pending) || raw.pending.length > MAX_PENDING_AUDIO) return []
      return raw.pending.filter(isPendingAudioRecord)
    } catch {
      return []
    }
  }

  private removePendingAudio(botId: number, updateId: number): void {
    const key = `${botId}:${updateId}`
    const timer = this.audioRetryTimers.get(key)
    if (timer) clearTimeout(timer)
    this.audioRetryTimers.delete(key)
    const pending = this.readPendingAudio().filter((record) => record.botId !== botId || record.audio.updateId !== updateId)
    if (pending.length) writeJsonAtomic(this.pendingAudioFile, { pending }, { mode: 0o600, newline: true })
    else if (existsSync(this.pendingAudioFile)) unlinkSync(this.pendingAudioFile)
  }

  private markPendingAudioProcessed(botId: number, updateId: number): boolean {
    const pending = this.readPendingAudio()
    const record = pending.find((item) => item.botId === botId && item.audio.updateId === updateId)
    if (!record) return false
    record.audio.processed = true
    writeJsonAtomic(this.pendingAudioFile, { pending }, { mode: 0o600, newline: true })
    return true
  }

  private async resumePendingAudio(credentials: Credentials): Promise<void> {
    const pending = this.readPendingAudio()
    const retained: PendingAudioRecord[] = []
    const now = this.now()
    for (const record of pending) {
      if (record.botId !== credentials.botId) continue
      if (record.exhausted) {
        this.onAudioError({ receivedAt: record.audio.receivedAt })
        retained.push(record)
        continue
      }
      if (!record.audio.processed && Math.floor(now / 1000) - Math.floor(record.audio.receivedAt / 1000) > MAX_UPDATE_AGE) {
        this.onExpired({ receivedAt: record.audio.receivedAt })
        continue
      }
      retained.push(record)
    }
    if (retained.length !== pending.length) {
      if (retained.length) writeJsonAtomic(this.pendingAudioFile, { pending: retained }, { mode: 0o600, newline: true })
      else if (existsSync(this.pendingAudioFile)) unlinkSync(this.pendingAudioFile)
    }
    for (const record of retained) if (!record.exhausted) this.enqueueAudio(credentials, record.audio)
  }

  private async downloadAudio(credentials: Credentials, ref: TelegramAudioReference): Promise<TelegramAudioPayload> {
    let metadataResponse: Response
    try {
      metadataResponse = await this.fetcher(`https://api.telegram.org/bot${credentials.token}/getFile`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file_id: ref.fileId }),
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      throw new Error('Não consegui localizar o áudio no Telegram.')
    }
    if (!metadataResponse.ok) throw new Error('Não consegui localizar o áudio no Telegram.')
    let metadata: unknown
    try {
      metadata = await metadataResponse.json()
    } catch {
      throw new Error('Telegram devolveu dados inválidos para o arquivo de áudio.')
    }
    if (!isObject(metadata) || metadata.ok !== true || !isObject(metadata.result) || typeof metadata.result.file_path !== 'string')
      throw new Error('Telegram devolveu dados inválidos para o arquivo de áudio.')
    const filePath = metadata.result.file_path
    if (
      filePath.length > 1000 ||
      filePath.split('/').some((part) => !part || part === '.' || part === '..' || !/^[A-Za-z0-9._-]+$/.test(part))
    )
      throw new TelegramAudioRejected('Telegram devolveu um caminho de áudio inválido.')
    const size = Number.isSafeInteger(metadata.result.file_size) ? (metadata.result.file_size as number) : ref.size
    if (size !== undefined && size > MAX_AUDIO_BYTES) throw new TelegramAudioRejected('O áudio do Telegram precisa ter até 20 MB.')
    const encodedPath = filePath.split('/').map(encodeURIComponent).join('/')
    let download: Response
    try {
      download = await this.fetcher(`https://api.telegram.org/file/bot${credentials.token}/${encodedPath}`, {
        signal: AbortSignal.timeout(60_000),
      })
    } catch {
      throw new Error('Não consegui baixar o áudio do Telegram.')
    }
    if (!download.ok) throw new Error('Não consegui baixar o áudio do Telegram.')
    const bytes = await readBoundedAudioResponse(download, size)
    return { ...ref, bytes, ...(typeof metadata.result.file_size === 'number' ? { size: metadata.result.file_size } : {}) }
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

async function readBoundedAudioResponse(response: Response, expectedSize?: number): Promise<Buffer> {
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length) && length > MAX_AUDIO_BYTES) throw new TelegramAudioRejected('O áudio do Telegram precisa ter até 20 MB.')
  const reader = response.body?.getReader()
  if (!reader) throw new Error('O download do áudio veio sem conteúdo legível.')
  const chunks: Buffer[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value?.byteLength) continue
      total += value.byteLength
      if (total > MAX_AUDIO_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new TelegramAudioRejected('O áudio do Telegram precisa ter até 20 MB.')
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }
  if (!total || (expectedSize !== undefined && total !== expectedSize)) throw new Error('O áudio do Telegram está vazio ou incompleto.')
  return Buffer.concat(chunks, total)
}

function audioReference(
  message: NonNullable<TelegramUpdate['message']>,
  userId: number,
  updateId: number,
  receivedAt: number,
): TelegramAudioReference | null {
  if (!Number.isSafeInteger(message.message_id) || typeof message.chat?.id !== 'number' || message.chat.id !== userId) return null
  const candidates = [message.voice, message.audio, message.document]
  for (const raw of candidates) {
    if (!isObject(raw) || typeof raw.file_id !== 'string' || !raw.file_id || raw.file_id.length > 512) continue
    const mime = typeof raw.mime_type === 'string' ? raw.mime_type.slice(0, 100) : undefined
    const name = typeof raw.file_name === 'string' ? raw.file_name.slice(0, 200) : ''
    const inferredName =
      message.voice === raw
        ? 'telegram-voice.ogg'
        : mime?.startsWith('audio/ogg')
          ? 'telegram-audio.ogg'
          : mime?.startsWith('audio/mp4') || mime?.startsWith('audio/x-m4a')
            ? 'telegram-audio.m4a'
            : mime?.startsWith('audio/')
              ? 'telegram-audio.mp3'
              : ''
    const fileName = name || inferredName
    if (!fileName) continue
    if (!isAudioFile(fileName, mime)) continue
    const size = Number.isSafeInteger(raw.file_size) && (raw.file_size as number) > 0 ? (raw.file_size as number) : undefined
    return {
      updateId,
      fileId: raw.file_id,
      fileName,
      ...(mime ? { mime } : {}),
      ...(size === undefined ? {} : { size }),
      ...(typeof message.caption === 'string' && message.caption.length <= 4096 ? { caption: redactBotTokens(message.caption) } : {}),
      chatId: userId,
      messageId: message.message_id as number,
      receivedAt,
    }
  }
  return null
}

function isPendingAudioRecord(value: unknown): value is PendingAudioRecord {
  if (
    !isObject(value) ||
    !Number.isSafeInteger(value.botId) ||
    (value.botId as number) <= 0 ||
    !isObject(value.audio) ||
    (value.retryCount !== undefined &&
      (!Number.isSafeInteger(value.retryCount) ||
        (value.retryCount as number) < 0 ||
        (value.retryCount as number) > AUDIO_RETRY_DELAYS_MS.length)) ||
    (value.exhausted !== undefined && typeof value.exhausted !== 'boolean')
  )
    return false
  const audio = value.audio
  return (
    Number.isSafeInteger(audio.updateId) &&
    (audio.updateId as number) >= 0 &&
    typeof audio.fileId === 'string' &&
    audio.fileId.length > 0 &&
    audio.fileId.length <= 512 &&
    typeof audio.fileName === 'string' &&
    audio.fileName.length <= 200 &&
    isAudioFile(audio.fileName, typeof audio.mime === 'string' ? audio.mime : '') &&
    (audio.mime === undefined || (typeof audio.mime === 'string' && audio.mime.length <= 100)) &&
    (audio.size === undefined ||
      (Number.isSafeInteger(audio.size) && (audio.size as number) > 0 && (audio.size as number) <= MAX_AUDIO_BYTES)) &&
    (audio.caption === undefined || (typeof audio.caption === 'string' && audio.caption.length <= 4096)) &&
    Number.isSafeInteger(audio.chatId) &&
    Number.isSafeInteger(audio.messageId) &&
    (audio.messageId as number) > 0 &&
    typeof audio.receivedAt === 'number' &&
    Number.isFinite(audio.receivedAt) &&
    (audio.processed === undefined || typeof audio.processed === 'boolean')
  )
}

function isAlreadyDeletedDescription(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const normalized = value.toLocaleLowerCase('en-US')
  return normalized.includes('message to delete not found') || normalized.includes('message not found')
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
