import { parsePersonalRoutines, routineDueOn, uniqueRoutineIds, type PersonalRoutineItem } from '@shared/routine-personal'
import { localWeek, routineOccurrenceId } from '@shared/routine-personal'
import type { AskQuestion } from '@shared/types'
import type { PersonalRoutineStore } from './personal-routines-store'

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME = /^(\d{2}):(\d{2})$/

export function localScheduledAt(day: string, time: string): number | null {
  const dateMatch = DATE.exec(day)
  const timeMatch = TIME.exec(time)
  if (!dateMatch || !timeMatch) return null
  const [, yearText, monthText, dayText] = dateMatch
  const [, hourText, minuteText] = timeMatch
  const year = Number(yearText)
  const month = Number(monthText)
  const date = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  if (month < 1 || month > 12 || hour > 23 || minute > 59) return null
  const at = new Date(year, month - 1, date, hour, minute, 0, 0)
  if (
    at.getFullYear() !== year || at.getMonth() !== month - 1 || at.getDate() !== date ||
    at.getHours() !== hour || at.getMinutes() !== minute
  ) return null
  return at.getTime()
}

export interface DailyQuestionItem {
  id: string
  question: string
  multiSelect?: boolean
  options: AskQuestion['options']
}

export interface DailyWorkflowDeps {
  store: PersonalRoutineStore
  now(): Date
  routineText(): string | null
  morning(day: string): string
  evening(day: string): string
  chat(text: string): void
  ask(items: DailyQuestionItem[], answer: (answers: Record<string, string>) => void): string | void
  cancelRequest?(requestId: string): void
}

/** Local-only daily schedule. Every process is persisted before delivery to make restarts idempotent. */
export class DailyWorkflow {
  private readonly reminderRequests = new Map<string, string>()

  constructor(private readonly deps: DailyWorkflowDeps) {}

  check(): void {
    const { store } = this.deps
    const now = this.deps.now()
    const day = localDay(now)
    const times = store.dailyTimes()
    const scheduled: string[] = []
    const processesToMark: string[] = []
    let morningScheduled = false
    let eveningScheduled = false
    const previousWorkflowDay = store.workflowDay()
    if (previousWorkflowDay !== undefined && previousWorkflowDay < day) {
      let missedDay = previousWorkflowDay < shiftDay(day, -1) ? shiftDay(previousWorkflowDay, 1) : previousWorkflowDay
      // Bound recovery work for stale/corrupt state while still catching up across long weekends.
      for (let count = 0; missedDay < day && count < 366; count++, missedDay = shiftDay(missedDay, 1)) {
        const key = `evening:${missedDay}`
        const at = localScheduledAt(missedDay, times.evening)
        if (at === null || now.getTime() < at || store.dayProcessHandled(key)) continue
        processesToMark.push(key)
        eveningScheduled = true
        scheduled.push(this.eveningWithRoutines(missedDay))
      }
    }
    for (const kind of ['morning', 'evening'] as const) {
      const key = `${kind}:${day}`
      const at = localScheduledAt(day, times[kind])
      if (at !== null && now.getTime() >= at && !store.dayProcessHandled(key)) {
        processesToMark.push(key)
        if (kind === 'morning') morningScheduled = true
        else eveningScheduled = true
        if (kind === 'morning') {
          const priorities = store.dailyPriorities(day)
          const priorityText = priorities.length ? `Prioridades escolhidas: ${priorities.join(', ')}` : ''
          scheduled.push([this.deps.morning(day), priorityText].filter(Boolean).join('\n\n'))
        } else scheduled.push(this.eveningWithRoutines(day))
      }
    }
    const dueRoutines = this.dueRoutines(day)
    const prompts: DailyQuestionItem[] = []
    if (morningScheduled) {
      prompts.push({
        id: `priorities:${day}`,
        question: 'Quais são suas prioridades para hoje?',
        multiSelect: true,
        options: [
          { label: 'Compromissos e aulas', description: 'Priorizar o que já está marcado na agenda.' },
          { label: 'Tarefas com data', description: 'Priorizar tarefas que vencem hoje.' },
          { label: 'Rotinas pessoais', description: 'Priorizar as rotinas previstas para hoje.' },
        ],
      })
    }
    if (eveningScheduled) {
      prompts.push({
        id: `next-steps:${day}`,
        question: 'O que você quer fazer com as pendências de hoje?',
        options: [
          { label: 'Planejar amanhã', description: 'Continuar no chat normal da Luna.' },
          { label: 'Revisar pendências', description: 'Escolher uma tarefa para retomar.' },
          { label: 'Deixar para depois', description: 'Manter tudo como está.' },
        ],
      })
    }
    for (const due of dueRoutines) {
      if (due.item.time === undefined) continue
      const at = localScheduledAt(day, due.item.time)
      if (at === null || now.getTime() < at) continue
      const occurrence = this.deps.store.ensureOccurrence(due.id, due.routineId, day)
      if (occurrence.status === 'completed' || occurrence.response) continue
      if (
        this.deps.store.reminderAttempts(due.id) === 1 &&
        occurrence.reminderAskedAt !== undefined &&
        now.getTime() >= occurrence.reminderAskedAt + 30 * 60_000
      ) {
        const requestId = this.reminderRequests.get(due.id)
        if (requestId) this.deps.cancelRequest?.(requestId)
        this.reminderRequests.delete(due.id)
      }
      if (this.deps.store.markReminderAsked(due.id, now.getTime())) {
        prompts.push({
          id: due.id,
          question: `Você concluiu “${due.item.title}” hoje?`,
          options: [
            { label: 'Concluída', description: 'Registrar como concluída hoje.' },
            { label: 'Adiar', description: 'Deixar pendente, sem registrar conclusão.' },
            { label: 'Não concluída', description: 'Manter pendente, sem registrar conclusão.' },
          ],
        })
      }
    }

    const routineText = dueRoutines.map((row) => `• ${row.item.title}${row.item.time ? ` (${row.item.time})` : ''}`).join('\n')
    const summary = [...scheduled.filter(Boolean), ...(scheduled.length && routineText ? [`Rotinas previstas hoje:\n${routineText}`] : [])]
    if (summary.length) this.deps.chat(summary.join('\n\n'))
    for (const item of prompts) {
      const requestId = this.deps.ask([item], (answers) => {
        const answeredAt = this.deps.now()
        const answer = answers[item.question]
        if (item.id.startsWith('priorities:'))
          store.saveDailyPriorities(item.id.slice('priorities:'.length), answer ? answer.split(/,\s*/u) : [])
        else if (answer === 'Concluída') store.answerReminder(item.id, 'completed', answeredAt.getTime())
        else if (answer === 'Adiar') store.answerReminder(item.id, 'deferred', answeredAt.getTime())
        else if (answer === 'Não concluída') store.answerReminder(item.id, 'not-completed', answeredAt.getTime())
        this.reminderRequests.delete(item.id)
      })
      if (item.id.startsWith('r') && requestId) this.reminderRequests.set(item.id, requestId)
    }
    for (const key of processesToMark) store.markDayProcessHandled(key)
    store.markWorkflowDay(day)
  }

  private dueRoutines(day: string): { id: string; routineId: string; item: PersonalRoutineItem }[] {
    const text = this.deps.routineText()
    if (!text) return []
    const parsed = parsePersonalRoutines(text)
    const ids = uniqueRoutineIds(parsed.flatMap((row) => (row.item ? [{ line: row.line, item: row.item }] : [])))
    return parsed.flatMap((row) => {
      if (!row.item) return []
      const routineId = ids.get(row.line)
      if (!routineId) return []
      const scheduledDays =
        row.item.cadence === 'semanal' && row.item.target !== undefined
          ? (this.deps.store.distribution(`${localWeek(day).start}:${routineId}`) ?? [])
          : undefined
      const due = scheduledDays ? scheduledDays.includes(new Date(`${day}T12:00:00Z`).getUTCDay()) : routineDueOn(row.item, day)
      if (!due) return []
      return [{ id: routineOccurrenceId(routineId, day), routineId, item: row.item }]
    })
  }

  private eveningWithRoutines(day: string): string {
    const completed: string[] = []
    const pending: string[] = []
    for (const due of this.dueRoutines(day)) {
      const occurrence = this.deps.store.occurrence(due.id)
      if (occurrence?.status === 'completed') completed.push(`• ${due.item.title}`)
      else pending.push(`• ${due.item.title}`)
    }
    const priorities = this.deps.store.dailyPriorities(day)
    const priorityText = priorities.length ? `Prioridades escolhidas: ${priorities.join(', ')}` : ''
    return [
      this.deps.evening(day),
      priorityText,
      completed.length ? `Rotinas concluídas:\n${completed.join('\n')}` : 'Rotinas concluídas: nenhuma registrada.',
      pending.length ? `Rotinas pendentes:\n${pending.join('\n')}` : 'Rotinas pendentes: nenhuma.',
    ].filter(Boolean).join('\n\n')
  }
}

function localDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function shiftDay(day: string, offset: number): string {
  const [year, month, date] = day.split('-').map(Number)
  const shifted = new Date(year!, month! - 1, date! + offset)
  return localDay(shifted)
}
