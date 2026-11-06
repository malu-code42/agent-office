import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { describe, expect, it } from 'vitest'
import { autoAckResults } from '../src/renderer/src/ui/result-rules'
import type { AgentResult, AgentSummary } from '../src/shared/types'

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

const result = (over: Partial<AgentResult>): AgentResult =>
  ({ id: 'r', agentId: 'a1', text: 'ok', isError: false, costUsd: 0, durationMs: 1, turns: 1, createdAt: 1, ...over }) as AgentResult

describe('abrir a conversa recebe a entrega simples pendente (AO-96)', () => {
  it('recebe a entrega simples pendente ao abrir e não a conta de novo ao reabrir', async () => {
    app.setPath('userData', mkdtempSync(join(tmpdir(), 'ao-auto-ack-')))
    const { Store } = await import('../src/main/store')
    const { AgentManager } = await import('../src/main/agents')
    const store = new Store()
    store.agents = [{ summary: summary('a1'), log: [] }]
    store.results = [
      result({ id: 'simples' }),
      result({ id: 'erro', isError: true }),
      result({ id: 'alteracoes', changes: { git: true, files: [] } as unknown as AgentResult['changes'] }),
    ]
    const manager = new AgentManager(store)
    const openConversation = (): void => {
      const pending = manager.pendingResults().filter((r) => r.agentId === 'a1')
      for (const r of autoAckResults(manager.agent('a1'), pending)) manager.ackResult(r.id)
    }

    openConversation()
    expect(manager.pendingResults().map((r) => r.id)).toEqual(['erro', 'alteracoes'])

    openConversation()
    expect(manager.pendingResults().map((r) => r.id)).toEqual(['erro', 'alteracoes'])
  })
})
