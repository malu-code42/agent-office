import { ipcMain } from 'electron'
import { projectFor } from '@shared/projects'
import {
  assigneeSchema,
  cleanDelegateTarget,
  commentSchema,
  modeIsMorePermissive,
  parse,
  searchSchema,
  ticketDraftSchema,
  ticketIdsSchema,
  ticketPatchSchema,
  ticketStatusSchema,
} from '../validate'
import { confirmPermissionOverride, ticketId, type IpcContext } from './context'

/** The ticket board. */
export function registerTicketsIpc(ctx: IpcContext): void {
  const { store, board, desk, manager, player } = ctx
  ipcMain.handle('office:createTicket', (_e, draft: unknown) => board.create(parse(ticketDraftSchema, draft, 'Ticket inválido.'), player()))
  ipcMain.handle('office:updateTicket', (_e, raw: unknown, patch: unknown) =>
    board.update(ticketId(raw), parse(ticketPatchSchema, patch, 'Ticket inválido.'), player()),
  )
  ipcMain.handle('office:moveTicket', (_e, raw: unknown, status: unknown, beforeId?: unknown) =>
    board.move(ticketId(raw), parse(ticketStatusSchema, status, 'Coluna inválida.'), beforeId ? ticketId(beforeId) : undefined, player()),
  )
  ipcMain.handle('office:commentTicket', (_e, raw: unknown, text: unknown) => {
    board.comment(ticketId(raw), parse(commentSchema, text, 'Comentário grande demais.'), player())
  })
  ipcMain.handle('office:deleteTicket', (_e, raw: unknown) => board.remove(ticketId(raw)))
  ipcMain.handle('office:closeTickets', (_e, ids?: unknown) => board.close(parse(ticketIdsSchema, ids, 'Tickets inválidos.'), player()))
  ipcMain.handle('office:listClosed', (_e, search?: unknown) => board.listClosed(searchSchema.parse(search)))
  ipcMain.handle('office:reopenTicket', (_e, raw: unknown) => board.reopen(ticketId(raw), player()))
  ipcMain.handle('office:assignTicket', (_e, raw: unknown, who: unknown) => {
    const t = board.assign(ticketId(raw), parse(assigneeSchema, who, 'Responsável inválido.') === 'me' ? player() : undefined, player())
    if (!t.assignee && t.status === 'doing') board.move(t.id, 'todo', undefined, player())
    else if (t.assignee && (t.status === 'backlog' || t.status === 'todo')) board.move(t.id, 'doing', undefined, player())
  })
  // A ticket may be written by someone else (or another agent): never run it with "bypass".
  ipcMain.handle('office:delegateTicket', async (_e, raw: unknown, target: unknown) => {
    const id = ticketId(raw)
    const cleaned = cleanDelegateTarget(target, store.settings.accounts)
    const ticket = board.get(id)
    if ('agentId' in cleaned) {
      const agent = manager.list().find((a) => a.id === cleaned.agentId)
      const inherited =
        projectFor(store.settings.projects, ticket?.cwd ?? agent?.cwd)?.permissionMode ?? store.settings.defaultPermissionMode
      if (agent && modeIsMorePermissive(agent.permissionMode, inherited)) {
        if (!(await confirmPermissionOverride(ctx.win(), `O agente ${agent.name} receberá o ticket ${ticket?.key ?? id}.`)))
          throw new Error('Delegação cancelada.')
        cleaned.confirmPermissionOverride = true
      }
    } else {
      const inherited = projectFor(store.settings.projects, ticket?.cwd)?.permissionMode ?? store.settings.defaultPermissionMode
      const mode = cleaned.hire.permissionMode ?? inherited
      if (mode === 'bypassPermissions') throw new Error('Tickets nunca podem rodar no modo "Sem pedir nada".')
      if (modeIsMorePermissive(mode, inherited)) {
        if (
          !(await confirmPermissionOverride(
            ctx.win(),
            `O agente executará o ticket ${ticket?.key ?? id} em ${ticket?.cwd ?? 'um projeto'}.`,
          ))
        )
          throw new Error('Delegação cancelada.')
        cleaned.hire.confirmPermissionOverride = true
      }
    }
    return desk.delegate(id, cleaned, player())
  })
}
