import { ipcMain } from 'electron'
import type { AgendaWriter } from '../agenda-write'
import { IrisDesk } from '../iris'
import { claudeIrisInterpreter } from '../iris-claude'
import { log } from '../log'
import type { TaskWriter } from '../tasks-write'
import { idSchema, irisRequestSchema, parse } from '../validate'
import type { IpcContext } from './context'

/**
 * The Luna (AO-13). `prepare` builds the text the user reads and sends nothing; `send` sends that same text
 * (by its token) and creates a pending proposal, which the user confirms in the caixa de entrada. `files` are the
 * writers of tasks.ts, so one read of tarefas.md is what the proposal is checked against.
 */
export function registerIrisIpc(ctx: IpcContext, files: { tasks: TaskWriter; agenda: AgendaWriter; vault(): string }): void {
  const desk = new IrisDesk({
    planning: ctx.planning,
    tasks: files.tasks,
    agenda: files.agenda,
    interpreter: claudeIrisInterpreter(),
    log,
    memories: () => ctx.profileMemory.summaries(), // AO-43
  })

  ipcMain.handle('office:prepareIris', async (_e, request: unknown) => {
    const text = parse(irisRequestSchema, request, 'Pedido inválido.')
    return desk.prepare(files.vault(), text)
  })

  ipcMain.handle('office:sendIris', async (_e, token: unknown) => {
    const t = parse(idSchema, token, 'Esse envio não existe mais. Revise o pedido de novo.')
    try {
      return await desk.send(t)
    } finally {
      ctx.broadcast({ type: 'proposals', proposals: ctx.planning.pendingProposals() })
    }
  })

  ipcMain.handle('office:cancelIris', async (_e, token: unknown) => {
    desk.cancel(parse(idSchema, token, 'Esse envio não existe mais. Revise o pedido de novo.'))
  })
}
