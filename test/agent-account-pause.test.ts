import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentSummary, LogEntry } from '../src/shared/types'

const queries = vi.fn(() => ({ [Symbol.asyncIterator]: async function* () {}, close: () => undefined, interrupt: async () => undefined }))
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: (...args: unknown[]) => queries(...(args as [])) }))
vi.mock('../src/main/claude-path', () => ({ findClaude: () => '/synthetic/claude' }))
vi.mock('../src/main/git', () => ({ takeSnapshot: async () => null, changesSince: async () => null, createWorktree: async () => null }))

const summary = (over: Partial<AgentSummary> = {}): AgentSummary => ({
  id: 'paused-task',
  name: 'Agente',
  source: 'office',
  cwd: 'C:/synthetic',
  account: 'fixed-account',
  quotaPaused: { accountId: 'fixed-account', resetsAt: Date.now() + 1000 },
  permissionMode: 'default',
  status: 'error',
  activity: 'Parou no limite',
  desk: 0,
  look: { skin: '', hair: '', hairStyle: 0, shirt: '', pants: '', shoes: '' },
  costUsd: 0,
  createdAt: 1,
  sessionId: 'synthetic-session',
  ...over,
})

const history: LogEntry[] = [
  {
    id: 'limit-log',
    t: 1,
    kind: 'system',
    text: 'Conta fixa atingiu o limite.',
    limit: { accountId: 'fixed-account', resetsAt: Date.now() + 1000 },
  },
]

async function setup() {
  app.setPath('userData', mkdtempSync(join(tmpdir(), 'ao-account-pause-')))
  const { Store } = await import('../src/main/store')
  const { AgentManager } = await import('../src/main/agents')
  const store = new Store()
  const fixed = { id: 'fixed-account', name: 'Fixa', provider: 'claude', color: '#123456' }
  const other = { id: 'other-account', name: 'Outra', provider: 'claude', color: '#654321' }
  const accountUse = { out: true }
  const accounts = {
    get: vi.fn((id: string) => (id === fixed.id ? fixed : id === other.id ? other : undefined)),
    // If the paused state leaks to the ordinary account selector, it would move to `other`.
    pick: vi.fn(() => other),
    out: vi.fn(() => accountUse.out),
    name: (id: string) => (id === fixed.id ? fixed.name : other.name),
    statuses: () => [{ id: fixed.id, loggedIn: true, limitedUntil: Date.now() + 1000 }],
    limitHit: vi.fn(),
  }
  store.agents = [{ summary: summary(), log: history }]
  store.results = [
    {
      id: 'quota-result',
      agentId: 'paused-task',
      text: 'Quota atingida; tarefa pausada.',
      isError: true,
      costUsd: 0,
      durationMs: 1,
      turns: 1,
      createdAt: 2,
      limit: { accountId: fixed.id, resetsAt: Date.now() + 1000 },
    },
  ]
  const manager = new AgentManager(store)
  manager.accounts = accounts as never
  return { manager, store, fixed, other, accountUse, accounts }
}

afterEach(() => vi.useRealTimers())

describe('pausa por quota com conta fixa (AO-42)', () => {
  it('recusa retomar uma conversa em outra conta', async () => {
    const { manager, store, other, accounts } = await setup()
    expect(() => manager.continueOn('paused-task', other.id)).toThrow(/conta fixa/)
    expect(() => manager.sendMessage('paused-task', 'try a different account')).toThrow(/pausada pela cota/)
    expect(() => manager.compact('paused-task')).toThrow(/pausada ou encerrada pela cota/)
    expect(manager.agent('paused-task')?.account).toBe('fixed-account')
    expect(manager.pendingResults()).toHaveLength(1)
    expect(accounts.pick).not.toHaveBeenCalled()
    expect(queries).not.toHaveBeenCalled()
    manager.shutdown()
    store.flush()
  })

  it('só permite outra conta depois de receber e encerrar a pausa, e de limpar para uma sessão nova', async () => {
    queries.mockClear()
    const { manager, store, other, accounts } = await setup()
    expect(() => manager.clearContext('paused-task')).toThrow(/Leia e encerre o resultado/)
    manager.ackResult('quota-result')
    manager.clearContext('paused-task')
    expect(manager.agent('paused-task')?.quotaPaused).toBeUndefined()
    manager.sendMessage('paused-task', 'new synthetic task')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(manager.agent('paused-task')?.account).toBe(other.id)
    expect(accounts.pick).toHaveBeenCalled()
    expect(queries).toHaveBeenCalled()
    manager.shutdown()
    store.flush()
  })

  it('a decisão de esperar retoma automaticamente somente quando a mesma conta abre espaço', async () => {
    vi.useFakeTimers()
    queries.mockClear()
    const { manager, store, fixed, accountUse, accounts } = await setup()
    manager.waitOnSameAccount('paused-task')
    manager.ackResult('quota-result')
    expect(manager.pendingResults()).toEqual([])
    accountUse.out = false
    await vi.advanceTimersByTimeAsync(1000)
    expect(manager.agent('paused-task')?.account).toBe(fixed.id)
    expect(accounts.pick).not.toHaveBeenCalled()
    expect(accounts.get).toHaveBeenCalledWith(fixed.id)
    expect(manager.agent('paused-task')?.quotaPaused).toBeUndefined()
    manager.shutdown()
    store.flush()
  })

  it('encerrar cancela a espera, mantém o resultado até o recebimento e não retoma depois', async () => {
    vi.useFakeTimers()
    queries.mockClear()
    const { manager, store, fixed, accountUse } = await setup()
    manager.waitOnSameAccount('paused-task')
    manager.endQuotaTask('paused-task')
    expect(manager.agent('paused-task')?.quotaEnded).toBe(true)
    expect(manager.pendingResults()).toHaveLength(1)

    accountUse.out = false
    await vi.advanceTimersByTimeAsync(5000)
    expect(queries).not.toHaveBeenCalled()
    expect(manager.agent('paused-task')?.account).toBe(fixed.id)
    expect(manager.pendingResults()).toHaveLength(1)

    manager.ackResult('quota-result')
    expect(manager.pendingResults()).toEqual([])
    await vi.advanceTimersByTimeAsync(5000)
    expect(queries).not.toHaveBeenCalled()
    manager.shutdown()
    store.flush()
  })

  it('shutdown cancela timers de espera e não retoma tarefas depois de fechar o manager', async () => {
    vi.useFakeTimers()
    queries.mockClear()
    const { manager, store, fixed, accountUse } = await setup()
    manager.waitOnSameAccount('paused-task')
    manager.shutdown()
    accountUse.out = false
    await vi.advanceTimersByTimeAsync(5000)
    expect(queries).not.toHaveBeenCalled()
    expect(manager.agent('paused-task')?.account).toBe(fixed.id)
    expect(manager.agent('paused-task')?.quotaPaused?.accountId).toBe(fixed.id)
    store.flush()
  })

  it('ack antes da escolha de espera não cria retry automático; a espera explícita pode vir depois', async () => {
    vi.useFakeTimers()
    queries.mockClear()
    const { manager, store, fixed, accountUse, accounts } = await setup()
    manager.ackResult('quota-result')
    await vi.advanceTimersByTimeAsync(5000)
    expect(queries).not.toHaveBeenCalled()
    expect(manager.agent('paused-task')?.quotaPaused?.accountId).toBe(fixed.id)

    manager.waitOnSameAccount('paused-task')
    accountUse.out = false
    await vi.advanceTimersByTimeAsync(1000)
    expect(manager.agent('paused-task')?.account).toBe(fixed.id)
    expect(accounts.pick).not.toHaveBeenCalled()
    expect(accounts.get).toHaveBeenCalledWith(fixed.id)
    manager.shutdown()
    store.flush()
  })
})
