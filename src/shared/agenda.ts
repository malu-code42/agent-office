import { parseTasksFile, TIME_FORMAT } from './tasks'

/** A line of agenda.md as the file wrote it. Any line that matches none of the known forms is unknown. */
export type AgendaLine =
  { kind: 'commitment'; time: string; title: string } | { kind: 'task'; time: string; id: string } | { kind: 'unknown'; text: string }

/** A line in the view: a task reference carries the task's text from tarefas.md, or null when its id is not there. */
export type AgendaEntry =
  | { kind: 'commitment'; time: string; title: string; conflict?: true }
  | { kind: 'task'; time: string; id: string; text: string | null; conflict?: true }
  | { kind: 'class'; id: string; time: string; title: string; attended?: true; conflict?: true }
  /** A task completed that day, at the moment it was completed (✅ DD.MM.AAAA HH:MM in tarefas.md). */
  | { kind: 'done'; time: string; id: string; text: string }
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
  /** Done vs planned per day of `week`; only the dated read (readAgendaForDate) fills it. */
  progress?: AgendaProgress
}

/** One day of the week dashboard: what was done that day and what was planned for it (done never exceeds planned). */
export interface AgendaDayProgress {
  date: string
  done: number
  planned: number
}

export interface AgendaProgress {
  days: AgendaDayProgress[]
  /** Tasks of tarefas.md completed (✅) on a day of the week, routine tasks excluded. */
  tasksDone: number
  /** Tasks of tarefas.md discarded (❌) on a day of the week. */
  tasksDiscarded: number
  routinesDone: number
  routinesPlanned: number
}

/** A personal-routine occurrence placed on a day of the week, and whether it was marked done. */
export interface RoutineMark {
  day: string
  done: boolean
  /** The tarefas.md task the occurrence created, so its ✅ is not counted twice. */
  taskId?: string
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
  /** `id/AAAA-MM-DD` of each class the user said she went to. */
  attended: Set<string>
  warnings: string[]
}

const CLASS_RULE =
  /^- id: ([a-z][a-z0-9-]{1,39}) \| dia: (segunda|terça|quarta|quinta|sexta|sábado|domingo) \| hora: (\d{2}:\d{2}) \| título: (.+)$/i
const CLASS_EXCEPTION =
  /^- id: ([a-z][a-z0-9-]{1,39}) \| data: (\d{4}-\d{2}-\d{2}) \| (cancelar|presença|hora: (\d{2}:\d{2})(?: \| título: (.+))?|título: (.+))$/i
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
  if (source === null) return { rules: [], exceptions: [], attended: new Set(), warnings: [] }
  const rules: ClassRule[] = []
  const exceptions: ClassException[] = []
  const attended = new Set<string>()
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
      if (exception[3]!.toLowerCase() === 'presença') {
        if (!isIsoDate(date)) warnings.push(`Linha ${index + 1}: data inválida em aulas.md (${date}).`)
        else attended.add(key)
        continue
      }
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
  for (const key of attended) if (!ids.has(key.slice(0, key.indexOf('/')))) warnings.push(`Presença sem regra correspondente: ${key.replace('/', ' em ')}.`)
  return { rules, exceptions, attended, warnings }
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
  // Tasks completed on each day; the moment of completion places them (older lines only know the day).
  const completedByDay = new Map<string, { id?: string; text: string; time?: string }[]>()
  for (const list of parseTasksFile(tasks).lists)
    for (const task of list.tasks) {
      if (task.status !== 'completed' || !task.completedDate) continue
      const day = isoOfMark(task.completedDate)
      completedByDay.set(day, [...(completedByDay.get(day) ?? []), { id: task.id, text: task.text, time: task.completedTime }])
    }
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
      const entry = {
        kind: 'class' as const,
        id: rule.id,
        time: exception?.time ?? rule.time,
        title: exception?.title ?? rule.title,
        ...(parsedClasses.attended.has(`${rule.id}/${date}`) ? { attended: true as const } : {}),
      }
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
    for (const done of completedByDay.get(date) ?? []) {
      // A task that was on the agenda and got done is that line, not a second one: with the moment of completion it
      // becomes the completion; without it (older lines) the agenda line stays.
      const planned = done.id ? entries.findIndex((e) => e.kind === 'task' && e.id.toLowerCase() === done.id!.toLowerCase()) : -1
      if (done.time) {
        if (planned >= 0) entries.splice(planned, 1)
        entries.push({ kind: 'done', time: done.time, id: done.id ?? '', text: done.text })
      } else if (planned < 0) entries.push({ kind: 'unknown', text: `✔ ${done.text}` })
    }
    const counts = new Map<string, number>()
    for (const entry of entries) if ('time' in entry && entry.kind !== 'done') counts.set(entry.time, (counts.get(entry.time) ?? 0) + 1)
    return {
      date,
      entries: entries.map((entry) =>
        'time' in entry && entry.kind !== 'done' && counts.get(entry.time)! > 1 ? { ...entry, conflict: true as const } : entry,
      ),
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

/** ISO day of a ✅/❌ date, which tarefas.md writes as AAAA-MM-DD or DD.MM.AAAA. */
const isoOfMark = (date: string): string => (date.includes('.') ? `${date.slice(6, 10)}-${date.slice(3, 5)}-${date.slice(0, 2)}` : date)

/**
 * Done vs planned for each day of `week`. Planned: the agenda items of the day plus the routine occurrences placed
 * on it. Done: classes the user said she attended, goals achieved that day (`goalDays`), tasks completed that day (✅ date in tarefas.md,
 * scheduled or not) and routine occurrences marked done. A day never shows more done than planned.
 */
export function weekProgress(week: AgendaDay[], tasks: string, routines: RoutineMark[], goalDays: string[] = []): AgendaProgress {
  const routineTasks = new Set(routines.flatMap((mark) => (mark.taskId ? [mark.taskId.toLowerCase()] : [])))
  const completedOn = new Map<string, number>()
  const inWeek = new Set(week.map((day) => day.date))
  let tasksDiscarded = 0
  for (const list of parseTasksFile(tasks).lists) {
    for (const task of list.tasks) {
      if (!task.completedDate || (task.id && routineTasks.has(task.id.toLowerCase()))) continue
      const day = isoOfMark(task.completedDate)
      if (!inWeek.has(day)) continue
      if (task.status === 'completed') completedOn.set(day, (completedOn.get(day) ?? 0) + 1)
      else if (task.status === 'discarded') tasksDiscarded++
    }
  }
  let tasksDone = 0
  let routinesDone = 0
  let routinesPlanned = 0
  const days = week.map((day): AgendaDayProgress => {
    let planned = 0
    let done = completedOn.get(day.date) ?? 0
    tasksDone += done
    done += goalDays.filter((goalDay) => goalDay === day.date).length
    for (const entry of day.entries) {
      // Completions are counted from tarefas.md above (done, and as planned through the max below).
      if (entry.kind === 'unknown' || entry.kind === 'done') continue
      if (entry.kind === 'task' && routineTasks.has(entry.id.toLowerCase())) continue
      planned++
      // Nothing is done by the clock: a class counts when the user said she went (presença in aulas.md).
      if (entry.kind === 'class' && entry.attended) done++
    }
    for (const mark of routines) {
      if (mark.day !== day.date) continue
      planned++
      routinesPlanned++
      if (mark.done) {
        done++
        routinesDone++
      }
    }
    return { date: day.date, done, planned: Math.max(planned, done) }
  })
  return { days, tasksDone, tasksDiscarded, routinesDone, routinesPlanned }
}
