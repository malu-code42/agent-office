import { isoDay, parseClasses } from './agenda'

/** One class in the week grid of the study floor's "Horário de aula" board. */
export interface ClassSlot {
  id: string
  time: string
  /** What is studied: the part of the aulas.md title before " · " (or " — "). */
  topic: string
  /** What happens in the class: the rest of the title, or empty. */
  detail: string
  /** This week's occurrence differs from the weekly grid (an exception in aulas.md). */
  change?: { kind: 'cancelled' } | { kind: 'moved'; from: string } | { kind: 'retitled' }
}

export interface ClassScheduleDay {
  /** AAAA-MM-DD, local. */
  date: string
  /** Seg, Ter, … */
  label: string
  today: boolean
  classes: ClassSlot[]
}

export interface ClassScheduleView {
  /** False when the vault has no aulas.md. */
  found: boolean
  warnings: string[]
  /** Monday to Friday of the week of `today`, and Saturday and Sunday too when a class falls on them. */
  days: ClassScheduleDay[]
  /** Every time of the week, sorted: the rows of the grid. */
  times: string[]
}

const LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

/** "Probabilidade · Aula com o tutor" → topic and detail; a title without a separator is all topic. */
export function splitClassTitle(title: string): { topic: string; detail: string } {
  const match = /^(.+?)\s+(?:·|—|–|-)\s+(.+)$/.exec(title.trim())
  return match ? { topic: match[1]!.trim(), detail: match[2]!.trim() } : { topic: title.trim(), detail: '' }
}

/**
 * The week grid of aulas.md for the week of `today` (Monday first). The weekly rules give
 * the classes; an exception of a date in this week changes only that occurrence: cancelled
 * (kept in the grid, marked), moved to another time or retitled. Read only.
 */
export function buildClassSchedule(source: string | null, today: Date): ClassScheduleView {
  const parsed = parseClasses(source)
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7))
  const todayKey = isoDay(today)
  const week = Array.from({ length: 7 }, (_, i) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i))
  const days: ClassScheduleDay[] = week.map((day) => {
    const date = isoDay(day)
    const classes = parsed.rules
      .filter((rule) => rule.weekday === day.getDay())
      .map((rule): ClassSlot => {
        const exception = parsed.exceptions.find((item) => item.id === rule.id && item.date === date)
        const time = exception?.time ?? rule.time
        const slot: ClassSlot = { id: rule.id, time, ...splitClassTitle(exception?.title ?? rule.title) }
        if (exception?.cancelled) slot.change = { kind: 'cancelled' }
        else if (exception?.time && exception.time !== rule.time) slot.change = { kind: 'moved', from: rule.time }
        else if (exception?.title && exception.title !== rule.title) slot.change = { kind: 'retitled' }
        return slot
      })
      .sort((a, b) => a.time.localeCompare(b.time) || a.topic.localeCompare(b.topic, 'pt-BR'))
    return { date, label: LABELS[day.getDay()]!, today: date === todayKey, classes }
  })
  // Saturday and Sunday are columns only when a class falls on them.
  const shown = days.filter((day, i) => i < 5 || day.classes.length)
  const times = [...new Set(shown.flatMap((day) => day.classes.map((slot) => slot.time)))].sort()
  return { found: source !== null, warnings: parsed.warnings, days: shown, times }
}
