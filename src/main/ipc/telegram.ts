import { app, dialog, ipcMain, safeStorage } from 'electron'
import { TelegramService } from '../telegram'
import { parse, telegramNoArgsSchema } from '../validate'
import type { IpcContext } from './context'

/** Local Telegram link and long polling. No credential or conversation archive crosses into settings JSON. */
export function registerTelegramIpc(ctx: IpcContext): void {
  const telegram = new TelegramService({
    dataDirectory: ctx.store.dataDirectory,
    vaultPath: () => ctx.store.settings.vaultPath,
    safeStorage,
    onMessage: (message) => ctx.broadcast({ type: 'telegram:message', ...message }),
    onExpired: (message) => ctx.broadcast({ type: 'telegram:expired', ...message }),
    onAudio: (audio) => ctx.onTelegramAudio?.(audio) ?? 'pending',
    onAudioError: (notice) => ctx.broadcast({ type: 'telegram:audio-error', ...notice }),
  })
  app.once('browser-window-created', (_event, window) => {
    if (window.webContents.isLoading()) window.webContents.once('did-finish-load', () => telegram.start())
    else telegram.start()
  })
  app.on('before-quit', () => telegram.stop())

  ipcMain.handle('office:telegramStatus', (_e, ...args: unknown[]) => {
    parse(telegramNoArgsSchema, args, 'Consulta do Telegram inválida.')
    return telegram.status()
  })
  ipcMain.handle('office:linkTelegram', async (_e, ...args: unknown[]) => {
    parse(telegramNoArgsSchema, args, 'Vinculação do Telegram inválida.')
    const options = {
      title: 'Importar arquivo de credenciais do Telegram',
      properties: ['openFile' as const],
      filters: [{ name: 'Credenciais JSON', extensions: ['json'] }],
    }
    const win = ctx.win()
    const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (picked.canceled || !picked.filePaths[0]) return null
    await telegram.linkFromFile(picked.filePaths[0])
    telegram.start()
    return telegram.status()
  })
  ipcMain.handle('office:unlinkTelegram', async (_e, ...args: unknown[]) => {
    parse(telegramNoArgsSchema, args, 'Desvinculação do Telegram inválida.')
    if (!telegram.status().linked) return false
    const options = {
      type: 'warning' as const,
      buttons: ['Desvincular', 'Cancelar'],
      defaultId: 1,
      cancelId: 1,
      message: 'Desvincular a conta do Telegram?',
      detail: 'O long polling será interrompido e a credencial criptografada local será removida. Nenhuma mensagem será enviada.',
    }
    const win = ctx.win()
    const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
    if (response !== 0) return false
    telegram.unlink()
    return true
  })
}
