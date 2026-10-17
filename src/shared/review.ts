import { describeOperation, dayPt, type ProposalOperation } from './proposals'

/**
 * The daily review (AO-12): four steps the Íris walks the user through, with no AI in any of them. Every
 * choice stays in the review until "Confirmar", which turns the choices into one proposal (proposals.ts).
 * This file is the model and its text, with no file access (src/main/review.ts does the files).
 */

/**
 * A focused task with no step recorded in this many days (today is day 0) gets the suggestion to
 * reschedule, review or discard it. The user has to confirm this number.
 */
export const REVIEW_STALE_DAYS = 3

export const REVIEW_STEPS = ['agenda', 'foco', 'estudos', 'confirmar'] as const
export type ReviewStep = (typeof REVIEW_STEPS)[number]

export const REVIEW_STEP_TITLES: Record<ReviewStep, string> = {
  agenda: 'Agenda',
  foco: 'Foco',
  estudos: 'Estudos e andares',
  confirmar: 'Confirmar',
}

/** The "O que fazer agora" line of each step. */
export const REVIEW_STEP_HINTS: Record<ReviewStep, string> = {
  agenda: 'O que fazer agora: confira os compromissos de hoje. Aqui nada muda.',
  foco: 'O que fazer agora: escolha o que acontece com cada tarefa em foco.',
  estudos: 'O que fazer agora: nada por enquanto.',
  confirmar: 'O que fazer agora: confira as operações e confirme. Só ao confirmar algo muda.',
}

/** What the user chose for a focused task. Tasks without a choice continue as they are. */
export type FocusChoice =
  | { kind: 'continuar' }
  | { kind: 'revisar' }
  /** `date` is DD.MM.AAAA, as the operation takes it. */
  | { kind: 'reagendar'; date: string }
  | { kind: 'descartar'; reason: string }

/** Choices by task id (lower case). "Concluir" is not a choice: finishing a task belongs to the board. */
export type ReviewChoices = Record<string, FocusChoice>

/** "Dispensar hoje" or adiar by 1, 2 or 3 days or 1 week (7). */
export type ReviewPostpone = 'dispensar' | 1 | 2 | 3 | 7

/** The source label the review's proposal carries. */
export const REVIEW_SOURCE = 'revisão'

/** The review of a day as it is kept until the end of that day, so it can be resumed. */
export interface ReviewDraft {
  /** AAAA-MM-DD, the local day the review belongs to. */
  day: string
  /** Index in REVIEW_STEPS. */
  step: number
  choices: ReviewChoices
}

export interface ReviewAgendaItem {
  time: string
  title: string
}

export interface ReviewFocusRow {
  id: string
  /** Empty when the task is no longer in tarefas.md. */
  title: string
  list: string
  missing: boolean
  /** No step in the last REVIEW_STALE_DAYS days: the review suggests a decision. */
  stale: boolean
}

/** What the review shows when it opens: the draft of today (or the first step), and what the files say now. */
export interface ReviewView {
  day: string
  step: number
  /** True when the review resumes a draft saved earlier the same day. */
  resumed: boolean
  choices: ReviewChoices
  agenda: { found: boolean; items: ReviewAgendaItem[] }
  focus: ReviewFocusRow[]
}

const DAY_MS = 86_400_000

const utcOf = (day: string): number => {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  return Date.UTC(y, m - 1, d)
}

/** The day `n` days after `day` (AAAA-MM-DD), by the calendar: no daylight saving involved. */
export function addDays(day: string, n: number): string {
  return new Date(utcOf(day) + n * DAY_MS).toISOString().slice(0, 10)
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((utcOf(to) - utcOf(from)) / DAY_MS)
}

/** The first day the offer comes back after the user's choice. "Dispensar" is the next day, like adiar 1. */
export function reviewNextDay(today: string, option: ReviewPostpone): string {
  return addDays(today, option === 'dispensar' ? 1 : option)
}

/** A focused task has gone REVIEW_STALE_DAYS or more without a recorded step (or never had one). */
export function isStale(lastStepDay: string | undefined, today: string): boolean {
  return lastStepDay === undefined || daysBetween(lastStepDay, today) >= REVIEW_STALE_DAYS
}

/** The suggestion line of a stale task. */
export function staleText(): string {
  return `Sem avanço há ${REVIEW_STALE_DAYS} dias ou mais. Reagende, revise ou descarte.`
}

/** AAAA-MM-DD from an input, as DD.MM.AAAA for the operation. */
export const ddmmOf = (iso: string): string => dayPt(iso)

/** DD.MM.AAAA back to AAAA-MM-DD, for an input that takes that shape. */
export function isoOfDdmm(date: string): string {
  const [d, m, y] = date.split('.')
  return `${y}-${m}-${d}`
}

/**
 * The operations a review's choices make, in the order of the focus. Continuar and revisar make none.
 * Throws a message for the user when a choice is not complete (no date, no reason): nothing is built then.
 */
export function reviewOperations(
  choices: ReviewChoices,
  focus: readonly string[],
  titleOf: (id: string) => string | undefined = () => undefined,
): ProposalOperation[] {
  const ops: ProposalOperation[] = []
  for (const id of focus) {
    const choice = choices[id]
    if (!choice) continue
    const title = titleOf(id)
    const name = title ? `“${title}”` : `a tarefa ${id}`
    if (choice.kind === 'reagendar') {
      if (!choice.date) throw new Error(`Escolha a nova data de ${name}.`)
      ops.push({ kind: 'reschedule', id, date: choice.date })
    } else if (choice.kind === 'descartar') {
      const reason = choice.reason.trim()
      if (!reason) throw new Error(`Escreva o motivo para descartar ${name}.`)
      ops.push({ kind: 'discard', id, reason })
    }
  }
  return ops
}

/** The operations of a review in words, as the Confirmar step lists them. Nothing is applied by building them. */
export function describeReviewOperations(ops: ProposalOperation[], titleOf: (id: string) => string | undefined): string[] {
  return ops.map((op) => describeOperation(op, titleOf))
}
