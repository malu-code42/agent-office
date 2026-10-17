import { randomUUID } from 'node:crypto'
import { focusItems, focusKey } from '@shared/planning'
import {
  addDays,
  isStale,
  REVIEW_SOURCE,
  reviewNextDay,
  reviewOperations,
  type ReviewChoices,
  type ReviewDraft,
  type ReviewPostpone,
  type ReviewView,
} from '@shared/review'
import { parseTasksFile } from '@shared/tasks'
import { commitmentsOn, type AgendaWriter } from './agenda-write'
import { dayKey } from './backups'
import type { PlanningStore } from './planning'
import { applyProposal, ProposalFailed } from './proposals'
import { readTasks, type TaskWriter } from './tasks-write'

/**
 * The daily review (AO-12) on the files: when the offer comes back, the draft of the day, and the
 * confirmation, which is one proposal applied through proposals.ts. Nothing here calls an AI: the review
 * reads tarefas.md and agenda.md and keeps its own state in planning.json.
 */

export interface ReviewDeps {
  planning: PlanningStore
  tasks: TaskWriter
  agenda: AgendaWriter
  /** The clock. The day of the review is read from it. */
  now: () => Date
  newId?: () => string
}

/** The offer is due when it was never shown, or the day it waits for has come. */
export function offerDue(planning: PlanningStore, today: string): boolean {
  const next = planning.reviewNextDay()
  return next === undefined || today >= next
}

/** The offer was shown: today is taken, so a second open the same day does not show it again. */
export function markOffered(planning: PlanningStore, today: string): void {
  planning.setReviewNextDay(addDays(today, 1))
}

/** The user postponed the offer, or dismissed it for the day. Returns the day it comes back. */
export function postponeReview(planning: PlanningStore, today: string, option: ReviewPostpone): string {
  const next = reviewNextDay(today, option)
  planning.setReviewNextDay(next)
  return next
}

/** The draft of `today`, or undefined. A draft of another day is dropped: it is never resumed. */
export function draftOf(planning: PlanningStore, today: string): ReviewDraft | undefined {
  const draft = planning.reviewDraft()
  if (!draft) return undefined
  if (draft.day === today) return draft
  planning.clearReviewDraft()
  return undefined
}

/** Choices keyed as planning.json keeps task ids, only for tasks in focus. */
function keyed(choices: ReviewChoices, focus: readonly string[]): ReviewChoices {
  const out: ReviewChoices = {}
  for (const [id, choice] of Object.entries(choices)) {
    const key = focusKey(id)
    if (focus.includes(key)) out[key] = choice
  }
  return out
}

/** Keeps the review of `today` as it is, step and choices, so it can be resumed. Only planning.json changes. */
export function saveReviewDraft(planning: PlanningStore, today: string, step: number, choices: ReviewChoices): void {
  planning.saveReviewDraft({ day: today, step, choices: keyed(choices, planning.focus()) })
}

/**
 * What the review shows: the focus with the titles and lists of tarefas.md, the commitments of today in
 * agenda.md, and the draft of today when there is one. Reads both files and remembers them for the
 * confirmation, which checks that they have not changed. Nothing is written.
 */
export function openReview(vault: string, deps: ReviewDeps): ReviewView {
  const { planning, tasks, agenda } = deps
  const today = dayKey(deps.now())
  const text = readTasks(vault)
  tasks.remember(vault, text)
  const agendaText = agenda.read(vault)
  const draft = draftOf(planning, today)
  const focus = focusItems(parseTasksFile(text).lists, planning.focus()).map((item) =>
    item.missing
      ? { id: item.id, title: '', list: '', missing: true, stale: false }
      : {
          id: item.id,
          title: item.text,
          list: item.list,
          missing: false,
          stale: !planning.archivedOf(item.id) && isStale(planning.lastStepDay(item.id), today),
        },
  )
  return {
    day: today,
    step: draft?.step ?? 0,
    resumed: !!draft,
    // A choice for a task that left the focus is not shown, so it cannot make the confirmation fail unseen.
    choices: keyed(draft?.choices ?? {}, planning.focus()),
    agenda: { found: agendaText !== null, items: agendaText === null ? [] : commitmentsOn(agendaText, today) },
    focus,
  }
}

const titlesOf = (text: string): Map<string, string> => {
  const titles = new Map<string, string>()
  for (const list of parseTasksFile(text).lists) for (const t of list.tasks) if (t.id) titles.set(focusKey(t.id), t.text)
  return titles
}

/**
 * Confirms the review: its choices become one proposal (source "revisão") that is applied through the proposal
 * mechanism, all of it or none. A review with no operations (everything continues) changes no file. The
 * draft is dropped once the review is confirmed. A proposal that could not be planned is removed, so the
 * inbox does not keep it; the draft stays, so the user can change the choices and confirm again.
 */
export function confirmReview(vault: string, choices: ReviewChoices, deps: ReviewDeps): { applied: number } {
  const { planning, tasks, agenda } = deps
  const focus = planning.focus()
  for (const id of Object.keys(choices)) {
    if (!focus.includes(focusKey(id))) throw new Error('Essa tarefa não está mais em foco. Abra a revisão de novo.')
  }
  const picked = keyed(choices, focus)
  // The text the review read: a file changed since is refused before any operation is planned.
  const titles = titlesOf(tasks.current(vault))
  const operations = reviewOperations(picked, focus, (id) => titles.get(id))
  if (operations.length === 0) {
    planning.clearReviewDraft()
    return { applied: 0 }
  }
  const proposal = planning.addProposal({
    id: (deps.newId ?? randomUUID)(),
    source: REVIEW_SOURCE,
    createdAt: deps.now().getTime(),
    operations,
  })
  try {
    applyProposal(vault, proposal, { tasks, agenda, planning, now: deps.now })
  } catch (err) {
    if (err instanceof ProposalFailed) planning.removeProposal(proposal.id)
    throw err
  }
  planning.clearReviewDraft()
  return { applied: operations.length }
}

/** Whether the review of today has a draft to resume (the inbox shows it). */
export function hasDraftToday(planning: PlanningStore, now: Date): boolean {
  return planning.reviewDraft()?.day === dayKey(now)
}
