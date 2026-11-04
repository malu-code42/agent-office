import {
  disciplineIdOf,
  studyBankFolders,
  STUDY_BANK_DEFAULT_PER_TOPIC,
  type StudyBankReason,
  type StudyBookSuggestion,
  type StudyBankStep,
  type StudyBankStop,
  type StudyBankTopicResult,
} from '@shared/study-bank'
import type { StudyLibraryHit } from '@shared/study-library'
import { isChoiceQuestion, STUDY_QUESTION_LIMITS, type StudyQuestion } from '@shared/study-questions'
import type { StudySubtopics } from '@shared/study-outline'
import type { StudyTrail, StudyTrailTopic } from '@shared/study-trail'
import { askClaude, generateGroundedQuestion, tooSimilar, type AskJson, type GroundedFailure } from './study-questions-grounded'

/** A bank error that ends the whole run: the bank is full or changed in Obsidian during the write. */
export type StudyBankWriteError = Error & { code?: 'full' | 'changed' }

export type StudyBankProgress =
  | { kind: 'topic'; topic: StudyTrailTopic; index: number; total: number; goal: number; had: number }
  | { kind: 'step'; step: StudyBankStep; made: number; source: string }
  | { kind: 'done'; result: StudyBankTopicResult }

interface Deps {
  library: { search(query: string, scope?: readonly string[]): Promise<{ hits: StudyLibraryHit[] }> }
  bank: {
    read(): { questions: StudyQuestion[] }
    appendChecked(rows: StudyQuestion[], backup?: boolean): { added: number; skipped: number }
  }
  ask?: AskJson
  /** An answered question does not count toward a topic's goal: the user will not see it again. */
  isAnswered?: (question: StudyQuestion) => boolean
  /** Textbooks on the web for a topic the local books do not cover; a failure just means no suggestion. */
  suggestBooks?: (topic: string, discipline: string) => Promise<StudyBookSuggestion[]>
  /** The topic's subtopics: the stored ones, and how to build them from the book's table of contents. */
  subtopics?: { get(topic: string): StudySubtopics | undefined; build(topic: StudyTrailTopic): Promise<StudySubtopics> }
}

export interface StudyBankBuildOptions {
  /** Discipline id, e.g. P2-ED; all disciplines when absent. */
  discipline?: string
  /** One topic of the trail (its label, title or id); all topics when absent. */
  topic?: string
  perTopic?: number
  /** Questions wanted from each subtopic; the topic's goal becomes this times its subtopics. Topics without subtopics keep `perTopic`. */
  perSubtopic?: number
  signal?: AbortSignal
  onProgress?: (event: StudyBankProgress) => void
}

export interface StudyBankBuildResult {
  results: StudyBankTopicResult[]
  stop?: StudyBankStop
  message?: string
}

/** One slice of a topic's goal: the whole topic, or one of its subtopics. */
interface Unit {
  name?: string
  query: string
  goal: number
}

const NAME_ONLY = /O nome corresponde|Encontrado pelo nome/
const ABORTED = 'study-bank-aborted'

/** The topics a request covers, in trail order. */
export function studyBankTopics(trail: StudyTrail, options: Pick<StudyBankBuildOptions, 'discipline' | 'topic'> = {}): StudyTrailTopic[] {
  return trail.topics.filter(
    (topic) =>
      (!options.discipline || disciplineIdOf(topic.id) === options.discipline) &&
      (!options.topic || [topic.label, topic.title, topic.id].includes(options.topic)),
  )
}

/**
 * Fills the bank for the topics of the trail, `perTopic` unanswered questions each, from the
 * discipline's books only. Safe to repeat: a topic that already has its questions is skipped. Each
 * topic's questions are written when the topic ends, so a stop keeps everything finished before it.
 */
export async function buildStudyBank(trail: StudyTrail, deps: Deps, options: StudyBankBuildOptions = {}): Promise<StudyBankBuildResult> {
  const perTopic = options.perTopic ?? STUDY_BANK_DEFAULT_PER_TOPIC
  const topics = studyBankTopics(trail, options)
  const results: StudyBankTopicResult[] = []
  const rawAsk = deps.ask ?? askClaude
  const ask: AskJson = (system, payload) => {
    if (options.signal?.aborted) throw new Error(ABORTED)
    return rawAsk(system, payload)
  }
  // One backup of the bank per run, before its first write (not one per topic).
  let backedUp = false
  const append = (rows: StudyQuestion[]) => {
    const out = deps.bank.appendChecked(rows, !backedUp)
    backedUp = true
    return out
  }

  const booksFor = async (topic: StudyTrailTopic): Promise<{ books?: StudyBookSuggestion[] }> => {
    if (!deps.suggestBooks || options.signal?.aborted) return {}
    try {
      const books = await deps.suggestBooks(topic.title, topic.discipline)
      return books.length ? { books } : {}
    } catch {
      return {}
    }
  }

  /** The topic's subtopics (built from its book once, then kept); none when the book has no usable table of contents. */
  const subtopicsFor = async (topic: StudyTrailTopic): Promise<string[]> => {
    if (!deps.subtopics || options.signal?.aborted) return []
    try {
      const entry = deps.subtopics.get(topic.title) ?? (await deps.subtopics.build(topic))
      return entry.status === 'ok' ? entry.subtopics.map((s) => s.name) : []
    } catch {
      return []
    }
  }

  for (const [index, topic] of topics.entries()) {
    if (options.signal?.aborted) return { results, stop: 'cancelled' }
    const disciplineId = disciplineIdOf(topic.id)
    const bank = deps.bank.read().questions
    const onTopic = bank.filter((q) => q.topic === topic.title)
    // only multiple-choice questions not answered yet count toward the goal
    const fresh = (list: StudyQuestion[]) => list.filter((q) => isChoiceQuestion(q) && !deps.isAnswered?.(q))
    const have = fresh(onTopic)
    // With subtopics, each gets its own goal (`perSubtopic`) or an equal share of the topic's, so the topic is covered rather than drawn from one corner of the book.
    const names = await subtopicsFor(topic)
    const share = options.perSubtopic ?? (names.length ? Math.ceil(perTopic / names.length) : perTopic)
    const goal = options.perSubtopic && names.length ? options.perSubtopic * names.length : perTopic
    const start: StudyBankTopicResult = {
      id: topic.id,
      topic: topic.title,
      discipline: topic.discipline,
      disciplineId,
      goal,
      had: have.length,
      added: 0,
    }
    options.onProgress?.({ kind: 'topic', topic, index, total: topics.length, goal, had: have.length })
    const finish = (result: StudyBankTopicResult) => {
      results.push(result)
      options.onProgress?.({ kind: 'done', result })
    }

    const { folders: scope, fallback } = studyBankFolders(disciplineId, topic.discipline)
    const units: Unit[] = names.length
      ? names.map((name) => ({ name, query: `${topic.title} ${name}`, goal: share }))
      : [{ query: topic.title, goal: perTopic }]
    if (units.every((unit) => fresh(onTopic.filter((q) => !unit.name || q.subtopic === unit.name)).length >= unit.goal)) {
      finish({ ...start, reason: 'complete' })
      continue
    }

    let added = 0
    // Questions made for the earlier subtopics of this topic: the bank was read before them, so the author must be told too.
    const madeBefore: StudyQuestion[] = []
    let reason: StudyBankReason | undefined
    let books: { books?: StudyBookSuggestion[] } = {}
    let folder: string | undefined
    for (const unit of units) {
      const mine = onTopic.filter((q) => !unit.name || q.subtopic === unit.name)
      const haveUnit = fresh(mine).length
      if (haveUnit >= unit.goal) continue
      const room = STUDY_QUESTION_LIMITS.count - bank.length - added
      if (room <= 0) {
        finish({ ...start, added })
        return { results, stop: 'full' }
      }
      const missing = Math.min(unit.goal - haveUnit, room)
      const capped = missing < unit.goal - haveUnit

      let hits: StudyLibraryHit[]
      try {
        hits = (await deps.library.search(unit.query, scope)).hits.filter((hit) => !NAME_ONLY.test(hit.excerpt))
      } catch (error) {
        return { results, stop: 'error', message: (error as Error).message }
      }
      const first = hits[0]
      if (!first) {
        // With no folder of its own, nothing found means no book was put in the default folder.
        reason ??= fallback ? 'no-book' : 'no-passage'
        if (fallback) folder = scope[0]
        books = await booksFor(topic)
        continue
      }
      // One passage per question: the author can only repeat itself past the passages there are.
      hits = distinct(hits)
      // Only as many questions as there are passages left (a short book still gives what it can; the report says it fell short).
      const toMake = Math.min(missing, hits.length - mine.length)
      if (toMake < 1) {
        reason ??= 'little'
        books = await booksFor(topic)
        continue
      }

      const made: StudyQuestion[] = []
      let failure: GroundedFailure | undefined
      let stop: StudyBankBuildResult | undefined
      for (let i = 0; i < toMake; i++) {
        // Each question starts from the next passage (wrapping), so a topic with many questions does not reread the same 3 passages.
        const anchor = hits[(mine.length + made.length) % hits.length] ?? first
        const file = fileOf(anchor.sourceRef)
        const sourceTitle = file.split('/').pop() ?? file
        const inFile = hits.filter((hit) => fileOf(hit.sourceRef) === file)
        const from = Math.max(0, inFile.indexOf(anchor))
        const excerpt = [0, 1, 2]
          .slice(0, inFile.length)
          .map((n) => inFile[(from + n) % inFile.length]!.excerpt)
          .join('\n\n')
        try {
          const result = await generateGroundedQuestion(
            {
              topic: unit.name ? `${topic.title} — ${unit.name}` : topic.title,
              excerpt,
              sourceTitle,
              sourceReference: anchor.sourceRef,
              // Answered questions too: the author must not write them again with other words.
              avoid: [...onTopic, ...madeBefore, ...made].map((q) => q.question),
            },
            ask,
            3,
            (step) => options.onProgress?.({ kind: 'step', step, made: added + made.length, source: sourceTitle }),
          )
          if (!result.ok) {
            failure = result.code
            break
          }
          // The question keeps the topic's title (the bank groups by it); the subtopic is its own field.
          made.push({ ...result.question, topic: topic.title, tags: [topic.discipline], ...(unit.name ? { subtopic: unit.name } : {}) })
        } catch (error) {
          const message = (error as Error).message
          stop = message === ABORTED ? { results, stop: 'cancelled' } : { results, stop: 'unavailable', message }
          break
        }
      }

      let addedHere = 0
      if (made.length) {
        try {
          addedHere = append(made).added
        } catch (error) {
          const code = (error as StudyBankWriteError).code
          return { results, stop: code ?? 'error', message: (error as Error).message }
        }
      }
      added += addedHere
      madeBefore.push(...made)
      if (stop) {
        if (added) finish({ ...start, added })
        return stop
      }
      if (capped && !failure && addedHere === missing) {
        finish({ ...start, added })
        return { results, stop: 'full' }
      }
      if (haveUnit + addedHere < unit.goal) reason ??= reasonOf(failure, addedHere < made.length)
    }
    const result: StudyBankTopicResult = { ...start, added }
    if (have.length + added < goal && reason) {
      result.reason = reason
      if (folder) result.folder = folder
      Object.assign(result, books)
    }
    finish(result)
  }
  return { results }
}

/** Passages in order, without those that teach what an earlier one already says. */
function distinct(hits: StudyLibraryHit[]): StudyLibraryHit[] {
  const kept: StudyLibraryHit[] = []
  for (const hit of hits) if (!kept.some((k) => tooSimilar(k.excerpt, hit.excerpt))) kept.push(hit)
  return kept
}

function reasonOf(failure: GroundedFailure | undefined, duplicates: boolean): StudyBankReason {
  if (failure === 'similar' || (!failure && duplicates)) return 'similar'
  if (failure === 'refused') return 'refused'
  return 'little'
}

/** The file part of a library reference (`path#heading:line`). */
const fileOf = (sourceRef: string): string => sourceRef.replace(/#.*$/, '').replace(/:\d+$/, '')
