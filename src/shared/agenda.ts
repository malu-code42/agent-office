import { parseTasksFile, TIME_FORMAT } from './tasks'

/** A line of agenda.md as the file wrote it. Any line that matches none of the known forms is unknown. */
export type AgendaLine =
  { kind: 'commitment'; time: string; title: string } | { kind: 'task'; time: string; id: string } | { kind: 'unknown'; text: string }

/** A line in the view: a task reference carries the task's text from tarefas.md, or null when its id is not there. */
export type AgendaEntry =
  | { kind: 'commitment'; time: string; title: string }
  | { kind: 'task'; time: string; id: string; text: string | null }
  | { kind: 'unknown'; text: string }

export interface AgendaDay {
  /** The local day as AAAA-MM-DD. */
  date: string
  entries: AgendaEntry[]
}

export interface AgendaView {
  /** False when the vault has no agenda.md: the view then shows the empty state. */
  found: boolean
  today: AgendaDay
  /** Monday to Sunday of the current week, local. */
  week: AgendaDay[]
  /** Lines before any date heading, or under a heading that is not a date. They are shown, never dropped. */
  undated: AgendaEntry[]
}

const DATE_HEADING = /^##\s+(\d{4}-\d{2}-\d{2})$/
const COMMITMENT = /^-\s+(\d{2}:\d{2})\s+(.+)$/
const TASK_REFERENCE = /^-\s+(\d{2}:\d{2})\s+↦\s+\^(t[a-z0-9]{6})$/i
const ARROW = '↦'

const pad = (n: number) => String(n).padStart(2, '0')

/** The local day as AAAA-MM-DD. */
export function isoDay(day: Date): string {
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`
}

/** A real calendar day written AAAA-MM-DD (no 2026-02-31). */
function isIsoDate(date: string): boolean {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const parsed = new Date(y, m - 1, d)
  return parsed.getFullYear() === y && parsed.getMonth() === m - 1 && parsed.getDate() === d
}

function parseLine(trimmed: string, raw: string): AgendaLine {
  const reference = TASK_REFERENCE.exec(trimmed)
  if (reference && TIME_FORMAT.test(reference[1]!)) return { kind: 'task', time: reference[1]!, id: reference[2]! }
  const commitment = COMMITMENT.exec(trimmed)
  if (commitment && TIME_FORMAT.test(commitment[1]!) && !commitment[2]!.includes(ARROW)) {
    return { kind: 'commitment', time: commitment[1]!, title: commitment[2]!.trim() }
  }
  return { kind: 'unknown', text: raw }
}

/**
 * The lines of agenda.md grouped by date, in file order. Blank lines are skipped. The text is only read:
 * nothing here writes the file, so an unknown line stays exactly as it was written.
 */
export function parseAgenda(content: string): { days: Map<string, AgendaLine[]>; undated: AgendaLine[] } {
  const days = new Map<string, AgendaLine[]>()
  const undated: AgendaLine[] = []
  let current: string | null = null
  for (const raw of content.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    const heading = DATE_HEADING.exec(trimmed)
    if (heading && isIsoDate(heading[1]!)) {
      current = heading[1]!
      if (!days.has(current)) days.set(current, [])
      continue
    }
    // Any other heading ends the day above it, so the lines under it are not taken for that day.
    if (trimmed.startsWith('#')) current = null
    const line = parseLine(trimmed, raw)
    if (current) days.get(current)!.push(line)
    else undated.push(line)
  }
  return { days, undated }
}

/**
 * The view for `today` (local): that day, the Monday-to-Sunday week and the undated lines. `agenda` is the text
 * of agenda.md, or null when the vault has none. `tasks` is the text of tarefas.md, read only to resolve ids.
 */
export function buildAgendaView(agenda: string | null, tasks: string, today: Date): AgendaView {
  const titles = new Map<string, string>()
  for (const list of parseTasksFile(tasks).lists) {
    for (const task of list.tasks) {
      if (task.id) titles.set(task.id.toLowerCase(), task.text)
    }
  }
  const { days, undated } = parseAgenda(agenda ?? '')
  const resolve = (line: AgendaLine): AgendaEntry =>
    line.kind === 'task' ? { kind: 'task', time: line.time, id: line.id, text: titles.get(line.id.toLowerCase()) ?? null } : line
  const dayOf = (day: Date): AgendaDay => {
    const date = isoDay(day)
    return { date, entries: (days.get(date) ?? []).map(resolve) }
  }
  // Monday is the first day of the week: Sunday (0) goes back six days.
  const back = (today.getDay() + 6) % 7
  const week = Array.from({ length: 7 }, (_, i) => dayOf(new Date(today.getFullYear(), today.getMonth(), today.getDate() - back + i)))
  return { found: agenda !== null, today: dayOf(today), week, undated: undated.map(resolve) }
}
