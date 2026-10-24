import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMediaPosters } from '../src/main/media-posters'
import { registerMediaIpc } from '../src/main/ipc/media'
import type { IpcContext } from '../src/main/ipc/context'
import { callHandler, ipcMain } from './mocks/electron'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d])
const TOKEN = 'a'.repeat(43)
let vault: string
let posters: ReturnType<typeof createMediaPosters>

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), 'ao-media-ipc-'))
  writeFileSync(join(vault, 'tarefas.md'), 'tarefas intactas\n')
  writeFileSync(join(vault, 'agenda.md'), 'agenda intacta\n')
  writeFileSync(join(vault, 'planning.json'), 'planning intacto\n')
  posters = createMediaPosters({ newToken: () => TOKEN })
  registerMediaIpc({
    store: { settings: { vaultPath: vault } },
    mediaPosters: posters,
    win: () => null,
  } as unknown as IpcContext)
})

afterEach(() => {
  for (const channel of ['office:pickMediaPoster', 'office:discardMediaPoster', 'office:createMediaItem']) ipcMain.removeHandler(channel)
  rmSync(vault, { recursive: true, force: true })
})

const create = (input: unknown, token?: string) => callHandler('office:createMediaItem', input, token) as Promise<string>

describe('confirmação IPC de mídia', () => {
  it.each([
    [{ kind: 'livro', title: 'Livro IPC', status: 'planejado', pagesRead: 0 }, 'livros.md', 'Livro IPC'],
    [{ kind: 'filme', title: 'Filme IPC', status: 'planejado' }, 'filmes.md', 'Filme IPC'],
    [{ kind: 'jogo', title: 'Jogo IPC', status: 'planejado', favorite: false, platinum: false }, 'jogos.md', 'Jogo IPC'],
  ])('grava só o Markdown correspondente (%s)', async (input, file, title) => {
    await create(input)
    expect(readFileSync(join(vault, file), 'utf8')).toContain(title)
    expect(['livros.md', 'filmes.md', 'jogos.md'].filter((name) => existsSync(join(vault, name)))).toEqual([file])
    expect(readFileSync(join(vault, 'tarefas.md'), 'utf8')).toBe('tarefas intactas\n')
    expect(readFileSync(join(vault, 'agenda.md'), 'utf8')).toBe('agenda intacta\n')
    expect(readFileSync(join(vault, 'planning.json'), 'utf8')).toBe('planning intacto\n')
  })

  it('consome token no main uma vez e só cria o registro quando a confirmação chega', async () => {
    const selected = posters.add(PNG, 'png')
    expect(existsSync(join(vault, 'filmes.md'))).toBe(false)
    const draft = { kind: 'filme', title: 'Filme com pôster', status: 'planejado' }
    const id = await create(draft, selected.token)
    expect(readFileSync(join(vault, 'filmes.md'), 'utf8')).toContain(`midias/posters/${id}.png`)
    expect(readFileSync(join(vault, 'midias', 'posters', `${id}.png`))).toEqual(PNG)
    await expect(create(draft, selected.token)).rejects.toThrow('A seleção de pôster expirou')
  })

  it('recusa campos arbitrários e token de pôster em livro sem consumir token', async () => {
    const selected = posters.add(PNG, 'png')
    await expect(create({ kind: 'filme', title: 'X', status: 'planejado', posterPath: 'C:\\arbitrario.png' })).rejects.toThrow()
    await expect(create({ kind: 'livro', title: 'X', status: 'planejado', pagesRead: 0 }, selected.token)).rejects.toThrow(
      'Pôster só pode ser anexado a um filme',
    )
    expect(posters.pendingCount).toBe(1)
    expect(existsSync(join(vault, 'livros.md'))).toBe(false)
  })
})
