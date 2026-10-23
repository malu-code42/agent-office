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
}

/** What the Luna shows in the daily review: a candidate is due today, or its line needs the user first. */
export interface RoutineCandidate {
  title?: string
  item?: PersonalRoutineItem
  line: number
  kind: 'due' | 'needsInput'
  reason?: string
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
  for (const field of rest) {
    const colon = field.indexOf(':')
    if (colon < 0)
      return {
        title,
        problem: `Depois do nome, cada campo é “nome: valor”, como “cadência: semanal” (o campo “${field.trim()}” não tem dois pontos).`,
      }
    const key = normalizeWord(field.slice(0, colon))
    const value = field.slice(colon + 1).trim()
    if (key !== 'cadencia' && key !== 'dias' && key !== 'hora') {
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
    } else {
      if (!TimePattern.test(value)) return { title, problem: `A hora precisa estar no formato HH:MM (recebi “${value}”).` }
      time = value.padStart(5, '0')
    }
  }

  if (!cadence) return { title, problem: 'A linha precisa dizer a cadência: “cadência: diária” ou “cadência: semanal”.' }
  if (cadence === 'semanal' && !days?.length) {
    return { title, problem: 'Cadência semanal sem dias marcados: diga os dias na linha, como “dias: seg, qua”.' }
  }
  if (cadence === 'diária' && days?.length) {
    return { title, problem: 'Dias marcados numa linha diária: “dias” só serve para a cadência semanal.' }
  }
  return { title, item: { title, cadence, ...(days ? { days } : {}), ...(time ? { time } : {}) } }
}

/** Reads the whole rotinas-pessoais.md text: every line usable as an item, and every line that needs the user. */
export function parsePersonalRoutines(text: string): RoutineLine[] {
  return text
    .split(/\r?\n/)
    .map((raw, i) => {
      const trimmed = raw.trim()
      if (!trimmed || trimmed.startsWith('#')) return null
      return { line: i + 1, ...parseLine(trimmed) }
    })
    .filter((l): l is RoutineLine => l !== null)
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
