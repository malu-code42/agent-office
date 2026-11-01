import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callHandler, dialog, ipcMain } from './mocks/electron'
import { registerWorktreesIpc } from '../src/main/ipc/worktrees'
import type { IpcContext } from '../src/main/ipc/context'
import { createWorktree } from '../src/main/git'
import { FORGOTTEN_AFTER_MS } from '../src/shared/worktrees'
import type { AgentSummary, ProjectFloor, WorktreeFloor } from '../src/shared/types'

// Bastidores → Worktrees over real throwaway repos in the temp folder; the native dialog is scripted.
const made: string[] = []
afterAll(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })))
const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1' }

function newRepo(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'ao-bs-')))
  made.push(dir)
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'teste@exemplo.com')
  git('config', 'user.name', 'Teste')
  git('config', 'commit.gpgsign', 'false')
  writeFileSync(join(dir, 'a.txt'), 'one\n')
  git('add', '.')
  git('commit', '-qm', 'base')
  return dir
}

let agents: AgentSummary[]
let projects: ProjectFloor[]
let answers: number[]
let shown: { message?: string; detail?: string; defaultId?: number }[]

beforeEach(() => {
  agents = []
  answers = []
  shown = []
  vi.spyOn(dialog, 'showMessageBox').mockImplementation((async (...args: unknown[]) => {
    shown.push(args.at(-1) as (typeof shown)[number])
    return { response: answers.shift() ?? 1 }
  }) as never)
  ipcMain.handlers.clear()
  registerWorktreesIpc({
    manager: { list: () => agents, agent: () => undefined },
    store: {
      settings: {
        get projects() {
          return projects
        },
      },
    },
    creation: { queues: () => [] },
    win: () => ({}),
    nameOf: () => 'Agente',
  } as unknown as IpcContext)
})
afterEach(() => vi.restoreAllMocks())

describe('Bastidores → Worktrees', { timeout: 60_000 }, () => {
  it('lista por andar e respeita o andar sem worktree', async () => {
    const repo = newRepo()
    projects = [{ id: 'p1', name: 'Loja', cwd: repo, worktrees: false }]
    const wt = (await createWorktree(repo, 'Ada', 'aaaaaaaa'))!
    agents = [{ id: 'ag-1', name: 'Ada', cwd: wt.path, worktree: wt } as AgentSummary]
    const floors = (await callHandler('office:listWorktrees')) as WorktreeFloor[]
    expect(floors).toHaveLength(1)
    expect(floors[0]).toMatchObject({ floorId: 'p1', name: 'Loja', worktrees: false })
    expect(floors[0].items[0]).toMatchObject({ agentId: 'ag-1', agentName: 'Ada', dirty: 0 })
    expect(floors[0].items[0]).not.toHaveProperty('state')
    // Someone works in it: no removal, not even with a yes.
    answers.push(0)
    await expect(callHandler('office:removeWorktreeAt', wt.root)).rejects.toThrow('ainda trabalha')
    expect(existsSync(wt.root)).toBe(true)
  })

  it('uma sessão de terminal dentro da cópia também conta como dona', async () => {
    const repo = newRepo()
    projects = [{ id: 'p1', name: 'Loja', cwd: repo }]
    const wt = (await createWorktree(repo, 'Bia', 'bbbbbbbb'))!
    agents = [{ id: 'term-1', name: 'Terminal', source: 'terminal', cwd: join(wt.root, 'src') } as AgentSummary]
    await expect(callHandler('office:removeWorktreeAt', wt.root)).rejects.toThrow('ainda trabalha')
  })

  it('cópia com mudança: cancelar mantém; só remove depois do sim, e Enter fica no Cancelar', async () => {
    const repo = newRepo()
    projects = [{ id: 'p1', name: 'Loja', cwd: repo }]
    const wt = (await createWorktree(repo, 'Carla', 'cccccccc'))!
    writeFileSync(join(wt.root, 'novo.txt'), 'trabalho\n')
    answers.push(1)
    expect(await callHandler('office:removeWorktreeAt', wt.root)).toBeNull()
    expect(existsSync(join(wt.root, 'novo.txt'))).toBe(true)
    expect(shown[0].defaultId).toBe(1)
    expect(shown[0].detail).toContain('mudanças não commitadas')
    answers.push(0)
    await callHandler('office:removeWorktreeAt', wt.root)
    expect(existsSync(wt.root)).toBe(false)
  })

  it('não remove pasta fora dos andares nem caminho inventado', async () => {
    const repo = newRepo()
    projects = []
    const wt = (await createWorktree(repo, 'Dora', 'dddddddd'))!
    await expect(callHandler('office:removeWorktreeAt', wt.root)).rejects.toThrow('nenhum andar')
    projects = [{ id: 'p1', name: 'Loja', cwd: repo }]
    await expect(callHandler('office:removeWorktreeAt', join(repo, 'src'))).rejects.toThrow()
    await expect(callHandler('office:removeWorktreeAt', join(repo, '.agent-office', 'worktrees', 'nao-existe'))).rejects.toThrow(
      'já não existe',
    )
    expect(existsSync(wt.root)).toBe(true)
  })

  it('limpar esquecidas leva só as antigas sem dono nem trabalho', async () => {
    const repo = newRepo()
    projects = [{ id: 'p1', name: 'Loja', cwd: repo }]
    const idle = (await createWorktree(repo, 'Eva', 'eeeeeeee'))!
    const dirty = (await createWorktree(repo, 'Fia', 'ffffffff'))!
    const busy = (await createWorktree(repo, 'Gal', '99999999'))!
    writeFileSync(join(dirty.root, 'x.txt'), 'x\n')
    agents = [{ id: 'ag-g', name: 'Gal', cwd: busy.path, worktree: busy } as AgentSummary]
    // Made just now: nothing is forgotten yet.
    expect(await callHandler('office:cleanWorktrees')).toContain('Nenhuma cópia para limpar')
    const now = Date.now() + FORGOTTEN_AFTER_MS + 60_000
    vi.spyOn(Date, 'now').mockReturnValue(now)
    answers.push(0)
    expect(await callHandler('office:cleanWorktrees')).toBe('Removi 1 cópia.')
    expect(shown.at(-1)?.detail).toContain(idle.branch)
    expect(existsSync(idle.root)).toBe(false)
    expect(existsSync(join(dirty.root, 'x.txt'))).toBe(true)
    expect(existsSync(busy.root)).toBe(true)
  })
})
