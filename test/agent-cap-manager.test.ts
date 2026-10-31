import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { AgentSummary } from '../src/shared/types'
import { LUNA_AGENT_ID } from '../src/shared/luna'

const sdk = vi.hoisted(() => ({ calls: [] as Array<{ prompt: unknown; options: Record<string, unknown> }> }))
vi.mock('@anthropic-ai/claude-agent-sdk', async (original) => ({
  ...(await original<object>()),
  query: (args: { prompt: unknown; options: Record<string, unknown> }) => {
    sdk.calls.push(args)
    return { [Symbol.asyncIterator]: async function* () {}, close: () => undefined, interrupt: async () => undefined }
  },
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
  it('Luna conversa pela sessão normal do SDK e retoma a mesma sessão depois de reabrir (#101)', async () => {
    const data = mkdtempSync(join(tmpdir(), 'ao-luna-persist-'))
    app.setPath('userData', data)
    const { Store } = await import('../src/main/store')
    const { AgentManager } = await import('../src/main/agents')
    const { LUNA_PROMPT } = await import('../src/main/luna-prompt')
    const { lunaTools } = await import('../src/main/luna-tools')
    const store = new Store()
    const manager = new AgentManager(store)
    manager.lunaTools = () => lunaTools({} as never)
    sdk.calls.length = 0
    await manager.sendMessage(LUNA_AGENT_ID, 'Pedido sintético')
    await vi.waitFor(() => expect(sdk.calls).toHaveLength(1))
    const first = sdk.calls[0]!.options
    // Sem vault configurado, a casa dela é a pasta de dados do Office.
    expect(first.cwd).toBe(store.dataDirectory)
    expect(first.permissionMode).toBe('auto')
    expect(first.sessionId).toEqual(expect.any(String))
    expect((first.systemPrompt as { append: string }).append).toBe(LUNA_PROMPT)
    expect(Object.keys(first.mcpServers as object)).toEqual(expect.arrayContaining(['casa']))
    const sessionId = first.sessionId
    manager.shutdown()
    store.flush()

    const restored = new Store()
    const reopened = new AgentManager(restored)
    expect(reopened.list().filter((agent) => agent.id === LUNA_AGENT_ID)).toHaveLength(1)
    expect(reopened.getLog(LUNA_AGENT_ID)).toContainEqual(expect.objectContaining({ kind: 'user', text: 'Pedido sintético' }))
    sdk.calls.length = 0
    await reopened.sendMessage(LUNA_AGENT_ID, 'Continuando')
    await vi.waitFor(() => expect(sdk.calls).toHaveLength(1))
    expect(sdk.calls[0]!.options.resume).toBe(sessionId)
    reopened.shutdown()
    restored.flush()
  })

  it('texto vai para a sessão da Luna; só áudio segue o fluxo local, e ela não é dispensada', async () => {
    app.setPath('userData', mkdtempSync(join(tmpdir(), 'ao-luna-manager-')))
    const { Store } = await import('../src/main/store')
    const { AgentManager } = await import('../src/main/agents')
    const store = new Store()
    const manager = new AgentManager(store)
    const handler = vi.fn()
    manager.setBuiltInMessageHandler(handler)

    const luna = manager.list().find((agent) => agent.id === LUNA_AGENT_ID)
    expect(luna).toMatchObject({ name: 'Luna', builtIn: 'luna', status: 'idle', permissionMode: 'auto' })
    sdk.calls.length = 0
    await manager.sendMessage(LUNA_AGENT_ID, 'Ajude a organizar o dia')
    await vi.waitFor(() => expect(sdk.calls).toHaveLength(1))
    expect(handler).not.toHaveBeenCalled()
    expect(manager.getLog(LUNA_AGENT_ID).find((e) => e.kind === 'user')).toMatchObject({ text: 'Ajude a organizar o dia' })

    const audio = [{ name: 'nota.ogg', mime: 'audio/ogg', dataBase64: 'AA==' }]
    await manager.sendMessage(LUNA_AGENT_ID, '', undefined, audio)
    expect(handler).toHaveBeenCalledWith(LUNA_AGENT_ID, '', audio)
    expect(() => manager.fire(LUNA_AGENT_ID)).toThrow(/não pode ser dispensada/)
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
    expect(manager.list()).toHaveLength(7) // Four regular agents, one temporary and the built-in Luna and Bonnie.
    expect(manager.list().filter((agent) => !agent.builtIn)).toHaveLength(5)
    expect(manager.list().find((agent) => agent.id === LUNA_AGENT_ID)?.name).toBe('Luna')
    expect(manager.list().filter((agent) => agent.temporary)).toHaveLength(1)
    manager.shutdown()
    store.flush()
  })
})
