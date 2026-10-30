import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { describe, expect, it } from 'vitest'
import type { AgentSummary, LogEntry } from '../src/shared/types'

const resident = (over: Partial<AgentSummary> = {}): AgentSummary => ({
  id: 'home-agent',
  name: 'Agente sintético',
  source: 'office',
  cwd: 'C:/synthetic',
  permissionMode: 'default',
  status: 'working',
  activity: 'Executando tarefa sintética',
  desk: 0,
  look: { skin: '', hair: '', hairStyle: 0, shirt: '', pants: '', shoes: '' },
  costUsd: 0,
  createdAt: 1,
  ...over,
})

describe('presença do agente na Casa (AO-94)', () => {
  it('persists independently from work status and keeps the conversation after leaving the house', async () => {
    app.setPath('userData', mkdtempSync(join(tmpdir(), 'ao-home-residence-')))
    const { Store } = await import('../src/main/store')
    const { AgentManager } = await import('../src/main/agents')
    const store = new Store()
    const history: LogEntry[] = [{ id: 'kept-log', t: 2, kind: 'assistant', text: 'Histórico sintético preservado.' }]
    store.agents = [{ summary: resident(), log: history }]
    const manager = new AgentManager(store)
    const before = manager.agent('home-agent')!

    manager.setHomeResident('home-agent', true)
    expect(manager.agent('home-agent')).toMatchObject({ homeResident: true, status: before.status, activity: before.activity })
    expect(manager.getLog('home-agent')).toEqual(history)
    expect(store.agents[0].summary.homeResident).toBe(true)

    store.flush()
    const reopenedStore = new Store()
    const reopened = new AgentManager(reopenedStore)
    expect(reopened.agent('home-agent')).toMatchObject({ homeResident: true })
    const restored = reopened.agent('home-agent')!
    reopened.setHomeResident('home-agent', false)
    expect(reopened.agent('home-agent')).not.toHaveProperty('homeResident')
    expect(reopened.agent('home-agent')).toMatchObject({ status: restored.status, activity: restored.activity })
    expect(reopened.getLog('home-agent')).toEqual(history)
    reopened.shutdown()
    manager.shutdown()
    reopenedStore.flush()
    store.flush()
  })

  it('refuses to send a called agent away while its task runs, and allows it once done (#105)', async () => {
    app.setPath('userData', mkdtempSync(join(tmpdir(), 'ao-home-busy-')))
    const { Store } = await import('../src/main/store')
    const { AgentManager } = await import('../src/main/agents')
    const store = new Store()
    store.agents = [{ summary: resident({ homeResident: true, status: 'idle' }), log: [] }]
    const manager = new AgentManager(store)
    const agent = (manager as unknown as { agents: Map<string, { summary: AgentSummary }> }).agents.get('home-agent')!
    for (const status of ['working', 'starting', 'waiting'] as const) {
      agent.summary.status = status
      expect(() => manager.setHomeResident('home-agent', false), status).toThrow('ainda está na tarefa')
      expect(manager.agent('home-agent')).toMatchObject({ homeResident: true })
    }
    agent.summary.status = 'done'
    manager.setHomeResident('home-agent', false)
    expect(manager.agent('home-agent')).not.toHaveProperty('homeResident')
    manager.shutdown()
    store.flush()
  })

  it('keeps a temporary resident after the user acknowledges its delivery', async () => {
    app.setPath('userData', mkdtempSync(join(tmpdir(), 'ao-home-temporary-')))
    const { Store } = await import('../src/main/store')
    const { AgentManager } = await import('../src/main/agents')
    const store = new Store()
    const summary = resident({ temporary: true, homeResident: true, status: 'done' })
    store.agents = [{ summary, log: [{ id: 'delivery-log', t: 2, kind: 'result', text: 'Entrega sintética.' }] }]
    store.results = [
      {
        id: 'pending-delivery',
        agentId: summary.id,
        text: 'Entrega sintética.',
        isError: false,
        costUsd: 0,
        durationMs: 1,
        turns: 1,
        createdAt: 2,
      },
    ]
    const manager = new AgentManager(store)

    manager.ackResult('pending-delivery')

    expect(manager.agent(summary.id)).toMatchObject({ homeResident: true, temporary: true, status: 'idle' })
    expect(manager.agent(summary.id)).not.toHaveProperty('departed')
    expect(manager.getLog(summary.id).map((entry) => entry.text)).toContain('Entrega sintética.')
    manager.shutdown()
    store.flush()
  })
})
