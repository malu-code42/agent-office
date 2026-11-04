// Before "Gerar": what each topic of a discipline still lacks. Checked by code, no model call and no web call.
import type { StudyBookSuggestion } from './study-bank'

export type StudyReadinessState = 'pronto' | 'sem-fonte' | 'poucos-trechos' | 'sem-subtemas' | 'precisa-ocr' | 'travado'

/** Why the exam question of a ready topic was not made: the source has nothing for it, it repeats another, or the checks refused it. */
export type StudyProofFailure = 'unsupported' | 'similar' | 'refused'

export interface StudyReadinessTopic {
  /** Trail id, e.g. P2-HW-06 (null when the trail item has none). */
  id: string | null
  topic: string
  state: StudyReadinessState
  /** What is missing or what is ready, in plain words. */
  reason: string
  /** Set with 'travado': the exam question of a ready topic failed, so the topic is blocked until a new check. */
  failure?: StudyProofFailure
  /** Where a book for the topic goes: full paths of the discipline's folders under study sources/textbooks (vault root + folder). */
  folders: string[]
  /** Textbooks found on request for a topic that is not ready (never part of the check itself). */
  books?: StudyBookSuggestion[]
}

export interface StudyReadiness {
  /** Discipline id, e.g. P2-HW. */
  discipline: string
  builtAt: number
  topics: StudyReadinessTopic[]
}

/**
 * "Montar banco" is released only when every topic of the trail's discipline (`titles`) is in the report and pronto.
 * A topic added to the trail after the check is missing from the report, so it blocks until the next check.
 */
export const isStudyReadinessReady = (report: StudyReadiness | undefined, titles: readonly string[]): boolean =>
  !!report && titles.length > 0 && titles.every((title) => report.topics.some((topic) => topic.topic === title && topic.state === 'pronto'))
