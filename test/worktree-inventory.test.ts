import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  createWorktree,
  folderSize,
  isForgotten,
  isSafeToRemove,
  listRepoWorktrees,
  removeLooseFolder,
  WORKTREES_DIR,
} from '../src/main/git'
import { cleanProjects } from '../src/main/validate'
import { FORGOTTEN_AFTER_MS, hasWork, sizeText, worktreeStatus } from '../src/shared/worktrees'
import type { WorktreeEntry } from '../src/shared/types'

// Throwaway repos in the temp folder, never this repo.
const made: string[] = []
afterAll(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })))

const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1' }
function newRepo(): { dir: string; git: (...args: string[]) => string } {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'ao-inv-')))
  made.push(dir)
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'teste@exemplo.com')
  git('config', 'user.name', 'Teste')
  git('config', 'commit.gpgsign', 'false')
  writeFileSync(join(dir, 'a.txt'), 'one\n')
  git('add', '.')
  git('commit', '-qm', 'base')
  return { dir, git }
}
const commitIn = (cwd: string, file: string, msg: string) => {
  writeFileSync(join(cwd, file), `${msg}\n`)
  execFileSync('git', ['add', '.'], { cwd, env })
  execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', 'commit', '-qm', msg], { cwd, env })
}

describe('inventário de worktrees', { timeout: 60_000 }, () => {
  it('separa a cópia limpa, a com mudança, a com commit só dela, a feita à mão e a pasta solta', async () => {
    const { dir, git } = newRepo()
    const clean = (await createWorktree(dir, 'Ada', 'aaaaaaaa'))!
    const dirty = (await createWorktree(dir, 'Barbara', 'bbbbbbbb'))!
    const committed = (await createWorktree(dir, 'Dennis', 'cccccccc'))!
    const merged = (await createWorktree(dir, 'Grace', 'dddddddd'))!
    writeFileSync(join(dirty.root, 'novo.txt'), 'x\n')
    commitIn(committed.root, 'b.txt', 'só dela')
    // A commit that is also on another branch: nothing is lost if the branch goes.
    commitIn(merged.root, 'c.txt', 'mergeado')
    git('branch', 'copia-de-grace', merged.branch)
    // Someone's own worktree in the same folder, on a branch the office never makes.
    const handmade = join(dir, WORKTREES_DIR, 'feita-a-mao')
    git('worktree', 'add', '-q', '-b', 'fix/meu', handmade)
    writeFileSync(join(handmade, 'meu.txt'), 'trabalho\n')
    const loose = join(dir, WORKTREES_DIR, 'esquecida')
    mkdirSync(loose)
    writeFileSync(join(loose, 'lixo.bin'), 'x'.repeat(4096))

    const list = await listRepoWorktrees(dir)
    const by = (root: string) => list.find((w) => w.root === root)!
    expect(list).toHaveLength(6)
    // Paths come back as join() makes them (C:\x on Windows, never git's C:/x): nothing looks broken.
    expect(by(clean.root)).toMatchObject({ dirty: 0, unique: 0, ahead: 0 })
    expect(by(clean.root).broken).toBeFalsy()
    expect(by(dirty.root).dirty).toBe(1)
    expect(by(committed.root)).toMatchObject({ unique: 1, ahead: 1 })
    expect(by(merged.root)).toMatchObject({ unique: 0, ahead: 1 })
    expect(by(handmade)).toMatchObject({ foreign: true, branch: 'fix/meu' })
    expect(by(loose)).toMatchObject({ broken: true, exists: true })

    expect(isSafeToRemove(by(clean.root))).toBe(true)
    expect(isSafeToRemove(by(merged.root))).toBe(true)
    expect(isSafeToRemove(by(dirty.root))).toBe(false)
    expect(isSafeToRemove(by(committed.root))).toBe(false)
    expect(isSafeToRemove(by(handmade))).toBe(false)
    expect(isSafeToRemove(by(loose))).toBe(false)
    expect(isSafeToRemove({ ...by(clean.root), agentId: 'x' })).toBe(false)
    // A copy the listing could not read is never safe.
    expect(isSafeToRemove({ ...by(clean.root), state: undefined })).toBe(false)
    // Made just now: safe, but not "esquecida" yet.
    expect(isForgotten(by(clean.root))).toBe(false)
    expect(isForgotten(by(clean.root), Date.now() + FORGOTTEN_AFTER_MS + 1000)).toBe(true)

    expect(await folderSize(loose)).toBeGreaterThanOrEqual(4096)
    // A worktree git still knows is never deleted as a loose folder.
    await expect(removeLooseFolder(dir, handmade)).rejects.toThrow('não está solta')
    await expect(removeLooseFolder(dir, clean.root)).rejects.toThrow('não está solta')
    expect(existsSync(join(handmade, 'meu.txt'))).toBe(true)
    await removeLooseFolder(dir, loose)
    expect(existsSync(loose)).toBe(false)
  })

  it('não apaga pasta fora de .agent-office/worktrees', async () => {
    const { dir } = newRepo()
    mkdirSync(join(dir, WORKTREES_DIR), { recursive: true })
    await expect(removeLooseFolder(dir, join(dir, 'src'))).rejects.toThrow()
    await expect(removeLooseFolder(dir, join(dir, WORKTREES_DIR, 'a', 'b'))).rejects.toThrow()
    await expect(removeLooseFolder(dir, join(dir, WORKTREES_DIR, '..', '..'))).rejects.toThrow()
    expect(existsSync(join(dir, 'a.txt'))).toBe(true)
    expect(await listRepoWorktrees(dir)).toEqual([])
  })

  it('o andar guarda "sem worktree" e esquece quando volta a ligar', () => {
    const { dir } = newRepo()
    const off = cleanProjects([{ id: 'p1', name: 'X', cwd: dir, worktrees: false }], [])
    expect(off[0].worktrees).toBe(false)
    const on = cleanProjects([{ id: 'p1', name: 'X', cwd: dir }], off)
    expect(on[0]).not.toHaveProperty('worktrees')
  })
})

describe('linha de cada cópia', () => {
  const base: WorktreeEntry = {
    root: '/r/.agent-office/worktrees/x',
    repo: '/r',
    branch: 'agent/x',
    dirty: 0,
    ignored: 0,
    ahead: 0,
    unique: 0,
    exists: true,
  }
  it('diz o que se perde e o tom', () => {
    expect(worktreeStatus(base)).toMatchObject({ tone: 'idle' })
    expect(worktreeStatus({ ...base, dirty: 2, unique: 1 })).toEqual({
      text: 'sem agente · 2 mudanças sem commit · 1 commit não enviado',
      tone: 'warn',
    })
    expect(worktreeStatus({ ...base, agentId: 'a', agentName: 'Ada' })).toEqual({ text: 'Ada trabalha aqui', tone: 'ok' })
    expect(worktreeStatus({ ...base, broken: true }).tone).toBe('fail')
    expect(hasWork({ ...base, unique: 1 })).toBe(true)
    expect(hasWork({ ...base, broken: true, dirty: 3 })).toBe(false)
    expect(sizeText(undefined)).toBe('—')
    expect(sizeText(5 * 1024 ** 2)).toBe('5 MB')
    expect(sizeText(1.5 * 1024 ** 3)).toBe('1,5 GB')
  })
})
