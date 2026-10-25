/**
 * Personal routines (AO-42): the rotinas-pessoais.md of the vault. Each item is one line of the file, the
 * user edits them as any note, and the app only reads: nothing here writes the file, launches agents or
 * completes tasks. What this module does is pure: turn the text into items, and say which are due today
 * (candidates the Luna raises in the daily review) and which lines need the user's input first.
 *
 * A line is: `título | cadência: diária|semanal | dias: … | hora: HH:MM`. `dias` exists only for the
 * weekly cadence, and lists the marked days by name, exactly as the user wrote them (seg, ter, sáb…).
 * A weekly line without days, a daily line with days, or any line without a cadence is never due: it
 * comes back as a candidate that needs the user, not as something the app decides by itself.
 */

/** A personal routine as the file writes it: title, cadence, and the explicit settings the line carries. */
export interface PersonalRoutineItem {
  title: string
  /** 'diária' repeats every day; 'semanal' repeats only on the marked days. */
  cadence: 'diária' | 'semanal'
  /** Day names, in the file order, lowercase without accents — only a weekly item has them. */
  days?: string[]
  /** Weekly target count. Its days are deliberately chosen in the Office each week. */
  target?: number
  /** HH:MM, when the line says when. It becomes the time of the new task, not an alarm of the app. */
  time?: string
}

/** One line of the file as read: either a usable item, or a problem for the user to fix. */
export interface RoutineLine {
  /** The 1-based number of the line in the file, as the user sees it there. */
  line: number
  item?: PersonalRoutineItem
  problem?: string
  /** The title the line carries, when the line even has one. */
  title?: string
  /** Original non-empty line, retained when the app cannot interpret a future field. */
  raw?: string
}

/** What the Luna shows in the daily review: a candidate is due today, or its line needs the user first. */
export interface RoutineCandidate {
  title?: string
  item?: PersonalRoutineItem
  line: number
  kind: 'due' | 'needsInput'
  reason?: string
  /** The exact occurrence of this candidate, when it is tracked locally. */
  occurrenceId?: string
}

/** Supported Portuguese weekday names and aliases, normalized without accents. */
const WEEKDAYS = new Map<string, number>([
  ['dom', 0],
  ['domingo', 0],
  ['seg', 1],
  ['segunda', 1],
  ['seg-feira', 1],
  ['segunda-feira', 1],
  ['ter', 2],
  ['terca', 2],
  ['terca-feira', 2],
  ['qua', 3],
  ['quarta', 3],
  ['qua-feira', 3],
  ['quarta-feira', 3],
  ['qui', 4],
  ['quinta', 4],
  ['qui-feira', 4],
  ['quinta-feira', 4],
  ['sex', 5],
  ['sexta', 5],
  ['sex-feira', 5],
  ['sexta-feira', 5],
  ['sab', 6],
  ['sabado', 6],
])

const normalize = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '')
const normalizeWord = (s: string): string => normalize(s).trim().toLowerCase()

const TimePattern = /^([01]?\d|2[0-3]):([0-5]\d)$/

/** Parses one line of rotinas-pessoais.md: the item, or what the user wrote that the app cannot use. */
function parseLine(raw: string): Omit<RoutineLine, 'line'> {
  let text = raw.trim()
  if (/^[-*]\s/.test(text)) text = text.slice(1).trim()
  if (!text) return {}

  const [titlePart, ...rest] = text.split('|')
  const title = titlePart.trim()
  if (!title) return { problem: 'A linha precisa começar com o nome da rotina.' }

  let cadence: PersonalRoutineItem['cadence'] | undefined
  let days: string[] | undefined
  let time: string | undefined
  let target: number | undefined
  for (const field of rest) {
    const colon = field.indexOf(':')
    if (colon < 0)
      return {
        title,
        problem: `Depois do nome, cada campo é “nome: valor”, como “cadência: semanal” (o campo “${field.trim()}” não tem dois pontos).`,
      }
    const key = normalizeWord(field.slice(0, colon))
    const value = field.slice(colon + 1).trim()
    if (key !== 'cadencia' && key !== 'dias' && key !== 'hora' && key !== 'meta') {
      return { title, problem: `Campo desconhecido na linha: “${key}”. Use cadência, dias e hora.` }
    }
    if (!value) return { title, problem: `O campo “${key}” está vazio na linha.` }
    if (key === 'cadencia') {
      const c = normalizeWord(value)
      if (c !== 'diaria' && c !== 'semanal') return { title, problem: `A cadência “${value}” não é diária nem semanal.` }
      cadence = c === 'semanal' ? 'semanal' : 'diária'
    } else if (key === 'dias') {
      const list = value.split(',').map((d) => normalizeWord(d))
      if (!list.length || list.every((d) => !d))
        return { title, problem: 'O campo dias precisa de pelo menos um dia, como “dias: seg, qua”.' }
      const invalid = list.find((day) => !WEEKDAYS.has(day))
      if (invalid !== undefined) {
        return { title, problem: `Dia da semana desconhecido: “${invalid || '(vazio)'}”. Use dias em português, como “seg, qua”.` }
      }
      days = list
    } else if (key === 'hora') {
      if (!TimePattern.test(value)) return { title, problem: `A hora precisa estar no formato HH:MM (recebi “${value}”).` }
      time = value.padStart(5, '0')
    } else {
      if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 7)
        return { title, problem: `A meta semanal precisa ser um número entre 1 e 7 (recebi “${value}”).` }
      target = Number(value)
    }
  }

  if (!cadence) return { title, problem: 'A linha precisa dizer a cadência: “cadência: diária” ou “cadência: semanal”.' }
  if (cadence === 'semanal' && !days?.length && target === undefined) {
    return { title, problem: 'Cadência semanal sem dias marcados: diga os dias na linha, como “dias: seg, qua”.' }
  }
  if (cadence === 'diária' && days?.length) {
    return { title, problem: 'Dias marcados numa linha diária: “dias” só serve para a cadência semanal.' }
  }
  if (cadence === 'diária' && target !== undefined) return { title, problem: 'O campo meta só serve para a cadência semanal.' }
  if (cadence === 'semanal' && target !== undefined && days?.length)
    return { title, problem: 'Use meta ou dias na rotina semanal, não os dois; a distribuição é escolhida no foco.' }
  return { title, item: { title, cadence, ...(days ? { days } : {}), ...(time ? { time } : {}), ...(target ? { target } : {}) } }
}

/** Reads the whole rotinas-pessoais.md text: every line usable as an item, and every line that needs the user. */
export function parsePersonalRoutines(text: string): RoutineLine[] {
  return text.split(/\r?\n/).flatMap((raw, i) => {
    const trimmed = raw.trim()
    if (!trimmed || trimmed.startsWith('#')) return []
    return [{ line: i + 1, raw: trimmed, ...parseLine(trimmed) }]
  })
}

/** The number of the weekday of an AAAA-MM-DD day, for the WEEKDAYS map (dom = 0 … sáb = 6). */
function weekdayOf(today: string): number {
  return new Date(`${today}T12:00:00Z`).getUTCDay()
}

/**
 * Whether the item is due on the day: a daily item is due every day; a weekly item only on the days
 * the line marks — never a default, never presumed.
 */
export function routineDueOn(item: PersonalRoutineItem, today: string): boolean {
  if (item.cadence === 'semanal') {
    const number = weekdayOf(today)
    return (item.days ?? []).some((d) => WEEKDAYS.get(d) === number)
  }
  return true
}

/** Explicit legacy weekly days as unique JavaScript weekdays (Sunday 0 … Saturday 6). */
export function routineWeekdays(item: PersonalRoutineItem): number[] {
  return [
    ...new Set(
      (item.days ?? []).flatMap((day) => {
        const weekday = WEEKDAYS.get(normalizeWord(day))
        return weekday === undefined ? [] : [weekday]
      }),
    ),
  ].sort((a, b) => a - b)
}

/**
 * The candidates of a day: every due item, and every line that cannot be used without the user (a cadence
 * missing, a weekly line without days, a daily line with days, an unknown field). A weekly line whose day
 * is not today is simply not there. Nothing is launched, nothing is completed, nothing writes the file.
 */
export function routineCandidates(text: string, today: string): RoutineCandidate[] {
  const out: RoutineCandidate[] = []
  for (const { line, item, problem, title } of parsePersonalRoutines(text)) {
    if (item) {
      if (routineDueOn(item, today)) out.push({ line, item, kind: 'due' })
      continue
    }
    out.push({ line, title, kind: 'needsInput', reason: problem })
  }
  return out
}

export interface PersonalRoutineWeekRow {
  routineId: string
  line: number
  title: string
  target?: number
  cadence: 'diária' | 'semanal'
  time?: string
  days?: number[]
  /** Existing `dias:` schedule: already explicit in the note, no weekly distribution prompt. */
  fixedSchedule?: boolean
  confirmed: boolean
  occurrenceIds: string[]
  completed: number
}

export interface PersonalRoutineOverview {
  today: string
  weekStart: string
  weekEnd: string
  rows: PersonalRoutineWeekRow[]
  candidates: RoutineCandidate[]
  pending: { occurrenceId: string; routineId: string; day: string; taskId?: string }[]
}

export interface PersonalRoutineCreateInput {
  occurrenceId: string
  objective: string
  list: string
  time?: string
}

export interface LocalWeek {
  start: string
  end: string
}

/** Local calendar week from Monday to Sunday. Date-only arithmetic avoids DST/UTC date drift. */
export function localWeek(day: string): LocalWeek {
  const date = new Date(`${day}T12:00:00Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) throw new Error('Dia inválido.')
  const offset = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - offset)
  const start = date.toISOString().slice(0, 10)
  date.setUTCDate(date.getUTCDate() + 6)
  return { start, end: date.toISOString().slice(0, 10) }
}

/** Selected weekdays use JavaScript convention: Sunday 0, Monday 1 … Saturday 6. */
export function weeklyOccurrenceDates(day: string, weekdays: number[]): string[] {
  const week = localWeek(day)
  if (weekdays.some((weekday) => !Number.isInteger(weekday) || weekday < 0 || weekday > 6))
    throw new Error('Distribuição semanal inválida.')
  const start = new Date(`${week.start}T12:00:00Z`)
  return [...new Set(weekdays)]
    .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
    .map((weekday) => {
      const date = new Date(start)
      date.setUTCDate(date.getUTCDate() + ((weekday + 6) % 7))
      return date.toISOString().slice(0, 10)
    })
}

/** Stable opaque identity; no routine title or instruction is copied into local persistence. */
const normalizedDays = (days: string[] | undefined): string[] =>
  [...new Set((days ?? []).map((day) => String(WEEKDAYS.get(normalizeWord(day)) ?? `?${normalizeWord(day)}`)))].sort()

export function routineId(item: PersonalRoutineItem): string {
  const days = normalizedDays(item.days).join(',')
  const source = `${item.title.trim().normalize('NFC')}\u001f${item.cadence}\u001f${item.target ?? ''}\u001f${item.time ?? ''}\u001f${days}`
  let hash = 2166136261
  for (const char of source) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return `r${(hash >>> 0).toString(36)}`
}

/**
 * Resolve every definition before touching occurrence state. The legacy opaque digest remains compatible,
 * but duplicate definitions or a digest collision are rejected instead of sharing progress/distribution.
 */
export function uniqueRoutineIds(
  rows: { line: number; item: PersonalRoutineItem }[],
  identity: (item: PersonalRoutineItem) => string = routineId,
): Map<number, string> {
  const ids = new Map<number, string>()
  const linesById = new Map<string, number>()
  for (const { line, item } of rows) {
    const id = identity(item)
    const previous = linesById.get(id)
    if (previous !== undefined) {
      const sameDefinition = rows.find((row) => row.line === previous)?.item
      const reason =
        sameDefinition &&
        sameDefinition.title === item.title &&
        sameDefinition.cadence === item.cadence &&
        sameDefinition.target === item.target &&
        sameDefinition.time === item.time &&
        normalizedDays(sameDefinition.days).join(',') === normalizedDays(item.days).join(',')
          ? 'definições duplicadas'
          : 'colisão de identidade'
      throw new Error(
        `Não consegui separar rotinas pessoais: ${reason} nas linhas ${previous} e ${line}. Edite a nota para que cada rotina tenha uma definição distinta.`,
      )
    }
    ids.set(line, id)
    linesById.set(id, line)
  }
  return ids
}

export const routineOccurrenceId = (routine: string, day: string): string => `${routine}:${day}`

/** Stable focus target for the accessible status replacing the weekly-distribution action. */
export const routineDistributionStatusFocusKey = (routine: string): string => `routine-distribution-status-${routine}`
