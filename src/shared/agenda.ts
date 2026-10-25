import { parseTasksFile, TIME_FORMAT } from './tasks'

/** A line of agenda.md as the file wrote it. Any line that matches none of the known forms is unknown. */
export type AgendaLine =
  { kind: 'commitment'; time: string; title: string } | { kind: 'task'; time: string; id: string } | { kind: 'unknown'; text: string }

/** A line in the view: a task reference carries the task's text from tarefas.md, or null when its id is not there. */
export type AgendaEntry =
  | { kind: 'commitment'; time: string; title: string; conflict?: true }
  | { kind: 'task'; time: string; id: string; text: string | null; conflict?: true }
  | { kind: 'class'; id: string; time: string; title: string; conflict?: true }
  | { kind: 'unknown'; text: string }

export interface AgendaDay {
  /** The local day as AAAA-MM-DD. */
  date: string
  entries: AgendaEntry[]
}

export interface AgendaView {
  /** False when the vault has no agenda.md: the view then shows the empty state. */
  found: boolean
  /** Whether aulas.md exists, independently from agenda.md. */
  classesFound: boolean
  /** Safe, actionable parser warnings; source lines remain unchanged. */
  warnings: string[]
  today: AgendaDay
  /** Monday to Sunday of the current week, local. */
  week: AgendaDay[]
  /** Lines before any date heading, or under a heading that is not a date. They are shown, never dropped. */
  undated: AgendaEntry[]
}

export interface ClassRule {
  id: string
  weekday: number
  time: string
  title: string
}
export interface ClassException {
  id: string
  date: string
  cancelled?: true
  time?: string
  title?: string
}
export interface ParsedClasses {
  rules: ClassRule[]
  exceptions: ClassException[]
  warnings: string[]
}

const CLASS_RULE =
  /^- id: ([a-z][a-z0-9-]{1,39}) \| dia: (segunda|terça|quarta|quinta|sexta|sábado|domingo) \| hora: (\d{2}:\d{2}) \| título: (.+)$/i
const CLASS_EXCEPTION =
  /^- id: ([a-z][a-z0-9-]{1,39}) \| data: (\d{4}-\d{2}-\d{2}) \| (cancelar|hora: (\d{2}:\d{2})(?: \| título: (.+))?|título: (.+))$/i
const WEEKDAY = new Map([
  ['segunda', 1],
  ['terça', 2],
  ['quarta', 3],
  ['quinta', 4],
  ['sexta', 5],
  ['sábado', 6],
  ['domingo', 0],
])

/**
 * Read-only aulas.md codec. Format: `- id: ... | dia: segunda | hora: 09:00 | título: ...`;
 * exceptions: `- id: ... | data: AAAA-MM-DD | cancelar` or `| hora: HH:MM | título: ...`.
 * Unknown or invalid non-empty lines are returned as warnings, never silently discarded.
 */
export function parseClasses(source: string | null): ParsedClasses {
  if (source === null) return { rules: [], exceptions: [], warnings: [] }
  const rules: ClassRule[] = []
  const exceptions: ClassException[] = []
  const warnings: string[] = []
  const ids = new Set<string>()
  const exceptionKeys = new Set<string>()
  for (const [index, raw] of source
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .entries()) {
    const line = raw.trim()
    if (!line || /^#{1,6}\s/.test(line)) continue
    const rule = CLASS_RULE.exec(line)
    if (rule) {
      const id = rule[1]!.toLowerCase()
      const weekday = WEEKDAY.get(rule[2]!.toLowerCase())
      if (ids.has(id)) warnings.push(`Linha ${index + 1}: identificador de aula duplicado (${id}).`)
      else if (weekday === undefined || !TIME_FORMAT.test(rule[3]!) || !validTitle(rule[4]!))
        warnings.push(`Linha ${index + 1}: regra inválida; confira dia, hora e título.`)
      else {
        ids.add(id)
        rules.push({ id, weekday, time: rule[3]!, title: rule[4]!.trim() })
      }
      continue
    }
    const exception = CLASS_EXCEPTION.exec(line)
    if (exception) {
      const id = exception[1]!.toLowerCase()
      const date = exception[2]!
      const key = `${id}/${date}`
      if (!isIsoDate(date)) warnings.push(`Linha ${index + 1}: data inválida em aulas.md (${date}).`)
      else if (exceptionKeys.has(key)) warnings.push(`Linha ${index + 1}: exceção duplicada para ${id} em ${date}.`)
      else if (exception[3]!.toLowerCase() !== 'cancelar' && exception[4] && !TIME_FORMAT.test(exception[4]))
        warnings.push(`Linha ${index + 1}: hora inválida na exceção.`)
      else if (
        exception[3]!.toLowerCase() !== 'cancelar' &&
        ((exception[4] !== undefined && exception[4] !== '' && !TIME_FORMAT.test(exception[4])) ||
          ((exception[5] !== undefined || exception[6] !== undefined) && !validTitle(exception[5] ?? exception[6] ?? '')))
      )
        warnings.push(`Linha ${index + 1}: título inválido na exceção.`)
      else {
        exceptionKeys.add(key)
        exceptions.push({
          id,
          date,
          ...(exception[3]!.toLowerCase() === 'cancelar' ? { cancelled: true as const } : {}),
          ...(exception[4] ? { time: exception[4] } : {}),
          ...((exception[5] ?? exception[6]) ? { title: (exception[5] ?? exception[6])!.trim() } : {}),
        })
      }
      continue
    }
    warnings.push(`Linha ${index + 1}: conteúdo não reconhecido em aulas.md: "${line}".`)
  }
  for (const exception of exceptions)
    if (!ids.has(exception.id)) warnings.push(`Exceção sem regra correspondente: ${exception.id} em ${exception.date}.`)
  return { rules, exceptions, warnings }
}

function validTitle(title: string): boolean {
  return title.trim().length > 0 && title.trim().length <= 200 && !/[\r\n]/.test(title)
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

/** The kind of one line of agenda.md, read from its trimmed text. The write planner uses it too, so both agree on what a commitment is. */
export function parseAgendaLine(trimmed: string, raw = trimmed): AgendaLine {
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
    const line = parseAgendaLine(trimmed, raw)
    if (current) days.get(current)!.push(line)
    else undated.push(line)
  }
  return { days, undated }
}

/**
 * The view for `today` (local): that day, the Monday-to-Sunday week and the undated lines. `agenda` is the text
 * of agenda.md, or null when the vault has none. `tasks` is the text of tarefas.md, read only to resolve ids.
 */
export function buildAgendaView(agenda: string | null, tasks: string, today: Date, classes: string | null = null): AgendaView {
  const titles = new Map<string, string>()
  for (const list of parseTasksFile(tasks).lists) {
    for (const task of list.tasks) {
      if (task.id) titles.set(task.id.toLowerCase(), task.text)
    }
  }
  const { days, undated } = parseAgenda(agenda ?? '')
  const parsedClasses = parseClasses(classes)
  const resolve = (line: AgendaLine): AgendaEntry =>
    line.kind === 'task' ? { kind: 'task', time: line.time, id: line.id, text: titles.get(line.id.toLowerCase()) ?? null } : line
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7))
  const week = Array.from({ length: 7 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
  const dayOf = (day: Date): AgendaDay => {
    const date = isoDay(day)
    const entries = (days.get(date) ?? []).map(resolve)
    const exceptionMap = new Map(parsedClasses.exceptions.filter((item) => item.date === date).map((item) => [item.id, item]))
    for (const rule of parsedClasses.rules) {
      if (day.getDay() !== rule.weekday) continue
      const exception = exceptionMap.get(rule.id)
      if (exception?.cancelled) continue
      const entry = { kind: 'class' as const, id: rule.id, time: exception?.time ?? rule.time, title: exception?.title ?? rule.title }
      const isClassMatch = (item: AgendaEntry): boolean =>
        'time' in item &&
        item.time === entry.time &&
        ((item.kind === 'commitment' && item.title === entry.title) ||
          (item.kind === 'task' && item.text !== null && item.text === entry.title))
      const firstMatch = entries.findIndex(isClassMatch)
      if (firstMatch < 0) {
        entries.push(entry)
        continue
      }
      entries[firstMatch] = entry
      for (let index = entries.length - 1; index > firstMatch; index--) if (isClassMatch(entries[index]!)) entries.splice(index, 1)
    }
    const counts = new Map<string, number>()
    for (const entry of entries) if ('time' in entry) counts.set(entry.time, (counts.get(entry.time) ?? 0) + 1)
    return {
      date,
      entries: entries.map((entry) => ('time' in entry && counts.get(entry.time)! > 1 ? { ...entry, conflict: true as const } : entry)),
    }
  }
  return {
    found: agenda !== null,
    classesFound: classes !== null,
    warnings: parsedClasses.warnings,
    today: dayOf(today),
    week: week.map(dayOf),
    undated: undated.map(resolve),
  }
}
