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

export interface StudyReadinessTarget {
  id?: string | null
  title: string
}

/**
 * AO-64: IDs are authoritative. Title fallback needs one topic in both the current scope and the report;
 * an entry with a different ID is never legacy evidence for the requested ID. Ambiguity requires a new check.
 */
export function readinessTopicOf(
  report: StudyReadiness | undefined,
  target: StudyReadinessTarget,
  scope: readonly StudyReadinessTarget[],
): StudyReadinessTopic | undefined {
  if (!report) return undefined
  if (target.id) {
    if (scope.filter((topic) => topic.id === target.id).length !== 1) return undefined
    const exact = report.topics.filter((topic) => topic.id === target.id)
    if (exact.length) return exact.length === 1 ? exact[0] : undefined
  }
  if (scope.filter((topic) => topic.title === target.title).length !== 1) return undefined
  const named = report.topics.filter((topic) => topic.topic === target.title)
  if (named.length !== 1 || named[0]!.id != null) return undefined
  return named[0]
}

/** Every current trail topic must have its own ready entry. Strings support unambiguous legacy callers only. */
export function isStudyReadinessReady(report: StudyReadiness | undefined, topics: readonly (StudyReadinessTarget | string)[]): boolean {
  const scope = topics.map((topic) => (typeof topic === 'string' ? { title: topic } : topic))
  return scope.length > 0 && scope.every((topic) => readinessTopicOf(report, topic, scope)?.state === 'pronto')
}
