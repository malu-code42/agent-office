import { ipcMain } from 'electron'
import { parse, writingDraftArgsSchema, writingOriginalSchema, writingReviewArgsSchema, writingTokenSchema } from '../validate'
import type { IpcContext } from './context'

function vaultOf(ctx: IpcContext): string {
  const vault = ctx.store.settings.vaultPath
  if (!vault) throw new Error('Configure a pasta do vault em Ajustes antes de abrir Escrita.')
  return vault
}

/** Escrita owns only escrita.md in the selected vault; no renderer-supplied path is accepted. */
export function registerWritingIpc(ctx: IpcContext): void {
  ipcMain.handle('office:readWriting', async () => {
    const vault = vaultOf(ctx)
    try {
      const { snippets } = ctx.writing.read(vault)
      return {
        snippets: snippets.map((snippet) => ({
          id: snippet.id,
          title: snippet.title,
          versions: snippet.versions,
        })),
      }
    } catch {
      throw new Error('Não foi possível ler a biblioteca de escrita. Verifique escrita.md e tente novamente.')
    }
  })

  ipcMain.handle('office:createWritingOriginal', async (_event, raw: unknown) => {
    const input = parse(writingOriginalSchema, raw, 'Original inválido.')
    try {
      return ctx.writing.createOriginal(vaultOf(ctx), input)
    } catch (error) {
      if (error instanceof Error && /^(O título|O corpo)/.test(error.message)) throw error
      // Deliberately omit the cause: operating-system errors can expose the local vault path.
      // eslint-disable-next-line preserve-caught-error
      throw new Error('Não foi possível salvar o Original. Recarregue a biblioteca e tente novamente.')
    }
  })

  ipcMain.handle('office:prepareWritingReview', async (_event, ...args: unknown[]) => {
    const [snippetId, versionId, instruction] = parse(writingReviewArgsSchema, args, 'Pedido de revisão inválido.')
    try {
      const { token, preview } = ctx.writingAssistant.prepare(vaultOf(ctx), snippetId, versionId, instruction)
      return { token, preview }
    } catch (error) {
      if (error instanceof Error && /^(A instru|O trecho|A vers)/.test(error.message)) throw error
      // Deliberately omit the cause: operating-system errors can expose the local vault path.
      // eslint-disable-next-line preserve-caught-error
      throw new Error('Não foi possível preparar a revisão. Recarregue a biblioteca e tente novamente.')
    }
  })

  ipcMain.handle('office:sendWritingPreview', async (_event, raw: unknown) => {
    const token = parse(writingTokenSchema, raw, 'A prévia não é válida. Prepare a revisão novamente.')
    return ctx.writingAssistant.send(token)
  })

  ipcMain.handle('office:cancelWritingPreview', async (_event, raw: unknown) => {
    ctx.writingAssistant.cancel(parse(writingTokenSchema, raw, 'A prévia não é válida.'))
  })

  ipcMain.handle('office:saveWritingDraft', async (_event, ...args: unknown[]) => {
    const [draftToken, body] = parse(writingDraftArgsSchema, args, 'Rascunho inválido.')
    try {
      ctx.writingAssistant.saveDraft(draftToken, body)
    } catch (error) {
      if (error instanceof Error && /mudou desde que/.test(error.message)) throw error
      // Deliberately omit the cause: failures may contain draft text or a local path.
      // eslint-disable-next-line preserve-caught-error
      throw new Error('Não foi possível salvar a nova versão. Recarregue a biblioteca e tente novamente.')
    }
  })

  ipcMain.handle('office:discardWritingDraft', async (_event, raw: unknown) => {
    ctx.writingAssistant.discard(parse(writingTokenSchema, raw, 'O rascunho não é válido.'))
  })
}
