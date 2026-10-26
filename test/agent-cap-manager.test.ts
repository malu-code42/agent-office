import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { AgentSummary } from '../src/shared/types'
import { LUNA_AGENT_ID } from '../src/shared/luna'

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
  it('persiste a conversa normal da Luna e a reabre sem duplicar o agente', async () => {
    const data = mkdtempSync(join(tmpdir(), 'ao-luna-persist-'))
    app.setPath('userData', data)
    const { Store } = await import('../src/main/store')
    const { AgentManager } = await import('../src/main/agents')
    const store = new Store()
    const manager = new AgentManager(store)
    manager.sendMessage(LUNA_AGENT_ID, 'Pedido sintético')
    manager.shutdown()
    store.flush()

    const restored = new Store()
    const reopened = new AgentManager(restored)
    expect(reopened.list().filter((agent) => agent.id === LUNA_AGENT_ID)).toHaveLength(1)
    expect(reopened.getLog(LUNA_AGENT_ID)).toContainEqual(expect.objectContaining({ kind: 'user', text: 'Pedido sintético' }))
    reopened.shutdown()
    restored.flush()
  })

  it('mantém Luna no roster e encaminha mensagens do chat normal sem criar um worker com ferramentas', async () => {
    app.setPath('userData', mkdtempSync(join(tmpdir(), 'ao-luna-manager-')))
    const { Store } = await import('../src/main/store')
    const { AgentManager } = await import('../src/main/agents')
    const store = new Store()
    const manager = new AgentManager(store)
    const handler = vi.fn()
    manager.setBuiltInMessageHandler(handler)

    const luna = manager.list().find((agent) => agent.id === LUNA_AGENT_ID)
    expect(luna?.name).toBe('Luna')
    expect(luna?.builtIn).toBe('luna')
    expect(luna?.status).toBe('idle')
    manager.sendMessage(LUNA_AGENT_ID, 'Ajude a organizar o dia')

    expect(handler).toHaveBeenCalledWith(LUNA_AGENT_ID, 'Ajude a organizar o dia')
    expect(manager.getLog(LUNA_AGENT_ID).at(-1)).toMatchObject({ kind: 'user', text: 'Ajude a organizar o dia' })
    const answer = vi.fn()
    const requestId = manager.requestDecision(
      LUNA_AGENT_ID,
      {
        kind: 'question',
        toolName: 'Luna',
        title: 'Aprovar envio de contexto',
        detail: '',
        input: {},
        canAlwaysAllow: false,
        questions: [{ header: 'Privacidade', question: 'Enviar?', multiSelect: false, options: [{ label: 'Sim', description: '' }] }],
      },
      answer,
    )
    manager.respond({ requestId, behavior: 'allow', answers: { Enviar: 'Sim' } })
    expect(answer).toHaveBeenCalledWith({ requestId, behavior: 'allow', answers: { Enviar: 'Sim' } })
    expect(() => manager.fire(LUNA_AGENT_ID)).toThrow(/não pode ser dispensada/)
    manager.simulate = vi.fn()
    manager.sendMessage(LUNA_AGENT_ID, 'Pedido sintético em demo')
    expect(handler).toHaveBeenCalledTimes(1)
    expect(manager.getLog(LUNA_AGENT_ID).at(-1)).toMatchObject({
      kind: 'assistant',
      text: 'A conversa com Luna está em modo de demonstração; nenhum pedido será enviado ou executado.',
    })
    manager.shutdown()
    store.flush()
  })

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
    expect(manager.list()).toHaveLength(6) // Four regular agents, one temporary and the built-in Luna.
    expect(manager.list().filter((agent) => !agent.builtIn)).toHaveLength(5)
    expect(manager.list().find((agent) => agent.id === LUNA_AGENT_ID)?.name).toBe('Luna')
    expect(manager.list().filter((agent) => agent.temporary)).toHaveLength(1)
    manager.shutdown()
    store.flush()
  })
})
