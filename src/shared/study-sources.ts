// Cora's source recommendations: for a study request ("fila, estrutura de dados, introdução"),
// the local sources ranked best to worst, each with where to start and where to stop (pages
// of a PDF, slides of a deck, sections of a note). Pure: main reads the files into units and
// this ranks them, so nothing here touches the disk and nothing is sent to Claude.

import { foldText, scoreStudyText, studySnippet, tokenizeStudyQuery, type StudyQuery } from './study-library'
import type { StudyQuestion } from './study-questions'

export type StudySourceKind = 'pdf' | 'pptx' | 'md' | 'txt'

/** One piece of a document: a PDF page, a slide, a note section or a block of text lines. */
export interface StudySourceUnit {
  /** Page, slide or section number (1-based); the first line for text blocks. */
  n: number
  /** The last line of a text block; the same as `n` otherwise. */
  end?: number
  /** The heading of a note section. */
  heading?: string
  text: string
}

export interface StudySourceDoc {
  /** Path relative to the vault, with `/`. */
  path: string
  title: string
  kind: StudySourceKind
  units: StudySourceUnit[]
}

/** Five steps, best (5) to worst (1). */
export type StudySourceLevel = 1 | 2 | 3 | 4 | 5

export const STUDY_SOURCE_LEVELS: Record<StudySourceLevel, string> = {
  5: 'Muito relevante',
  4: 'Bastante relevante',
  3: 'Relevante',
  2: 'Parcialmente relevante',
  1: 'Pouco relevante',
}

export interface StudySourceRecommendation {
  path: string
  title: string
  kind: StudySourceKind
  /** Where to start and stop, in the document's own numbering (page, slide, section, line). */
  start: number
  end: number
  /** "p. 12–18", "slides 3–5", "seções 2–4", "linhas 10–42". */
  range: string
  /** The section names at the start and end of the range (notes only). */
  startHeading?: string
  endHeading?: string
  /** 0 to 100. */
  score: number
  level: StudySourceLevel
  label: string
  /** A short local piece of the best unit, for the user's eyes only. */
  snippet: string
}

export interface StudySourceRecommendations {
  query: string
  recommendations: StudySourceRecommendation[]
  /** Files the scan could not read or skipped (limits, unreadable formats). */
  warning?: string
}

/** Longest range Cora proposes, in units: past that it is a whole book, not a reading. */
const MAX_RANGE = 30
/** A neighbour joins the range when it scores at least this share of the best unit. */
const NEIGHBOUR_SHARE = 0.35
/**
 * A term found in more than this share of a long document's units says little about where to
 * read in it ("dados" in a data structures book): it weighs a quarter inside that document.
 */
const COMMON_SHARE = 0.4
const COMMON_WEIGHT = 0.25

const WORD_START = (term: string) => new RegExp(`(?:^|[^\\p{L}\\p{N}])${term}`, 'gu')

interface UnitScore {
  hits: Map<string, number>
  phrases: number
  /** The whole phrases of the query found in the unit. */
  phraseList: string[]
  score: number
  length: number
}

/** Scores a unit again with per-term weights (common terms of the document weigh less). */
function reweigh(unit: UnitScore, weight: (term: string) => number, phraseWeight: (phrase: string) => number): UnitScore {
  if (!unit.hits.size) return unit
  let base = 0
  let repeats = 0
  for (const [term, n] of unit.hits) {
    base += 10 * weight(term)
    repeats += (n - 1) * weight(term)
  }
  for (const phrase of unit.phraseList) base += 15 * phraseWeight(phrase)
  return { ...unit, score: base + Math.min(repeats, 10) }
}

function scoreUnit(text: string, query: StudyQuery): UnitScore {
  const folded = foldText(text)
  const hits = new Map<string, number>()
  let repeats = 0
  for (const term of query.terms) {
    const found = folded.match(WORD_START(term))?.length ?? 0
    if (!found) continue
    hits.set(term, found)
    repeats += found - 1
  }
  const spaced = folded.replace(/[^\p{L}\p{N}]+/gu, ' ')
  const phraseList = hits.size ? query.phrases.filter((phrase) => spaced.includes(phrase)) : []
  const phrases = phraseList.length
  const score = hits.size ? hits.size * 10 + phrases * 15 + Math.min(repeats, 10) : 0
  return { hits, phrases, phraseList, score, length: text.length }
}

/** The contiguous units around the best one that still talk about the query (one empty unit may be bridged). */
function denseRange(scores: UnitScore[], best: number, specific: (unit: UnitScore) => boolean): [number, number] {
  const floor = Math.max(1, scores[best]!.score * NEIGHBOUR_SHARE)
  const dense = (i: number) => i >= 0 && i < scores.length && scores[i]!.score >= floor && specific(scores[i]!)
  let start = best
  let end = best
  for (;;) {
    if (end - start + 1 >= MAX_RANGE) break
    if (dense(start - 1)) start--
    else if (dense(start - 2) && end - start + 2 < MAX_RANGE) start -= 2
    else break
  }
  for (;;) {
    if (end - start + 1 >= MAX_RANGE) break
    if (dense(end + 1)) end++
    else if (dense(end + 2) && end - start + 2 < MAX_RANGE) end += 2
    else break
  }
  return [start, end]
}

export function studySourceLevel(score: number): StudySourceLevel {
  return score >= 80 ? 5 : score >= 60 ? 4 : score >= 40 ? 3 : score >= 20 ? 2 : 1
}

/** "p. 12–18" / "p. 12", "slides 3–5", "seção 2", "linhas 10–42". */
export function studySourceRange(kind: StudySourceKind, start: number, end: number): string {
  const span = start === end ? `${start}` : `${start}–${end}`
  if (kind === 'pdf') return `p. ${span}`
  if (kind === 'pptx') return start === end ? `slide ${span}` : `slides ${span}`
  if (kind === 'md') return start === end ? `seção ${span}` : `seções ${span}`
  return start === end ? `linha ${span}` : `linhas ${span}`
}

/**
 * Ranks the documents for a request, best to worst. Each one gets its densest stretch
 * (where to start and stop) and a 0–100 score: term coverage in the stretch (55%), density of
 * hits (15%), whole phrases found (20%) and the file or folder name matching (10%).
 */
export function rankStudySources(docs: StudySourceDoc[], request: string, limit = 12): StudySourceRecommendation[] {
  const query = tokenizeStudyQuery(request)
  if (!query.terms.length) return []
  const out: StudySourceRecommendation[] = []
  for (const doc of docs) {
    const name = scoreUnit(`${doc.path} ${doc.title}`.replace(/[/\\_.-]+/g, ' '), query)
    const nameCoverage = name.hits.size / query.terms.length
    let scores = doc.units.map((unit) => scoreUnit(`${unit.heading ?? ''} ${unit.text}`, query))
    // With common terms, a page joins the range only if it has one of the specific ones.
    let specific = (_unit: UnitScore) => true
    if (scores.length >= 6) {
      const share = (term: string) => scores.filter((unit) => unit.hits.has(term)).length / scores.length
      const common = new Set(query.terms.filter((term) => share(term) > COMMON_SHARE))
      // Only when the request has a more specific term to look for instead.
      if (common.size && common.size < query.terms.length) {
        specific = (unit) => [...unit.hits.keys()].some((term) => !common.has(term))
        scores = scores.map((unit) =>
          reweigh(
            unit,
            (term) => (common.has(term) ? COMMON_WEIGHT : 1),
            // A phrase made only of common terms ("estrutura de dados") is as common as they are.
            (phrase) => (tokenizeStudyQuery(phrase).terms.every((term) => common.has(term)) ? COMMON_WEIGHT : 1),
          ),
        )
      }
    }
    let best = -1
    for (let i = 0; i < scores.length; i++) if (scores[i]!.score > (best < 0 ? 0 : scores[best]!.score)) best = i
    if (best < 0) {
      // Found only by its name: the whole document, at the bottom of the scale.
      if (!name.hits.size || !doc.units.length) continue
      const first = doc.units[0]!
      const last = doc.units[doc.units.length - 1]!
      const score = Math.round(15 * nameCoverage)
      out.push(recommendation(doc, first, last, score, studySnippet(first.text, query, 220)))
      continue
    }
    const [start, end] = denseRange(scores, best, specific)
    const range = scores.slice(start, end + 1)
    const found = new Set<string>()
    let hits = 0
    let chars = 0
    let phrases = 0
    for (const unit of range) {
      for (const [term, n] of unit.hits) {
        found.add(term)
        hits += n
      }
      chars += unit.length
      phrases = Math.max(phrases, unit.phrases)
    }
    const coverage = found.size / query.terms.length
    // Hits per thousand characters: 8 or more is as dense as a passage gets.
    const density = Math.min(1, hits / Math.max(1, chars / 1000) / 8)
    const phraseShare = query.phrases.length ? phrases / query.phrases.length : coverage
    const score = Math.round(100 * (0.55 * coverage + 0.15 * density + 0.2 * phraseShare + 0.1 * nameCoverage))
    out.push(recommendation(doc, doc.units[start]!, doc.units[end]!, score, studySnippet(doc.units[best]!.text, query, 220)))
  }
  return out
    .sort((a, b) => b.score - a.score || a.end - a.start - (b.end - b.start) || a.path.localeCompare(b.path, 'pt-BR'))
    .slice(0, limit)
}

function recommendation(
  doc: StudySourceDoc,
  first: StudySourceUnit,
  last: StudySourceUnit,
  score: number,
  snippet: string,
): StudySourceRecommendation {
  const start = first.n
  const end = last.end ?? last.n
  const level = studySourceLevel(score)
  return {
    path: doc.path,
    title: doc.title,
    kind: doc.kind,
    start,
    end,
    range: studySourceRange(doc.kind, start, end),
    ...(doc.kind === 'md' && first.heading ? { startHeading: first.heading } : {}),
    ...(doc.kind === 'md' && last.heading ? { endHeading: last.heading } : {}),
    score,
    level,
    label: STUDY_SOURCE_LEVELS[level],
    snippet,
  }
}

/** Words of a question that say nothing about its concept. */
const QUESTION_WORDS = new Set(
  (
    'qual quais como explique descreva defina cite resposta afirmativa alternativa correta incorreta sobre entre quando ' +
    'porque onde sendo seguinte seguintes exemplo considere assinale marque indique justifique apresente julgue item itens ' +
    'verdadeira falsa dentre partir deve devem pode podem possui possuem sempre nunca cada todos todas mesmo outra outro'
  ).split(' '),
)

/**
 * The request Cora answers for a question the user got wrong, built here (no model): its
 * topic without the trail id, its tags and up to four telling words of its text.
 */
export function studyQueryOfQuestion(question: { topic: string; tags: string[]; question: string }): string {
  const clean = (text: string) => text.replace(/^\s*\[[^\]]+\]\s*/, '').trim()
  const parts = [clean(question.topic), ...question.tags.map(clean)].filter(Boolean)
  const known = new Set(parts.flatMap((part) => foldText(part).match(/[\p{L}\p{N}]+/gu) ?? []))
  const words: string[] = []
  for (const word of foldText(question.question).match(/[\p{L}]+/gu) ?? []) {
    if (word.length < 5 || QUESTION_WORDS.has(word) || known.has(word) || words.includes(word)) continue
    words.push(word)
  }
  words.sort((a, b) => b.length - a.length)
  parts.push(...words.slice(0, 4))
  return parts.join(', ').slice(0, 200)
}

/** Questions a new cycle of a topic takes from the bank: those whose topic or tags match it (its trail id left out), best first. */
export function questionsForTopic(bank: StudyQuestion[], topic: string, limit = 10): StudyQuestion[] {
  const query = tokenizeStudyQuery(topic.replace(/^\s*\[[^\]]+\]\s*/, ''))
  if (!query.terms.length) return []
  return bank
    .filter((q) => !q.sourceOnly && q.question.trim())
    .map((q) => ({ q, score: scoreStudyText(`${q.topic} ${q.tags.join(' ')}`, query) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.q)
}
