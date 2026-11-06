import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emiAgentId } from '../src/shared/emi'
import type { Account } from '../src/shared/types'

// AO-94: trocar a conta do andar nos ajustes vale para o próximo ciclo de squad, ticket e conversa da Emi.
const sdk = vi.hoisted(() => ({ calls: [] as Array<{ options: Record<string, unknown> }> }))
vi.mock('@anthropic-ai/claude-agent-sdk', async (original) => ({
  ...(await original<object>()),
  query: (args: { options: Record<string, unknown> }) => {
    sdk.calls.push(args)
    return { [Symbol.asyncIterator]: async function* () {}, close: () => undefined, interrupt: async () => undefined }
  },
}))
vi.mock('../src/main/claude-path', () => ({ findClaude: () => '/synthetic/claude' }))
vi.mock('../src/main/git', () => ({ createWorktree: async () => null, takeSnapshot: async () => null, changesSince: async () => null }))
// Sem tocar em ~/.claude: o env devolve só a conta escolhida.
vi.mock('../src/main/accounts', async (original) => ({
  ...(await original<object>()),
  accountEnv: (account?: Account) => ({ CLAUDE_CONFIG_DIR: account?.id ?? 'main' }),
}))

const { Store } = await import('../src/main/store')
const { AgentManager } = await import('../src/main/agents')
const { Accounts } = await import('../src/main/accounts')
const { findSquad, squadInfo } = await import('../src/main/squads')

const acc = (id: string): Account => ({ id, name: id, provider: 'claude', configDir: `/synthetic/.claude-${id}`, color: '#fff' })
const used = () => sdk.calls.at(-1)!.options.env as { CLAUDE_CONFIG_DIR: string }

function squadRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'ao-floor-account-'))
  const dir = join(root, 'squads', 'produto')
  mkdirSync(join(dir, 'agents'), { recursive: true })
  mkdirSync(join(dir, 'pipeline'), { recursive: true })
  writeFileSync(
    join(dir, 'squad.yaml'),
    'code: produto\nname: Produto\nagents:\n  - id: dev\n    role: implementer\n  - id: reviewer\n    role: reviewer\npipeline:\n  entry: pipeline/pipeline.yaml',
  )
  writeFileSync(join(dir, 'agents/dev.agent.md'), 'Implementa.')
  writeFileSync(join(dir, 'agents/reviewer.agent.md'), 'Revisa.')
  writeFileSync(join(dir, 'pipeline/pipeline.yaml'), 'steps:\n  - id: implement\n    agent: dev\n  - id: review\n    agent: reviewer')
  return root
}

function office() {
  app.setPath('userData', mkdtempSync(join(tmpdir(), 'ao-floor-account-data-')))
  const root = squadRoot()
  const store = new Store()
  store.settings = {
    ...store.settings,
    accounts: [...store.settings.accounts, acc('pex'), acc('malu')],
    projects: [{ id: 'p1', name: 'Andar', cwd: root, accounts: ['pex'] }],
  }
  const manager = new AgentManager(store)
  manager.claudeHome = mkdtempSync(join(tmpdir(), 'ao-floor-account-claude-'))
  manager.accounts = new Accounts(
    () => store.settings,
    () => [],
  )
  // O mesmo efeito do handler office:setAccountPool para um andar.
  const chooseFloorAccount = (id: string) => {
    store.settings = { ...store.settings, projects: store.settings.projects.map((p) => ({ ...p, accounts: [id] })) }
  }
  return { root, store, manager, chooseFloorAccount }
}

describe('troca da conta do andar nos ajustes', () => {
  beforeEach(() => {
    sdk.calls.length = 0
  })

  it('o próximo ciclo de squad usa a conta nova; o ciclo em andamento fica na antiga', async () => {
    const { root, store, manager, chooseFloorAccount } = office()
    const squad = squadInfo(findSquad(root, 'produto')!)
    const brain = { permissionMode: 'default' as const }
    const agent = manager.runSquad(squad, 'ciclo 1', 'ciclo 1', brain)
    await vi.waitFor(() => expect(sdk.calls).toHaveLength(1))
    expect(used().CLAUDE_CONFIG_DIR).toBe('pex')

    chooseFloorAccount('malu')
    // Mensagem dentro do mesmo ciclo: a conta continua fixa.
    manager.sendMessage(agent.id, 'continue')
    await vi.waitFor(() => expect(sdk.calls).toHaveLength(2))
    expect(used().CLAUDE_CONFIG_DIR).toBe('pex')

    manager.runSquad(squad, 'ciclo 2', 'ciclo 2', brain)
    await vi.waitFor(() => expect(sdk.calls).toHaveLength(3))
    expect(used().CLAUDE_CONFIG_DIR).toBe('malu')
    expect(agent.account).toBe('malu')

    manager.shutdown()
    store.flush()
  })

  it('o próximo ciclo de ticket (agente contratado) usa a conta nova', async () => {
    const { root, store, manager, chooseFloorAccount } = office()
    const hire = (task: string) => manager.hire({ name: '', cwd: root, task, worktree: false, engine: 'claude', permissionMode: 'default' })
    await hire('AO-1')
    await vi.waitFor(() => expect(sdk.calls).toHaveLength(1))
    expect(used().CLAUDE_CONFIG_DIR).toBe('pex')
    chooseFloorAccount('malu')
    await hire('AO-2')
    await vi.waitFor(() => expect(sdk.calls).toHaveLength(2))
    expect(used().CLAUDE_CONFIG_DIR).toBe('malu')
    manager.shutdown()
    store.flush()
  })

  it('a Emi do andar usa a conta nova na próxima conversa', async () => {
    const { store, manager, chooseFloorAccount } = office()
    await manager.sendMessage(emiAgentId('p1'), 'oi')
    await vi.waitFor(() => expect(sdk.calls).toHaveLength(1))
    expect(used().CLAUDE_CONFIG_DIR).toBe('pex')
    chooseFloorAccount('malu')
    await manager.sendMessage(emiAgentId('p1'), 'e agora?')
    await vi.waitFor(() => expect(sdk.calls).toHaveLength(2))
    expect(used().CLAUDE_CONFIG_DIR).toBe('malu')
    manager.shutdown()
    store.flush()
  })
})
