import { join } from 'node:path'
import { focusKey, type ArchivedTask, type FocusTimer, type Step, type TimerState } from '@shared/planning'
import type { Proposal, ProposalFailure, ProposalOperation } from '@shared/proposals'
import type { ReviewDraft } from '@shared/review'
import { backupCopies, shapeOf } from './backups'
import { loadJson, reportLoad, writeJsonAtomic } from './fs-safe'
import { parseProposal, proposalSchema, reviewDraftSchema } from './validate'

/**
 * planning.json in userData: the focus set ("Tarefas em foco"), a list of task ids, the
 * "Passo de hoje" of each task (one per task: the last one saved, with its day), a legacy timer
 * field (AO-08's focus timer is gone: an old file's timer is parsed and written back unchanged,
 * but the app never starts, changes or reads one again), and the completed tasks by id (AO-05:
 * origin list, day, line as it was). Nothing here clears the focus by itself: it carries over
 * from day to day until the user takes a task out. A step of another day stays in the file as
 * history. A legacy session past its deadline still settles as interrupted on load, and the
 * user confirms the minutes it saw. Proposals (AO-10) wait here until they are applied or refused.
 * The daily review (AO-12) keeps here the first day its offer comes back and the draft of today's review.
 */

interface Planning {
  focus: string[]
  steps: Record<string, Step>
  timer?: FocusTimer | undefined
  archived?: Record<string, ArchivedTask> | undefined
  proposals?: Proposal[] | undefined
  review?: { next?: string | undefined; offered?: string | undefined; draft?: ReviewDraft | undefined } | undefined
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

export class PlanningStore {
  private file: string
  private focusIds: string[]
  private steps: Map<string, Step>
  private timer: FocusTimer | undefined
  private archived: Map<string, ArchivedTask>
  private proposals: Proposal[]
  private reviewNext: string | undefined
  private reviewOffered: string | undefined
  private draft: ReviewDraft | undefined
  private readonly now: () => number
  /** How many tasks were in the focus the last time the app was told about it. */
  private toldFocus: number

  /**
   * `now` is the clock: the app uses the system's, tests pass one they control.
   * `onFocusChange` is called with the new size of the focus whenever it changes, so the
   * dock can show how many tasks are in it.
   */
  constructor(
    dir: string,
    now: () => number = Date.now,
    private onFocusChange?: (count: number) => void,
  ) {
    this.now = now
    this.file = join(dir, 'planning.json')
    const r = loadJson<Partial<Planning>>(this.file, { valid: shapeOf('planning.json'), fallbacks: backupCopies(dir, 'planning.json') })
    reportLoad(this.file, r)
    const raw: Partial<Planning> = r.status === 'ok' || r.status === 'restored' ? r.data : {}
    this.focusIds = [...new Set((raw.focus ?? []).map(focusKey))]
    // The count the app already has: only a change is news.
    this.toldFocus = this.focusIds.length
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
    // A proposal this version cannot read is dropped, never guessed at: nothing is applied from it.
    this.proposals = (Array.isArray(raw.proposals) ? raw.proposals : []).flatMap((p) => {
      const ok = proposalSchema.safeParse(p)
      return ok.success ? [ok.data] : []
    })
    // A review draft or day this version cannot read is dropped: the review starts over, nothing is applied from it.
    const review = raw.review && typeof raw.review === 'object' ? raw.review : {}
    this.reviewNext = typeof review.next === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(review.next) ? review.next : undefined
    this.reviewOffered = typeof review.offered === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(review.offered) ? review.offered : undefined
    const draft = reviewDraftSchema.safeParse(review.draft)
    this.draft = draft.success ? draft.data : undefined
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

  /** Time left in a legacy session now; a paused, stopped or confirmed session keeps what it had. */
  private left(t: FocusTimer): number {
    if (t.state !== 'em andamento') return t.remainingMs
    return Math.max(0, t.remainingMs - (this.now() - (t.resumedAt ?? t.startedAt)))
  }

  /** A legacy session whose deadline has passed becomes interrupted, never completed: nothing
   * knows how much of it was done. Runs once on load, so the state kept is never stale.
   */
  private settle(): void {
    const t = this.timer
    if (!t || t.state !== 'em andamento' || this.left(t) > 0) return
    this.timer = this.moved(t, 'interrompida', 0)
    this.save()
  }

  /** The session with a new state and time left; the running clock is dropped. */
  private moved(t: FocusTimer, state: TimerState, remainingMs: number): FocusTimer {
    return { taskId: t.taskId, durationMs: t.durationMs, state, startedAt: t.startedAt, remainingMs }
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

  /** The proposals waiting for a confirmation, oldest first. */
  pendingProposals(): Proposal[] {
    return [...this.proposals]
  }

  proposal(id: string): Proposal | undefined {
    return this.proposals.find((p) => p.id === id)
  }

  /** Puts a proposal on the pending list. The input is checked first: a refused kind ("concluir") is never stored. */
  addProposal(input: unknown): Proposal {
    const p = parseProposal(input)
    if (this.proposals.some((o) => o.id === p.id)) throw new Error('Já existe uma proposta com esse identificador.')
    this.proposals.push(p)
    this.save()
    return p
  }

  /**
   * Records what a confirmation did: the focus set, the tasks taken to the Archive, and the operations
   * still waiting. With none left, the proposal is done and leaves the list.
   */
  settleProposal(
    id: string,
    change: {
      focus?: string[]
      archived?: { id: string; record: ArchivedTask }[]
      steps?: { id: string; step: Step }[]
      operations: ProposalOperation[]
      failure?: ProposalFailure | undefined
    },
  ): void {
    const i = this.proposals.findIndex((p) => p.id === id)
    if (i < 0) throw new Error('Essa proposta não existe mais.')
    if (change.focus) this.focusIds = [...new Set(change.focus.map(focusKey))]
    for (const a of change.archived ?? []) this.archived.set(focusKey(a.id), a.record)
    for (const s of change.steps ?? []) this.steps.set(focusKey(s.id), s.step)
    if (change.operations.length) this.proposals[i] = { ...this.proposals[i]!, operations: change.operations, failure: change.failure }
    else this.proposals.splice(i, 1)
    this.save()
  }

  /** Takes a proposal off the pending list without applying anything. Nothing is saved when it is not there. */
  removeProposal(id: string): void {
    const before = this.proposals.length
    this.proposals = this.proposals.filter((p) => p.id !== id)
    if (this.proposals.length !== before) this.save()
  }

  /** The first local day the review offer may come back (AAAA-MM-DD), or undefined when it never was offered. */
  reviewNextDay(): string | undefined {
    return this.reviewNext
  }

  setReviewNextDay(day: string): void {
    this.reviewNext = day
    this.save()
  }

  /** The local day the review offer was last shown (AAAA-MM-DD), or undefined. */
  reviewOfferedDay(): string | undefined {
    return this.reviewOffered
  }

  setReviewOffered(day: string): void {
    this.reviewOffered = day
    this.save()
  }

  /** The draft of a review, of any day: the caller checks the day. */
  reviewDraft(): ReviewDraft | undefined {
    return this.draft
  }

  saveReviewDraft(draft: ReviewDraft): void {
    this.draft = draft
    this.save()
  }

  /** Drops the draft of the review (after a confirmation, or a draft of an earlier day). Nothing is saved when there is none. */
  clearReviewDraft(): void {
    if (!this.draft) return
    this.draft = undefined
    this.save()
  }

  /** The day of the step a focused task has (its last saved step), or undefined when it has none. */
  lastStepDay(id: string): string | undefined {
    return this.steps.get(focusKey(id))?.date
  }

  private save(): void {
    writeJsonAtomic(
      this.file,
      {
        focus: this.focusIds,
        steps: Object.fromEntries(this.steps),
        timer: this.timer,
        archived: this.archived.size ? Object.fromEntries(this.archived) : undefined,
        proposals: this.proposals.length ? this.proposals : undefined,
        review:
          this.reviewNext || this.reviewOffered || this.draft
            ? { next: this.reviewNext, offered: this.reviewOffered, draft: this.draft }
            : undefined,
      } satisfies Planning,
      { space: 2, newline: true },
    )
    this.tellFocus()
  }

  /** Tells the app when the focus changes size: the file is already written when it does. */
  private tellFocus(): void {
    const n = this.focusIds.length
    if (n === this.toldFocus) return
    this.toldFocus = n
    this.onFocusChange?.(n)
  }
}
