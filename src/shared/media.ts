import { isIsoDay } from './proposals'

export const MEDIA_STATUSES = ['planejado', 'em andamento', 'concluído'] as const
export type MediaStatus = (typeof MEDIA_STATUSES)[number]
export type MediaKind = 'livro' | 'filme' | 'jogo'

/** Fields the local confirmation editor may send to create exactly one item. */
export type MediaCreateInput =
  | { kind: 'livro'; title: string; status: MediaStatus; pagesRead: number; totalPages?: number; agenda?: MediaAgendaLink }
  | { kind: 'filme'; title: string; status: MediaStatus; agenda?: MediaAgendaLink }
  | { kind: 'jogo'; title: string; status: MediaStatus; favorite: boolean; platinum: boolean; agenda?: MediaAgendaLink }

/** Editable fields for an existing item; null clears an optional agenda link or page total. */
export type MediaUpdateInput =
  | {
      kind: 'livro'
      id: string
      title: string
      status: MediaStatus
      pagesRead: number
      totalPages: number | null
      agenda: MediaAgendaLink | null
    }
  | { kind: 'filme'; id: string; title: string; status: MediaStatus; agenda: MediaAgendaLink | null }
  | { kind: 'jogo'; id: string; title: string; status: MediaStatus; favorite: boolean; platinum: boolean; agenda: MediaAgendaLink | null }

export interface MediaPosterResult {
  dataUrl: string | null
  error?: string
}

export const MEDIA_FILES: Record<MediaKind, string> = { livro: 'livros.md', filme: 'filmes.md', jogo: 'jogos.md' }
export const MEDIA_ID_RE = /^m[a-z0-9]{8}$/
export const POSTER_DIR = 'midias/posters'

const POSTER_PREFIX = `${POSTER_DIR}/`
// Control characters are excluded on purpose, so the lint rule against them does not apply here.
// eslint-disable-next-line no-control-regex
const POSTER_FILE_RE = /^[^/\\:*?"<>|\r\n\x00-\x1f]+\.(png|jpe?g|webp)$/i
const WINDOWS_RESERVED_RE = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const TITLE_MAX = 200
const HEADING = /^## (.+)$/
const FIELD = /^-[ ]*([^:]+):[ ]*(.*)$/
const ID_LINE_WITHOUT_COLON = /^- ID(\s|$)[^:]*$/
const AGENDA_FIELD = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) (.+)$/

const FIELDS: Record<MediaKind, readonly string[]> = {
  livro: ['ID', 'Estado', 'Páginas lidas', 'Total de páginas', 'Agenda'],
  filme: ['ID', 'Estado', 'Pôster', 'Agenda'],
  jogo: ['ID', 'Estado', 'Favorito', 'Platina', 'Agenda'],
}

/** Optional fields left empty in the file mean the same as missing. */
const OPTIONAL_FIELDS: readonly string[] = ['Pôster', 'Total de páginas', 'Agenda']

export interface MediaAgendaLink {
  day: string
  time: string
  title: string
}

interface MediaBase {
  id: string
  title: string
  status: MediaStatus
  agenda?: MediaAgendaLink
}

export interface BookItem extends MediaBase {
  kind: 'livro'
  pagesRead: number
  totalPages?: number
}

export interface MovieItem extends MediaBase {
  kind: 'filme'
  posterPath?: string
  /** Set when the file's poster path is invalid: the item loads without posterPath and shows this message. */
  posterError?: string
}

export interface GameItem extends MediaBase {
  kind: 'jogo'
  favorite: boolean
  platinum: boolean
}

export type MediaItem = BookItem | MovieItem | GameItem
export type MediaItemOf<K extends MediaKind> = Extract<MediaItem, { kind: K }>

export interface MediaSpan {
  start: number
  end: number
}

export interface MediaDocument<T extends MediaItem = MediaItem> {
  kind: MediaKind
  lines: string[]
  items: T[]
  spans: MediaSpan[]
  eol: '\n' | '\r\n'
  trailingNewline: boolean
}

export interface BookProgress {
  pagesRead: number
  totalPages?: number
  percent: number
}

/** Agenda-linked state/progress edits require an explicit user confirmation. */
export function needsAgendaConfirmation(item: MediaItem, change: Partial<MediaItem>): boolean {
  if (!item.agenda) return false
  if (change.status !== undefined && change.status !== item.status) return true
  if (item.kind === 'livro' && change.kind === 'livro') {
    return change.pagesRead !== undefined && change.pagesRead !== item.pagesRead
  }
  if (item.kind === 'jogo' && change.kind === 'jogo') return change.platinum !== undefined && change.platinum !== item.platinum
  return false
}

/** A declined completion prompt preserves the existing state; reaching the total never completes silently. */
export function bookStatusAfterPrompt(
  current: MediaStatus,
  pagesRead: number,
  totalPages: number | undefined,
  confirmed: boolean,
): MediaStatus {
  return totalPages !== undefined && pagesRead === totalPages && confirmed ? 'concluído' : current
}

/** A cancelled native picker leaves the current selection untouched. */
export function posterAfterPicker<T>(current: T | null, picked: T | null): T | null {
  return picked ?? current
}

/** Parses a media Markdown file, keeping every original line so untouched text round-trips exactly. */
export function parseMedia<K extends MediaKind>(kind: K, source: string): MediaDocument<MediaItemOf<K>> {
  const text = source.startsWith('\uFEFF') ? source.slice(1) : source
  const hasCrlf = text.includes('\r\n')
  if (hasCrlf && /(?<!\r)\n/.test(text)) {
    throw new Error(`${MEDIA_FILES[kind]} mistura finais de linha LF e CRLF. Use um só tipo antes de editar.`)
  }
  const eol = hasCrlf ? '\r\n' : '\n'
  const trailingNewline = text.endsWith('\n')
  const lines = text.split(/\r?\n/)
  if (trailingNewline) lines.pop()
  const items: MediaItem[] = []
  const spans: MediaSpan[] = []
  const seen = new Set<string>()
  let start = 0
  while (start < lines.length) {
    if (!HEADING.test(lines[start]!)) {
      start++
      continue
    }
    let end = start + 1
    while (end < lines.length && !HEADING.test(lines[end]!)) end++
    const item = readSection(kind, lines, start, end)
    if (item) {
      if (seen.has(item.id)) throw new Error(`O identificador ${item.id} aparece mais de uma vez em ${MEDIA_FILES[kind]}.`)
      seen.add(item.id)
      items.push(item)
      spans.push({ start, end })
    }
    start = end
  }
  return { kind, lines, items: items as MediaItemOf<K>[], spans, eol, trailingNewline }
}

/** Serializes the document with its original line endings; untouched lines come back byte for byte. */
export function serializeMedia(document: MediaDocument): string {
  return document.lines.join(document.eol) + (document.trailingNewline ? document.eol : '')
}

/** Default item for a new draft: planned, no progress, no poster, no favorite or platinum. */
export function newMediaItem<K extends MediaKind>(kind: K, id: string, title: string): MediaItemOf<K> {
  const base = { id, title: title.trim(), status: 'planejado' as const }
  const item: MediaItem =
    kind === 'livro'
      ? { kind: 'livro', ...base, pagesRead: 0 }
      : kind === 'filme'
        ? { kind: 'filme', ...base }
        : { kind: 'jogo', ...base, favorite: false, platinum: false }
  checkItem(item)
  return item as MediaItemOf<K>
}

/** Adds an item section at the end of the file, leaving the existing text untouched. */
export function appendMediaItem<K extends MediaKind>(text: string, kind: K, item: MediaItemOf<K>): string {
  const document = parseMedia(kind, text)
  checkItem(item)
  if (document.items.some((existing) => existing.id === item.id)) {
    throw new Error(`O identificador ${item.id} aparece mais de uma vez em ${MEDIA_FILES[kind]}.`)
  }
  const block = renderItem(item)
  const lines = text === '' ? block : [...document.lines, '', ...block]
  return serializeMedia({ ...document, lines, trailingNewline: true })
}

/**
 * Rewrites one item section. Known fields are regenerated from the item in place, unknown lines
 * keep their exact position, and new fields go right after the last known field.
 */
export function replaceMediaItem<K extends MediaKind>(text: string, kind: K, item: MediaItemOf<K>): string {
  const document = parseMedia(kind, text)
  checkItem(item)
  const index = document.items.findIndex((existing) => existing.id === item.id)
  if (index < 0) throw new Error(`Não encontrei este item em ${MEDIA_FILES[kind]}.`)
  const { start, end } = document.spans[index]!
  const section = rewriteSection(kind, document.lines, start, end, item)
  const lines = [...document.lines.slice(0, start), ...section, ...document.lines.slice(end)]
  return serializeMedia({ ...document, lines })
}

export function bookProgress(book: BookItem): BookProgress {
  const total = book.totalPages ?? 0
  const percent = total === 0 ? 0 : Math.floor((book.pagesRead * 100) / total)
  return { pagesRead: book.pagesRead, totalPages: book.totalPages, percent }
}

/** Changes pages read only; reaching the total never changes the status by itself. */
export function setPagesRead(book: BookItem, pagesRead: number): BookItem {
  const next = { ...book, pagesRead }
  checkItem(next)
  return next
}

/** Platinum concludes the game; removing it leaves the status as it is. */
export function setPlatinum(game: GameItem, platinum: boolean): GameItem {
  return platinum ? { ...game, platinum, status: 'concluído' } : { ...game, platinum }
}

export function setStatus(game: GameItem, status: MediaStatus): GameItem {
  const next = { ...game, status }
  checkItem(next)
  return next
}

/** Changes a movie's status only; the poster path stays as it is. */
export function setMovieStatus(movie: MovieItem, status: MediaStatus): MovieItem {
  const next = { ...movie, status }
  checkItem(next)
  return next
}

function readSection(kind: MediaKind, lines: string[], start: number, end: number): MediaItem | undefined {
  const title = HEADING.exec(lines[start]!)![1]!.trim()
  const found: Array<[string, string]> = []
  for (let i = start + 1; i < end; i++) {
    if (ID_LINE_WITHOUT_COLON.test(lines[i]!)) throw new Error(idLineError(title))
    const match = FIELD.exec(lines[i]!)
    if (!match) continue
    const key = match[1]!.trim()
    if (FIELDS[kind].includes(key)) found.push([key, (match[2] ?? '').trim()])
  }
  if (!found.some(([key]) => key === 'ID')) return undefined
  const fields = new Map<string, string>()
  for (const [key, value] of found) {
    if (fields.has(key)) throw new Error(`O campo "${key}" aparece mais de uma vez em "${title}".`)
    fields.set(key, value)
  }
  for (const key of OPTIONAL_FIELDS) if (fields.get(key) === '') fields.delete(key)
  const base = {
    id: fields.get('ID')!,
    title,
    status: fields.has('Estado') ? parseStatus(fields.get('Estado')!, kind, title) : ('planejado' as const),
    ...(fields.has('Agenda') ? { agenda: parseAgenda(fields.get('Agenda')!, title) } : {}),
  }
  let item: MediaItem
  if (kind === 'livro') {
    const totalPages = fields.has('Total de páginas') ? parseCount(fields.get('Total de páginas')!, 'Total de páginas', title) : undefined
    item = {
      kind,
      ...base,
      pagesRead: fields.has('Páginas lidas') ? parseCount(fields.get('Páginas lidas')!, 'Páginas lidas', title) : 0,
      ...(totalPages === undefined ? {} : { totalPages }),
    }
  } else if (kind === 'filme') {
    const posterPath = fields.get('Pôster')
    if (posterPath === undefined || isPosterPath(posterPath)) {
      item = { kind, ...base, ...(posterPath === undefined ? {} : { posterPath }) }
    } else {
      item = { kind, ...base, posterError: posterMessage(title) }
    }
  } else {
    const platinum = fields.has('Platina') ? parseYesNo(fields.get('Platina')!, 'Platina', title) : false
    item = {
      kind,
      ...base,
      status: platinum ? 'concluído' : base.status,
      favorite: fields.has('Favorito') ? parseYesNo(fields.get('Favorito')!, 'Favorito', title) : false,
      platinum,
    }
  }
  checkItem(item)
  return item
}

/** Shared rules for every item, whether it came from the file or from the UI. */
function checkItem(item: MediaItem): void {
  const title = item.title
  if (!MEDIA_ID_RE.test(item.id)) throw new Error(`O identificador "${item.id}" de "${title}" é inválido.`)
  if (!title.trim() || title.length > TITLE_MAX || /[\r\n]/.test(title)) {
    throw new Error(`O título precisa ter de 1 a ${TITLE_MAX} caracteres, em uma linha.`)
  }
  if (!isMediaStatus(item.status)) throw new Error('Estado inválido. Use planejado, em andamento ou concluído.')
  if (item.kind === 'jogo' && item.platinum && item.status !== 'concluído') {
    throw new Error(`"${title}" é platinado, então precisa estar concluído. Desmarque a platina antes de mudar o estado.`)
  }
  if (item.kind === 'livro') {
    if (!isCount(item.pagesRead)) throw new Error(countError('Páginas lidas', title))
    if (item.totalPages !== undefined) {
      if (!isCount(item.totalPages)) throw new Error(countError('Total de páginas', title))
      if (item.pagesRead > item.totalPages) throw new Error(`Páginas lidas de "${title}" não pode ser maior que o total de páginas.`)
    }
  }
  if (item.kind === 'filme' && item.posterPath !== undefined && !isPosterPath(item.posterPath)) {
    throw new Error(posterMessage(title))
  }
  if (item.agenda) {
    const { day, time, title: agendaTitle } = item.agenda
    if (!isIsoDay(day) || !TIME_RE.test(time) || !agendaTitle.trim() || agendaTitle.length > TITLE_MAX || /[\r\n]/.test(agendaTitle)) {
      throw new Error(agendaError(title))
    }
  }
}

function renderItem(item: MediaItem): string[] {
  return [`## ${item.title.trim()}`, ...renderFields(item).map(([, line]) => line)]
}

function renderFields(item: MediaItem): Array<[string, string]> {
  const fields: Array<[string, string]> = [
    ['ID', `- ID: ${item.id}`],
    ['Estado', `- Estado: ${item.status}`],
  ]
  if (item.kind === 'livro') {
    fields.push(['Páginas lidas', `- Páginas lidas: ${item.pagesRead}`])
    if (item.totalPages !== undefined) fields.push(['Total de páginas', `- Total de páginas: ${item.totalPages}`])
  } else if (item.kind === 'filme') {
    if (item.posterPath !== undefined) fields.push(['Pôster', `- Pôster: ${item.posterPath}`])
  } else {
    fields.push(['Favorito', `- Favorito: ${yesNo(item.favorite)}`], ['Platina', `- Platina: ${yesNo(item.platinum)}`])
  }
  if (item.agenda) {
    fields.push(['Agenda', `- Agenda: ${item.agenda.day} ${item.agenda.time} ${item.agenda.title.trim()}`])
  }
  return fields
}

function rewriteSection(kind: MediaKind, lines: string[], start: number, end: number, item: MediaItem): string[] {
  const rendered = new Map(renderFields(item))
  const placed = new Set<string>()
  const body: string[] = []
  let anchor = 0
  for (const line of lines.slice(start + 1, end)) {
    const key = knownKey(kind, line)
    if (key === undefined) {
      body.push(line)
      continue
    }
    const next = rendered.get(key) ?? (keepsInvalidPoster(item, key) ? line : undefined)
    if (next === undefined) continue
    placed.add(key)
    body.push(next)
    anchor = body.length - 1
  }
  for (const [key, line] of rendered) {
    if (placed.has(key)) continue
    body.splice(anchor + 1, 0, line)
    anchor++
  }
  return [`## ${item.title.trim()}`, ...body]
}

/** An invalid poster line is kept as written so editing other fields never erases it. */
function keepsInvalidPoster(item: MediaItem, key: string): boolean {
  return key === 'Pôster' && item.kind === 'filme' && item.posterError !== undefined
}

function knownKey(kind: MediaKind, line: string): string | undefined {
  const key = FIELD.exec(line)?.[1]?.trim()
  return key !== undefined && FIELDS[kind].includes(key) ? key : undefined
}

function posterMessage(title: string): string {
  return `O pôster de "${title}" precisa estar em ${POSTER_DIR} e ser PNG, JPEG ou WebP.`
}

function idLineError(title: string): string {
  return `A linha de ID de "${title}" precisa seguir o formato "- ID: identificador".`
}

function isPosterPath(path: string): boolean {
  if (!path.startsWith(POSTER_PREFIX)) return false
  const name = path.slice(POSTER_PREFIX.length)
  return POSTER_FILE_RE.test(name) && !WINDOWS_RESERVED_RE.test(name.split('.')[0]!.trimEnd().toUpperCase())
}

function parseStatus(value: string, kind: MediaKind, title: string): MediaStatus {
  if (!isMediaStatus(value)) {
    throw new Error(`Estado inválido em ${MEDIA_FILES[kind]} para "${title}". Use planejado, em andamento ou concluído.`)
  }
  return value
}

function parseAgenda(value: string, title: string): MediaAgendaLink {
  const match = AGENDA_FIELD.exec(value)
  if (!match) throw new Error(agendaError(title))
  return { day: match[1]!, time: match[2]!, title: match[3]!.trim() }
}

function parseCount(value: string, label: string, title: string): number {
  if (!/^\d+$/.test(value)) throw new Error(countError(label, title))
  return Number(value)
}

function parseYesNo(value: string, label: string, title: string): boolean {
  if (value === 'sim') return true
  if (value === 'não') return false
  throw new Error(`O campo "${label}" de "${title}" precisa ser "sim" ou "não".`)
}

function isMediaStatus(value: string): value is MediaStatus {
  return (MEDIA_STATUSES as readonly string[]).includes(value)
}

function isCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}

function countError(label: string, title: string): string {
  return `${label} de "${title}" deve ser um número inteiro maior ou igual a zero.`
}

function agendaError(title: string): string {
  return `O vínculo de agenda de "${title}" precisa seguir o formato AAAA-MM-DD HH:MM e ter um título.`
}

function yesNo(value: boolean): string {
  return value ? 'sim' : 'não'
}
