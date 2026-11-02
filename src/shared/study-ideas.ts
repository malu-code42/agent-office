import type { StudyCycleState } from './study-cycle'

export interface StudyIdea {
  title: string
  description: string
}

export interface StudyIdeaSet {
  topic: string
  generatedAt: number
  ideas: StudyIdea[]
}

export interface StudiedTopic {
  topic: string
  /** True once a cycle of the topic was completed (its retest passed and the student confirmed). */
  completed: boolean
}

/** Every topic of the study cycles, newest first; a topic counts as completed if any of its cycles is. */
export function studiedTopics(state: StudyCycleState): StudiedTopic[] {
  const topics = new Map<string, StudiedTopic>()
  for (const cycle of [...state.cycles].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const seen = topics.get(cycle.topic)
    topics.set(cycle.topic, { topic: cycle.topic, completed: !!seen?.completed || cycle.stage === 'completed' })
  }
  return [...topics.values()]
}

/** Keeps only well-formed ideas from a model reply (3 to 6, bounded text); null when none survive. */
export function parseIdeas(reply: unknown): StudyIdea[] | null {
  const list = reply && typeof reply === 'object' ? (reply as { ideas?: unknown }).ideas : undefined
  if (!Array.isArray(list)) return null
  const ideas: StudyIdea[] = []
  for (const item of list) {
    const { title, description } = (item ?? {}) as Record<string, unknown>
    if (typeof title !== 'string' || typeof description !== 'string') continue
    const t = title.trim()
    const d = description.trim()
    if (t && d && t.length <= 120 && d.length <= 600) ideas.push({ title: t, description: d })
  }
  return ideas.length ? ideas.slice(0, 6) : null
}
