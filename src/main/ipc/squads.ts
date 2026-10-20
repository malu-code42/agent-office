import { ipcMain } from 'electron'
import { join } from 'node:path'
import { projectFor } from '@shared/projects'
import { findSquad, inspectSquads, isDir, squadInfo, validateSquad } from '../squads'
import { checkedSquadMode, modeIsMorePermissive, pathSchema, squadCodeSchema, squadNoteSchema } from '../validate'
import { confirmPermissionOverride, type IpcContext } from './context'

/** Squads of a project floor. */
export function registerSquadsIpc(ctx: IpcContext): void {
  const { store, manager, defaultBrain } = ctx
  ipcMain.handle('office:listSquads', (_e, cwd: unknown) =>
    pathSchema.safeParse(cwd).success && isDir(cwd) ? inspectSquads(cwd) : [],
  )
  ipcMain.handle('office:runSquad', async (_e, cwd: unknown, code: unknown, mode: unknown, note: unknown, _confirmOverride: unknown) => {
    if (!pathSchema.safeParse(cwd).success || !isDir(cwd)) throw new Error('Essa pasta de squads não existe mais.')
    // Orchestrators work in the squad room of their project's floor.
    if (projectFor(store.settings.projects, cwd)?.cwd !== cwd)
      throw new Error('Crie um andar para esse projeto antes de contratar um squad.')
    const plain = squadCodeSchema.safeParse(code)
    const squad = plain.success ? findSquad(cwd, plain.data) : undefined
    if (!squad) throw new Error(`A definição do squad não foi encontrada em ${join(String(cwd), 'squads', plain.success ? plain.data : '<código>', 'squad.yaml')}. Restaure ou corrija esse arquivo manualmente e feche/reabra o Agent Office; o Agent Office não recria definições.`)
    try {
      validateSquad(squad)
    } catch (err) {
      throw new Error(`O squad ${squad.code} está indisponível: ${err instanceof Error ? err.message : String(err)}. Corrija ${join(String(cwd), 'squads', squad.code, 'squad.yaml')} e feche/reabra o Agent Office; nenhuma definição foi alterada.`, { cause: err })
    }
    const inherited = projectFor(store.settings.projects, cwd)?.permissionMode ?? store.settings.defaultPermissionMode
    const permissionMode = checkedSquadMode(mode, inherited, true)
    if (
      modeIsMorePermissive(permissionMode, inherited) &&
      !(await confirmPermissionOverride(ctx.win(), `O squad ${squad.name} executará o ciclo com o modo selecionado.`))
    )
      throw new Error('Ciclo cancelado.')
    const extra = (squadNoteSchema.parse(note) ?? '').trim().slice(0, 2000)
    return manager.runSquad(
      squadInfo({ ...squad, cwd: projectFor(store.settings.projects, cwd)!.cwd }),
      `Rode um ciclo do squad ${squad.name} (squads/${squad.code}), do primeiro passo do pipeline até o fim.${extra ? `\n\nRecado de ${store.settings.playerName}: ${extra}` : ''}`,
      `Rodar um ciclo de ${squad.icon} ${squad.name}${extra ? `\n\n${extra}` : ''}`,
      {
        ...defaultBrain(),
        model: 'claude-haiku-5-5',
        // Same rule as tickets: a cycle reaches real systems, so it never runs with "bypass".
        permissionMode,
      },
    )
  })
}
