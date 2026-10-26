import { join } from 'node:path'
import { loadJson, reportLoad, writeJsonAtomic } from './fs-safe'

export interface AudioDictionaryEntry {
  heard: string
  correction: string
  context: string
  updatedAt: number
}

interface Data {
  entries: AudioDictionaryEntry[]
  acceptedGroups?: string[]
}

const LIMIT = 1000
const MAX_PHRASE = 200
const MAX_CONTEXT = 300
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

export function normalizeAudioPhrase(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

export function isAudioDictionaryData(value: unknown): value is Data {
  return (
    isObject(value) &&
    Array.isArray(value.entries) &&
    value.entries.length <= LIMIT &&
    (value.acceptedGroups === undefined ||
      (Array.isArray(value.acceptedGroups) &&
        value.acceptedGroups.length <= 5000 &&
        value.acceptedGroups.every((id) => /^[a-f0-9]{64}$/.test(id)))) &&
    value.entries.every(
      (entry) =>
        isObject(entry) &&
        typeof entry.heard === 'string' &&
        entry.heard.trim().length > 0 &&
        entry.heard.length <= MAX_PHRASE &&
        typeof entry.correction === 'string' &&
        entry.correction.trim().length > 0 &&
        entry.correction.length <= MAX_PHRASE &&
        typeof entry.context === 'string' &&
        entry.context.length <= MAX_CONTEXT &&
        typeof entry.updatedAt === 'number' &&
        Number.isFinite(entry.updatedAt),
    )
  )
}

/** Local confirmed corrections only; transcript/audio content is never sent to a cloud dictionary. */
export class AudioDictionaryStore {
  private readonly file: string
  private entries: AudioDictionaryEntry[]
  private acceptedGroups: Set<string>

  constructor(
    dataDirectory: string,
    private readonly now: () => number = Date.now,
  ) {
    this.file = join(dataDirectory, 'audio-dictionary.json')
    const loaded = loadJson<Data>(this.file, { valid: isAudioDictionaryData })
    reportLoad(this.file, loaded)
    this.entries = loaded.status === 'ok' || loaded.status === 'restored' ? loaded.data.entries : []
    this.acceptedGroups = new Set(loaded.status === 'ok' || loaded.status === 'restored' ? (loaded.data.acceptedGroups ?? []) : [])
  }

  find(heard: string): AudioDictionaryEntry[] {
    const key = normalizeAudioPhrase(heard)
    if (!key) return []
    return this.entries.filter((entry) => normalizeAudioPhrase(entry.heard) === key).map((entry) => ({ ...entry }))
  }

  hasAcceptedGroup(id: string): boolean {
    return /^[a-f0-9]{64}$/.test(id) && this.acceptedGroups.has(id)
  }

  markAcceptedGroup(id: string): void {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('O identificador deste grupo de áudio é inválido.')
    if (this.acceptedGroups.has(id)) return
    this.acceptedGroups.add(id)
    if (this.acceptedGroups.size > 5000) this.acceptedGroups.delete(this.acceptedGroups.values().next().value!)
    this.save()
  }

  remember(heard: string, correction: string, context: string): void {
    const cleanHeard = heard.trim()
    const cleanCorrection = correction.trim()
    const cleanContext = context.trim().slice(0, MAX_CONTEXT)
    if (!cleanHeard || cleanHeard.length > MAX_PHRASE || !cleanCorrection || cleanCorrection.length > MAX_PHRASE)
      throw new Error('A correção precisa ter até 200 caracteres e não pode ficar vazia.')
    const existing = this.entries.find(
      (entry) => normalizeAudioPhrase(entry.heard) === normalizeAudioPhrase(cleanHeard) && entry.correction === cleanCorrection,
    )
    if (existing) {
      existing.context = cleanContext
      existing.updatedAt = this.now()
    } else {
      this.entries.push({ heard: cleanHeard, correction: cleanCorrection, context: cleanContext, updatedAt: this.now() })
      if (this.entries.length > LIMIT) this.entries.splice(0, this.entries.length - LIMIT)
    }
    this.save()
  }

  private save(): void {
    writeJsonAtomic(this.file, { entries: this.entries, acceptedGroups: [...this.acceptedGroups] } satisfies Data, {
      mode: 0o600,
      space: 2,
      newline: true,
    })
  }
}
