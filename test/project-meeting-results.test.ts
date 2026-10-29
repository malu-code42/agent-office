import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { describe, expect, it } from 'vitest'
import type { AgentResult, AgentSummary } from '@shared/types'

const agent: AgentSummary = {
  id: 'project-agent',
  name: 'Agente sintético',
  source: 'office',
  cwd: 'C:/synthetic/project',
  project: 'project-1',
  permissionMode: 'default',
  status: 'done',
  activity: 'Trazendo o resultado',
  desk: 0,
  look: { skin: '', hair: '', hairStyle: 0, shirt: '', pants: '', shoes: '' },
  costUsd: 0,
  createdAt: 1,
}

const result: AgentResult = {
  id: 'project-result',
  agentId: agent.id,
  text: 'Entrega de teste sintética.',
  isError: false,
  costUsd: 0,
  durationMs: 1,
  turns: 1,
  createdAt: 2,
}

describe('resultados da sala de reunião de projeto (AO-57)', () => {
  it('mantém a apresentação após reinício e torna o recebimento duplicado inofensivo', async () => {
    app.setPath('userData', mkdtempSync(join(tmpdir(), 'ao-project-meeting-')))
    const { Store } = await import('../src/main/store')
    const { AgentManager } = await import('../src/main/agents')
    const store = new Store()
    store.agents = [{ summary: agent, log: [] }]
    store.results = [result]
    const manager = new AgentManager(store)

    expect(manager.pendingResults()).toEqual([result])
    manager.shutdown()
    store.flush()

    const reopened = new Store()
    const restored = new AgentManager(reopened)
    expect(restored.pendingResults()).toEqual([result])
    restored.ackResult(result.id)
    restored.ackResult(result.id)
    expect(restored.pendingResults()).toEqual([])
    restored.shutdown()
    reopened.flush()

    const finalStore = new Store()
    expect(finalStore.results).toEqual([])
    finalStore.flush()
  })
})
