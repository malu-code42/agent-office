import type { TaskList } from './tasks'

/**
 * The focus set ("Tarefas em foco") and what the popup shows of it. Focus is state, not a copy
 * of the task: the set holds task ids, and the title and list come from tarefas.md when read.
 */

/** The "Passo de hoje" of a focused task: one a day, saved with the day it is for. */
export interface Step {
  date: string
  text: string
}

/**
 * A completed or discarded task, by its id in planning.json. `origin` is the list it came from,
 * `completedAt` the local day it left the list as AAAA-MM-DD, `originalLine` the line as it was
 * before. Reopening (AO-06) needs them; the record goes when the task is reopened.
 */
export interface ArchivedTask {
  origin: string
  completedAt: string
  /** HH:MM of the completion, shown in the agenda; the line in tarefas.md carries no completion date. */
  completedTime?: string
  originalLine: string
}

/** Longest text of a "Passo de hoje", in characters. */
export const STEP_MAX = 200

/** A focus session lasts 25 minutes (AO-08). */
export const TIMER_DURATION_MS = 25 * 60 * 1000
export const TIMER_MINUTES = TIMER_DURATION_MS / 60_000

/**
 * The states of a focus session. "interrompida" is never a completed session: the time done
 * is unknown until the user confirms it, and nothing confirms it by itself.
 */
export type TimerState = 'em andamento' | 'pausada' | 'interrompida' | 'confirmada'

/**
 * The one focus session planning.json keeps (the next one replaces it). A running session
 * counts down from `resumedAt`, so the time left is computed from the clock when it is read.
 */
export interface FocusTimer {
  taskId: string
  durationMs: number
  state: TimerState
  startedAt: number
  /** Time left at the last pause, stop or resume. */
  remainingMs: number
  resumedAt?: number
  confirmedMinutes?: number
}

/** The session as the popup shows it: the time left at the moment it was read. */
export interface FocusTimerView {
  state: TimerState
  remainingMs: number
  confirmedMinutes?: number
}

/** A focused task: its title and list in tarefas.md; `missing` when its id is no longer there. `step` is today's step, when there is one; `timer` is the session of this task, when it has one. */
export type FocusItem =
  | { id: string; missing: false; text: string; list: string; date?: string; step?: string; timer?: FocusTimerView }
  | { id: string; missing: true }

/** mm:ss for the popup. Rounds up, so the last second still shows 00:01. */
export function clockText(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(Math.floor(total / 60))}:${p(total % 60)}`
}

/** Ids in planning.json are lowercase, as the reader stores them, so a comparison never misses on case. */
export const focusKey = (id: string): string => id.toLowerCase()

/** Each focused id in the order it was added, matched against the tasks that have an id. */
export function focusItems(
  lists: TaskList[],
  focus: readonly string[],
  todaySteps: ReadonlyMap<string, string> = new Map(),
  timers: ReadonlyMap<string, FocusTimerView> = new Map(),
): FocusItem[] {
  const tasks = new Map<string, { text: string; list: string; date?: string }>()
  for (const list of lists) {
    for (const task of list.tasks)
      if (task.id) tasks.set(focusKey(task.id), { text: task.text, list: list.name, date: task.date ?? task.dueDate })
  }
  return focus.map((id) => {
    const task = tasks.get(id)
    if (!task) return { id, missing: true }
    const step = todaySteps.get(id)
    const timer = timers.get(id)
    return {
      id,
      missing: false,
      text: task.text,
      list: task.list,
      ...(task.date ? { date: task.date } : {}),
      ...(step ? { step } : {}),
      ...(timer ? { timer } : {}),
    }
  })
}
