import type { ReviewChoices } from '@shared/review'
import { ddmmOf, isoOfDdmm } from '@shared/review'

export type FocusKind = 'continuar' | 'reagendar' | 'revisar' | 'descartar'

/** A choice the user is making for one focused task, kept only until confirmation. DOM-free.
 * `date` is always AAAA-MM-DD (HTML <input type="date">); the IPC schema expects DD.MM.AAAA,
 * so the boundary converts both ways. */
export interface Pending {
  kind: FocusKind
  /** AAAA-MM-DD. */
  date: string
  reason: string
}

/** Builds the choices to persist from the pending map, in the shape the review IPC expects. Pure.
 * Converts the input date (AAAA-MM-DD) to the operation date (DD.MM.AAAA). */
export function pendingChoices(pendingById: Map<string, Pending>): ReviewChoices {
  const out: ReviewChoices = {}
  for (const [id, p] of pendingById) {
    if (p.kind === 'reagendar') {
      if (p.date) out[id] = { kind: 'reagendar', date: ddmmOf(p.date) }
    } else if (p.kind === 'descartar') {
      out[id] = { kind: 'descartar', reason: p.reason }
    } else if (p.kind !== 'continuar') {
      out[id] = { kind: p.kind }
    }
  }
  return out
}

/** Restores saved draft choices into the pending map so confirmation matches the draft. Pure.
 * Converts the operation date (DD.MM.AAAA) back to the input date (AAAA-MM-DD). */
export function restoreChoices(choices: ReviewChoices): Map<string, Pending> {
  const out = new Map<string, Pending>()
  for (const [id, choice] of Object.entries(choices)) {
    if (choice.kind === 'reagendar') {
      out.set(id, { kind: 'reagendar', date: isoOfDdmm(choice.date), reason: '' })
    } else if (choice.kind === 'descartar') {
      out.set(id, { kind: 'descartar', date: '', reason: choice.reason })
    } else {
      out.set(id, { kind: choice.kind, date: '', reason: '' })
    }
  }
  return out
}
