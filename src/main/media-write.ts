import { randomInt } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeSync,
  type Stats,
} from 'node:fs'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import {
  MEDIA_FILES,
  MEDIA_ID_RE,
  POSTER_DIR,
  appendMediaItem,
  newMediaItem,
  parseMedia,
  replaceMediaItem,
  setMovieStatus,
  setPagesRead,
  setPlatinum,
  setStatus,
  type MediaAgendaLink,
  type MediaItem,
  type MediaItemOf,
  type MediaKind,
  type MediaStatus,
} from '@shared/media'
import { writeFileAtomic } from './fs-safe'
import { log } from './log'

/**
 * Writes the three media libraries (livros.md, filmes.md, jogos.md) and the posters copied to
 * midias/posters. Same rules as goals-write and tasks-write: the file must still be what the last
 * read saw (stale-check), a dated copy goes to backups/midias before the first write of a session
 * and is never overwritten, and the Markdown is written atomically. Nothing here touches
 * tarefas.md, agenda.md or planning.json: an agenda link is only a reference kept in the item.
 * A poster is copied before the record that points to it; when the record cannot be written, the
 * copy is undone, so no record ever points to a poster that was not copied.
 */

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
const ID_ATTEMPTS = 100
export const POSTER_MAX_BYTES = 10 * 1024 * 1024
const BOM = '\uFEFF'
const LABEL: Record<MediaKind, string> = { livro: 'livros', filme: 'filmes', jogo: 'jogos' }
const CHANGED = (file: string) =>
  `O ${file} mudou desde que você abriu a biblioteca, então nada foi escrito. Abra a biblioteca de novo e tente outra vez.`
const NOT_FOUND = (file: string) => `Não encontrei este item em ${file}.`
const POSTER_EXTENSION = 'Escolha um pôster PNG, JPEG ou WebP.'
const POSTER_EMPTY = 'O arquivo escolhido está vazio.'
const POSTER_SIZE = `O pôster passa de ${POSTER_MAX_BYTES / (1024 * 1024)} MiB. Escolha uma imagem menor.`
const POSTER_PATH = `Caminho de pôster inválido: ${POSTER_DIR} precisa ser uma pasta real dentro do vault, sem links simbólicos nem atalhos.`
const BACKUP_PATH =
  'Caminho de backup inválido: backups/midias precisa ser uma pasta real dentro do vault, sem links simbólicos nem atalhos.'

type PosterType = 'png' | 'jpeg' | 'webp'

const POSTER_TYPES = new Map<string, PosterType>([
  ['png', 'png'],
  ['jpg', 'jpeg'],
  ['jpeg', 'jpeg'],
  ['webp', 'webp'],
])
const POSTER_LABEL: Record<PosterType, string> = { png: 'PNG', jpeg: 'JPEG', webp: 'WebP' }
const SIGNATURE: Record<PosterType, (bytes: Uint8Array) => boolean> = {
  png: (bytes) => matchesAt(bytes, 0, [0x89, 0x50, 0x4e, 0x47]),
  jpeg: (bytes) => matchesAt(bytes, 0, [0xff, 0xd8, 0xff]),
  webp: (bytes) => matchesAt(bytes, 0, [0x52, 0x49, 0x46, 0x46]) && matchesAt(bytes, 8, [0x57, 0x45, 0x42, 0x50]),
}

interface MediaFields {
  title: string
  status: MediaStatus
  agenda: MediaAgendaLink | null
}
interface BookFields extends MediaFields {
  pagesRead: number
  totalPages: number | null
}
interface GameFields extends MediaFields {
  favorite: boolean
  platinum: boolean
}
interface FieldsByKind {
  livro: BookFields
  filme: MediaFields
  jogo: GameFields
}

/** What a new item starts with: its title, and any other field the caller sets. */
export type MediaDraft<K extends MediaKind> = Pick<FieldsByKind[K], 'title'> & Partial<Omit<FieldsByKind[K], 'title'>>
/** The fields an update changes. `null` clears an optional field (total of pages, agenda link). */
export type MediaChange<K extends MediaKind> = Partial<FieldsByKind[K]>
export interface PosterInput {
  bytes: Uint8Array
  extension: string
}

type AnyChange = Partial<BookFields & GameFields>

const FIELDS_OF: Record<MediaKind, ReadonlyArray<keyof AnyChange>> = {
  livro: ['title', 'status', 'agenda', 'pagesRead', 'totalPages'],
  filme: ['title', 'status', 'agenda'],
  jogo: ['title', 'status', 'agenda', 'favorite', 'platinum'],
}

export interface MediaWriterOptions {
  now?: () => Date
  newId?: () => string
  /** Writes a Markdown library. Tests replace it to simulate a failed write. */
  writeText?: (file: string, text: string) => void
}

/** One writer per app session. Each read is remembered, and a write is refused unless the file still matches it. */
export function createMediaWriter(opts: MediaWriterOptions = {}) {
  const lastRead = new Map<string, string | null>()
  const backedUp = new Set<string>()
  const now = opts.now ?? (() => new Date())
  const newId = opts.newId ?? randomMediaId
  const writeText = opts.writeText ?? ((file: string, text: string) => writeFileAtomic(file, text))
  const keyOf = (vault: string, kind: MediaKind) => JSON.stringify([vault, kind])
  const fileOf = (vault: string, kind: MediaKind) => join(vault, MEDIA_FILES[kind])

  const readFile = (vault: string, kind: MediaKind): string | null => {
    try {
      return readFileSync(fileOf(vault, kind), 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw userFileError(`Não foi possível ler ${MEDIA_FILES[kind]}. Verifique as permissões e tente novamente.`, err)
    }
  }

  /** The file as the last read left it. Throws when there was no read or the file changed since. */
  const unchanged = (vault: string, kind: MediaKind): string | null => {
    const key = keyOf(vault, kind)
    if (!lastRead.has(key)) throw new Error(`Abra a biblioteca de novo antes de alterar o ${MEDIA_FILES[kind]}.`)
    const before = lastRead.get(key) ?? null
    if (readFile(vault, kind) !== before) throw new Error(CHANGED(MEDIA_FILES[kind]))
    return before
  }

  const backup = (vault: string, kind: MediaKind, text: string): void => {
    let dir: string
    try {
      dir = safeDirectory(vault, ['backups', 'midias'], BACKUP_PATH)
    } catch (err) {
      if (err instanceof Error && err.message === BACKUP_PATH) throw err
      throw userFileError('Não foi possível acessar a pasta de backups/midias. Verifique as permissões.', err)
    }
    const base = basename(MEDIA_FILES[kind], '.md')
    const stamp = stampOf(now())
    let dest = join(dir, `${base}-${stamp}.md`)
    for (let n = 2; existsSync(dest); n++) dest = join(dir, `${base}-${stamp}-${n}.md`)
    try {
      writeFileAtomic(dest, text)
    } catch (err) {
      throw userFileError('Não foi possível criar o backup da biblioteca de mídias. Verifique o espaço e as permissões.', err)
    }
  }

  const save = (vault: string, kind: MediaKind, before: string | null, after: string): void => {
    const key = keyOf(vault, kind)
    if (readFile(vault, kind) !== before) throw new Error(CHANGED(MEDIA_FILES[kind]))
    if (!backedUp.has(key)) {
      backup(vault, kind, before ?? '')
      backedUp.add(key)
    }
    try {
      writeText(fileOf(vault, kind), after)
    } catch (err) {
      throw userFileError(`Não foi possível gravar ${MEDIA_FILES[kind]}. Verifique o espaço e as permissões.`, err)
    }
    lastRead.set(key, after)
  }

  /** Saves the whole file when its text changed. The byte order mark, which the parser drops, goes back in front. */
  const persist = (vault: string, kind: MediaKind, before: string | null, next: string): void => {
    const after = before?.startsWith(BOM) && !next.startsWith(BOM) ? BOM + next : next
    if (after !== before) save(vault, kind, before, after)
  }

  const readItems = (vault: string, kind: MediaKind): MediaItem[] => {
    const text = readFile(vault, kind)
    const items = parseMedia(kind, text ?? '').items
    lastRead.set(keyOf(vault, kind), text)
    return items
  }

  const createItem = (vault: string, kind: MediaKind, draft: AnyChange & { title: string }): string => {
    const before = unchanged(vault, kind)
    const text = before ?? ''
    const taken = new Set(parseMedia(kind, text).items.map((item) => item.id))
    const id = pickId(taken, newId)
    persist(vault, kind, before, appendMediaItem(text, kind, draftItem(kind, id, draft)))
    return id
  }

  const createMovieWithPoster = (vault: string, draft: MediaDraft<'filme'>, poster?: PosterInput): string => {
    const before = unchanged(vault, 'filme')
    const text = before ?? ''
    const taken = new Set(parseMedia('filme', text).items.map((item) => item.id))
    const id = pickId(taken, newId)
    const extension = poster ? validatePosterImage(poster.bytes, poster.extension) : undefined
    const posterPath = extension ? `${POSTER_DIR}/${id}.${extension}` : undefined
    const item = { ...draftItem('filme', id, draft), ...(posterPath ? { posterPath } : {}) }
    const after = appendMediaItem(text, 'filme', item)
    if (!poster || !extension || !posterPath) {
      persist(vault, 'filme', before, after)
      return id
    }

    let dir: string
    try {
      dir = posterDir(vault)
    } catch (err) {
      if (err instanceof Error && err.message === POSTER_PATH) throw err
      throw userFileError('Não foi possível acessar a pasta de pôsteres. Verifique as permissões.', err)
    }
    const file = join(dir, `${id}.${extension}`)
    if (linkStat(file)) throw new Error(POSTER_PATH)
    try {
      writePosterAtomic(file, poster.bytes)
    } catch (err) {
      throw userFileError('Não foi possível gravar o pôster. Verifique o espaço e as permissões.', err)
    }
    try {
      persist(vault, 'filme', before, after)
    } catch (err) {
      undoPoster(file, undefined)
      throw err
    }
    return id
  }

  const updateItem = (vault: string, kind: MediaKind, id: string, change: AnyChange): void => {
    const before = unchanged(vault, kind)
    const text = before ?? ''
    const item = parseMedia(kind, text).items.find((existing) => existing.id === id)
    if (!item) throw new Error(NOT_FOUND(MEDIA_FILES[kind]))
    persist(vault, kind, before, replaceMediaItem(text, kind, applyChange(item, change)))
  }

  return {
    /** The items of the library, read now. A missing file is an empty library and nothing is created. */
    read<K extends MediaKind>(vault: string, kind: K): MediaItemOf<K>[] {
      return readItems(vault, kind) as MediaItemOf<K>[]
    },
    /** Adds an item with a new id and returns the id. Refused, with nothing written, when the file changed since the read. */
    create<K extends MediaKind>(vault: string, kind: K, draft: MediaDraft<K>): string {
      return createItem(vault, kind, draft)
    },
    /** Creates a movie and optional poster as one confirmed operation; a Markdown failure removes the new poster. */
    createMovieWithPoster(vault: string, draft: MediaDraft<'filme'>, poster?: PosterInput): string {
      return createMovieWithPoster(vault, draft, poster)
    },
    /** Changes the fields of the item `id`. Only the fields the kind has are accepted. */
    update<K extends MediaKind>(vault: string, kind: K, id: string, change: MediaChange<K>): void {
      updateItem(vault, kind, id, change)
    },
    /** Stores the agenda reference of the item. Nothing else changes: no task, no recurrence, no agenda.md. */
    linkAgenda(vault: string, kind: MediaKind, id: string, agenda: MediaAgendaLink): void {
      updateItem(vault, kind, id, { agenda })
    },
    unlinkAgenda(vault: string, kind: MediaKind, id: string): void {
      updateItem(vault, kind, id, { agenda: null })
    },
    /**
     * Copies a poster to midias/posters/<id>.<ext> and points the movie at it. Returns the relative path.
     * Refused, with nothing copied, when the bytes are not a PNG, JPEG or WebP up to 10 MiB, or when
     * the movie or the file has changed. A failed write of the record removes the new copy.
     */
    attachPoster(vault: string, id: string, poster: PosterInput): string {
      if (!MEDIA_ID_RE.test(id)) throw new Error(`O identificador "${id}" é inválido.`)
      validatePosterImage(poster.bytes, poster.extension)
      const extension = poster.extension.toLowerCase()
      const posterPath = `${POSTER_DIR}/${id}.${extension}`

      const before = unchanged(vault, 'filme')
      const text = before ?? ''
      const movie = parseMedia('filme', text).items.find((item) => item.id === id)
      if (!movie) throw new Error(NOT_FOUND(MEDIA_FILES.filme))
      const next = replaceMediaItem(text, 'filme', { ...movie, posterPath, posterError: undefined })

      let dir: string
      try {
        dir = posterDir(vault)
      } catch (err) {
        if (err instanceof Error && err.message === POSTER_PATH) throw err
        throw userFileError('Não foi possível acessar a pasta de pôsteres. Verifique as permissões.', err)
      }
      const file = join(dir, `${id}.${extension}`)
      let previous: Buffer | undefined
      try {
        previous = currentPoster(file)
      } catch (err) {
        if (err instanceof Error && err.message === POSTER_PATH) throw err
        throw userFileError('Não foi possível ler o pôster existente. Verifique as permissões.', err)
      }
      const tmp = `${file}.tmp`
      let tmpStat: Stats | undefined
      try {
        tmpStat = linkStat(tmp)
      } catch (err) {
        throw userFileError('Não foi possível verificar o arquivo temporário do pôster.', err)
      }
      if (tmpStat?.isSymbolicLink()) throw new Error(POSTER_PATH)
      try {
        writePosterAtomic(file, poster.bytes)
      } catch (err) {
        throw userFileError('Não foi possível gravar o pôster. Verifique o espaço e as permissões.', err)
      }
      try {
        persist(vault, 'filme', before, next)
      } catch (err) {
        undoPoster(file, previous)
        throw err
      }
      if (movie.posterPath && movie.posterPath !== posterPath) {
        try {
          removePreviousPoster(dir, movie.posterPath, id)
        } catch {
          // O registro novo já foi salvo; falhar ao limpar o anterior não deve marcar a operação como falha.
          // Se a remoção falhar, o arquivo antigo permanece no lugar.
        }
      }
      return posterPath
    },
  }
}

export type MediaWriter = ReturnType<typeof createMediaWriter>

function randomMediaId(): string {
  let id = 'm'
  for (let i = 0; i < 8; i++) id += ALPHABET[randomInt(ALPHABET.length)]
  return id
}

function pickId(taken: Set<string>, newId: () => string): string {
  for (let i = 0; i < ID_ATTEMPTS; i++) {
    const id = newId()
    if (MEDIA_ID_RE.test(id) && !taken.has(id)) return id
  }
  throw new Error('Não consegui gerar um identificador único para o item. Tente de novo.')
}

function draftItem(kind: MediaKind, id: string, draft: AnyChange & { title: string }): MediaItem {
  return applyChange(newMediaItem(kind, id, draft.title), draft)
}

/** Applies the fields the change sets, through the Phase 1 rules (pages, platinum, status). Nothing is written here. */
function applyChange(item: MediaItem, change: AnyChange): MediaItem {
  for (const key of Object.keys(change) as Array<keyof AnyChange>) {
    if (change[key] !== undefined && !FIELDS_OF[item.kind].includes(key)) {
      throw new Error(`Este campo não existe para ${LABEL[item.kind]}.`)
    }
  }
  let next = item
  if (change.title !== undefined) next = { ...next, title: change.title.trim() }
  if (change.agenda !== undefined) next = { ...next, agenda: change.agenda ?? undefined }
  if (next.kind === 'livro') {
    // The total goes first, so the pages check runs against the total that will be saved.
    if (change.totalPages !== undefined) next = { ...next, totalPages: change.totalPages ?? undefined }
    if (change.pagesRead !== undefined) next = setPagesRead(next, change.pagesRead)
  }
  if (next.kind === 'jogo' && change.platinum !== undefined) next = setPlatinum(next, change.platinum)
  if (change.status !== undefined) {
    if (next.kind === 'jogo') next = setStatus(next, change.status)
    else if (next.kind === 'filme') next = setMovieStatus(next, change.status)
    else next = { ...next, status: change.status }
  }
  if (next.kind === 'jogo') {
    if (change.favorite !== undefined) next = { ...next, favorite: change.favorite }
  }
  return next
}

function posterType(extension: string): PosterType {
  const type = POSTER_TYPES.get(extension.toLowerCase())
  if (!type) throw new Error(POSTER_EXTENSION)
  return type
}

function checkPosterBytes(bytes: Uint8Array, type: PosterType): void {
  if (bytes.byteLength === 0) throw new Error(POSTER_EMPTY)
  if (bytes.byteLength > POSTER_MAX_BYTES) throw new Error(POSTER_SIZE)
  if (!SIGNATURE[type](bytes)) throw new Error(`O arquivo não é um ${POSTER_LABEL[type]} válido.`)
}

/** Validates a poster's declared extension, actual signature and size; returns its canonical extension. */
export function validatePosterImage(bytes: Uint8Array, extension: string): 'png' | 'jpeg' | 'webp' {
  const type = posterType(extension)
  checkPosterBytes(bytes, type)
  return type
}

function matchesAt(bytes: Uint8Array, offset: number, expected: number[]): boolean {
  return bytes.length >= offset + expected.length && expected.every((byte, i) => bytes[offset + i] === byte)
}

/**
 * The poster folder inside the vault, created when missing. Every part of it must be a real folder
 * whose real location is inside the vault: a link or junction anywhere on the way is refused.
 */
function posterDir(vault: string): string {
  return safeDirectory(vault, POSTER_DIR.split('/'), POSTER_PATH)
}

function safeDirectory(vault: string, parts: string[], error: string): string {
  const root = resolve(vault)
  const realRoot = realpathSync(root)
  let dir = root
  for (const part of parts) {
    dir = join(dir, part)
    const stat = linkStat(dir)
    if (!stat) mkdirSync(dir)
    else if (stat.isSymbolicLink() || !stat.isDirectory() || !isInside(realRoot, realpathSync(dir))) throw new Error(error)
  }
  return dir
}

function writePosterAtomic(file: string, bytes: Uint8Array): void {
  const tmp = `${file}.stage-${process.pid}-${randomInt(0x7fffffff)}`
  const fd = openSync(tmp, 'wx')
  try {
    let offset = 0
    while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset)
    fsyncSync(fd)
  } catch (err) {
    closeSync(fd)
    rmSync(tmp, { force: true })
    throw err
  }
  closeSync(fd)
  try {
    renameSync(tmp, file)
  } catch (err) {
    rmSync(tmp, { force: true })
    throw err
  }
}

function removePreviousPoster(dir: string, relPath: string, id: string): void {
  const prefix = `${POSTER_DIR}/`
  if (!relPath.startsWith(prefix) || basename(relPath) === '' || !basename(relPath).startsWith(`${id}.`)) return
  const previous = join(dir, basename(relPath))
  const stat = linkStat(previous)
  if (stat?.isFile() && !stat.isSymbolicLink() && isInside(realpathSync(dir), realpathSync(previous))) unlinkSync(previous)
}

function userFileError(message: string, cause: unknown): Error {
  return new Error(message, { cause })
}

/** The bytes of the poster already at `file`, or undefined. A link there is refused. */
function currentPoster(file: string): Buffer | undefined {
  const stat = linkStat(file)
  if (!stat) return undefined
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(POSTER_PATH)
  return readFileSync(file)
}

/** Puts back the poster that was there before the failed attempt, or removes the new copy when none was. */
function undoPoster(file: string, previous: Buffer | undefined): void {
  try {
    if (previous) writeFileAtomic(file, previous)
    else rmSync(file, { force: true })
  } catch (err) {
    // The error the user needs is the one from the Markdown; a copy that could not be undone is only logged.
    log.warn(`Pôster: não consegui desfazer a cópia de ${basename(file)} depois de uma falha: ${(err as Error).message}`)
  }
}

function linkStat(path: string): Stats | undefined {
  try {
    return lstatSync(path)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw err
  }
}

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel !== '' && !isAbsolute(rel) && rel.split(/[\\/]/)[0] !== '..'
}

const stampOf = (d: Date): string => {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}
