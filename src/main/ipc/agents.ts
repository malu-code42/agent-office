import { dialog, ipcMain, type MessageBoxOptions } from 'electron'
import { isAbsolute } from 'node:path'
import { isDir } from '../squads'
import { cleanLook } from '../templates'
import { repoRoot } from '../git'
import {
  worktreeFlagSchema,
  attachmentsSchema,
  cleanBrain,
  cleanHire,
  messageSchema,
  modeIsMorePermissive,
  parse,
  pathSchema,
  permissionDecisionSchema,
  permissionModeSchema,
  subagentLogArgsSchema,
} from '../validate'
import { projectFor } from '@shared/projects'
import { confirmPermissionOverride, id, type IpcContext } from './context'

/** Agents: hire, summon, talk to them, answer permissions and ack results. */
export function registerAgentsIpc(ctx: IpcContext): void {
  const { store, manager, bridge, updateBadge, defaultBrain } = ctx
  ipcMain.handle('office:getLog', (_e, raw: unknown) => manager.getLog(id(raw)))
  ipcMain.handle('office:getSubagentLog', (_e, ...args: unknown[]) => {
    const [agentId, subId] = parse(subagentLogArgsSchema, args, 'ID inválido.')
    return manager.getSubagentLog(agentId, subId)
  })
  // A permission mode outside the list falls back to the office default.
  ipcMain.handle('office:hire', async (_e, req: unknown) => {
    const record = req && typeof req === 'object' ? (req as Record<string, unknown>) : {}
    const hire = cleanHire({ ...record, confirmPermissionOverride: true }, store.settings)
    if (hire.engine === 'opencode' && !(await confirmOpenCodeData(ctx))) throw new Error('Contratação OpenCode cancelada.')
    const inherited = projectFor(store.settings.projects, hire.cwd)?.permissionMode ?? store.settings.defaultPermissionMode
    if (
      modeIsMorePermissive(hire.permissionMode, inherited) &&
      !(await confirmPermissionOverride(
        ctx.win(),
        `O agente ${hire.name || '(sem nome)'} será contratado para ${hire.cwd}.`,
        hire.permissionMode === 'bypassPermissions',
      ))
    ) {
      throw new Error('Contratação cancelada.')
    }
    return manager.hire({ ...hire, look: cleanLook((req as { look?: unknown } | null)?.look) })
  })
  ipcMain.handle('office:summon', async (_e, cwd: unknown, mode: unknown, brain: unknown, worktree: unknown, _confirmOverride: unknown, engine: unknown) => {
    if (!pathSchema.safeParse(cwd).success || !isDir(cwd)) throw new Error('Escolha uma pasta de projeto que exista.')
    const m = permissionModeSchema.safeParse(mode)
    const inherited = projectFor(store.settings.projects, cwd)?.permissionMode ?? store.settings.defaultPermissionMode
    const permissionMode = m.success ? m.data : inherited
    const selectedEngine = engine === 'claude' || engine === 'opencode' ? engine : store.settings.defaultEngine
    if (selectedEngine === 'opencode' && !(await confirmOpenCodeData(ctx))) throw new Error('Chamada OpenCode cancelada.')
    if (
      modeIsMorePermissive(permissionMode, inherited) &&
      !(await confirmPermissionOverride(
        ctx.win(),
        `O agente será chamado para trabalhar em ${cwd}.`,
        permissionMode === 'bypassPermissions',
      ))
    )
      throw new Error('Chamada cancelada.')
    return manager.summon(
      cwd,
      { ...defaultBrain(), ...cleanBrain(brain, store.settings.accounts), permissionMode },
      worktreeFlagSchema.parse(worktree),
      selectedEngine,
    )
  })
  ipcMain.handle('office:isGitRepo', async (_e, cwd: unknown) => {
    const p = pathSchema.safeParse(cwd)
    return p.success && isAbsolute(p.data) && isDir(p.data) && !!(await repoRoot(p.data))
  })
  ipcMain.handle('office:send', (_e, raw: unknown, text: unknown, attachments: unknown) =>
    manager.sendMessage(
      id(raw),
      parse(messageSchema, text, 'Mensagem grande demais. Mande em partes ou anexe como arquivo.'),
      undefined,
      parse(attachmentsSchema.optional(), attachments, 'Anexos inválidos.') ?? [],
    ),
  )
  ipcMain.handle('office:interrupt', (_e, raw: unknown) => manager.interrupt(id(raw)))
  ipcMain.handle('office:compact', (_e, raw: unknown) => manager.compact(id(raw)))
  ipcMain.handle('office:clearContext', (_e, raw: unknown) => manager.clearContext(id(raw)))
  ipcMain.handle('office:closeTerminal', (_e, raw: unknown) => bridge.closeSession(id(raw)))

  ipcMain.handle('office:respond', (_e, d: unknown) => manager.respond(parse(permissionDecisionSchema, d, 'Resposta inválida.')))
  ipcMain.handle('office:continueOn', (_e, raw: unknown, account: unknown) => manager.continueOn(id(raw), id(account)))
  ipcMain.handle('office:ackResult', (_e, raw: unknown) => {
    manager.ackResult(id(raw))
    updateBadge()
  })
}

async function confirmOpenCodeData(ctx: IpcContext): Promise<boolean> {
  if (ctx.store.settings.openCodeDataConsentAt) return true
  const options: MessageBoxOptions = {
    type: 'warning',
    title: 'Uso de modelos OpenCode',
    message: 'O código da pasta de trabalho será enviado ao provedor do modelo selecionado pelo OpenCode.',
    detail: 'Não inclua o vault real, credenciais, segredos ou dados de clientes. O Agent Office enviará a tarefa ao GPT-6 Luna high pela conta/provider já conectado ao OpenCode. Você pode cancelar antes de enviar qualquer tarefa.',
    buttons: ['Continuar', 'Cancelar'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  }
  const owner = ctx.win()
  const result = owner ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options)
  if (result.response !== 0) return false
  ctx.store.settings = { ...ctx.store.settings, openCodeDataConsentAt: Date.now() }
  ctx.broadcast({ type: 'settings', settings: ctx.store.settings })
  return true
}
