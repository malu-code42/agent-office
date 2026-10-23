import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import type { AgentSummary, OfficeEvent } from '../src/shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Ticket 03, seam 2: o Office é a autoridade de permissão. O canUseTool da SDK
// consulta a política do Office (decide, em permissions/policy) antes de qualquer
// cartão; o que ela pede vai pelo permission:new respondido aqui, e nada vira
// regra guardada no CLI por conta do próprio CLI.

type ToolUseOpts = { signal: AbortSignal; suggestions?: unknown[]; decisionReason?: string; agentID?: string }
type CanUse = (tool: string, input: Record<string, unknown>, opts: ToolUseOpts) => Promise<unknown>

const queries: Array<{ prompt: unknown; options: Record<string, unknown> & { canUseTool?: CanUse } }> = []
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: { prompt: unknown; options: Record<string, unknown> & { canUseTool?: CanUse } }) => {
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

const proj = () => mkdtempSync(join(tmpdir(), 'ao-policy-'))
const flush = () => new Promise<void>((r) => setTimeout(r, 10))

/** Eventos que o manager emite a partir deste momento. */
const track = (m: InstanceType<typeof AgentManager>): OfficeEvent[] => {
  const evs: OfficeEvent[] = []
  m.on('event', (e: OfficeEvent) => evs.push(e))
  return evs
}

/** Contrata um agente e devolve o canUseTool que a SDK capturou, junto do id dele. */
const started = async (
  mode: 'default' | 'auto',
): Promise<{ m: InstanceType<typeof AgentManager>; a: AgentSummary; dir: string; canUse: CanUse; store: InstanceType<typeof Store> }> => {
  const store = new Store()
  const dir = proj()
  store.settings = { ...store.settings, projects: [{ id: 'p1', name: 'Teste', cwd: dir }] }
  const m = new AgentManager(store)
  const a = await m.hire({ name: 'Ada', cwd: dir, task: 'organize', engine: 'claude', permissionMode: mode, worktree: false })
  await flush()
  const canUse = queries[0]?.options.canUseTool
  expect(canUse).toBeTypeOf('function')
  return { m, a, dir, canUse: canUse as CanUse, store }
}

/** O pedido de permissão criado, com o id para responder. */
const asked = (evs: OfficeEvent[]): { id: string; toolName: string; canAlwaysAllow: boolean } => {
  const news = evs.filter((e) => e.type === 'permission:new')
  expect(news).toHaveLength(1)
  const request = (news[0] as { request: { id: string; toolName: string; canAlwaysAllow: boolean } }).request
  return request
}

describe('permissões: o Office decide antes do cartão (seam 2)', () => {
  beforeEach(() => {
    app.setPath('userData', mkdtempSync(join(tmpdir(), 'ao-po-')))
    queries.length = 0
  })

  it('applies the selected built-in profile scope to the fresh task sent to Claude', async () => {
    const store = new Store()
    const dir = proj()
    const m = new AgentManager(store)
    const a = await m.hire({
      name: 'Ada',
      cwd: dir,
      task: 'Explain this isolated TypeScript question.',
      profile: 'estudo-avulso',
      permissionMode: 'default',
      worktree: false,
    })
    await flush()
    expect(a.profile).toBe('estudo-avulso')
    const prompt = queries.at(-1)?.prompt as AsyncIterable<{ message: { content: string } }>
    const first = await prompt[Symbol.asyncIterator]().next()
    expect(first.value?.message.content).toContain('[Approved profile scope]')
    expect(first.value?.message.content).toContain('outside any active study cycle')
    expect(a.sessionId).toMatch(/^[0-9a-f-]{36}$/i)
    m.shutdown()
    store.flush()
  })

  it('ignores an obsolete OpenCode request and creates a Claude agent', async () => {
    const store = new Store()
    const dir = proj()
    const m = new AgentManager(store)
    const agent = await m.hire({
      name: 'Ada',
      cwd: dir,
      task: 'synthetic task',
      engine: 'opencode' as never,
      permissionMode: 'default',
      worktree: false,
    })
    await flush()
    expect(agent.engine).toBe('claude')
    expect(agent.sessionId).toMatch(/^[0-9a-f-]{36}$/i)
  })

  it('keeps OpenCode agents as read-only history and blocks resumption/deletion', () => {
    const store = new Store()
    const archived: AgentSummary = {
      id: 'legacy-agent',
      name: 'Arquivo',
      source: 'office',
      engine: 'opencode',
      cwd: proj(),
      permissionMode: 'default',
      status: 'working',
      activity: 'antigo',
      desk: 0,
      look: { skin: '#f2c9a0', hair: '#332211', hairStyle: 0, shirt: '#4a8fe0', pants: '#222222', shoes: '#111111' },
      costUsd: 0,
      createdAt: Date.now(),
      sessionId: 'ses_legacy',
    }
    const log = [
      { id: 'legacy-log', t: Date.now(), kind: 'assistant' as const, text: 'Historical response' },
      { id: 'legacy-result-log', t: Date.now(), kind: 'result' as const, text: 'Historical result' },
    ]
    store.agents = [{ summary: archived, log }]
    store.results = [
      {
        id: 'legacy-result',
        agentId: archived.id,
        text: 'Historical result',
        isError: false,
        costUsd: 0,
        durationMs: 0,
        turns: 1,
        createdAt: Date.now(),
      },
    ]
    const manager = new AgentManager(store)
    expect(manager.agent(archived.id)).toMatchObject({ engine: 'opencode', status: 'stopped' })
    expect(manager.getLog(archived.id)).toEqual(log)
    expect(manager.pendingResults().map((result) => result.id)).toEqual(['legacy-result'])
    manager.ackResult('legacy-result')
    expect(manager.pendingResults()).toEqual([])
    expect(manager.getLog(archived.id)).toEqual(log)
    expect(() => manager.sendMessage(archived.id, 'continue')).toThrow(/somente para consulta/)
    manager.configure(archived.id, { model: 'claude-opus-4-6', permissionMode: 'auto' })
    expect(manager.agent(archived.id)?.model).toBeUndefined()
    expect(manager.agent(archived.id)?.permissionMode).toBe('default')
    manager.accounts = {} as never
    expect(() => manager.continueOn(archived.id, 'main')).toThrow(/não podem ser retomados/)
    expect(() => manager.clearContext(archived.id)).toThrow(/não podem ser retomados/)
    expect(() => manager.compact(archived.id)).toThrow(/somente para consulta/)
    expect(() => manager.fire(archived.id)).toThrow(/preservados/)
    expect(manager.agent(archived.id)).toBeDefined()
  })

  it('leitura comum no Automático passa sem cartão nem evento', async () => {
    const { m, dir, canUse } = await started('auto')
    const evs = track(m)
    const input = { file_path: join(dir, 'src', 'a.ts') }
    const r = await canUse('Read', input, { signal: new AbortController().signal })
    expect(r).toEqual({ behavior: 'allow', updatedInput: input })
    expect(evs).toEqual([])
  })

  it('Pedir permissão cria um permission:new e a resposta resolve uma vez', async () => {
    const { m, a, dir, canUse } = await started('default')
    const evs = track(m)
    const input = { file_path: join(dir, 'a.txt'), old_string: 'x', new_string: 'y' }
    const waiting = canUse('Edit', input, {
      signal: new AbortController().signal,
      // Sugestão do CLI? Nada vira promoção por conta dele: quem oferta regra é o Office.
      suggestions: [{ type: 'setMode', mode: 'acceptEdits' } as unknown],
    })
    await flush()
    const request = asked(evs)
    expect(request.toolName).toBe('Edit')
    expect(request.canAlwaysAllow).toBe(true)
    expect(m.agent(a.id)?.status).toBe('waiting')

    m.respond({ requestId: request.id, behavior: 'allow' })
    expect(await waiting).toEqual({ behavior: 'allow', updatedInput: input })
    expect(evs.filter((e) => e.type === 'permission:resolved')).toHaveLength(1)
    const decisions = evs.filter((e) => e.type === 'agent:log' && (e as { entry: { kind: string } }).entry.kind === 'decision')
    expect(decisions).toHaveLength(1)
    expect(m.agent(a.id)?.status).toBe('working')
  })

  it('Sempre permitir persiste regra exata no projeto, sem enviar updatedPermissions ao CLI', async () => {
    const { m, dir, canUse, store } = await started('default')
    const evs = track(m)
    const input = { file_path: join(dir, 'a.txt'), old_string: 'x', new_string: 'y' }
    const waiting = canUse('Edit', input, {
      signal: new AbortController().signal,
      suggestions: [{ type: 'setMode', mode: 'acceptEdits' } as unknown],
    })
    await flush()
    m.respond({ requestId: asked(evs).id, behavior: 'allow_always' })
    expect(await waiting).toEqual({ behavior: 'allow', updatedInput: input })
    expect(store.settings.projects[0]?.alwaysAllow).toMatchObject([{ kind: 'tool', value: 'Edit' }])
    const next = await canUse('Edit', input, { signal: new AbortController().signal })
    expect(next).toEqual({ behavior: 'allow', updatedInput: input })
    expect(evs.filter((e) => e.type === 'permission:resolved')).toHaveLength(1)
  })

  it('negar encerra a chamada', async () => {
    const { m, dir, canUse } = await started('default')
    const evs = track(m)
    const input = { file_path: join(dir, 'a.txt'), old_string: 'x', new_string: 'y' }
    const waiting = canUse('Edit', input, { signal: new AbortController().signal })
    await flush()
    m.respond({ requestId: asked(evs).id, behavior: 'deny', message: 'não' })
    expect(await waiting).toEqual({ behavior: 'deny', message: 'não' })
    expect(evs.filter((e) => e.type === 'permission:resolved')).toHaveLength(1)
  })

  it('abortar cancela o pedido e emite resolved', async () => {
    const { m, a, canUse } = await started('default')
    const evs = track(m)
    const ac = new AbortController()
    const waiting = canUse('Bash', { command: 'cp a b' }, { signal: ac.signal })
    await flush()
    expect(evs.filter((e) => e.type === 'permission:new')).toHaveLength(1)
    ac.abort()
    expect(await waiting).toEqual({ behavior: 'deny', message: 'Cancelado.' })
    expect(evs.filter((e) => e.type === 'permission:resolved')).toHaveLength(1)
    expect(m.agent(a.id)?.status).not.toBe('waiting')
  })

  it('a sessão do Office fecha as fontes externas de regras (settingSources: [])', async () => {
    await started('default')
    expect(queries[0]?.options.settingSources).toEqual([])
  })
})

describe('lenientRealpath: link com alvo quebrado não vira arquivo novo in-scope', () => {
  it('symlink existente com destino quebrado lança em vez de devolver caminho lexical do projeto', async () => {
    const { lenientRealpath } = await import('../src/main/agents/decisions')
    const base = mkdtempSync(join(tmpdir(), 'ao-link-'))
    try {
      mkdirSync(join(base, 'fora'), { recursive: true })
      // Junction no Windows dispensa privilégio de symlink; em POSIX vira symlink comum.
      symlinkSync(join(base, 'fora', 'nada'), join(base, 'atalho'), 'junction')
      expect(() => lenientRealpath(join(base, 'atalho', 'b.ts'))).toThrow()
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})
