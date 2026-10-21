import { ipcMain } from 'electron'
import { join } from 'node:path'
import { projectFor } from '@shared/projects'
import { ticketBrief } from '@shared/tickets'
import { findSquad, inspectSquads, isDir, squadInfo, validateSquad } from '../squads'
import {
  checkedSquadMode,
  modeIsMorePermissive,
  pathSchema,
  squadAdjustmentSchema,
  squadApprovalSchema,
  squadCodeSchema,
  squadNoteSchema,
  squadProposalIdSchema,
  squadProposalRequestSchema,
  squadRenameSchema,
  parse,
} from '../validate'
import { confirmPermissionOverride, type IpcContext } from './context'

/** Squads of a project floor. */
export function registerSquadsIpc(ctx: IpcContext): void {
  const { store, manager, defaultBrain } = ctx
  ipcMain.handle('office:listSquads', (_e, cwd: unknown) => (pathSchema.safeParse(cwd).success && isDir(cwd) ? inspectSquads(cwd) : []))
  ipcMain.handle('office:runSquad', async (_e, cwd: unknown, code: unknown, mode: unknown, note: unknown, _confirmOverride: unknown) => {
    if (!pathSchema.safeParse(cwd).success || !isDir(cwd)) throw new Error('Essa pasta de squads não existe mais.')
    // Orchestrators work in the squad room of their project's floor.
    if (projectFor(store.settings.projects, cwd)?.cwd !== cwd)
      throw new Error('Crie um andar para esse projeto antes de contratar um squad.')
    const plain = squadCodeSchema.safeParse(code)
    const squad = plain.success ? findSquad(cwd, plain.data) : undefined
    if (!squad)
      throw new Error(
        `A definição do squad não foi encontrada em ${join(String(cwd), 'squads', plain.success ? plain.data : '<código>', 'squad.yaml')}. Restaure ou corrija esse arquivo manualmente e feche/reabra o Agent Office; o Agent Office não recria definições.`,
      )
    try {
      validateSquad(squad)
    } catch (err) {
      throw new Error(
        `O squad ${squad.code} está indisponível: ${err instanceof Error ? err.message : String(err)}. Corrija ${join(String(cwd), 'squads', squad.code, 'squad.yaml')} e feche/reabra o Agent Office; nenhuma definição foi alterada.`,
        { cause: err },
      )
    }
    const inherited = projectFor(store.settings.projects, cwd)?.permissionMode ?? store.settings.defaultPermissionMode
    const permissionMode = checkedSquadMode(mode, inherited, true)
    if (
      modeIsMorePermissive(permissionMode, inherited) &&
      !(await confirmPermissionOverride(ctx.win(), `O squad ${squad.name} executará o ciclo com o modo selecionado.`))
    )
      throw new Error('Ciclo cancelado.')
    const extra = (squadNoteSchema.parse(note) ?? '').trim().slice(0, 2000)
    // The squad with a queue starts by the ticket it owns: the first of the ones the
    // player chose when the squad was created.
    const queue = ctx.creation.queue(squad.code)
    const active = queue?.active ? ctx.board.get(queue.active) : undefined
    const ticketNote = active ? `\n\nA equipe começa pelo ticket ${active.key} (${active.title}):\n${ticketBrief(active)}` : ''
    return manager.runSquad(
      squadInfo({ ...squad, cwd: projectFor(store.settings.projects, cwd)!.cwd }),
      `Rode um ciclo do squad ${squad.name} (squads/${squad.code}), do primeiro passo do pipeline até o fim.${ticketNote}${extra ? `\n\nRecado de ${store.settings.playerName}: ${extra}` : ''}`,
      `Rodar um ciclo de ${squad.icon} ${squad.name}${extra ? `\n\n${extra}` : ''}`,
      {
        ...defaultBrain(),
        model: 'claude-haiku-5-5',
        // Same rule as tickets: a cycle reaches real systems, so it never runs with "bypass".
        permissionMode,
      },
    )
  })

  // ---------- a squad proposed for an empty room (ticket 04) ----------

  // The page sends the id of the proposal and the room it means: never a path.
  ipcMain.handle('office:proposeSquad', async (_e, raw: unknown) => {
    const input = parse(squadProposalRequestSchema, raw, 'Proposta inválida.')
    return ctx.creation.propose(input)
  })
  ipcMain.handle('office:adjustSquadProposal', async (_e, raw: unknown) => {
    const input = parse(squadAdjustmentSchema, raw, 'Ajuste inválido.')
    return ctx.creation.adjust(input.id, input.adjustment, input.name)
  })
  ipcMain.handle('office:renameSquadProposal', async (_e, raw: unknown) => {
    const input = parse(squadRenameSchema, raw, 'Nome inválido.')
    return ctx.creation.rename(input.id, input.name)
  })
  ipcMain.handle('office:discardSquadProposal', (_e, raw: unknown) => {
    const { id } = parse(squadProposalIdSchema, raw, 'Proposta inválida.')
    ctx.creation.discard(id)
  })
  ipcMain.handle('office:approveSquadProposal', async (_e, raw: unknown) => {
    const input = parse(squadApprovalSchema, raw, 'Aprovação inválida.')
    const { squad } = await ctx.creation.approve(input.id, input.name)
    // The room has a squad now: the floor is built again with it.
    ctx.broadcast({ type: 'squads', squads: ctx.rereadSquads() })
    return squad
  })
  ipcMain.handle('office:squadQueue', (_e, code: unknown) => {
    const plain = squadCodeSchema.safeParse(code)
    return plain.success ? ctx.creation.queue(plain.data) : undefined
  })
}
