/** A line of a book's table of contents: the printed title and page. `id` is its position in the list, so agents can cite it. */
export interface OutlineEntry {
  id: number
  title: string
  page: number
}

/** One part of a topic and the table-of-contents lines it comes from. */
export interface SubtopicDraft {
  name: string
  entries: number[]
}

export const SUBTOPIC_LIMITS = { min: 3, max: 8 } as const

/** How many first pages are searched for the table of contents, and how many lines are kept. */
const TOC_PAGES = 40
const TOC_LINES = 400

// "1.2 Lei de Coulomb ........ 23" or "Capítulo 3  Campo elétrico   45": a title and a page at the end.
const TOC_LINE = /^\s*(?<title>[\p{L}\d][^\n]{2,120}?)\s*(?:\.{2,}|·{2,}|\s{2,}|\s\.\s)\s*(?<page>\d{1,4})\s*$/u

/** The table of contents of a PDF read from its first pages (no model): lines that end in a page number. */
export function tocEntries(pages: string[]): OutlineEntry[] {
  const found: { title: string; page: number }[] = []
  for (const text of pages.slice(0, TOC_PAGES)) {
    for (const line of text.split(/\r?\n/)) {
      const match = TOC_LINE.exec(line)
      const title = match?.groups?.title?.replace(/[.\s·]+$/, '').trim()
      const page = Number(match?.groups?.page)
      if (title && /\p{L}{3}/u.test(title) && page > 0) found.push({ title, page })
    }
  }
  // A real table of contents is long; a few stray lines are not one (page order is not checked).
  if (found.length < 8) return []
  return found.slice(0, TOC_LINES).map((entry, id) => ({ id, ...entry }))
}

/** The words of a title that can tell one topic from another: accent-free, at least 5 letters, plural "s" dropped. */
const keyWords = (text: string): Set<string> =>
  new Set(
    text
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 5)
      .map((word) => word.replace(/s$/, '')),
  )

/** How many lines of a table of contents share a key word with the topic. Tells which book is about the topic. */
export function tocScore(topic: string, outline: OutlineEntry[]): number {
  const words = keyWords(topic)
  return outline.filter((entry) => [...keyWords(entry.title)].some((word) => words.has(word))).length
}

export type SubtopicCheck ={ ok: true; subtopics: SubtopicDraft[] } | { ok: false; reason: string }

/** Rules the code enforces on a proposed list, whoever wrote it. Its sections must exist in the table and belong to one subtopic only. */
export function checkSubtopics(raw: unknown, outline: OutlineEntry[]): SubtopicCheck {
  if (!Array.isArray(raw)) return { ok: false, reason: 'A lista de subtemas não é uma lista.' }
  if (raw.length < SUBTOPIC_LIMITS.min || raw.length > SUBTOPIC_LIMITS.max)
    return { ok: false, reason: `Subtemas demais ou de menos (${raw.length}); o esperado é de ${SUBTOPIC_LIMITS.min} a ${SUBTOPIC_LIMITS.max}.` }
  const valid = new Set(outline.map((entry) => entry.id))
  const used = new Set<number>()
  const names = new Set<string>()
  const subtopics: SubtopicDraft[] = []
  for (const item of raw) {
    const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
    const name = typeof row.name === 'string' ? row.name.replace(/\s+/g, ' ').trim() : ''
    const entries = Array.isArray(row.entries) ? row.entries : []
    if (!name || name.length > 120) return { ok: false, reason: 'Um subtema está sem nome ou com nome longo demais.' }
    if (names.has(name.toLocaleLowerCase('pt-BR'))) return { ok: false, reason: `Subtema repetido: ${name}.` }
    names.add(name.toLocaleLowerCase('pt-BR'))
    if (!entries.length || !entries.every((id): id is number => Number.isInteger(id) && valid.has(id as number)))
      return { ok: false, reason: `O subtema “${name}” cita seções que não existem no índice.` }
    for (const id of entries as number[]) {
      if (used.has(id)) return { ok: false, reason: `A seção ${id} está em mais de um subtema.` }
      used.add(id)
    }
    subtopics.push({ name, entries: entries as number[] })
  }
  return { ok: true, subtopics }
}

const overlap = (a: number[], b: number[]): number => {
  const right = new Set(b)
  const shared = a.filter((id) => right.has(id)).length
  return shared / (new Set([...a, ...b]).size || 1)
}

/**
 * Whether two lists made apart agree: every subtopic of one has a counterpart in the other that shares at
 * least half of its sections, and the sections each list leaves out are mostly the same.
 */
export function listsAgree(a: SubtopicDraft[], b: SubtopicDraft[]): boolean {
  const match = (from: SubtopicDraft[], to: SubtopicDraft[]) => from.every((x) => to.some((y) => overlap(x.entries, y.entries) >= 0.5))
  return match(a, b) && match(b, a) && overlap(a.flatMap((x) => x.entries), b.flatMap((x) => x.entries)) >= 0.7
}

export interface StudySubtopics {
  topic: string
  /** The book the table of contents came from. */
  source: string
  builtAt: number
  status: 'ok' | 'sem-indice' | 'sem-acordo'
  /** Plain reason when the status is not ok. */
  reason?: string
  /** Whether the two lists agreed by themselves (false: the third agent picked one). */
  agreed?: boolean
  subtopics: { name: string; sections: { title: string; page: number }[] }[]
}
