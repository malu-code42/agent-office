import { open as openFile } from 'node:fs/promises'
import { constants, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { extname, join, relative, resolve, isAbsolute } from 'node:path'
import { dialog, ipcMain } from 'electron'
import {
  parse,
  createMediaItemArgsSchema,
  mediaPosterTokenSchema,
  mediaUpdateArgsSchema,
  mediaReadArgsSchema,
  mediaPosterReadArgsSchema,
  pickMediaPosterArgsSchema,
  vaultPathSchema,
} from '../validate'
import { POSTER_MAX_BYTES, validatePosterImage } from '../media-write'
import { parseMedia, POSTER_DIR } from '@shared/media'
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
  const flags = constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW)
  const file = await (options.open ?? (async (path) => openFile(path, flags)))(source)
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
  const writer = ctx.mediaWriter
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
          { title: input.title, status: input.status, ...(input.agenda ? { agenda: input.agenda } : {}) },
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

  ipcMain.handle('office:readMedia', async (_event, ...args: unknown[]) => {
    const [kind] = parse(mediaReadArgsSchema, args, 'Tipo de mídia inválido.')
    const vault = requireVault(ctx.store.settings.vaultPath)
    return writer.read(vault, kind)
  })

  ipcMain.handle('office:updateMediaItem', async (_event, ...args: unknown[]) => {
    const [input, posterToken] = parse(mediaUpdateArgsSchema, args, 'Alteração de mídia inválida.')
    if (posterToken && input.kind !== 'filme') throw new Error('Pôster só pode ser anexado a um filme.')
    const vault = requireVault(ctx.store.settings.vaultPath)
    let poster: Buffer | undefined
    let extension: string | undefined
    if (posterToken) {
      const selected = ctx.mediaPosters.take(parse(mediaPosterTokenSchema, posterToken, 'Seleção de pôster inválida ou expirada.'))
      if (!selected) throw new Error('A seleção de pôster expirou. Escolha a imagem de novo.')
      poster = selected.bytes
      extension = selected.extension
    }
    try {
      const { id, kind, ...change } = input
      if (poster && extension) writer.updateFilmWithPoster(vault, kind, id, change, { bytes: poster, extension })
      else writer.update(vault, kind, id, change)
    } finally {
      poster?.fill(0)
    }
  })

  ipcMain.handle('office:readMediaPoster', async (_event, ...args: unknown[]) => {
    const [id] = parse(mediaPosterReadArgsSchema, args, 'Identificador de filme inválido.')
    try {
      const vault = requireVault(ctx.store.settings.vaultPath)
      const movie = parseMedia('filme', readFileSync(join(vault, 'filmes.md'), 'utf8')).items.find((item) => item.id === id)
      if (!movie?.posterPath || movie.posterError) return { dataUrl: null, error: movie?.posterError ?? 'Este filme ainda não tem pôster.' }
      const root = realpathSync(vault)
      const rel = movie.posterPath.replace(/\\/g, '/')
      if (!rel.startsWith(`${POSTER_DIR}/`) || rel.split('/').length !== 3) throw new Error('Caminho de pôster inválido.')
      const file = resolve(vault, ...rel.split('/'))
      const relativePath = relative(root, file)
      if (!relativePath || isAbsolute(relativePath) || relativePath.split(/[\\/]/)[0] === '..')
        throw new Error('Caminho de pôster fora do vault.')
      let current = resolve(vault)
      for (const part of rel.split('/')) {
        current = join(current, part)
        const stat = lstatSync(current)
        if (stat.isSymbolicLink()) throw new Error('Pôster com link simbólico recusado.')
        if (current !== file && !stat.isDirectory()) throw new Error('Pasta de pôster inválida.')
      }
      const bytes = await readPosterFile(file)
      const type = validatePosterImage(bytes, extname(file).slice(1))
      const mime = type === 'jpeg' ? 'image/jpeg' : `image/${type}`
      return { dataUrl: `data:${mime};base64,${bytes.toString('base64')}` }
    } catch {
      return { dataUrl: null, error: 'Não foi possível exibir este pôster. Ele pode estar ausente ou inválido.' }
    }
  })
}

function requireVault(configured: string | undefined): string {
  if (!configured) throw new Error('Configure a pasta do vault em Ajustes → Tarefas do Obsidian.')
  const vault = parse(vaultPathSchema, configured, 'O caminho do vault precisa ser uma pasta absoluta.')
  if (!vault || !statSync(vault).isDirectory()) throw new Error('A pasta do vault configurada não está disponível.')
  return vault
}
