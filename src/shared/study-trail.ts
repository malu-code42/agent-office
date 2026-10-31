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
