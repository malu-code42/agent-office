export interface StudyLibraryHit {
  id: string
  sourceRef: string
  title: string
  excerpt: string
  line: number
  score: number
}

/** What Cora can do with a file of "study sources": read it, wait for OCR, or only find it by name. */
export type StudySourceStatus = 'lida' | 'ocr' | 'lendo' | 'so-nome' | 'grande' | 'ilegivel'

export interface StudySourceInfo {
  /** Path relative to the vault. */
  path: string
  name: string
  ext: string
  size: number
  status: StudySourceStatus
  /** PDF only: pages, and how many have no text (scanned pages the OCR still has to read). */
  pages?: number
  blankPages?: number
}

export interface StudySourceInventory {
  sources: StudySourceInfo[]
  /** False when some folders or shortcuts were not walked. */
  complete: boolean
  /** The "study sources" folder does not exist yet. */
  missingFolder?: true
  /** Scanned PDFs handed to the background OCR by this check. */
  ocrQueued: number
}

/** The background OCR right now: the file being read, its pages read so far, and the files waiting. */
export interface StudyOcrStatus {
  file: string
  done: number
  total: number
  queued: number
}

export interface StudyLibrarySearch {
  token: string
  query: string
  complete: boolean
  hits: StudyLibraryHit[]
  warning?: string
}

/** A query for Cora: its words (folded) and its multi-word phrases, split by commas or semicolons. */
export interface StudyQuery {
  terms: string[]
  phrases: string[]
}

/** Words that alone say nothing about a topic ("estrutura de dados" searches "estrutura" and "dados"). */
const STOPWORDS = new Set(
  'a o as os e de da do das dos em no na nos nas um uma uns umas para por com sem ao aos the of and or to in on for'.split(' '),
)

/** Lowercase without accents ("Árvore" → "arvore"), one output char per input char where possible. */
export function foldText(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR')
}

/**
 * Splits a query into terms and phrases: "fila, estrutura de dados" gives the terms fila,
 * estrutura and dados and the phrase "estrutura de dados". Accents and case do not count;
 * a plural "s" is dropped so "filas" also finds "fila".
 */
export function tokenizeStudyQuery(query: string): StudyQuery {
  const terms = new Set<string>()
  const phrases = new Set<string>()
  for (const part of query.split(/[,;\n]+/)) {
    const words = foldText(part).match(/[\p{L}\p{N}]+/gu) ?? []
    if (words.length > 1) phrases.add(words.join(' '))
    for (const word of words) {
      if (word.length < 2 || STOPWORDS.has(word)) continue
      terms.add(word.length > 4 && word.endsWith('s') ? word.slice(0, -1) : word)
    }
  }
  return { terms: [...terms].slice(0, 12), phrases: [...phrases].slice(0, 6) }
}

// Terms are letters and digits only (tokenizeStudyQuery), so they need no escaping.
const WORD_START = (term: string) => new RegExp(`(?:^|[^\\p{L}\\p{N}])${term}`, 'gu')

/**
 * How well a text answers a query: 10 points per distinct term found at a word start, 15 per
 * phrase found whole, plus up to 5 for repeated hits. Zero when no term is there.
 */
export function scoreStudyText(text: string, query: StudyQuery): number {
  const folded = foldText(text)
  let score = 0
  let repeats = 0
  for (const term of query.terms) {
    const found = folded.match(WORD_START(term))?.length ?? 0
    if (!found) continue
    score += 10
    repeats += found - 1
  }
  if (!score) return 0
  const spaced = folded.replace(/[^\p{L}\p{N}]+/gu, ' ')
  for (const phrase of query.phrases) if (spaced.includes(phrase)) score += 15
  return score + Math.min(repeats, 5)
}

/** A short piece of a text around its first matching term, with … where it was cut. */
export function studySnippet(text: string, query: StudyQuery, max = 320): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const folded = foldText(clean)
  // Folding keeps the length unless a char decomposes oddly; then the window is only approximate.
  let first = -1
  for (const term of query.terms) {
    const match = WORD_START(term).exec(folded)
    if (match && (first < 0 || match.index < first)) first = match.index
  }
  const start = Math.max(0, Math.min(first < 0 ? 0 : first - Math.floor(max / 3), clean.length - max))
  const cut = clean.slice(start, start + max).trim()
  return `${start > 0 ? '…' : ''}${cut}${start + max < clean.length ? '…' : ''}`
}
