import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMediaPosters } from '../src/main/media-posters'
import { createMediaWriter } from '../src/main/media-write'
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
    mediaWriter: createMediaWriter({ newId: () => 'm12345678' }),
    win: () => null,
  } as unknown as IpcContext)
})

afterEach(() => {
  for (const channel of [
    'office:pickMediaPoster',
    'office:discardMediaPoster',
    'office:createMediaItem',
    'office:readMedia',
    'office:updateMediaItem',
    'office:readMediaPoster',
  ])
    ipcMain.removeHandler(channel)
  rmSync(vault, { recursive: true, force: true })
})

const create = (input: unknown, token?: string) => callHandler('office:createMediaItem', input, token) as Promise<string>
const posterPath = (markdown: string): string => markdown.match(/- Pôster: (.+)/)?.[1] ?? ''

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
    await create(draft, selected.token)
    const path = posterPath(readFileSync(join(vault, 'filmes.md'), 'utf8'))
    expect(path).toMatch(/^midias\/posters\/.+\.png$/)
    expect(readFileSync(join(vault, ...path.split('/')))).toEqual(PNG)
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

  it('lê o catálogo e atualiza cada tipo pela API tipada, sem tocar agenda, tarefas ou planning', async () => {
    const fixtures = [
      {
        kind: 'livro',
        title: 'Livro editado',
        status: 'em andamento',
        pagesRead: 12,
        totalPages: 120,
        agenda: { day: '2026-10-24', time: '10:00', title: 'Leitura' },
      },
      { kind: 'filme', title: 'Filme editado', status: 'concluído', agenda: null },
      { kind: 'jogo', title: 'Jogo editado', status: 'concluído', favorite: true, platinum: true, agenda: null },
    ] as const
    for (const input of fixtures) {
      const initial =
        input.kind === 'livro'
          ? { kind: input.kind, title: 'Livro antes', status: 'planejado', pagesRead: 0 }
          : input.kind === 'filme'
            ? { kind: input.kind, title: 'Filme antes', status: 'planejado' }
            : { kind: input.kind, title: 'Jogo antes', status: 'planejado', favorite: false, platinum: false }
      await create(initial)
      const items = (await callHandler('office:readMedia', input.kind)) as Array<{ id: string }>
      expect(items).toHaveLength(1)
      const id = items[0]!.id
      const update = { ...input, id, ...(input.kind === 'filme' ? { agenda: null } : {}) }
      await callHandler('office:updateMediaItem', update)
      const readback = (await callHandler('office:readMedia', input.kind)) as Array<{ title: string; status: string }>
      expect(readback[0]).toMatchObject({ title: input.title, status: input.status })
    }
    expect(readFileSync(join(vault, 'tarefas.md'), 'utf8')).toBe('tarefas intactas\n')
    expect(readFileSync(join(vault, 'agenda.md'), 'utf8')).toBe('agenda intacta\n')
    expect(readFileSync(join(vault, 'planning.json'), 'utf8')).toBe('planning intacto\n')
  })

  it('vincula e desvincula referência de agenda sem escrever na agenda', async () => {
    const reference = { day: '2026-10-24', time: '10:00', title: 'Cinema' }
    const id = await create({ kind: 'filme', title: 'Vínculo', status: 'planejado', agenda: reference })
    const linked = {
      kind: 'filme',
      id,
      title: 'Vínculo',
      status: 'planejado',
      agenda: reference,
    }
    await callHandler('office:updateMediaItem', linked)
    expect(((await callHandler('office:readMedia', 'filme')) as Array<{ agenda?: unknown }>)[0]?.agenda).toEqual(linked.agenda)
    await callHandler('office:updateMediaItem', { ...linked, agenda: null })
    expect(((await callHandler('office:readMedia', 'filme')) as Array<{ agenda?: unknown }>)[0]?.agenda).toBeUndefined()
    expect(readFileSync(join(vault, 'agenda.md'), 'utf8')).toBe('agenda intacta\n')
    expect(readFileSync(join(vault, 'tarefas.md'), 'utf8')).toBe('tarefas intactas\n')
    expect(readFileSync(join(vault, 'planning.json'), 'utf8')).toBe('planning intacto\n')
  })

  it('reverte só o pôster novo quando a escrita combinada do Markdown falha', async () => {
    let failWhenNewPosterIsReferenced = false
    let attemptedPath = ''
    const writer = createMediaWriter({
      newId: () => 'm87654321',
      writeText: (file, text) => {
        if (failWhenNewPosterIsReferenced && file === join(vault, 'filmes.md') && text.includes('Título novo')) {
          attemptedPath = posterPath(text)
          throw new Error('falha simulada')
        }
        writeFileSync(file, text)
      },
    })
    registerMediaIpc({
      store: { settings: { vaultPath: vault } },
      mediaPosters: posters,
      mediaWriter: writer,
      win: () => null,
    } as unknown as IpcContext)
    const id = await create({ kind: 'filme', title: 'Título antigo', status: 'planejado' }, posters.add(PNG, 'png').token)
    const oldMarkdown = readFileSync(join(vault, 'filmes.md'), 'utf8')
    const oldPath = posterPath(oldMarkdown)
    const oldPoster = readFileSync(join(vault, ...oldPath.split('/')))
    failWhenNewPosterIsReferenced = true

    await expect(
      callHandler(
        'office:updateMediaItem',
        { kind: 'filme', id, title: 'Título novo', status: 'concluído', agenda: null },
        posters.add(Buffer.from([0xff, 0xd8, 0xff]), 'jpg').token,
      ),
    ).rejects.toThrow('Não foi possível gravar filmes.md')

    expect(readFileSync(join(vault, 'filmes.md'), 'utf8')).toBe(oldMarkdown)
    expect(readFileSync(join(vault, ...oldPath.split('/')))).toEqual(oldPoster)
    expect(attemptedPath).toMatch(/^midias\/posters\/.+\.jpeg$/)
    expect(existsSync(join(vault, ...attemptedPath.split('/')))).toBe(false)
  })

  it('atualiza campos e pôster juntos e mantém o pôster anterior após sucesso', async () => {
    const markdownWrites: string[] = []
    const writer = createMediaWriter({
      newId: () => 'm87654321',
      writeText: (file, text) => {
        markdownWrites.push(text)
        writeFileSync(file, text)
      },
    })
    registerMediaIpc({
      store: { settings: { vaultPath: vault } },
      mediaPosters: posters,
      mediaWriter: writer,
      win: () => null,
    } as unknown as IpcContext)
    const id = await create({ kind: 'filme', title: 'Título antigo', status: 'planejado' }, posters.add(PNG, 'png').token)
    const oldPath = posterPath(readFileSync(join(vault, 'filmes.md'), 'utf8'))
    markdownWrites.length = 0

    await callHandler(
      'office:updateMediaItem',
      { kind: 'filme', id, title: 'Título novo', status: 'concluído', agenda: null },
      posters.add(Buffer.from([0xff, 0xd8, 0xff]), 'jpg').token,
    )

    const markdown = readFileSync(join(vault, 'filmes.md'), 'utf8')
    const newPath = posterPath(markdown)
    expect(markdown).toContain('## Título novo\n- ID: m87654321\n- Estado: concluído')
    expect(newPath).toMatch(/^midias\/posters\/.+\.jpeg$/)
    expect(markdownWrites).toHaveLength(1)
    expect(markdownWrites[0]).toContain(`- Pôster: ${newPath}`)
    expect(readFileSync(join(vault, ...newPath.split('/')))).toEqual(Buffer.from([0xff, 0xd8, 0xff]))
    expect(readFileSync(join(vault, ...oldPath.split('/')))).toEqual(PNG)
  })

  it('devolve pôster como data URL validada pelo ID e placeholder para caminho inacessível', async () => {
    const id = await create({ kind: 'filme', title: 'Pôster', status: 'planejado' }, posters.add(PNG, 'png').token)
    const result = (await callHandler('office:readMediaPoster', id)) as { dataUrl: string | null }
    expect(result.dataUrl).toBe(`data:image/png;base64,${PNG.toString('base64')}`)
    expect(result.dataUrl).not.toContain('file://')
    writeFileSync(join(vault, 'filmes.md'), `## Filme fora\n- ID: m87654321\n- Pôster: midias/posters/m87654321.png\n`)
    const inaccessible = (await callHandler('office:readMediaPoster', 'm87654321')) as { dataUrl: string | null; error: string }
    expect(inaccessible).toMatchObject({ dataUrl: null })
    expect(inaccessible.error).toMatch(/pôster/i)
  })

  it('recusa poster armazenado por symlink e devolve fallback localizado', async () => {
    const id = await create({ kind: 'filme', title: 'Link', status: 'planejado' })
    const dir = join(vault, 'midias', 'posters')
    mkdirSync(dir, { recursive: true })
    const target = join(vault, 'fora.png')
    writeFileSync(target, PNG)
    try {
      symlinkSync(target, join(dir, `${id}.png`), 'file')
    } catch {
      return
    }
    writeFileSync(join(vault, 'filmes.md'), `## Link\n- ID: ${id}\n- Estado: planejado\n- Pôster: midias/posters/${id}.png\n`)
    const result = (await callHandler('office:readMediaPoster', id)) as { dataUrl: string | null; error: string }
    expect(result.dataUrl).toBeNull()
    expect(result.error).toContain('Não foi possível exibir')
  })
})
