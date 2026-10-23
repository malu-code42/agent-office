import { lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { ProfileMemoryEntry } from '@shared/types'
import { PROFILE_IDS, profileById } from '@shared/profiles'
import { isSafeProfileMemoryText } from '@shared/profile-memory'
import { bakPath, loadJson, parseJson, reportLoad, writeJsonAtomic, writeFileAtomic } from './fs-safe'

interface Data {
  memories: Record<string, ProfileMemoryEntry>
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const KNOWN_IDS = new Set<string>(PROFILE_IDS)
const validFileShape = (v: unknown): v is Partial<Data> => isObj(v) && (v.memories === undefined || isObj(v.memories))

/** Remove only recognizable unsafe profile entries, preserving valid siblings. */
function sanitizedMemoryJson(text: string): string | null {
  let value: unknown
  try {
    value = parseJson(text)
  } catch {
    return null
  }
  if (!isObj(value)) return null
  const source = isObj(value.memories) ? value.memories : {}
  const memories: Data['memories'] = {}
  for (const [id, raw] of Object.entries(source)) {
    if (!KNOWN_IDS.has(id) || !isObj(raw) || typeof raw.text !== 'string' || !isSafeProfileMemoryText(raw.text)) continue
    memories[id] = {
      text: raw.text.trim(),
      updatedAt: typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now(),
    }
  }
  const normalized = JSON.stringify({ memories }, null, 2)
  return normalized === JSON.stringify(value, null, 2) ? null : normalized
}

const PROFILE_BACKUP_DIR = /^(?:\d{4}-\d{2}-\d{2}|antes-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:-\d{3})?)$/

function isContainedRegularFile(path: string, root: string): boolean {
  try {
    const info = lstatSync(path)
    if (info.isSymbolicLink() || !info.isFile()) return false
    const realRoot = realpathSync(root)
    const realFile = realpathSync(path)
    const rel = relative(realRoot, realFile)
    return rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(rel)
  } catch {
    return false
  }
}

/** Return only regular profile-memory copies beneath the real userData/backups tree. */
function profileMemoryCopies(dir: string, file: string): string[] {
  const paths: string[] = []
  if (isContainedRegularFile(bakPath(file), dir)) paths.push(bakPath(file))
  const backups = join(dir, 'backups')
  try {
    const rootInfo = lstatSync(backups)
    if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) return paths
    const root = realpathSync(backups)
    for (const folder of readdirSync(backups)) {
      if (!PROFILE_BACKUP_DIR.test(folder)) continue
      const folderPath = join(backups, folder)
      const info = lstatSync(folderPath)
      if (info.isSymbolicLink() || !info.isDirectory()) continue
      const realFolder = realpathSync(folderPath)
      const rel = relative(root, realFolder)
      if (!rel || rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel)) continue
      const copy = join(folderPath, 'profile-memory.json')
      if (isContainedRegularFile(copy, root)) paths.push(copy)
    }
  } catch {
    // No backup directory yet (or unreadable); valid copies already found remain usable.
  }
  return paths
}

/** Move a symlink entry itself aside; never read, unlink, or modify its target. */
function quarantineSymlink(path: string, dir: string): void {
  let info
  try {
    info = lstatSync(path)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    throw err
  }
  if (!info.isSymbolicLink()) return
  const target = join(dir, `${path.split(/[\\/]/).pop()}.symlink-quarantined-${Date.now()}`)
  try {
    renameSync(path, target)
  } catch (err) {
    throw new Error('Não foi possível isolar um link simbólico da memória dos perfis; a inicialização foi interrompida.', { cause: err })
  }
}

/** Sanitize only validated copies, using that same list for recovery. */
function sanitizeProfileMemoryCopies(paths: string[]): void {
  for (const path of paths) {
    try {
      const cleaned = sanitizedMemoryJson(readFileSync(path, 'utf8'))
      if (cleaned !== null) writeFileAtomic(path, cleaned)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue
      // Never allow loadJson to select an unsafe copy that we could not sanitize.
      throw new Error('Não foi possível proteger uma cópia da memória dos perfis; a inicialização foi interrompida.', { cause: err })
    }
  }
}

/**
 * One memory read from profile-memory.json (AO-43), or null when unusable. The IPC
 * already validated it on save: this only guards against a file edited by hand or
 * written by a newer version. Only ids of profiles.ts stay — an id the app does not
 * know cannot be Luna's context.
 */
function loadEntry(raw: unknown): ProfileMemoryEntry | null {
  if (!isObj(raw)) return null
  const e = raw
  if (typeof e.text !== 'string') return null
  const text = e.text.trim()
  if (!isSafeProfileMemoryText(text)) return null
  return { text, updatedAt: typeof e.updatedAt === 'number' && Number.isFinite(e.updatedAt) ? e.updatedAt : Date.now() }
}

/**
 * userData/profile-memory.json (AO-43): one short summary per profile, written by the
 * user, that Luna may read. Never raw prompts or transcripts, never credentials, and no
 * task receives it automatically — this store only holds what the person typed. Written
 * like office.json: atomically, debounced, never over a file that did not parse (that
 * one is moved aside and the last good copy loads).
 */
export class ProfileMemoryStore {
  private file: string
  private memories: Record<string, ProfileMemoryEntry> = {}
  private timer: NodeJS.Timeout | null = null
  /** Set while a restore or import replaces the files: nothing in memory may land on them. */
  private locked = false

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true })
    this.file = join(dir, 'profile-memory.json')
    const userDataReal = realpathSync(dir)
    const userDataRel = relative(resolve(dir), userDataReal)
    if (userDataRel !== '' || lstatSync(dir).isSymbolicLink()) throw new Error('O diretório da memória dos perfis não pode ser um link simbólico.')
    quarantineSymlink(this.file, dir)
    quarantineSymlink(bakPath(this.file), dir)
    const fallbacks = profileMemoryCopies(dir, this.file)
    sanitizeProfileMemoryCopies(fallbacks)
    let mainText: string | undefined
    try {
      mainText = readFileSync(this.file, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
    if (mainText !== undefined) {
      const cleaned = sanitizedMemoryJson(mainText)
      if (cleaned !== null) {
        try {
          writeFileAtomic(this.file, cleaned)
        } catch {
          // Do not let loadJson refresh .bak from an unsafe original after sanitation fails.
          return
        }
      }
    }
    const r = loadJson<Partial<Data>>(this.file, {
      // Keep the file-level shape check structural so one bad entry does not discard good memories.
      // Each entry still passes loadEntry before it can enter the store or Luna's context.
      valid: validFileShape,
      fallbacks: fallbacks.filter((path) => path !== bakPath(this.file)),
    })
    reportLoad(this.file, r)
    const raw = r.status === 'ok' || r.status === 'restored' ? r.data : {}
    for (const [id, v] of Object.entries(raw.memories ?? {})) {
      if (!KNOWN_IDS.has(id)) continue
      const entry = loadEntry(v)
      if (entry) this.memories[id] = entry
    }
    // The copy that loaded goes back under the real name, or the next start would find no file.
    if (r.status === 'restored') this.flush()
  }

  /** The memory of one profile, or null when the profile has none. */
  view(profileId: string): ProfileMemoryEntry | null {
    return this.memories[profileId] ?? null
  }

  /** Everything, keyed by profile id (the renderer reads all at once for the modal). */
  all(): Record<string, ProfileMemoryEntry> {
    return { ...this.memories }
  }

  /** One profile line for Luna: { profile, summary }, only when a non-empty summary exists. */
  summaries(): { profile: string; summary: string }[] {
    return PROFILE_IDS.filter((id) => !!this.memories[id]).map((id) => ({
      profile: profileById(id)?.name ?? id,
      summary: this.memories[id]!.text,
    }))
  }

  /** Saves the profile's memory; the text passed the IPC's zod check, and the store keeps the same bar. */
  set(profileId: string, text: string): ProfileMemoryEntry {
    if (!KNOWN_IDS.has(profileId)) throw new Error('Esse perfil não existe.')
    const clean = text.trim()
    if (!clean) throw new Error('Escreva o resumo ou apague a memória.')
    if (!isSafeProfileMemoryText(clean))
      throw new Error('A memória parece conter uma credencial ou segredo. Remova esse dado antes de salvar.')
    const entry = { text: clean, updatedAt: Date.now() }
    this.memories[profileId] = entry
    this.save()
    return entry
  }

  /** Deletes a profile's memory. A profile that had none stays with none. */
  remove(profileId: string): void {
    if (!KNOWN_IDS.has(profileId)) throw new Error('Esse perfil não existe.')
    if (!this.memories[profileId]) return
    delete this.memories[profileId]
    this.save()
  }

  save(): void {
    if (this.timer) return
    this.timer = setTimeout(() => this.flush(), 500)
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.locked) return
    writeJsonAtomic(this.file, { memories: this.memories } satisfies Data)
  }

  /** Writes what is pending, then stops writing for good (the app restarts next). */
  lock(): void {
    this.flush()
    this.locked = true
  }
}
