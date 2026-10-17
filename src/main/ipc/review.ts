import { ipcMain } from 'electron'
import type { AgendaWriter } from '../agenda-write'
import { dayKey } from '../backups'
import {
  confirmReview,
  hasDraftToday,
  offerDue,
  markOffered,
  openReview,
  postponeReview,
  saveReviewDraft,
  type ReviewDeps,
} from '../review'
import type { TaskWriter } from '../tasks-write'
import { parse, reviewChoicesSchema, reviewPostponeSchema, reviewStepSchema } from '../validate'
import type { IpcContext } from './context'

/**
 * The daily review (AO-12). Every handler here is free of AI: it reads the files, keeps the review's state
 * in planning.json and, on confirmation, applies one proposal. `files` are the writers of tasks.ts, so one read
 * of tarefas.md is what every confirmation checks against.
 */
export function registerReviewIpc(ctx: IpcContext, files: { tasks: TaskWriter; agenda: AgendaWriter; vault(): string }): void {
  const deps = (): ReviewDeps => ({ planning: ctx.planning, tasks: files.tasks, agenda: files.agenda, now: () => new Date() })
  const draftChanged = () => ctx.broadcast({ type: 'review:draft', draft: hasDraftToday(ctx.planning, new Date()) })

  // The offer is shown once per local day. Without a vault there is nothing to review, so no offer and no mark.
  ipcMain.handle('office:reviewGate', async () => {
    if (!ctx.store.settings.vaultPath) return false
    const today = dayKey()
    if (!offerDue(ctx.planning, today)) return false
    markOffered(ctx.planning, today)
    return true
  })

  ipcMain.handle('office:openReview', async () => openReview(files.vault(), deps()))

  ipcMain.handle('office:saveReviewDraft', async (_e, step: unknown, choices: unknown) => {
    const s = parse(reviewStepSchema, step, 'Passo da revisão invǭlido.')
    const c = parse(reviewChoicesSchema, choices, 'Escolhas da revisão invǭlidas.')
    saveReviewDraft(ctx.planning, dayKey(), s, c)
    draftChanged()
  })

  ipcMain.handle('office:postponeReview', async (_e, option: unknown) => {
    const o = parse(reviewPostponeSchema, option, 'Opção de adiamento invǭlida.')
    return { next: postponeReview(ctx.planning, dayKey(), o) }
  })

  // The choices come from the page, so they are checked here; the proposal is then planned and applied in the main process.
  ipcMain.handle('office:confirmReview', async (_e, choices: unknown) => {
    const c = parse(reviewChoicesSchema, choices, 'Escolhas da revisão invǭlidas.')
    try {
      return confirmReview(files.vault(), c, deps())
    } finally {
      ctx.broadcast({ type: 'proposals', proposals: ctx.planning.pendingProposals() })
      draftChanged()
    }
  })
}
