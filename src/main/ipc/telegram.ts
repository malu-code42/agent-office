import { ipcMain } from 'electron'
import { z } from 'zod'
import { parse } from '../validate'
import type { IpcContext } from './context'

// AO-84: ajustes do Telegram. O token entra por aqui, vai direto ao armazenamento criptografado e NUNCA volta:
// as respostas são sempre a TelegramView (configurado: sim/não). Nada daqui é registrado em log.

const saveSchema = z.object({
  token: z.string().max(200).optional(),
  chatId: z.string().max(40),
  enabled: z.boolean(),
})

export function registerTelegramIpc(ctx: Pick<IpcContext, 'telegram'>): void {
  ipcMain.handle('office:telegramState', () => ctx.telegram.view())
  ipcMain.handle('office:telegramSave', (_e, raw: unknown) => ctx.telegram.save(parse(saveSchema, raw, 'Dados do Telegram inválidos.')))
}
