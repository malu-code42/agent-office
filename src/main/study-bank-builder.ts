import {
  disciplineIdOf,
  studyBankFolders,
  STUDY_BANK_DEFAULT_PER_TOPIC,
  type StudyBankReason,
  type StudyBankStep,
  type StudyBankStop,
  type StudyBankTopicResult,
} from '@shared/study-bank'
import type { StudyLibraryHit } from '@shared/study-library'
import { isChoiceQuestion, STUDY_QUESTION_LIMITS, type StudyQuestion } from '@shared/study-questions'
import type { StudyTrail, StudyTrailTopic } from '@shared/study-trail'
import { askClaude, generateGroundedQuestion, type AskJson, type GroundedFailure } from './study-questions-grounded'

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
}

export interface StudyBankBuildOptions {
  /** Discipline id, e.g. P2-ED; all disciplines when absent. */
  discipline?: string
  /** One topic of the trail (its label, title or id); all topics when absent. */
  topic?: string
  perTopic?: number
  signal?: AbortSignal
  onProgress?: (event: StudyBankProgress) => void
}

export interface StudyBankBuildResult {
  results: StudyBankTopicResult[]
  stop?: StudyBankStop
  message?: string
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

  for (const [index, topic] of topics.entries()) {
    if (options.signal?.aborted) return { results, stop: 'cancelled' }
    const disciplineId = disciplineIdOf(topic.id)
    const bank = deps.bank.read().questions
    const onTopic = bank.filter((q) => q.topic === topic.title)
    // only multiple-choice questions not answered yet count toward the goal
    const have = onTopic.filter((q) => isChoiceQuestion(q) && !deps.isAnswered?.(q))
    const start: StudyBankTopicResult = {
      id: topic.id,
      topic: topic.title,
      discipline: topic.discipline,
      disciplineId,
      goal: perTopic,
      had: have.length,
      added: 0,
    }
    options.onProgress?.({ kind: 'topic', topic, index, total: topics.length, goal: perTopic, had: have.length })
    const finish = (result: StudyBankTopicResult) => {
      results.push(result)
      options.onProgress?.({ kind: 'done', result })
    }

    const { folders: scope, fallback } = studyBankFolders(disciplineId, topic.discipline)
    if (have.length >= perTopic) {
      finish({ ...start, reason: 'complete' })
      continue
    }
    const room = STUDY_QUESTION_LIMITS.count - bank.length
    if (room <= 0) return { results, stop: 'full' }
    const missing = Math.min(perTopic - have.length, room)
    const capped = missing < perTopic - have.length

    let hits: StudyLibraryHit[]
    try {
      hits = (await deps.library.search(topic.title, scope)).hits.filter((hit) => !NAME_ONLY.test(hit.excerpt))
    } catch (error) {
      return { results, stop: 'error', message: (error as Error).message }
    }
    const first = hits[0]
    if (!first) {
      // With no folder of its own, nothing found means no book was put in the default folder.
      finish({ ...start, ...(fallback ? { reason: 'no-book', folder: scope[0] } : { reason: 'no-passage' }) })
      continue
    }
    const file = fileOf(first.sourceRef)
    const sourceTitle = file.split('/').pop() ?? file
    const excerpt = hits
      .filter((hit) => fileOf(hit.sourceRef) === file)
      .slice(0, 3)
      .map((hit) => hit.excerpt)
      .join('\n\n')

    const made: StudyQuestion[] = []
    let failure: GroundedFailure | undefined
    let stop: StudyBankBuildResult | undefined
    for (let i = 0; i < missing; i++) {
      try {
        const result = await generateGroundedQuestion(
          {
            topic: topic.title,
            excerpt,
            sourceTitle,
            sourceReference: first.sourceRef,
            // Answered questions too: the author must not write them again with other words.
            avoid: [...onTopic, ...made].map((q) => q.question),
          },
          ask,
          3,
          (step) => options.onProgress?.({ kind: 'step', step, made: made.length, source: sourceTitle }),
        )
        if (!result.ok) {
          failure = result.code
          break
        }
        made.push({ ...result.question, tags: [topic.discipline] })
      } catch (error) {
        const message = (error as Error).message
        stop = message === ABORTED ? { results, stop: 'cancelled' } : { results, stop: 'unavailable', message }
        break
      }
    }

    let added = 0
    if (made.length) {
      try {
        added = append(made).added
      } catch (error) {
        const code = (error as StudyBankWriteError).code
        return { results, stop: code ?? 'error', message: (error as Error).message }
      }
    }
    const result: StudyBankTopicResult = { ...start, added }
    if (stop) {
      if (added) finish(result)
      return stop
    }
    if (capped && !failure && added === missing) {
      finish(result)
      return { results, stop: 'full' }
    }
    if (have.length + added < perTopic) result.reason = reasonOf(failure, added < made.length)
    finish(result)
  }
  return { results }
}

function reasonOf(failure: GroundedFailure | undefined, duplicates: boolean): StudyBankReason {
  if (failure === 'similar' || (!failure && duplicates)) return 'similar'
  if (failure === 'refused') return 'refused'
  return 'little'
}

/** The file part of a library reference (`path#heading:line`). */
const fileOf = (sourceRef: string): string => sourceRef.replace(/#.*$/, '').replace(/:\d+$/, '')
