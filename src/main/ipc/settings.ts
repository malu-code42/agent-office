import { dialog, ipcMain } from 'electron'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { cleanTemplate, loadTemplates, upsertTemplate } from '../templates'
import { cleanSettings, modeIsMorePermissive } from '../validate'
import { confirmPermissionOverride, id, type IpcContext } from './context'
import { previewClaudePermissions } from '../permissions/import'

/** Configurações: terminal bridge, templates and settings. */
export function registerSettingsIpc(ctx: IpcContext): void {
  const { win, store, manager, board, bridge, broadcast, rereadSquads } = ctx
  ipcMain.handle('office:previewClaudePermissions', async () => {
    const selected = await dialog.showOpenDialog(win()!, {
      title: 'Selecionar configurações Claude para importar (somente leitura)',
      properties: ['openFile'],
      filters: [{ name: 'Configurações JSON', extensions: ['json'] }],
    })
    if (selected.canceled || !selected.filePaths[0]) return null
    let parsed: unknown
    try {
      const text = await readFile(selected.filePaths[0], 'utf8')
      if (text.length > 1_000_000) throw new Error('too large')
      parsed = JSON.parse(text)
    } catch {
      throw new Error('Não consegui ler um JSON válido. Nenhum arquivo foi alterado.')
    }
    const rules = previewClaudePermissions(parsed)
    return { source: basename(selected.filePaths[0]), rules }
  })
  ipcMain.handle('office:installBridge', async () => {
    const { response } = await dialog.showMessageBox(win()!, {
      type: 'question',
      buttons: ['Conectar', 'Cancelar'],
      defaultId: 0,
      cancelId: 1,
      message: 'Conectar sessões do Claude Code no terminal?',
      detail:
        'Vamos adicionar hooks HTTP em ~/.claude/settings.json (com backup em settings.json.agent-office.bak). ' +
        'Cada sessão do terminal vira um agente no escritório, e pedidos de permissão chegam até você aqui. ' +
        'Se o app estiver fechado, o Claude Code segue normal no terminal.',
    })
    if (response !== 0) return bridge.status()
    try {
      return bridge.install()
    } catch (err) {
      dialog.showErrorBox('Não consegui editar ~/.claude/settings.json', err instanceof Error ? err.message : String(err))
      return bridge.status()
    }
  })
  ipcMain.handle('office:uninstallBridge', () => {
    try {
      return bridge.uninstall()
    } catch (err) {
      dialog.showErrorBox('Não consegui editar ~/.claude/settings.json', err instanceof Error ? err.message : String(err))
      return bridge.status()
    }
  })
  ipcMain.handle('office:saveTemplate', async (_e, raw: unknown) => {
    const t = cleanTemplate(raw, store.settings.projects)
    const inherited =
      (t.floor ? store.settings.projects.find((p) => p.id === t.floor)?.permissionMode : undefined) ?? store.settings.defaultPermissionMode
    if (
      modeIsMorePermissive(t.permissionMode, inherited) &&
      !(await confirmPermissionOverride(
        win(),
        `O modelo ${t.name} executará tarefas com este modo de permissões.`,
        t.permissionMode === 'bypassPermissions',
      ))
    )
      throw new Error('Modelo não salvo.')
    store.settings = { ...store.settings, templates: upsertTemplate(store.settings.templates, t) }
    broadcast({ type: 'settings', settings: store.settings })
    return t
  })
  ipcMain.handle('office:deleteTemplate', (_e, raw: unknown) => {
    const templateId = id(raw)
    store.settings = { ...store.settings, templates: store.settings.templates.filter((t) => t.id !== templateId) }
    broadcast({ type: 'settings', settings: store.settings })
  })
  ipcMain.handle('office:saveSettings', async (_e, patch: unknown) => {
    const before = JSON.stringify(store.settings.projects)
    const days = store.settings.ticketAutoCloseDays
    // Unknown keys are dropped; a bad value keeps the current one. The bridge port never changes here.
    const cleaned = cleanSettings({ ...(patch && typeof patch === 'object' ? patch : {}), confirmPermissionChanges: true }, store.settings)
    const overrides = [
      ...(modeIsMorePermissive(cleaned.defaultPermissionMode, store.settings.defaultPermissionMode) ? ['padrão do escritório'] : []),
      ...cleaned.projects.flatMap((floor) => {
        const old = store.settings.projects.find((p) => p.id === floor.id)
        const previous = (old?.cwd === floor.cwd ? old.permissionMode : undefined) ?? store.settings.defaultPermissionMode
        const next = floor.permissionMode ?? cleaned.defaultPermissionMode
        return modeIsMorePermissive(next, previous) ? [floor.name] : []
      }),
    ]
    const enablesBypass =
      (cleaned.defaultPermissionMode === 'bypassPermissions' && store.settings.defaultPermissionMode !== 'bypassPermissions') ||
      cleaned.projects.some((floor) => {
        const old = store.settings.projects.find((p) => p.id === floor.id && p.cwd === floor.cwd)
        return floor.permissionMode === 'bypassPermissions' && old?.permissionMode !== 'bypassPermissions'
      })
    if (
      overrides.length &&
      !(await confirmPermissionOverride(win(), `Permissões que ficarão mais permissivas: ${overrides.join(', ')}.`, enablesBypass))
    )
      throw new Error('Configurações não salvas.')
    // Templates change only through saveTemplate/deleteTemplate; a removed floor turns its templates global.
    store.settings = { ...cleaned, templates: loadTemplates(store.settings.templates, cleaned.projects) }
    manager.setLunaPreferences(store.settings)
    const { projects, ticketAutoCloseDays } = store.settings
    broadcast({ type: 'settings', settings: store.settings })
    if (ticketAutoCloseDays !== days) board.autoClose(ticketAutoCloseDays)
    if (JSON.stringify(projects) !== before) {
      broadcast({ type: 'squads', squads: rereadSquads() })
      manager.relocate()
    }
    return store.settings
  })
}
