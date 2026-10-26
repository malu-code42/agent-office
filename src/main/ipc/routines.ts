import { ipcMain } from 'electron'
import { projectFor } from '@shared/projects'
import { cleanRoutineDraft, modeIsMorePermissive } from '../validate'
import { confirmPermissionOverride, id, type IpcContext } from './context'

/** Rotinas: tarefas agendadas, controladas pelo totem do térreo. */
export function registerRoutinesIpc(ctx: IpcContext): void {
  const { store, manager, routines, macJobs } = ctx
  const routineId = (raw: unknown) => id(raw)
  ipcMain.handle('office:listRoutines', () => routines.list())
  ipcMain.handle('office:saveRoutine', async (_e, raw: unknown) => {
    const draft = cleanRoutineDraft(
      { ...(raw && typeof raw === 'object' ? raw : {}), confirmPermissionOverride: true },
      { settings: store.settings, agents: manager.list().filter((agent) => !agent.builtIn) },
    )
    const agent = draft.who.kind === 'agent' ? manager.agent(draft.who.agentId) : undefined
    const floor = draft.floor ? store.settings.projects.find((p) => p.id === draft.floor) : undefined
    const cwd = agent?.cwd ?? floor?.cwd ?? draft.cwd
    const inherited = (cwd ? projectFor(store.settings.projects, cwd)?.permissionMode : undefined) ?? store.settings.defaultPermissionMode
    if (
      modeIsMorePermissive(draft.permissionMode, inherited) &&
      !(await confirmPermissionOverride(
        ctx.win(),
        `A rotina ${draft.name} executará tarefas em ${cwd ?? 'seu projeto'}.`,
        draft.permissionMode === 'bypassPermissions',
      ))
    ) {
      throw new Error('Rotina não salva.')
    }
    return routines.save(draft)
  })
  ipcMain.handle('office:deleteRoutine', (_e, raw: unknown) => routines.remove(routineId(raw)))
  ipcMain.handle('office:setRoutineEnabled', (_e, raw: unknown, on: unknown) => {
    if (typeof on !== 'boolean') throw new Error('Valor inválido.')
    return routines.setEnabled(routineId(raw), on)
  })
  ipcMain.handle('office:duplicateRoutine', (_e, raw: unknown) => routines.duplicate(routineId(raw)))
  ipcMain.handle('office:runRoutineNow', (_e, raw: unknown) => routines.runNow(routineId(raw)))

  // The Mac's own jobs: only labels read from ~/Library/LaunchAgents get through (MacJobs.find).
  const label = (raw: unknown) => {
    if (typeof raw !== 'string' || !raw.trim() || raw.length > 200) throw new Error('Agendamento inválido.')
    return raw
  }
  ipcMain.handle('office:listMacJobs', () => macJobs.refresh())
  ipcMain.handle('office:runMacJobNow', (_e, raw: unknown) => macJobs.runNow(label(raw)))
  ipcMain.handle('office:macJobLog', (_e, raw: unknown) => macJobs.logTail(label(raw)))
  ipcMain.handle('office:openMacJobLog', (_e, raw: unknown) => macJobs.openLog(label(raw)))
}
