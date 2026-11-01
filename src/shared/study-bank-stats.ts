import { isAgentVerified } from './study-bank'
import type { AnswerStatus, StudyOriginKind, StudyQuestion } from './study-questions'
import type { StudyTrailTopic } from './study-trail'

export const NO_DISCIPLINE = 'Sem disciplina'
export const NO_TOPIC = 'Sem tópico'

export interface StudyBankTopicCount {
  topic: string
  /** Trail topic id (P2-ED-05), when the topic is in the trail. */
  id?: string | null
  count: number
  /** Not answered yet: what the user can still be asked. */
  fresh: number
  /** Below the goal of new questions (trail topics only). */
  below: boolean
  /** The questions of the topic, in bank order. */
  ids: string[]
}

export interface StudyBankDisciplineCount {
  discipline: string
  count: number
  fresh: number
  /** Topics below the goal. */
  below: number
  /** Largest first. */
  topics: StudyBankTopicCount[]
}

export interface StudyBankStats {
  total: number
  /** Questions already answered in some cycle (they are never offered again). */
  answered: number
  byOrigin: Record<StudyOriginKind, number>
  byAnswer: Record<AnswerStatus, number>
  /** Who checked each question: the agent chain, the user (old manual review), or no one. */
  byReview: { agents: number; you: number; none: number }
  goal: number
  /** Trail topics below the goal, in the whole bank. */
  below: number
  /** Largest first; questions whose topic is not in the trail go to "Sem disciplina". */
  disciplines: StudyBankDisciplineCount[]
}

type TrailTopic = Pick<StudyTrailTopic, 'id' | 'title' | 'label' | 'discipline'>

export interface StudyBankStatsOptions {
  /** New (unanswered) questions each trail topic should have. */
  goal?: number
  isAnswered?: (question: StudyQuestion) => boolean
}

const key = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.;:]+$/, '')

const byCount =
  <T extends { count: number }>(name: (item: T) => string) =>
  (a: T, b: T) =>
    b.count - a.count || name(a).localeCompare(name(b), 'pt-BR')

/**
 * The numbers of the question bank. A question does not store its discipline: it is found by
 * matching `question.topic` with the trail's topics (label, title or id, ignoring accents and case).
 * Every trail topic is listed, even with no question, so what is missing shows.
 */
export function studyBankStats(
  questions: readonly StudyQuestion[],
  trailTopics: readonly TrailTopic[],
  options: StudyBankStatsOptions = {},
): StudyBankStats {
  const goal = options.goal ?? 20
  const index = new Map<string, TrailTopic>()
  const add = (k: string, topic: TrailTopic) => {
    if (k && !index.has(k)) index.set(k, topic)
  }
  for (const topic of trailTopics) {
    add(key(topic.label), topic)
    add(key(topic.title), topic)
    if (topic.id) {
      add(key(topic.id), topic)
      add(key(`[${topic.id}]`), topic)
    }
  }
  const find = (raw: string): TrailTopic | undefined => {
    const k = key(raw)
    if (!k) return undefined
    const direct = index.get(k)
    if (direct) return direct
    const code = /^\[([^\]]+)\]\s*(.*)$/.exec(k)
    return code ? (index.get(code[1]!.trim()) ?? (code[2] ? index.get(code[2]) : undefined)) : undefined
  }

  const byOrigin: Record<StudyOriginKind, number> = { enem: 0, concurso: 0, livro: 0, web: 0, ia: 0 }
  const byAnswer: Record<AnswerStatus, number> = { verified: 0, unverified: 0, missing: 0 }
  const byReview = { agents: 0, you: 0, none: 0 }
  let answered = 0
  type Row = { id?: string | null; count: number; fresh: number; trail: boolean; ids: string[] }
  const groups = new Map<string, Map<string, Row>>()
  const row = (discipline: string, topic: string, id?: string | null, trail = false): Row => {
    const topics = groups.get(discipline) ?? new Map<string, Row>()
    groups.set(discipline, topics)
    const existing = topics.get(topic)
    if (existing) return existing
    const created: Row = { id, count: 0, fresh: 0, trail, ids: [] }
    topics.set(topic, created)
    return created
  }
  for (const topic of trailTopics) row(topic.discipline, topic.title, topic.id, true)

  for (const question of questions) {
    byOrigin[question.originKind]++
    byAnswer[question.answerStatus]++
    if (isAgentVerified(question)) byReview.agents++
    else if (question.verifiedByUser) byReview.you++
    else byReview.none++
    const done = !!options.isAnswered?.(question)
    if (done) answered++
    const match = find(question.topic)
    const target = match ? row(match.discipline, match.title, match.id, true) : row(NO_DISCIPLINE, question.topic.trim() || NO_TOPIC)
    target.count++
    target.ids.push(question.id)
    if (!done) target.fresh++
  }

  let below = 0
  const disciplines = [...groups].map(([discipline, topics]) => {
    const list = [...topics].map(([topic, item]) => {
      const isBelow = item.trail && item.fresh < goal
      return {
        topic,
        ...(item.id !== undefined ? { id: item.id } : {}),
        count: item.count,
        fresh: item.fresh,
        below: isBelow,
        ids: item.ids,
      }
    })
    list.sort(byCount((t) => t.topic))
    const disciplineBelow = list.filter((t) => t.below).length
    below += disciplineBelow
    return {
      discipline,
      count: list.reduce((sum, t) => sum + t.count, 0),
      fresh: list.reduce((sum, t) => sum + t.fresh, 0),
      below: disciplineBelow,
      topics: list,
    }
  })
  disciplines.sort(byCount((d) => d.discipline))
  return { total: questions.length, answered, byOrigin, byAnswer, byReview, goal, below, disciplines }
}
