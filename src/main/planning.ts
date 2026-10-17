import { join } from 'node:path'
import {
  focusKey,
  TIMER_DURATION_MS,
  type ArchivedTask,
  type FocusTimer,
  type FocusTimerView,
  type Step,
  type TimerState,
} from '@shared/planning'
import { backupCopies, shapeOf } from './backups'
import { loadJson, reportLoad, writeJsonAtomic } from './fs-safe'

/**
 * planning.json in userData: the focus set ("Tarefas em foco"), a list of task ids, the
 * "Passo de hoje" of each task (one per task: the last one saved, with its day), the one
 * focus timer (AO-08), and the completed tasks by id (AO-05: origin list, day, line as it was).
 * Nothing here clears the focus by itself: it carries over from day to day
 * until the user takes a task out. A step of another day stays in the file as history. The
 * timer is never completed by the app: a session past its deadline is interrupted, and the
 * user confirms the minutes done. Review comes with its own ticket.
 */

interface Planning {
  focus: string[]
  steps: Record<string, Step>
  timer?: FocusTimer | undefined
  archived?: Record<string, ArchivedTask> | undefined
}

const isArchived = (v: unknown): v is ArchivedTask =>
  !!v &&
  typeof v === 'object' &&
  typeof (v as ArchivedTask).origin === 'string' &&
  typeof (v as ArchivedTask).completedAt === 'string' &&
  typeof (v as ArchivedTask).originalLine === 'string'

const isStep = (v: unknown): v is Step =>
  !!v && typeof v === 'object' && typeof (v as Step).date === 'string' && typeof (v as Step).text === 'string'

const TIMER_STATES: readonly string[] = ['em andamento', 'pausada', 'interrompida', 'confirmada']
const isTimerState = (v: unknown): v is TimerState => typeof v === 'string' && TIMER_STATES.includes(v)

/** A timer this version can use; anything else is dropped rather than guessed at. */
function parseTimer(v: unknown): FocusTimer | undefined {
  if (!v || typeof v !== 'object') return undefined
  const t = v as Partial<Record<keyof FocusTimer, unknown>>
  const ok =
    typeof t.taskId === 'string' &&
    typeof t.durationMs === 'number' &&
    typeof t.startedAt === 'number' &&
    typeof t.remainingMs === 'number' &&
    Number.isFinite(t.remainingMs) &&
    t.remainingMs >= 0 &&
    isTimerState(t.state) &&
    (t.state !== 'em andamento' || typeof t.resumedAt === 'number') &&
    (t.confirmedMinutes === undefined || typeof t.confirmedMinutes === 'number')
  if (!ok) return undefined
  return {
    taskId: focusKey(t.taskId as string),
    durationMs: t.durationMs as number,
    state: t.state as TimerState,
    startedAt: t.startedAt as number,
    remainingMs: t.remainingMs as number,
    ...(t.state === 'em andamento' ? { resumedAt: t.resumedAt as number } : {}),
    ...(t.confirmedMinutes !== undefined ? { confirmedMinutes: t.confirmedMinutes as number } : {}),
  }
}

const STEP_REFUSAL = 'Só tarefas em foco podem ter passo de hoje.'
const TIMER_REFUSAL = 'Só tarefas em foco podem ter timer de foco.'
const TIMER_BUSY = 'Já há uma sessão de foco em andamento, pausada ou por confirmar. Pare ou confirme essa sessão antes de começar outra.'

export class PlanningStore {
  private file: string
  private focusIds: string[]
  private steps: Map<string, Step>
  private timer: FocusTimer | undefined
  private archived: Map<string, ArchivedTask>
  private readonly now: () => number

  /** `now` is the clock: the app uses the system's, tests pass one they control. */
  constructor(dir: string, now: () => number = Date.now) {
    this.now = now
    this.file = join(dir, 'planning.json')
    const r = loadJson<Partial<Planning>>(this.file, { valid: shapeOf('planning.json'), fallbacks: backupCopies(dir, 'planning.json') })
    reportLoad(this.file, r)
    const raw: Partial<Planning> = r.status === 'ok' || r.status === 'restored' ? r.data : {}
    this.focusIds = [...new Set((raw.focus ?? []).map(focusKey))]
    this.steps = new Map(
      Object.entries(raw.steps ?? {})
        .filter(([, s]) => isStep(s))
        .map(([id, s]) => [focusKey(id), s]),
    )
    this.timer = parseTimer(raw.timer)
    this.archived = new Map(
      Object.entries(raw.archived ?? {})
        .filter((entry): entry is [string, ArchivedTask] => isArchived(entry[1]))
        .map(([id, a]) => [focusKey(id), a]),
    )
    this.settle()
  }

  focus(): string[] {
    return [...this.focusIds]
  }

  /** Today's step text of each task, by id. A step of another day is not here. */
  todaySteps(today: string): Map<string, string> {
    const out = new Map<string, string>()
    for (const [id, s] of this.steps) if (s.date === today) out.set(id, s.text)
    return out
  }

  /** Saves today's step of a focused task, in place of the one it had. Only planning.json changes. */
  saveStep(id: string, text: string, today: string): void {
    const key = this.focusedKey(id)
    this.steps.set(key, { date: today, text })
    this.save()
  }

  /** Removes today's step of a focused task. A step of another day is history and stays. */
  clearStep(id: string, today: string): void {
    const key = this.focusedKey(id)
    if (this.steps.get(key)?.date !== today) return
    this.steps.delete(key)
    this.save()
  }

  private focusedKey(id: string, refusal = STEP_REFUSAL): string {
    const key = focusKey(id)
    if (!this.focusIds.includes(key)) throw new Error(refusal)
    return key
  }

  /**
   * The focus session of each task: only the one timer, and only for its task. The time left
   * is computed from the clock now. Settles first, so a session past its deadline reads as interrupted.
   */
  timers(): Map<string, FocusTimerView> {
    this.settle()
    const t = this.timer
    if (!t) return new Map()
    const view: FocusTimerView = {
      state: t.state,
      remainingMs: this.left(t),
      ...(t.confirmedMinutes !== undefined ? { confirmedMinutes: t.confirmedMinutes } : {}),
    }
    return new Map([[t.taskId, view]])
  }

  /** Starts a 25-minute session for a focused task. Refused while another session is running, paused or unconfirmed. */
  startTimer(id: string): void {
    const key = this.focusedKey(id, TIMER_REFUSAL)
    this.settle()
    // A session of a completed task cannot be confirmed from the focus popup: it does not block the next one.
    if (this.timer && this.timer.state !== 'confirmada' && !this.archived.has(this.timer.taskId)) throw new Error(TIMER_BUSY)
    const now = this.now()
    this.timer = {
      taskId: key,
      durationMs: TIMER_DURATION_MS,
      state: 'em andamento',
      startedAt: now,
      remainingMs: TIMER_DURATION_MS,
      resumedAt: now,
    }
    this.save()
  }

  pauseTimer(id: string): void {
    const t = this.timerOf(id)
    if (t.state !== 'em andamento') throw new Error('Só um timer em andamento pode ser pausado.')
    this.timer = this.moved(t, 'pausada', this.left(t))
    this.save()
  }

  resumeTimer(id: string): void {
    const t = this.timerOf(id)
    if (t.state !== 'pausada') throw new Error('Só um timer pausado pode ser retomado.')
    this.timer = { ...this.moved(t, 'em andamento', t.remainingMs), resumedAt: this.now() }
    this.save()
  }

  /** Stops a running or paused session before its deadline. It is interrupted, so the minutes done are confirmed by the user. */
  stopTimer(id: string): void {
    const t = this.timerOf(id)
    if (t.state !== 'em andamento' && t.state !== 'pausada') throw new Error('Só um timer em andamento ou pausado pode ser parado.')
    this.timer = this.moved(t, 'interrompida', this.left(t))
    this.save()
  }

  /** Saves the minutes done in an interrupted session. The caller checks the range (0 to 25 whole minutes). */
  confirmTimer(id: string, minutes: number): void {
    const t = this.timerOf(id)
    if (t.state !== 'interrompida') throw new Error('Só uma sessão interrompida pode ter os minutos confirmados.')
    this.timer = { ...this.moved(t, 'confirmada', t.remainingMs), confirmedMinutes: minutes }
    this.save()
  }

  /** The session of a focused task. The popup changes only the session of a task in focus. */
  private timerOf(id: string): FocusTimer {
    const key = this.focusedKey(id, TIMER_REFUSAL)
    this.settle()
    if (!this.timer || this.timer.taskId !== key) throw new Error('Essa tarefa não tem timer de foco.')
    return this.timer
  }

  /** The session with a new state and time left; the running clock is dropped. */
  private moved(t: FocusTimer, state: TimerState, remainingMs: number): FocusTimer {
    return { taskId: t.taskId, durationMs: t.durationMs, state, startedAt: t.startedAt, remainingMs }
  }

  /** Time left in a session now; a paused, stopped or confirmed session keeps what it had. */
  private left(t: FocusTimer): number {
    if (t.state !== 'em andamento') return t.remainingMs
    return Math.max(0, t.remainingMs - (this.now() - (t.resumedAt ?? t.startedAt)))
  }

  /**
   * A running session whose deadline has passed becomes interrupted, never completed: nothing
   * knows how much of it was done. Runs on load and on every read, so the state is never stale.
   */
  private settle(): void {
    const t = this.timer
    if (!t || t.state !== 'em andamento' || this.left(t) > 0) return
    this.timer = this.moved(t, 'interrompida', 0)
    this.save()
  }

  add(id: string): void {
    const key = focusKey(id)
    if (this.focusIds.includes(key)) return
    this.focusIds.push(key)
    this.save()
  }

  remove(id: string): void {
    const key = focusKey(id)
    if (!this.focusIds.includes(key)) return
    this.focusIds = this.focusIds.filter((f) => f !== key)
    this.save()
  }

  /** A task completed in tarefas.md: it leaves the focus, and its origin and line are kept by id. */
  archive(id: string, record: ArchivedTask): void {
    const key = focusKey(id)
    this.focusIds = this.focusIds.filter((f) => f !== key)
    this.archived.set(key, record)
    this.save()
  }

  /** Undoes archive(): the record goes, and the task is focused again when it was focused before. */
  restore(id: string, focused: boolean): void {
    const key = focusKey(id)
    this.archived.delete(key)
    if (focused && !this.focusIds.includes(key)) this.focusIds.push(key)
    this.save()
  }

  /** The record of a completed or discarded task, when this store has it. */
  archivedOf(id: string): ArchivedTask | undefined {
    return this.archived.get(focusKey(id))
  }

  /** Removes the record of a reopened task. Nothing is saved when there is none. */
  unarchive(id: string): void {
    if (!this.archived.delete(focusKey(id))) return
    this.save()
  }

  private save(): void {
    writeJsonAtomic(
      this.file,
      {
        focus: this.focusIds,
        steps: Object.fromEntries(this.steps),
        timer: this.timer,
        archived: this.archived.size ? Object.fromEntries(this.archived) : undefined,
      } satisfies Planning,
      { space: 2, newline: true },
    )
  }
}
