import { open as openFile } from 'node:fs/promises'
import { statSync } from 'node:fs'
import { extname } from 'node:path'
import { dialog, ipcMain } from 'electron'
import { parse, createMediaItemArgsSchema, mediaPosterTokenSchema, pickMediaPosterArgsSchema, vaultPathSchema } from '../validate'
import { createMediaWriter, POSTER_MAX_BYTES } from '../media-write'
import type { IpcContext } from './context'

const POSTER_TOO_LARGE = `O pôster passa de ${POSTER_MAX_BYTES / (1024 * 1024)} MiB. Escolha uma imagem menor.`

interface PosterFileHandle {
  stat(): Promise<{ size: number }>
  read(buffer: Buffer, offset: number, length: number, position: number): Promise<{ bytesRead: number }>
  close(): Promise<void>
}

interface PosterReadOptions {
  open?: (source: string) => Promise<PosterFileHandle>
  alloc?: (size: number) => Buffer
}

/** Reads no more than the shared poster limit plus one byte, checking the file size before allocating. */
export async function readPosterFile(source: string, options: PosterReadOptions = {}): Promise<Buffer> {
  const file = await (options.open ?? (async (path) => openFile(path, 'r')))(source)
  try {
    const { size } = await file.stat()
    if (size > POSTER_MAX_BYTES) throw new Error(POSTER_TOO_LARGE)

    const bytes = (options.alloc ?? Buffer.alloc)(POSTER_MAX_BYTES + 1)
    let total = 0
    while (total < bytes.length) {
      const { bytesRead } = await file.read(bytes, total, bytes.length - total, total)
      if (bytesRead === 0) break
      total += bytesRead
    }
    if (total > POSTER_MAX_BYTES) throw new Error(POSTER_TOO_LARGE)
    return bytes.subarray(0, total)
  } finally {
    await file.close()
  }
}

export function registerMediaIpc(ctx: IpcContext): void {
  const writer = createMediaWriter()
  ipcMain.handle('office:pickMediaPoster', async (_event, ...args: unknown[]) => {
    parse(pickMediaPosterArgsSchema, args, 'Não foi possível abrir o seletor de pôster.')
    const win = ctx.win()
    if (!win) throw new Error('Não foi possível abrir o seletor de pôster agora. Tente novamente.')
    let result
    try {
      result = await dialog.showOpenDialog(win, {
        title: 'Escolha um pôster',
        properties: ['openFile'],
        filters: [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
      })
    } catch {
      throw new Error('Não foi possível abrir o seletor de pôster. Tente novamente.')
    }
    if (result.canceled || !result.filePaths[0]) return null

    const source = result.filePaths[0]
    try {
      const bytes = await readPosterFile(source)
      return ctx.mediaPosters.add(bytes, extname(source).slice(1))
    } catch (err) {
      if (err instanceof Error && err.message === POSTER_TOO_LARGE) throw err
      throw new Error('Não foi possível ler o pôster escolhido. Verifique as permissões e tente novamente.', { cause: err })
    }
  })

  ipcMain.handle('office:discardMediaPoster', async (_event, token: unknown) => {
    const validToken = parse(mediaPosterTokenSchema, token, 'Seleção de pôster inválida ou expirada.')
    ctx.mediaPosters.discard(validToken)
  })

  ipcMain.handle('office:createMediaItem', async (_event, ...args: unknown[]) => {
    const [input, posterToken] = parse(createMediaItemArgsSchema, args, 'Rascunho de mídia inválido.')
    if (posterToken && input.kind !== 'filme') throw new Error('Pôster só pode ser anexado a um filme.')
    const configured = ctx.store.settings.vaultPath
    if (!configured) throw new Error('Configure a pasta do vault em Ajustes → Tarefas do Obsidian.')
    const vault = parse(vaultPathSchema, configured, 'O caminho do vault precisa ser uma pasta absoluta.')
    if (!vault || !statSync(vault).isDirectory()) throw new Error('A pasta do vault configurada não está disponível.')

    let poster: Buffer | undefined
    let extension: string | undefined
    if (posterToken) {
      const token = parse(mediaPosterTokenSchema, posterToken, 'Seleção de pôster inválida ou expirada.')
      const selected = ctx.mediaPosters.take(token)
      if (!selected) throw new Error('A seleção de pôster expirou. Escolha a imagem de novo.')
      poster = selected.bytes
      extension = selected.extension
    }

    try {
      writer.read(vault, input.kind)
      if (input.kind === 'filme') {
        const id = writer.createMovieWithPoster(
          vault,
          { title: input.title, status: input.status },
          poster && extension ? { bytes: poster, extension } : undefined,
        )
        return id
      }
      const { kind, ...draft } = input
      return writer.create(vault, kind, draft)
    } finally {
      poster?.fill(0)
    }
  })
}
