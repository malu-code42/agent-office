import { existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }))
vi.mock('../src/main/claude-path', () => ({ findClaude: () => '/not-invoked' }))

const { lookFromSeed } = await import('../src/shared/describe')
const { Store } = await import('../src/main/store')
const { AgentManager } = await import('../src/main/agents')

describe('retomada do squad após reabrir o Office', () => {
  let userData: string
  let projectRoot: string
  let transientWorktree: string

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'ao-squad-store-'))
    app.setPath('userData', userData)
    projectRoot = mkdtempSync(join(tmpdir(), 'ao-squad-project-'))
    transientWorktree = join(projectRoot, '.agent-office', 'worktrees', 'ticket-temp')
    mkdirSync(transientWorktree, { recursive: true })
  })

  it('reassocia o orquestrador ao root estável e dá erro recuperável sem recriar YAML ausente', () => {
    const firstStore = new Store()
    firstStore.settings = {
      ...firstStore.settings,
      projects: [{ id: 'p1', name: 'Projeto sintético', cwd: projectRoot }],
    }
    firstStore.agents = [
      {
        summary: {
          id: 'agent-1',
          name: 'Squad produto',
          source: 'office',
          cwd: transientWorktree,
          project: 'p1',
          role: 'orchestrator',
          squad: 'ticket-pr',
          permissionMode: 'default',
          status: 'working',
          activity: 'Executando pipeline',
          desk: 0,
          look: lookFromSeed('squad-fixture'),
          costUsd: 0,
          createdAt: Date.now(),
          sessionId: 'session-1',
          account: 'fixed-account',
        },
        log: [{ id: 'log-1', t: Date.now(), kind: 'assistant', text: 'Etapa salva' }],
      },
    ]
    firstStore.flush()

    const reopened = new Store()
    const manager = new AgentManager(reopened)
    expect(manager.list()[0]).toMatchObject({ cwd: projectRoot, project: 'p1', squad: 'ticket-pr', account: 'fixed-account', status: 'idle' })
    expect(manager.getLog('agent-1')).toMatchObject([{ text: 'Etapa salva' }])

    manager.sendMessage('agent-1', 'Retome o ciclo')
    expect(manager.pendingResults()[0]?.text).toContain(join(projectRoot, 'squads', 'ticket-pr', 'squad.yaml'))
    expect(manager.pendingResults()[0]?.text).toContain('Restaure ou corrija esse arquivo manualmente')
    expect(manager.pendingResults()[0]?.text).not.toContain(transientWorktree)
    expect(existsSync(join(projectRoot, 'squads', 'ticket-pr', 'squad.yaml'))).toBe(false)
  })
})
