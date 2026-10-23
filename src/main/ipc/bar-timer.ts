import { ipcMain } from 'electron'
import { z } from 'zod'
import { BAR_MODES } from '@shared/barTimer'
import { parse, taskIdSchema } from '../validate'

/** Longer task title (passes by hint/step labels today) — the same scope as parseStepText's input. */
const taskTitleSchema = z.string().min(1).max(300)
import type { IpcContext } from './context'

/**
 * The bar Timer (AO-64), outside planning.json: one session in timer.json, owned by the user
 * and linked to no task. The task link is only a display label; arguments are validated before
 * anything reaches the store.
 */

const BAR_MODE_LIST = [...BAR_MODES] as unknown[]

export function registerBarTimerIpc(ctx: IpcContext): void {
  const timer = () => ctx.barTimer.view() ?? null

  ipcMain.handle('office:barTimerState', () => timer())

  ipcMain.handle('office:barTimerStart', (_e, mode: unknown, task: unknown) => {
    if (!BAR_MODE_LIST.includes(mode)) throw new Error('Escolha Foco · 25, Pausa curta · 5 ou Pausa longa · 15.')
    const link = task === null || task === undefined ? undefined : pageTask(task)
    return ctx.barTimer.start(mode as number, link)
  })

  ipcMain.handle('office:barTimerPause', () => ctx.barTimer.pause())
  ipcMain.handle('office:barTimerResume', () => ctx.barTimer.resume())
  ipcMain.handle('office:barTimerReset', () => {
    ctx.barTimer.reset()
    return timer()
  })

  ipcMain.handle('office:barTimerTask', (_e, task: unknown) => {
    return task === null || task === undefined ? ctx.barTimer.setTask(undefined) ?? timer() : ctx.barTimer.setTask(pageTask(task)) ?? timer()
  })
}

/** The task label a page may send: the id of a task checked like any other, and the title as it was read. */
function pageTask(task: unknown): { id: string; text: string } {
  if (!task || typeof task !== 'object') throw new Error('Tarefa inválida para o Timer.')
  const t = task as { id?: unknown; text?: unknown }
  return { id: parse(taskIdSchema, t.id, 'Identificador inválido.'), text: parse(taskTitleSchema, t.text, 'Tarefa inválida para o Timer.') }
}
