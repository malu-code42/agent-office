import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn(() => ({ [Symbol.asyncIterator]: async function* () {} }))
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query }))
vi.mock('../src/main/claude-path', () => ({ findClaude: () => '/not-invoked' }))
vi.mock('../src/main/git', () => ({ takeSnapshot: async () => null }))

const { Store } = await import('../src/main/store')
const { AgentManager } = await import('../src/main/agents')
const { findSquad, squadInfo } = await import('../src/main/squads')

describe('conta fixa do ciclo do squad', () => {
  beforeEach(() => {
    query.mockClear()
    app.setPath('userData', mkdtempSync(join(tmpdir(), 'ao-squad-account-')))
  })

  it('não alterna conta ao iniciar outro turno do mesmo orquestrador', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ao-squad-account-project-'))
    const dir = join(root, 'squads', 'produto')
    mkdirSync(join(dir, 'agents'), { recursive: true })
    mkdirSync(join(dir, 'pipeline'), { recursive: true })
    writeFileSync(join(dir, 'squad.yaml'), 'code: produto\nname: Produto\nagents:\n  - id: dev\n    role: implementer\n  - id: reviewer\n    role: reviewer\npipeline:\n  entry: pipeline/pipeline.yaml')
    writeFileSync(join(dir, 'agents/dev.agent.md'), 'Implementa.')
    writeFileSync(join(dir, 'agents/reviewer.agent.md'), 'Revisa.')
    writeFileSync(join(dir, 'pipeline/pipeline.yaml'), 'steps:\n  - id: implement\n    agent: dev\n  - id: review\n    agent: reviewer')

    const store = new Store()
    store.settings = { ...store.settings, projects: [{ id: 'p1', name: 'Projeto', cwd: root }] }
    const manager = new AgentManager(store)
    const primary = { id: 'fixed-account', name: 'Principal', provider: 'claude', color: '#123456' }
    const secondary = { id: 'other-account', name: 'Outra', provider: 'claude', color: '#654321' }
    manager.accounts = {
      pick: vi.fn(() => primary),
      get: vi.fn((id: string) => (id === primary.id ? primary : id === secondary.id ? secondary : undefined)),
    } as never

    const squad = squadInfo(findSquad(root, 'produto')!)
    const brain = { model: 'claude-haiku-5-5', accounts: [primary.id, secondary.id], permissionMode: 'default' as const }
    const agent = manager.runSquad(squad, 'primeiro ciclo', 'iniciar', brain)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(agent.account).toBe(primary.id)
    expect(() => manager.continueOn(agent.id, secondary.id)).toThrow(/fixado à conta Claude/)

    manager.runSquad(squad, 'continuar ciclo', 'retomar', brain)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(agent.account).toBe(primary.id)
    expect((manager.accounts as unknown as { pick: ReturnType<typeof vi.fn> }).pick).toHaveBeenCalledTimes(1)
    expect((manager.accounts as unknown as { get: ReturnType<typeof vi.fn> }).get).toHaveBeenCalledWith(primary.id)

    manager.shutdown()
    store.flush()
  })
})
