import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { AgentSummary } from '../src/shared/types'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: () => ({ [Symbol.asyncIterator]: async function* () {}, close: () => undefined, interrupt: async () => undefined }),
}))
vi.mock('../src/main/claude-path', () => ({ findClaude: () => '/synthetic/claude' }))
vi.mock('../src/main/git', () => ({ createWorktree: async () => null, takeSnapshot: async () => null, changesSince: async () => null }))

const summary = (id: string): AgentSummary => ({
  id,
  name: id,
  source: 'office',
  cwd: 'C:/synthetic',
  permissionMode: 'default',
  status: 'idle',
  activity: 'Aguardando instruções',
  desk: 0,
  look: { skin: '', hair: '', hairStyle: 0, shirt: '', pants: '', shoes: '' },
  costUsd: 0,
  createdAt: 1,
})

describe('cap central de hires e summons (AO-42)', () => {
  it('serializa simultâneos hire/summon antes do await e só deixa um quinto temporário', async () => {
    app.setPath('userData', mkdtempSync(join(tmpdir(), 'ao-cap-manager-')))
    const { Store } = await import('../src/main/store')
    const { AgentManager } = await import('../src/main/agents')
    const store = new Store()
    store.agents = Array.from({ length: 4 }, (_, i) => ({ summary: summary(`regular-${i}`), log: [] }))
    const manager = new AgentManager(store)
    const outcomes = await Promise.allSettled([
      manager.hire({ name: 'quinto', cwd: 'C:/synthetic', task: 'tarefa sintética', permissionMode: 'default', worktree: false }),
      manager.summon('C:/synthetic', { permissionMode: 'default' }, false),
    ])
    expect(outcomes.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((x) => x.status === 'rejected')).toHaveLength(1)
    expect(manager.list()).toHaveLength(5)
    expect(manager.list().filter((agent) => agent.temporary)).toHaveLength(1)
    manager.shutdown()
    store.flush()
  })
})
