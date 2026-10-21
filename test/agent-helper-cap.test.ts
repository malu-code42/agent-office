import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import type { OfficeEvent } from '../src/shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// O limite de 3 subagentes por mesa (HANDOFF §3.4.1) vale no runtime de verdade:
// o quarto pedido de subagente é recusado antes de rodar, e o motivo fica na
// conversa do agente. A cena (GameSubagents.syncHelpers) só mostra o que roda.

type HookInput = {
  hook_event_name: string
  tool_name: string
  tool_input: unknown
  tool_use_id: string
}
type HookOutput = { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } }

const queries: Array<{ options: Record<string, unknown> & { hooks?: { PreToolUse?: { hooks: ((input: HookInput) => Promise<HookOutput>)[] }[] } } }> =
  []

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: { options: Record<string, unknown> }) => {
    queries.push(args)
    return {
      [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => undefined) }),
      close: () => undefined,
      interrupt: async () => undefined,
    }
  },
}))
vi.mock('../src/main/claude-path', () => ({ findClaude: () => '/bin/false' }))
vi.mock('../src/main/git', () => ({
  createWorktree: async () => null,
  changesSince: async () => null,
  takeSnapshot: async () => null,
}))

const { Store } = await import('../src/main/store')
const { AgentManager } = await import('../src/main/agents')

const flush = () => new Promise<void>((r) => setTimeout(r, 10))
const proj = () => mkdtempSync(join(tmpdir(), 'ao-cap-'))

/** Contrata um agente e devolve o hook de PreToolUse que a SDK recebeu. */
const hired = async (maxSubagents?: number) => {
  const store = new Store()
  const dir = proj()
  if (maxSubagents !== undefined) store.settings = { ...store.settings, maxSubagents }
  store.settings = { ...store.settings, projects: [{ id: 'p1', name: 'Teste', cwd: dir }] }
  const m = new AgentManager(store)
  const evs: OfficeEvent[] = []
  m.on('event', (e: OfficeEvent) => evs.push(e))
  const a = await m.hire({ name: 'Ada', cwd: dir, task: 'organize', engine: 'claude', permissionMode: 'default', worktree: false })
  await flush()
  const matchers = queries[0]?.options.hooks?.PreToolUse ?? []
  const hook = matchers.flatMap((m2) => m2.hooks).find((h) => h.length > 0)!
  expect(hook).toBeTypeOf('function')
  return { m, a, dir, evs, hook }
}

const spawn = (id: string): HookInput => ({
  hook_event_name: 'PreToolUse',
  tool_name: 'Agent',
  tool_input: { subagent_type: 'general-purpose', prompt: 'trabalha' },
  tool_use_id: id,
})

describe('limite de subagentes por mesa, no runtime do Claude Agent SDK', () => {
  beforeEach(() => {
    app.setPath('userData', mkdtempSync(join(tmpdir(), 'ao-cap-')))
    queries.length = 0
  })

  it('recusa o quarto subagente e escreve o motivo na conversa', async () => {
    const { a, evs, hook } = await hired()
    // Três pedidos na mesma mensagem: o CLI ainda não reportou nenhum.
    expect((await hook(spawn('t1'))).hookSpecificOutput).toBeUndefined()
    expect((await hook(spawn('t2'))).hookSpecificOutput).toBeUndefined()
    expect((await hook(spawn('t3'))).hookSpecificOutput).toBeUndefined()
    const fourth = await hook(spawn('t4'))
    expect(fourth.hookSpecificOutput?.permissionDecision).toBe('deny')
    expect(fourth.hookSpecificOutput?.permissionDecisionReason).toContain('3')
    // O motivo fica na conversa do agente: o trabalho não some em silêncio.
    const logs = evs.filter((e) => e.type === 'agent:log' && e.agentId === a.id) as { entry: { kind: string; text: string } }[]
    expect(logs.some((l) => l.entry.kind === 'error' && l.entry.text.includes('limite de 3'))).toBe(true)
  })

  it('respeita um limite configurado menor que o da sala', async () => {
    const { hook } = await hired(1)
    expect((await hook(spawn('t1'))).hookSpecificOutput).toBeUndefined()
    const second = await hook(spawn('t2'))
    expect(second.hookSpecificOutput?.permissionDecision).toBe('deny')
    expect(second.hookSpecificOutput?.permissionDecisionReason).toContain('limite de 1')
  })

  it('deixa passar o pedido que não é de subagente', async () => {
    const { hook } = await hired(1)
    const read = { ...spawn('r1'), tool_name: 'Read', tool_input: { file_path: 'a.ts' } }
    expect((await hook(read)).hookSpecificOutput).toBeUndefined()
  })
})
