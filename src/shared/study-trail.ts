// The topics of `trilha zettel.md` (the vault's study trail), read only: the study cycle
// picks its topic from them. Format, as the file writes it:
//   ## 2º período
//   ### [P2-ED] Estrutura de Dados e Técnicas de Programação — 45 h
//   - [ ] [P2-ED-05] Filas.
// A topic is a checklist item under a `###` heading (its discipline); the id is optional.

export interface StudyTrailTopic {
  /** The trail's own identifier, e.g. P2-ED-05; null when the item has none. */
  id: string | null
  title: string
  /** The checkbox of the trail (manual follow-up; it proves nothing). */
  done: boolean
  /** The `###` heading, without its id and hours: "Estrutura de Dados e Técnicas de Programação". */
  discipline: string
  /** The `##` heading above it: "2º período". */
  period: string
  /** Position within its discipline, 1-based, and how many topics the discipline has. */
  index: number
  total: number
  /** What the study cycle stores as its topic: "[P2-ED-05] Filas". */
  label: string
}

export interface StudyTrail {
  /** False when the vault has no `trilha zettel.md`. */
  found: boolean
  topics: StudyTrailTopic[]
}

export const STUDY_TRAIL_FILE = 'trilha zettel.md'

/** A topic as people read it: without the trail's code ("[P2-ED-05] Filas" → "Filas"). Display only; the label stays the key. */
export const topicName = (label: string): string => label.replace(/^\[[^\]]+\]\s*/, '')

const ITEM = /^[-*+]\s+\[( |x|X)\]\s+(?:\[([A-Za-z0-9][\w.-]{0,39})\]\s+)?(.+)$/
const DISCIPLINE = /^###\s+(?:\[[^\]]+\]\s+)?(.+?)(?:\s+[—–-]\s+\d+\s*h)?\s*$/

/** The checklist topics of the trail, grouped by discipline, in file order. */
export function parseStudyTrail(source: string | null): StudyTrail {
  if (source === null) return { found: false, topics: [] }
  const topics: StudyTrailTopic[] = []
  let period = ''
  let discipline = ''
  for (const raw of source.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim()
    if (/^##\s/.test(line)) {
      period = line.replace(/^##\s+/, '').trim()
      discipline = ''
      continue
    }
    const heading = DISCIPLINE.exec(line)
    if (heading) {
      discipline = heading[1]!.trim()
      continue
    }
    if (/^#\s/.test(line)) continue
    const item = ITEM.exec(line)
    // Checklists outside a discipline (rules, notes) are not topics.
    if (!item || !discipline) continue
    const title = item[3]!.trim().replace(/\.$/, '').slice(0, 180)
    const id = item[2] ?? null
    topics.push({ id, title, done: item[1] !== ' ', discipline, period, index: 0, total: 0, label: id ? `[${id}] ${title}` : title })
  }
  const counts = new Map<string, number>()
  for (const topic of topics) {
    const key = `${topic.period}\n${topic.discipline}`
    topic.index = (counts.get(key) ?? 0) + 1
    counts.set(key, topic.index)
  }
  for (const topic of topics) topic.total = counts.get(`${topic.period}\n${topic.discipline}`)!
  return { found: true, topics }
}

/** The trail topic a cycle topic names (by its label, or by its id), if any. */
export function trailTopicOf(trail: StudyTrail, topic: string): StudyTrailTopic | undefined {
  const clean = topic.trim()
  const id = /^\[([^\]]+)\]/.exec(clean)?.[1]
  return trail.topics.find((t) => t.label === clean || (id !== undefined && t.id === id))
}

// ---------- the "Trilha de estudos" board (Bonnie's office) ----------

/**
 * Where a trail topic stands for the user: the cycle open now, a cycle kept from a topic
 * switch, a cycle concluded with the retest, ticked in the trail by hand, or not started.
 */
export type StudyTrailTopicState = 'current' | 'kept' | 'completed' | 'checked' | 'new'

/** The cycles the board looks at; a subset of StudyCycleState, so this file stays free of the cycle module. */
export interface StudyTrailCycles {
  activeId: string | null
  cycles: { id: string; topic: string; stage: string; updatedAt: number }[]
}

export interface StudyTrailCard {
  topic: StudyTrailTopic
  state: StudyTrailTopicState
  /** The cycle that gives the state (current, kept or completed), if any. */
  cycleId?: string
  cycleStage?: string
}

/** A list of the board: one discipline of a period, as the trail file groups them. */
export interface StudyTrailList {
  key: string
  discipline: string
  period: string
  cards: StudyTrailCard[]
  /** Topics neither completed nor ticked. */
  open: number
  current: boolean
}

/** The board of the trail: one list per discipline (in file order) with each topic's state. */
export function studyTrailBoard(trail: StudyTrail, state: StudyTrailCycles): StudyTrailList[] {
  const lists = new Map<string, StudyTrailList>()
  for (const topic of trail.topics) {
    const key = `${topic.period}\n${topic.discipline}`
    let list = lists.get(key)
    if (!list) {
      list = { key, discipline: topic.discipline, period: topic.period, cards: [], open: 0, current: false }
      lists.set(key, list)
    }
    const card = trailCard(topic, state)
    if (card.state === 'current') list.current = true
    if (card.state !== 'completed' && card.state !== 'checked') list.open++
    list.cards.push(card)
  }
  return [...lists.values()]
}

const sameTopic = (topic: StudyTrailTopic, label: string): boolean => {
  const clean = label.trim()
  const id = /^\[([^\]]+)\]/.exec(clean)?.[1]
  return clean === topic.label || (id !== undefined && id === topic.id)
}

function trailCard(topic: StudyTrailTopic, state: StudyTrailCycles): StudyTrailCard {
  const mine = state.cycles.filter((cycle) => sameTopic(topic, cycle.topic)).sort((a, b) => b.updatedAt - a.updatedAt)
  const active = mine.find((cycle) => cycle.id === state.activeId)
  if (active) return { topic, state: 'current', cycleId: active.id, cycleStage: active.stage }
  const kept = mine.find((cycle) => cycle.stage !== 'completed')
  if (kept) return { topic, state: 'kept', cycleId: kept.id, cycleStage: kept.stage }
  const completed = mine.find((cycle) => cycle.stage === 'completed')
  if (completed) return { topic, state: 'completed', cycleId: completed.id, cycleStage: completed.stage }
  return { topic, state: topic.done ? 'checked' : 'new' }
}

/**
 * What "Começar com este tópico" does, keeping every earlier cycle: open the cycle when the
 * topic is already the current one, pin a kept cycle of the topic again, or set the current
 * cycle aside (it stays in the history) and start the topic from the question picker.
 */
export type StudyTopicStart = { kind: 'open' } | { kind: 'resume'; cycleId: string } | { kind: 'new'; setAside: boolean }

export function studyTopicStart(state: StudyTrailCycles, label: string): StudyTopicStart {
  const active = state.cycles.find((cycle) => cycle.id === state.activeId)
  const clean = label.trim()
  const id = /^\[([^\]]+)\]/.exec(clean)?.[1]
  const matches = (topic: string) => topic.trim() === clean || (id !== undefined && /^\[([^\]]+)\]/.exec(topic.trim())?.[1] === id)
  if (active && matches(active.topic)) return { kind: 'open' }
  const kept = state.cycles
    .filter((cycle) => cycle.id !== state.activeId && cycle.stage !== 'completed' && matches(cycle.topic))
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]
  if (kept) return { kind: 'resume', cycleId: kept.id }
  return { kind: 'new', setAside: !!active }
}

export const STUDY_TRAIL_STATE_LABEL: Record<StudyTrailTopicState, string> = {
  current: 'Ciclo atual',
  kept: 'Ciclo guardado',
  completed: 'Concluído',
  checked: 'Marcado na trilha',
  new: 'Não iniciado',
}

/** The trail topics of the given discipline ids (`P2-ED`), done when their cycle concluded (the trail checkbox proves nothing), with the day it did. */
export function trailGoalTopics(
  trail: StudyTrail,
  state: StudyTrailCycles,
  disciplineIds: readonly string[],
): { label: string; discipline: string; done: boolean; day?: string }[] {
  const wanted = new Set(disciplineIds)
  const day = (ms: number): string => {
    const d = new Date(ms)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  return studyTrailBoard(trail, state)
    .flatMap((list) => list.cards)
    .filter((card) => card.topic.id !== null && wanted.has(card.topic.id.replace(/-\d+$/, '')))
    .map((card) => {
      const finished = card.state === 'completed' ? state.cycles.find((cycle) => cycle.id === card.cycleId) : undefined
      return {
        label: card.topic.label,
        discipline: card.topic.discipline,
        done: card.state === 'completed',
        ...(finished ? { day: day(finished.updatedAt) } : {}),
      }
    })
}
