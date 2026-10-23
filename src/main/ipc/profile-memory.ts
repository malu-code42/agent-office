import { ipcMain } from 'electron'
import type { IpcContext } from './context'
import { parse, parseProfileMemoryText, profileChoiceSchema } from '../validate'

/**
 * The memory of the profiles (AO-43): one short summary per profile, written by the
 * person, that Luna may read. Every argument is validated here before it reaches the
 * store, and nothing else (no prompt, no transcript) ever passes through.
 */
export function registerProfileMemoryIpc(ctx: IpcContext): void {
  ipcMain.handle('office:profileMemoryState', () => ctx.profileMemory.all())

  ipcMain.handle('office:profileMemoryRead', (_e, profileId: unknown) => {
    return ctx.profileMemory.view(parse(profileChoiceSchema, profileId, 'Esse perfil não existe.'))
  })

  ipcMain.handle('office:profileMemoryEdit', (_e, profileId: unknown, text: unknown) => {
    const id = parse(profileChoiceSchema, profileId, 'Esse perfil não existe.')
    return ctx.profileMemory.set(id, parseProfileMemoryText(text))
  })

  ipcMain.handle('office:profileMemoryDelete', (_e, profileId: unknown) => {
    ctx.profileMemory.remove(parse(profileChoiceSchema, profileId, 'Esse perfil não existe.'))
  })
}
