/**
 * The Timer of the bar: one Pomodoro of the user, not of a task (it replaces the AO-08 timer).
 * Pure arithmetic, without I/O: the session lives in a main-process store (timer.json), and the
 * end time `endsAt` is absolute, so the count continues after a restart. Pause keeps the time
 * left; a deadline that passed while the app was closed reads as interrupted, with unconfirmed
 * time. Nothing here completes a task or goal: at zero the Timer only warns.
 */

/** The three fixed intervals, in minutes: focus, short break, long break. */
export const BAR_MODES = [25, 5, 15] as const
export type BarMode = (typeof BAR_MODES)[number]

/** ms of an interval. */
export const barMs = (mode: BarMode): number => mode * 60_000

/** The states of the bar Timer. "interrompida" is not a done session: the time done stays unconfirmed. */
export type BarTimerState = 'parada' | 'em andamento' | 'pausada' | 'interrompida'

/**
 * One session, the only one (the next one replaces it). `endsAt` is only while running —
 * wall-clock, so a restart resumes the same deadline. `palette...task` is the optional task
 * link: only a label in the popup, never a command on the task.
 */
export interface BarTimer {
  mode: BarMode
  state: BarTimerState
  startedAt: number
  /** Absolute deadline, while "em andamento". */
  endsAt?: number
  /** Time left at the last pause or interruption; a paused session keeps it until it resumes. */
  remainingMs?: number
  /** Optional task link: its id in planning.json and the title as it was linked. */
  taskId?: string
  taskText?: string
}

/** mm:ss of the time the Timer has left, rounds up so the last second still shows 00:01. */
export function barClockText(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`
}

/** The time left, computed from the clock: an absolute deadline never lies about an old session. */
export function barRemaining(t: Pick<BarTimer, 'state' | 'endsAt' | 'remainingMs'>, now: number): number {
  if (t.state === 'em andamento') return Math.max(0, (t.endsAt ?? now) - now)
  return t.remainingMs ?? 0
}

/** Starts an interval; `task` is the optional label of a focused task. */
export function barStart(mode: BarMode, task: { id?: string; text?: string } | undefined, now: number): BarTimer {
  return {
    mode,
    state: 'em andamento',
    startedAt: now,
    endsAt: now + barMs(mode),
    ...(typeof task?.id === 'string' && typeof task?.text === 'string' ? { taskId: task.id, taskText: task.text } : {}),
  }
}

/** Pauses: keeps what was left, drops the deadline. */
export function barPause(t: BarTimer, now: number): BarTimer {
  const { endsAt: _gone, ...rest } = t
  return { ...rest, state: 'pausada', remainingMs: barRemaining(t, now) }
}

/** Resumes: the deadline comes back from what was left, as if the pause never happened. */
export function barResume(t: BarTimer, now: number): BarTimer {
  const { remainingMs: _gone, ...rest } = t
  return { ...rest, state: 'em andamento', endsAt: now + (t.remainingMs ?? 0) }
}

/** Interrupts a session in progress (deadline zeroed or passed): the time done stays unconfirmed. */
export function barInterrupt(t: BarTimer, now: number): BarTimer {
  return { mode: t.mode, state: 'interrompida', startedAt: t.startedAt, remainingMs: barRemaining(t, now) }
}

/** Zeros the Timer: nothing is kept, and only the user marks a task done — ever. */
export function barReset(): undefined {
  return undefined
}

/**
 * A session past its deadline is interrupted, never "done": the running one only shifts state
 * when it has no time left. Used on load (app reopened after the deadline) and on every read.
 */
export function barSettle(t: BarTimer, now: number): BarTimer {
  if (t.state === 'em andamento' && barRemaining(t, now) <= 0) return barInterrupt(t, now)
  return t
}

/** A session this version can use; anything else is dropped rather than guessed at. */
export function parseBarTimer(v: unknown): BarTimer | undefined {
  if (!v || typeof v !== 'object') return undefined
  const t = v as Partial<Record<keyof BarTimer, unknown>>
  const mode = t.mode
  const ok =
    typeof mode === 'number' &&
    Number.isInteger(mode) &&
    (BAR_MODES as readonly number[]).includes(mode) &&
    typeof t.startedAt === 'number' &&
    typeof t.state === 'string' &&
    (t.state === 'parada' || t.state === 'em andamento' || t.state === 'pausada' || t.state === 'interrompida') &&
    (t.state !== 'em andamento' || typeof t.endsAt === 'number') &&
    (t.endsAt === undefined || (typeof t.endsAt === 'number' && Number.isFinite(t.endsAt))) &&
    (t.remainingMs === undefined || (typeof t.remainingMs === 'number' && Number.isFinite(t.remainingMs) && t.remainingMs >= 0)) &&
    (t.taskId === undefined || typeof t.taskId === 'string') &&
    (t.taskText === undefined || typeof t.taskText === 'string')
  if (!ok) return undefined
  return {
    mode: mode as BarMode,
    state: t.state as BarTimerState,
    startedAt: t.startedAt as number,
    ...(t.state === 'em andamento' ? { endsAt: t.endsAt as number } : {}),
    ...(t.remainingMs !== undefined ? { remainingMs: t.remainingMs as number } : {}),
    ...(t.taskId !== undefined && t.taskText !== undefined ? { taskId: t.taskId as string, taskText: t.taskText as string } : {}),
  }
}

/** What the main process pushes and the bar shows, read now: mode, state, time left, and whether it has a task. */
export interface BarTimerView {
  state: BarTimerState
  mode: BarMode
  /** The time left at reading; the running one also carries its absolute `endsAt`. */
  remainingMs: number
  endsAt?: number
  taskId?: string
  taskText?: string
}

/** The session as a view, at the moment of the read; an empty Timer reads as null. */
export function barView(t: BarTimer | undefined, now: number): BarTimerView | undefined {
  if (!t) return undefined
  const left = barRemaining(t, now)
  return {
    state: t.state,
    mode: t.mode,
    remainingMs: left,
    ...(t.state === 'em andamento' ? { endsAt: t.endsAt ?? now + left } : {}),
    ...(t.taskId !== undefined && t.taskText !== undefined ? { taskId: t.taskId, taskText: t.taskText } : {}),
  }
}

/** The bar timer's own file (timer.json): the session, or nothing. Anything the app cannot use reads as stopped. */
export interface TimerFile {
  timer?: BarTimer | undefined
}

/** What the popup's clock head shows for each state. */
export const BAR_STATUS: Record<BarTimerState, string> = {
  parada: 'Parado',
  'em andamento': 'Em andamento',
  pausada: 'Pausado',
  interrompida: 'Interrompida',
}

/** The interval buttons: "Foco · 25", "Pausa curta · 5" and "Pausa longa · 15". */
export const BAR_INTERVALS: readonly { mode: BarMode; short: string; title: string }[] = [
  { mode: 25, short: 'Foco · 25', title: 'Foco · 25 min' },
  { mode: 5, short: 'Pausa curta · 5', title: 'Pausa curta · 5 min' },
  { mode: 15, short: 'Pausa longa · 15', title: 'Pausa longa · 15 min' },
]

/** The interval title as the popup opens: "Foco · 25 min". */
export const intervalTitle = (mode: BarMode): string => BAR_INTERVALS.find((i) => i.mode === mode)?.title ?? BAR_INTERVALS[0].title
