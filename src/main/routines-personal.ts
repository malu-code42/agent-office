import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  localWeek,
  parsePersonalRoutines,
  routineCandidates,
  routineOccurrenceId,
  routineWeekdays,
  uniqueRoutineIds,
  weeklyOccurrenceDates,
  type PersonalRoutineOverview,
  type PersonalRoutineItem,
  type RoutineCandidate,
} from '@shared/routine-personal'
import type { PersonalRoutineStore } from './personal-routines-store'

/**
 * Personal routines (AO-42), the part that touches the vault: read rotinas-pessoais.md and turn it into
 * the candidates of the day. This is read-only on purpose: the file belongs to the user's notes, and no
 * write of the app ever lands in it. A missing file means no candidates and no error — without a note of
 * personal routines there is simply nothing to raise in the daily review.
 */

export const PERSONAL_ROUTINES_FILE = 'rotinas-pessoais.md'

/** The exact text of the file, or null when the vault has no rotinas-pessoais.md. */
export function readPersonalRoutines(vault: string): string | null {
  try {
    return readFileSync(join(vault, PERSONAL_ROUTINES_FILE), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

/** The candidates the Luna raises today, from the file. Missing file: no candidates, not an error. */
export function personalRoutineCandidates(vault: string, today: string): RoutineCandidate[] {
  const text = readPersonalRoutines(vault)
  if (text === null) return []
  return routineCandidates(text, today)
}

/** Read-only overview: projected dates are not persisted until distribution or task actions are explicit. */
export function personalRoutineOverview(vault: string, today: string, store: PersonalRoutineStore): PersonalRoutineOverview {
  const text = readPersonalRoutines(vault) ?? ''
  const week = localWeek(today)
  const parsed = parsePersonalRoutines(text)
  const routineIds = uniqueRoutineIds(parsed.flatMap((row) => (row.item ? [{ line: row.line, item: row.item }] : [])))
  const rows: PersonalRoutineOverview['rows'] = []
  const candidates = routineCandidates(text, today).map((candidate) => {
    const id = routineIds.get(candidate.line)
    const tracked = parsed.find((row) => row.line === candidate.line)?.item
    return id && tracked && (tracked.cadence === 'diária' || tracked.target !== undefined || !!tracked.days?.length)
      ? { ...candidate, occurrenceId: routineOccurrenceId(id, today) }
      : candidate
  })
  for (const line of parsed) {
    const item = line.item
    if (!item) continue
    const id = routineIds.get(line.line)!
    if (item.cadence === 'semanal' && item.target !== undefined) {
      const key = `${week.start}:${id}`
      const days = store.distribution(key)
      const dates = days ? weeklyOccurrenceDates(today, days) : []
      const occurrenceIds = dates.map((date) => routineOccurrenceId(id, date))
      const dueToday = days?.includes(new Date(`${today}T12:00:00Z`).getUTCDay())
      const todayOccurrenceId = routineOccurrenceId(id, today)
      if (days && dueToday && store.occurrence(todayOccurrenceId)?.status !== 'completed')
        candidates.push({ line: line.line, item, kind: 'due', occurrenceId: todayOccurrenceId })
      rows.push({
        routineId: id,
        line: line.line,
        title: item.title,
        cadence: item.cadence,
        target: item.target,
        ...(item.time ? { time: item.time } : {}),
        ...(days ? { days } : {}),
        confirmed: !!days,
        occurrenceIds,
        completed: store.count(id, week.start, week.end),
      })
    } else if (item.cadence === 'diária') {
      const occurrenceId = routineOccurrenceId(id, today)
      const occurrence = store.occurrence(occurrenceId)
      if (occurrence?.status === 'completed') {
        for (let i = candidates.length - 1; i >= 0; i--)
          if (candidates[i]!.line === line.line && candidates[i]!.kind === 'due') candidates.splice(i, 1)
      }
      rows.push({
        routineId: id,
        line: line.line,
        title: item.title,
        cadence: item.cadence,
        occurrenceIds: [occurrenceId],
        completed: store.count(id, today, today),
        confirmed: true,
      })
    } else if (item.cadence === 'semanal' && item.days?.length) {
      const days = routineWeekdays(item)
      const dates = weeklyOccurrenceDates(today, days)
      const occurrenceIds = dates.map((date) => routineOccurrenceId(id, date))
      const occurrenceId = routineOccurrenceId(id, today)
      const completedToday = store.occurrence(occurrenceId)?.status === 'completed'
      if (completedToday) {
        for (let i = candidates.length - 1; i >= 0; i--)
          if (candidates[i]!.line === line.line && candidates[i]!.kind === 'due') candidates.splice(i, 1)
      }
      rows.push({
        routineId: id,
        line: line.line,
        title: item.title,
        cadence: item.cadence,
        target: days.length,
        fixedSchedule: true,
        ...(item.time ? { time: item.time } : {}),
        days,
        confirmed: true,
        occurrenceIds,
        completed: store.count(id, week.start, week.end),
      })
    }
  }
  return {
    today,
    weekStart: week.start,
    weekEnd: week.end,
    rows,
    candidates,
    pending: store
      .list()
      .filter((row) => row.status === 'pending' && (row.day < today || !!row.taskId))
      .map((row) => ({
        occurrenceId: row.id,
        routineId: row.routineId,
        day: row.day,
        ...(row.taskId ? { taskId: row.taskId } : {}),
      })),
  }
}

/** Resolve an occurrence's current definition from the read-only note, never from renderer-supplied fields. */
export function personalRoutineDefinition(vault: string, id: string): PersonalRoutineItem | undefined {
  const lines = parsePersonalRoutines(readPersonalRoutines(vault) ?? '')
  const ids = uniqueRoutineIds(lines.flatMap((line) => (line.item ? [{ line: line.line, item: line.item }] : [])))
  return lines.find((line) => ids.get(line.line) === id)?.item
}
