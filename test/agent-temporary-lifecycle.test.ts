import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { describe, expect, it } from 'vitest'
import { AgentCapReservations, agentCapDecision } from '../src/shared/agent-cap'
import type { AgentSummary, LogEntry } from '../src/shared/types'

const summary = (id: string, over: Partial<AgentSummary> = {}): AgentSummary => ({
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
  ...over,
})

describe('ciclo do agente temporário (AO-42)', () => {
  it('mantém a entrega e a conversa arquivadas, e libera a cadeira somente após recebimento', async () => {
    app.setPath('userData', mkdtempSync(join(tmpdir(), 'ao-temp-lifecycle-')))
    const { Store } = await import('../src/main/store')
    const { AgentManager } = await import('../src/main/agents')
    const store = new Store()
    const history: LogEntry[] = [{ id: 'result-log', t: 2, kind: 'result', text: 'Entrega sintética preservada.' }]
    const regulars = Array.from({ length: 4 }, (_, i) => ({ summary: summary(`regular-${i}`), log: [] }))
    const temporary = { summary: summary('temporary', { temporary: true, status: 'done' }), log: history }
    store.agents = [...regulars, temporary]
    store.results = [
      {
        id: 'pending-result',
        agentId: 'temporary',
        text: 'Entrega sintética preservada.',
        isError: false,
        costUsd: 0,
        durationMs: 1,
        turns: 1,
        createdAt: 2,
      },
    ]
    const manager = new AgentManager(store)
    const reservations = new AgentCapReservations()

    expect(agentCapDecision(manager.list()).result).toBe('refuse')
    expect(manager.pendingResults()).toHaveLength(1)
    expect(manager.getLog('temporary')).toEqual(history)
    expect(() => manager.fire('temporary')).toThrow(/leia o resultado/)
    expect(manager.pendingResults()).toHaveLength(1)

    manager.ackResult('pending-result')

    expect(manager.pendingResults()).toEqual([])
    expect(manager.list().map((agent) => agent.id)).toEqual(['regular-0', 'regular-1', 'regular-2', 'regular-3'])
    expect(manager.agent('temporary')).toMatchObject({ departed: true, temporary: true, status: 'stopped' })
    expect(manager.getLog('temporary')).toEqual(history)
    expect(agentCapDecision(manager.list()).result).toBe('temporary')
    expect(reservations.reserve(manager.list()).temporary).toBe(true)
    expect(store.agents.find((agent) => agent.summary.id === 'temporary')).toMatchObject({
      summary: { departed: true, temporary: true },
      log: history,
    })
    store.flush()
    const reopened = new Store()
    const restored = new AgentManager(reopened)
    expect(restored.list().map((agent) => agent.id)).toEqual(['regular-0', 'regular-1', 'regular-2', 'regular-3'])
    expect(restored.getLog('temporary')).toEqual(history)
    expect(restored.agent('temporary')).toMatchObject({ departed: true, status: 'stopped' })
    restored.shutdown()
    reopened.flush()
    manager.shutdown()
    store.flush()
  })

  it('um erro significativo não dispensa o temporário até o recebimento explícito', async () => {
    app.setPath('userData', mkdtempSync(join(tmpdir(), 'ao-temp-error-')))
    const { Store } = await import('../src/main/store')
    const { AgentManager } = await import('../src/main/agents')
    const store = new Store()
    const agent = summary('temporary-error', { temporary: true, status: 'error' })
    store.agents = [{ summary: agent, log: [{ id: 'error-log', t: 2, kind: 'result', text: 'Erro sintético a revisar.' }] }]
    store.results = [
      {
        id: 'error-result',
        agentId: agent.id,
        text: 'Erro sintético a revisar.',
        isError: true,
        costUsd: 0,
        durationMs: 1,
        turns: 1,
        createdAt: 2,
      },
    ]
    const manager = new AgentManager(store)

    expect(manager.agent(agent.id)?.departed).toBeUndefined()
    expect(manager.pendingResults().map((result) => result.id)).toEqual(['error-result'])
    manager.ackResult('error-result')
    expect(manager.agent(agent.id)).toMatchObject({ departed: true, status: 'stopped' })
    expect(manager.getLog(agent.id).map((entry) => entry.text)).toContain('Erro sintético a revisar.')
    manager.shutdown()
    store.flush()
  })
})
