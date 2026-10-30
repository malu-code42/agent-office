import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { agentCapDecision } from '../src/shared/agent-cap'
import { emiAgentId } from '../src/shared/emi'
import type { OfficeEvent, ProjectFloor } from '../src/shared/types'

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

const floor = (id: string): ProjectFloor => ({ id, name: `Andar ${id}`, cwd: mkdtempSync(join(tmpdir(), `ao-emi-${id}-`)) })

async function office(projects: ProjectFloor[]) {
  app.setPath('userData', mkdtempSync(join(tmpdir(), 'ao-emi-manager-')))
  const { Store } = await import('../src/main/store')
  const { AgentManager } = await import('../src/main/agents')
  const store = new Store()
  store.settings = { ...store.settings, projects }
  return { Store, AgentManager, store, manager: new AgentManager(store) }
}

describe('a Emi de cada andar', () => {
  it('cada andar já nasce com a sua Emi, que não ocupa vaga de contratação nem é dispensada', async () => {
    const p1 = floor('p1')
    const p2 = floor('p2')
    const { manager, store } = await office([p1, p2])
    const emis = manager.list().filter((a) => a.builtIn === 'emi')
    expect(emis.map((a) => a.id).sort()).toEqual([emiAgentId('p1'), emiAgentId('p2')])
    expect(manager.list().find((a) => a.id === emiAgentId('p1'))).toMatchObject({
      name: 'Emi',
      cwd: p1.cwd,
      project: 'p1',
      permissionMode: 'default',
      desk: -1,
    })
    expect(agentCapDecision(manager.list())).toEqual({ regular: 0, result: 'regular' })
    expect(() => manager.fire(emiAgentId('p1'))).toThrow(/só sai quando o andar for removido/)
    manager.shutdown()
    store.flush()
  })

  it('conversa numa sessão própria na pasta do andar, com o prompt e as ferramentas dela', async () => {
    const p1 = floor('p1')
    const { manager, store } = await office([p1])
    const { emiPrompt } = await import('../src/main/emi-prompt')
    manager.emiTools = vi.fn(() => ({ type: 'sdk', name: 'emi' }) as never)
    sdk.calls.length = 0
    await manager.sendMessage(emiAgentId('p1'), 'Quero uma loja online')
    await vi.waitFor(() => expect(sdk.calls).toHaveLength(1))
    const options = sdk.calls[0]!.options
    expect(options.cwd).toBe(p1.cwd)
    expect(options.permissionMode).toBe('default')
    expect((options.systemPrompt as { append: string }).append).toBe(emiPrompt(p1))
    expect(Object.keys(options.mcpServers as object)).toEqual(['emi'])
    expect(manager.emiTools).toHaveBeenCalledWith('p1')
    manager.shutdown()
    store.flush()
  })

  it('um andar novo ganha Emi; um andar removido leva a Emi junto, também depois de reabrir', async () => {
    const p1 = floor('p1')
    const { Store, AgentManager, manager, store } = await office([p1])
    const events: OfficeEvent[] = []
    manager.on('event', (e: OfficeEvent) => events.push(e))

    const p2 = floor('p2')
    store.settings = { ...store.settings, projects: [p1, p2] }
    manager.relocate()
    expect(manager.list().some((a) => a.id === emiAgentId('p2'))).toBe(true)
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'agent:upsert', agent: expect.objectContaining({ id: emiAgentId('p2') }) }),
    )

    store.settings = { ...store.settings, projects: [p2] }
    manager.relocate()
    expect(manager.list().some((a) => a.id === emiAgentId('p1'))).toBe(false)
    expect(events).toContainEqual({ type: 'agent:removed', agentId: emiAgentId('p1') })
    manager.shutdown()
    store.flush()

    // A floor removed while the office was closed: its Emi is not brought back.
    const restored = new Store()
    restored.settings = { ...restored.settings, projects: [] }
    const reopened = new AgentManager(restored)
    expect(reopened.list().filter((a) => a.builtIn === 'emi')).toEqual([])
    reopened.shutdown()
    restored.flush()
  })
})
