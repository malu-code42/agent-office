import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { commitChanges, findOnPath, runBatch } from '../src/main/git'
import { changeButtons, editorMissingNote } from '../src/renderer/src/ui/result-rules'
import type { ResultChanges } from '@shared/types'

const itWin = it.skipIf(process.platform !== 'win32')

const made: string[] = []
afterAll(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })))

function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), `.ro-${prefix}`))
  made.push(d)
  return d
}

/** Runs `fn` with PATH narrowed to `dirs`, restoring afterwards. */
function withPath(dirs: string[], fn: () => void): void {
  const prev = process.env.PATH
  process.env.PATH = dirs.join(delimiter)
  try {
    fn()
  } finally {
    process.env.PATH = prev
  }
}

describe('regra de habilitação dos botões do cartão de mudanças (AO-34/01)', () => {
  const files = [{ path: 'src/a.ts', status: 'modified' as const }]

  it('sem mudanças, tudo pouco', () => {
    expect(changeButtons(null)).toEqual({ editor: false, discard: false, commit: false, pr: false })
    expect(changeButtons({ git: true, root: 'r', files: [] })).toEqual({ editor: false, discard: false, commit: false, pr: false })
  })

  it('resultado vivo com branch: os quatro botões disponíveis', () => {
    expect(changeButtons({ git: true, root: 'r', branch: 'agent/x', files })).toEqual({
      editor: true,
      discard: true,
      commit: true,
      pr: true,
    })
  })

  it('commitado: commit e descartar saem, PR continua (o branch está pronto pro push)', () => {
    expect(changeButtons({ git: true, root: 'r', branch: 'agent/x', files, committed: 'a1b2c3d' })).toEqual({
      editor: true,
      discard: false,
      commit: false,
      pr: true,
    })
  })

  it('descartado: nada além de abrir os arquivos', () => {
    expect(changeButtons({ git: true, root: 'r', branch: 'agent/x', files, discarded: true })).toEqual({
      editor: true,
      discard: false,
      commit: false,
      pr: false,
    })
  })

  it('pasta sem git: só abrir os arquivos', () => {
    expect(changeButtons({ git: false, root: 'r', files: [{ path: 'x.md', tool: 'Write' }] as ResultChanges['files'] })).toEqual({
      editor: true,
      discard: false,
      commit: false,
      pr: false,
    })
  })

  it('sem worktree (sem branch): sem PR', () => {
    expect(changeButtons({ git: true, root: 'r', files }).pr).toBe(false)
  })

  it('resultado truncado: impede commit e descarte para não ignorar mudanças omitidas', () => {
    expect(changeButtons({ git: true, root: 'r', branch: 'agent/x', files, truncated: true })).toEqual({
      editor: true,
      discard: false,
      commit: false,
      pr: true,
    })
  })
})

describe('aviso de editor ausente por plataforma (ticket 01)', () => {
  it('Mac fala Finder; Windows e Linux falam explorador de arquivos', () => {
    expect(editorMissingNote('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)')).toBe('Mostrei no Finder.')
    expect(editorMissingNote('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Mostrei a pasta no explorador de arquivos.')
    expect(editorMissingNote('Mozilla/5.0 (X11; Linux x86_64)')).toBe('Mostrei a pasta no explorador de arquivos.')
  })
})

describe('findOnPath no Windows procura .exe, .cmd e .bat (ticket 01)', () => {
  it('prefere .exe, depois .cmd e .bat, dentro do mesmo diretório', () => {
    const dir = tmp('fop')
    for (const f of ['ord.exe', 'ord.cmd', 'ord.bat', 'ord']) writeFileSync(join(dir, f), 'x')
    withPath([dir], () => {
      expect(findOnPath(['ord'])).toBe(join(dir, 'ord.exe'))
      for (const f of ['ord.exe']) rmSync(join(dir, f))
      expect(findOnPath(['ord'])).toBe(join(dir, 'ord.cmd'))
      for (const f of ['ord.cmd']) rmSync(join(dir, f))
      expect(findOnPath(['ord'])).toBe(join(dir, 'ord.bat'))
    })
  })

  it('achando gh-instalado-por-winget (gh.exe) — a causa antiga do "Abrir PR" morto', () => {
    const dir = tmp('fop-gh')
    writeFileSync(join(dir, 'gh.exe'), 'x')
    withPath([dir], () => {
      expect(findOnPath(['gh'])).toBe(join(dir, 'gh.exe'))
    })
  })

  it('a ordem dos diretórios do PATH manda entre tipos diferentes', () => {
    const d1 = tmp('fop-a')
    const d2 = tmp('fop-b')
    writeFileSync(join(d1, 'nome.cmd'), 'x')
    writeFileSync(join(d2, 'nome.exe'), 'x')
    withPath([d1, d2], () => {
      expect(findOnPath(['nome'])).toBe(join(d1, 'nome.cmd'))
    })
    withPath([d2, d1], () => {
      expect(findOnPath(['nome'])).toBe(join(d2, 'nome.exe'))
    })
  })

  it('nome que não existe em lado nenhum: null, sem estourar', () => {
    withPath([tmp('fop-vazio')], () => {
      expect(findOnPath(['catacumba-que-nunca-existe'])).toBeNull()
    })
  })

  it('no Mac/Linux, procura o nome cru', () => {
    if (process.platform === 'win32') return
    const dir = tmp('fop-cru')
    writeFileSync(join(dir, 'editorzinho'), 'x')
    withPath([dir], () => {
      expect(findOnPath(['editorzinho'])).toBe(join(dir, 'editorzinho'))
    })
  })
})

describe('runBatch lança .cmd no Windows sem spawn EINVAL (ticket 01)', () => {
  itWin('roda o batch com argumentos que têm espaço', async () => {
    const outside = tmp('rb-out') // caminho do batch sem espaço
    const base = tmp('rb-alvo') // alvo sem espaço
    const program = join(outside, 'dirzinho com espaço')
    mkdirSync(program, { recursive: true })
    const batch = join(program, 'lanca.cmd')
    writeFileSync(batch, '@echo off\r\necho got:%~1\r\nif exist "%~1" (echo existe) else (echo ausente)\r\n')
    const target = join(base, 'arquivo com espaço.txt')
    writeFileSync(target, 'conteudo')
    const out = await runBatch(batch, [target], base, 15_000)
    expect(out).toContain('existe')
    expect(existsSync(target)).toBe(true)
  })

  itWin('batch que falha vira erro (não fica em silêncio)', async () => {
    const outside = tmp('rb-fail')
    const batch = join(outside, 'falha.cmd')
    writeFileSync(batch, '@echo off\r\necho para o stderr 1>&2\r\nexit /b 3\r\n')
    await expect(runBatch(batch, [], outside, 15_000)).rejects.toThrow()
  })

  itWin('recusa metacaracteres de cmd.exe em argumentos, em vez de interpretá-los', async () => {
    const outside = tmp('rb-meta')
    const batch = join(outside, 'seguro.cmd')
    writeFileSync(batch, '@echo off\r\necho executou\r\n')
    await expect(runBatch(batch, ['arquivo&echo INJETADO.txt'], outside, 15_000)).rejects.toThrow(
      'Não é seguro passar esse caminho ou argumento para um launcher .cmd no Windows.',
    )
  })
})

describe('mensagens de erro do Commitar em português (ticket 01)', () => {
  const base: ResultChanges = { git: true, root: '', files: [{ path: 'a.ts', status: 'modified' }] }

  it('pasta sem git', async () => {
    await expect(commitChanges({ ...base, git: false, root: tmp('cc') }, 'm')).rejects.toThrow('Essa pasta não é um repositório git.')
  })

  it('mudanças demais', async () => {
    await expect(commitChanges({ ...base, truncated: true, total: 500 }, 'm')).rejects.toThrow(
      'São mudanças demais para commitar daqui. Use o terminal.',
    )
  })

  it('arquivos fora da raiz listados em vão', async () => {
    const root = tmp('cc-out')
    const outside = join(root, '..', 'fora-da-raiz.ts') // join normaliza o "..", sai da raiz
    await expect(commitChanges({ ...base, root, files: [{ path: outside, status: 'modified' }] }, 'm')).rejects.toThrow(
      'Não há arquivos para commitar.',
    )
  })
})
