import { PROFILE_IDS } from './profiles'

/** High-confidence credential formats that should never be included in profile memory. */
export function hasRecognizableProfileMemorySecret(text: string): boolean {
  return [
    /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/i,
    /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bsk-ant-[A-Za-z0-9_-]{20,}\b/,
    /\bsk-proj-[A-Za-z0-9_-]{20,}\b/,
    /\bsk-[A-Za-z0-9]{40,}\b/,
    /\bAIza[0-9A-Za-z_-]{35}\b/,
    /\b(?:password|passwd|api[_-]?key|secret|access[_-]?key)\s*[:=]\s*['"]?\S+/i,
  ].some((pattern) => pattern.test(text))
}

/** Shared content rule for IPC, persisted data, and backup/import shapes. */
export function isSafeProfileMemoryText(text: string): boolean {
  const clean = text.trim()
  return clean.length > 0 && [...clean].length <= 10_000 && !hasRecognizableProfileMemorySecret(clean)
}

/** Validates every stored entry so backup/export/import cannot preserve unsafe memory. */
export function isProfileMemoryData(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const data = value as Record<string, unknown>
  if (Object.keys(data).some((key) => key !== 'memories')) return false
  const memories = data.memories
  if (memories === undefined) return true
  if (!memories || typeof memories !== 'object' || Array.isArray(memories)) return false
  return Object.entries(memories).every(([profileId, entry]) => {
    if (!(PROFILE_IDS as readonly string[]).includes(profileId)) return false
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false
    const record = entry as Record<string, unknown>
    return (
      Object.keys(record).every((key) => key === 'text' || key === 'updatedAt') &&
      typeof record.text === 'string' &&
      isSafeProfileMemoryText(record.text) &&
      typeof record.updatedAt === 'number' &&
      Number.isFinite(record.updatedAt)
    )
  })
}
