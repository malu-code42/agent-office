import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// AO-58: o leitor `pullRequestState` com o `gh` simulado (só a regra reconcileMergedPRs tinha teste).
const run = vi.hoisted(() => ({
  gh: vi.fn<(file: string, args: string[]) => Promise<string>>(),
  remote: 'https://github.com/org/repo.git',
}))
vi.mock('../src/main/git/run', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/main/git/run')>()),
  git: vi.fn(async (_cwd: string, args: string[]) => (args[0] === 'remote' && args[1] === 'get-url' ? `${run.remote}\n` : 'origin\n')),
  run: vi.fn(async (file: string, args: string[]) => run.gh(file, args)),
  safeGitEnv: vi.fn(async () => ({})),
}))

const { pullRequestState } = await import('../src/main/git/publish')

const URL_OK = 'https://github.com/org/repo/pull/12'
const binDir = mkdtempSync(join(tmpdir(), 'ao58-bin-'))
const emptyDir = mkdtempSync(join(tmpdir(), 'ao58-empty-'))
writeFileSync(join(binDir, 'gh'), '')
writeFileSync(join(binDir, 'gh.exe'), '')
const originalPath = process.env.PATH
afterAll(() => {
  rmSync(binDir, { recursive: true, force: true })
  rmSync(emptyDir, { recursive: true, force: true })
})

beforeEach(() => {
  process.env.PATH = binDir
  run.remote = 'https://github.com/org/repo.git'
  run.gh.mockReset()
})
afterEach(() => {
  process.env.PATH = originalPath
})

describe('pullRequestState (AO-58)', () => {
  it.each(['OPEN', 'MERGED', 'CLOSED'] as const)('devolve %s quando o gh diz %s', async (state) => {
    run.gh.mockResolvedValue(JSON.stringify({ state }))
    expect(await pullRequestState('C:/repo', URL_OK)).toBe(state)
    expect(run.gh).toHaveBeenCalledTimes(1)
    expect(run.gh.mock.calls[0]![1]).toEqual(['pr', 'view', URL_OK, '--json=state'])
  })

  it('saída que não é JSON ou estado desconhecido vira null (nada muda)', async () => {
    run.gh.mockResolvedValue('isto não é json')
    expect(await pullRequestState('C:/repo', URL_OK)).toBeNull()
    run.gh.mockResolvedValue(JSON.stringify({ state: 'DRAFT' }))
    expect(await pullRequestState('C:/repo', URL_OK)).toBeNull()
    run.gh.mockResolvedValue(JSON.stringify({}))
    expect(await pullRequestState('C:/repo', URL_OK)).toBeNull()
    run.gh.mockResolvedValue('null')
    expect(await pullRequestState('C:/repo', URL_OK)).toBeNull()
  })

  it('PR de outro repositório ou host não chama o gh', async () => {
    expect(await pullRequestState('C:/repo', 'https://github.com/outro/repo/pull/1')).toBeNull()
    expect(await pullRequestState('C:/repo', 'https://example.com/org/repo/pull/1')).toBeNull()
    expect(await pullRequestState('C:/repo', 'não é url')).toBeNull()
    expect(run.gh).not.toHaveBeenCalled()
  })

  it('sem gh no PATH devolve null sem tentar rodar', async () => {
    process.env.PATH = emptyDir
    expect(await pullRequestState('C:/repo', URL_OK)).toBeNull()
    expect(run.gh).not.toHaveBeenCalled()
  })

  it('falha do gh (sem rede, sem login) é repassada para quem chama decidir', async () => {
    run.gh.mockRejectedValue(new Error('sem rede'))
    await expect(pullRequestState('C:/repo', URL_OK)).rejects.toThrow('sem rede')
  })
})
