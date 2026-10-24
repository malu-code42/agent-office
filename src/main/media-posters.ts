import { randomBytes } from 'node:crypto'
import { validatePosterImage } from './media-write'

const DEFAULT_TTL_MS = 5 * 60_000
const DEFAULT_MAX_PENDING = 5

export interface MediaPosterPreview {
  token: string
  previewDataUrl: string
  extension: 'png' | 'jpeg' | 'webp'
  sizeBytes: number
}

export interface MediaPostersOptions {
  now?: () => number
  newToken?: () => string
  ttlMs?: number
  maxPending?: number
}

/** Short-lived, process-local poster buffers. Tokens are never persisted and are consumed by take(). */
export function createMediaPosters(options: MediaPostersOptions = {}) {
  const selections = new Map<string, { bytes: Buffer; expiresAt: number; extension: MediaPosterPreview['extension'] }>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const now = options.now ?? Date.now
  const newToken = options.newToken ?? (() => randomBytes(32).toString('base64url'))
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  const maxPending = options.maxPending ?? DEFAULT_MAX_PENDING

  const remove = (token: string): void => {
    const timer = timers.get(token)
    if (timer) clearTimeout(timer)
    timers.delete(token)
    const selection = selections.get(token)
    if (!selection) return
    selection.bytes.fill(0)
    selections.delete(token)
  }

  const scheduleExpiry = (token: string, expiresAt: number): void => {
    const timer = setTimeout(
      () => {
        const selection = selections.get(token)
        if (!selection || selection.expiresAt !== expiresAt) return
        if (selection.expiresAt > now()) {
          scheduleExpiry(token, selection.expiresAt)
          return
        }
        remove(token)
      },
      Math.max(0, expiresAt - now()),
    )
    timer.unref?.()
    timers.set(token, timer)
  }

  const clearExpired = () => {
    const time = now()
    for (const [token, selection] of selections) {
      if (selection.expiresAt > time) continue
      remove(token)
    }
  }

  return {
    add(input: Uint8Array, declaredExtension: string): MediaPosterPreview {
      clearExpired()
      const extension = validatePosterImage(input, declaredExtension)
      if (selections.size >= maxPending) throw new Error('Já há seleções de pôster demais aguardando confirmação.')
      let token = newToken()
      while (selections.has(token)) token = newToken()
      const bytes = Buffer.from(input)
      const expiresAt = now() + ttlMs
      selections.set(token, { bytes, expiresAt, extension })
      scheduleExpiry(token, expiresAt)
      const mime = extension === 'jpeg' ? 'jpeg' : extension
      return { token, previewDataUrl: `data:image/${mime};base64,${bytes.toString('base64')}`, extension, sizeBytes: bytes.byteLength }
    },
    /** Consumes a live token once; returned bytes stay within the main process. */
    take(token: string): { bytes: Buffer; extension: MediaPosterPreview['extension'] } | undefined {
      clearExpired()
      const selection = selections.get(token)
      if (!selection) return undefined
      const timer = timers.get(token)
      if (timer) clearTimeout(timer)
      timers.delete(token)
      selections.delete(token)
      const bytes = Buffer.from(selection.bytes)
      selection.bytes.fill(0)
      return { bytes, extension: selection.extension }
    },
    discard(token: string): void {
      remove(token)
    },
    clear(): void {
      for (const token of selections.keys()) remove(token)
    },
    get pendingCount(): number {
      clearExpired()
      return selections.size
    },
  }
}

export type MediaPosters = ReturnType<typeof createMediaPosters>
