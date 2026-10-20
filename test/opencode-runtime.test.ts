import type { AgentSummary, SubagentInfo } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({ client: undefined as unknown }))

vi.mock('@opencode/client', () => ({ OpenCode: { make: () => mock.client } }))
vi.mock('@opencode/client/service', () => ({
  Service: {
    discover: async () => ({ url: 'http://127.0.0.1:4099', id: 'fixture' }),
    ensure: async () => ({ url: 'http://127.0.0.1:4099', id: 'fixture' }),
    headers: () => ({}),
  },
}))

const { OpenCodeRuntime } = await import('../src/main/opencode/runtime')

const agent = (): AgentSummary => ({
  id: 'agent-1',
  name: 'Ada',
  source: 'office',
  engine: 'opencode',
  cwd: 'C:\\projects\\demo',
  permissionMode: 'default',
  status: 'working',
  activity: '',
  desk: 0,
  look: {} as AgentSummary['look'],
  costUsd: 0,
  createdAt: 1,
  sessionId: 'session-main',
})

/** Structured envelope the mock judge answers in the decision stage. */
const PLAN = JSON.stringify({
  objective: 'Concluir a tarefa em subtarefas',
  decisions: [
    {
      task: 'Implementar subtarefa de código',
      profile: 'general',
      providerID: 'openai',
      modelID: 'gpt-6-luna',
      variant: 'high',
      rationale: 'General dimensiona bem a subtarefa de código',
      confidence: 0.9,
    },
  ],
})

/** The same envelope, with four delegations: the cap of the desk stops the fourth. */
const PLAN_FOUR = JSON.stringify({
  objective: 'Concluir a tarefa em quatro subtarefas',
  decisions: [1, 2, 3, 4].map((n) => ({
    task: `Implementar subtarefa ${n} de código`,
    profile: 'general',
    providerID: 'openai',
    modelID: 'gpt-6-luna',
    variant: 'high',
    rationale: 'General dimensiona bem a subtarefa de código',
    confidence: 0.9,
  })),
})

/** A persisted parent session with recovered children, as a resume sees it. */
interface RecoveredChild {
  id: string
  /** The model the child is really running; the approved one unless said otherwise. */
  model?: { providerID: string; id: string; variant: string }
  /** When the child was created: the desk adopts the oldest ones first. */
  created?: number
}

/**
 * A client for a resumed session: the parent already exists in the service and
 * the listed children may still be running. Returns the spies the tests read.
 */
const resumedClient = (parent: AgentSummary, recovered: RecoveredChild[], active: string[]) => {
  const parentSession = parent.sessionId ?? ''
  const update = vi.fn(async (_input: unknown) => undefined)
  const interrupt = vi.fn(async (_input: unknown) => undefined)
  const reply = vi.fn(async (_input: unknown) => undefined)
  const pendingPermissions = vi.fn(async (_input: { sessionID: string }): Promise<unknown[]> => [])
  let releaseEvents: (() => void) | undefined
  let finishEvents: (() => void) | undefined
  const eventReady = new Promise<void>((resolve) => (releaseEvents = resolve))
  const eventsConsumed = new Promise<void>((resolve) => (finishEvents = resolve))
  const prompt = vi.fn(async (_input: unknown) => {
    releaseEvents?.()
    await eventsConsumed
  })
  const listed = recovered.map((child, index) => ({
    id: child.id,
    parentID: parentSession,
    agent: 'general',
    title: `Subtarefa recuperada ${index + 1}`,
    model: child.model ?? { providerID: 'openai', id: 'gpt-6-luna', variant: 'high' },
    cost: 0,
    tokens: { input: 0, output: 0 },
    time: { created: child.created ?? index + 1, updated: 2 },
  }))
  mock.client = {
    server: { info: async () => ({ version: '2.0.32' }) },
    model: {
      list: async () => ({
        location: { directory: parent.cwd },
        data: [{ id: 'gpt-6-luna', providerID: 'openai', enabled: true, status: 'active', capabilities: { tools: true }, variants: [{ id: 'high' }], cost: [] }],
      }),
    },
    agent: { list: async () => ({ location: { directory: parent.cwd }, data: [{ id: 'general', name: 'General', mode: 'subagent', hidden: false, model: undefined }] }) },
    session: {
      get: async () => ({ ...parent, location: { directory: parent.cwd }, model: { providerID: 'openai', id: 'gpt-6-luna', variant: 'high' } }),
      create: vi.fn(),
      switchModel: vi.fn(),
      update,
      list: async () => ({ data: listed }),
      active: async () => Object.fromEntries(active.map((id) => [id, { id }])),
      prompt,
      interrupt,
    },
    event: {
      subscribe: ({ signal }: { signal: AbortSignal }) => ({
        async *[Symbol.asyncIterator]() {
          // The real stream ends when the runtime aborts it, even before any event.
          const aborted = new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
          await Promise.race([eventReady, aborted])
          if (signal.aborted) return
          yield { type: 'session.text.delta', data: { sessionID: parentSession, delta: 'Resumed.' } }
          yield { type: 'session.execution.succeeded', data: { sessionID: parentSession } }
          finishEvents?.()
          if (!signal.aborted) await aborted
        },
      }),
    },
    permission: { list: pendingPermissions, reply },
    message: {
      list: async () => ({
        data: [{ type: 'assistant', cost: 0, tokens: { input: 8, output: 3 }, content: [{ type: 'text', text: PLAN }] }],
      }),
    },
  }
  return { update, interrupt, prompt, reply, pendingPermissions }
}

describe('OpenCodeRuntime', () => {
  beforeEach(() => {
    mock.client = undefined
  })

  it('pins the main and child sessions to the approved model, validates the judge plan, then executes it', async () => {
    const parent = agent()
    const childID = 'session-child'
    const overflowChildID = 'session-child-overflow'
    const stageTwo: Array<{ type: string; data: Record<string, unknown> }> = [
      {
        type: 'session.created',
        data: { sessionID: childID, parentID: parent.sessionId, agent: 'general', title: 'Implementar subtarefa', model: { providerID: 'openai', id: 'gpt-6-luna', variant: 'high' } },
      },
      {
        type: 'session.created',
        data: { sessionID: overflowChildID, parentID: parent.sessionId, agent: 'general', title: 'Subtarefa excedente', model: { providerID: 'openai', id: 'gpt-6-luna', variant: 'high' } },
      },
      { type: 'session.text.delta', data: { sessionID: childID, delta: 'CHILD_OK' } },
      { type: 'session.usage.updated', data: { sessionID: childID, cost: 0, tokens: { input: 4, output: 2 } } },
      { type: 'session.execution.succeeded', data: { sessionID: childID } },
      { type: 'permission.asked', data: { sessionID: parent.sessionId, id: 'permission-1', action: 'read', resources: ['src/a.ts'], message: 'Ler fixture' } },
      { type: 'session.text.delta', data: { sessionID: parent.sessionId, delta: 'SPIKE_OK' } },
      { type: 'session.usage.updated', data: { sessionID: parent.sessionId, cost: 0, tokens: { input: 8, output: 3 } } },
      { type: 'session.execution.succeeded', data: { sessionID: parent.sessionId } },
    ]
    let releaseEvents: (() => void) | undefined
    let openMidGate: (() => void) | undefined
    let finishEvents: (() => void) | undefined
    const eventReady = new Promise<void>((resolve) => (releaseEvents = resolve))
    const midGate = new Promise<void>((resolve) => (openMidGate = resolve))
    const eventsConsumed = new Promise<void>((resolve) => (finishEvents = resolve))
    const create = vi.fn(async () => undefined)
    const switchModel = vi.fn(async () => undefined)
    const update = vi.fn(async () => undefined)
    const reply = vi.fn(async () => undefined)
    const interrupt = vi.fn(async () => undefined)
    const prompt = vi.fn(async (_input: unknown) => {
      if (prompt.mock.calls.length === 1) {
        releaseEvents?.()
        return
      }
      openMidGate?.()
      await eventsConsumed
    })
    mock.client = {
      server: { info: async () => ({ version: '2.0.32' }) },
      model: {
        list: async () => ({
          location: { directory: parent.cwd },
          data: [{ id: 'gpt-6-luna', providerID: 'openai', enabled: true, status: 'active', capabilities: { tools: true }, variants: [{ id: 'high' }], cost: [] }],
        }),
      },
      agent: { list: async () => ({ location: { directory: parent.cwd }, data: [{ id: 'general', name: 'General', mode: 'subagent', hidden: false, model: undefined }] }) },
      session: {
        get: async () => { throw { status: 404 } },
        create,
        switchModel,
        update,
        list: async () => ({ data: [] }),
        active: async () => ({}),
        prompt,
        interrupt,
      },
      event: {
        subscribe: ({ signal }: { signal: AbortSignal }) => ({
          async *[Symbol.asyncIterator]() {
            await eventReady
            await midGate
            for (const event of stageTwo) yield event
            finishEvents?.()
            if (!signal.aborted) await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
          },
        }),
      },
      permission: { list: async () => [], reply },
      message: {
        list: async () => ({
          data: [{ type: 'assistant', cost: 0, tokens: { input: 8, output: 3 }, content: [{ type: 'text', text: PLAN }] }],
        }),
      },
    }

    const runtime = new OpenCodeRuntime()
    const permission = vi.fn(async () => 'once' as const)
    const children: SubagentInfo[] = []
    const streamed: string[] = []
    const turn = await runtime.run(parent, 'Tarefa sintética', new AbortController().signal, permission, (child) => children.push(child), (delta) => streamed.push(delta), 1)

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      id: parent.sessionId,
      location: { directory: parent.cwd },
      model: { providerID: 'openai', id: 'gpt-6-luna', variant: 'high' },
    }))
    expect(prompt).toHaveBeenCalledTimes(2)
    const promptText = (call: number): string => {
      const input = (prompt.mock.calls[call] ?? [])[0] as { text?: unknown } | undefined
      return typeof input?.text === 'string' ? input.text : ''
    }
    expect(promptText(0)).toContain('ETAPA 1')
    expect(promptText(0)).toContain('Tarefa sintética')
    expect(promptText(0)).not.toContain('Implementar subtarefa de código')
    const executionText = promptText(1)
    expect(executionText).toContain('ETAPA 2')
    expect(executionText).toContain('"task": "Implementar subtarefa de código"')
    expect(executionText).toContain('"profile": "general"')
    expect(switchModel).not.toHaveBeenCalledWith({ sessionID: childID, model: { providerID: 'openai', id: 'gpt-6-luna', variant: 'high' } })
    expect(update).toHaveBeenCalledWith({ sessionID: childID, permissions: expect.arrayContaining([expect.objectContaining({ action: '*', effect: 'ask' })]) })
    expect(permission).toHaveBeenCalledWith(expect.objectContaining({ action: 'read', resources: ['src/a.ts'] }))
    expect(reply).toHaveBeenCalledWith({ sessionID: parent.sessionId, requestID: 'permission-1', decision: 'once' })
    expect(children).toContainEqual(expect.objectContaining({ id: childID, status: 'completed', model: 'openai/gpt-6-luna', summary: 'CHILD_OK' }))
    expect(children).toContainEqual(expect.objectContaining({ id: overflowChildID, status: 'failed', summary: expect.stringContaining('limite') }))
    expect(interrupt).toHaveBeenCalledWith({ sessionID: overflowChildID })
    expect(streamed.join('')).toBe('SPIKE_OK')
    expect(turn).toMatchObject({ model: 'gpt-6-luna', providerID: 'openai', variant: 'high', text: 'SPIKE_OK' })
    expect(turn.plan).toHaveLength(1)
    expect(turn.plan[0]).toMatchObject({ profile: 'general', providerID: 'openai', modelID: 'gpt-6-luna', variant: 'high', confidence: 0.9 })
    expect(turn.costUsd).toBeUndefined()
  })

  it('stops at three subagents per desk, even when the plan asks for more', async () => {
    const parent = agent()
    const childIDs = ['session-c1', 'session-c2', 'session-c3', 'session-c4']
    const stageTwo: Array<{ type: string; data: Record<string, unknown> }> = [
      ...childIDs.map((id, i) => ({
        type: 'session.created',
        data: { sessionID: id, parentID: parent.sessionId, agent: 'general', title: `Subtarefa ${i + 1}`, model: { providerID: 'openai', id: 'gpt-6-luna', variant: 'high' } },
      })),
      { type: 'session.text.delta', data: { sessionID: parent.sessionId, delta: 'OK' } },
      { type: 'session.execution.succeeded', data: { sessionID: parent.sessionId } },
    ]
    let releaseEvents: (() => void) | undefined
    let openMidGate: (() => void) | undefined
    let finishEvents: (() => void) | undefined
    const eventReady = new Promise<void>((resolve) => (releaseEvents = resolve))
    const midGate = new Promise<void>((resolve) => (openMidGate = resolve))
    const eventsConsumed = new Promise<void>((resolve) => (finishEvents = resolve))
    const interrupt = vi.fn(async () => undefined)
    const prompt = vi.fn(async (_input: unknown) => {
      if (prompt.mock.calls.length === 1) {
        releaseEvents?.()
        return
      }
      openMidGate?.()
      await eventsConsumed
    })
    mock.client = {
      server: { info: async () => ({ version: '2.0.32' }) },
      model: {
        list: async () => ({
          location: { directory: parent.cwd },
          data: [{ id: 'gpt-6-luna', providerID: 'openai', enabled: true, status: 'active', capabilities: { tools: true }, variants: [{ id: 'high' }], cost: [] }],
        }),
      },
      agent: { list: async () => ({ location: { directory: parent.cwd }, data: [{ id: 'general', name: 'General', mode: 'subagent', hidden: false, model: undefined }] }) },
      session: {
        get: async () => { throw { status: 404 } },
        create: vi.fn(async () => undefined),
        switchModel: vi.fn(async () => undefined),
        update: vi.fn(async () => undefined),
        list: async () => ({ data: [] }),
        active: async () => ({}),
        prompt,
        interrupt,
      },
      event: {
        subscribe: ({ signal }: { signal: AbortSignal }) => ({
          async *[Symbol.asyncIterator]() {
            await eventReady
            await midGate
            for (const event of stageTwo) yield event
            finishEvents?.()
            if (!signal.aborted) await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
          },
        }),
      },
      permission: { list: async () => [], reply: vi.fn() },
      message: { list: async () => ({ data: [{ type: 'assistant', content: [{ type: 'text', text: PLAN_FOUR }] }] }) },
    }

    const runtime = new OpenCodeRuntime()
    const children: SubagentInfo[] = []
    // No configured limit: the cap of the desk (three) is the one that applies.
    await runtime.run(parent, 'Tarefa sintética', new AbortController().signal, async () => 'once', (child) => children.push(child), () => undefined)
    const blocked = children.find((c) => c.id === 'session-c4')
    expect(blocked?.status).toBe('failed')
    expect(blocked?.summary).toContain('limite de 3')
    expect(interrupt).toHaveBeenCalledWith({ sessionID: 'session-c4' })
    for (const id of childIDs.slice(0, 3)) expect(children.some((c) => c.id === id && !c.status)).toBe(true)
  })

  it('does not resume a persisted OpenCode session from another worktree', async () => {
    const parent = agent()
    const prompt = vi.fn()
    mock.client = {
      server: { info: async () => ({ version: '2.0.32' }) },
      model: { list: async () => ({ location: { directory: parent.cwd }, data: [{ id: 'gpt-6-luna', providerID: 'openai', enabled: true, status: 'active', capabilities: { tools: true }, variants: [{ id: 'high' }], cost: [] }] }) },
      agent: { list: async () => ({ data: [] }) },
      session: {
        get: async () => ({ ...parent, location: { directory: 'C:\\other-project' } }),
        create: vi.fn(),
        switchModel: vi.fn(),
        update: vi.fn(),
        prompt,
        interrupt: vi.fn(),
      },
    }
    const runtime = new OpenCodeRuntime()
    await expect(runtime.run(parent, 'Não deve enviar', new AbortController().signal, async () => 'reject', () => undefined, () => undefined)).rejects.toThrow(/outra pasta/)
    expect(prompt).not.toHaveBeenCalled()
  })

  it('pauses when GPT-6 is unavailable instead of trying a free model', async () => {
    const parent = agent()
    const create = vi.fn()
    mock.client = {
      server: { info: async () => ({ version: '2.0.32' }) },
      model: {
        list: async () => ({ data: [{ id: 'beam-free', providerID: 'opencode', enabled: true, status: 'active', capabilities: { tools: true }, variants: [{ id: 'high' }], cost: [] }] }),
      },
      agent: { list: async () => ({ data: [] }) },
      session: { create, get: async () => { throw { status: 404 } } },
    }
    const runtime = new OpenCodeRuntime()
    await expect(runtime.run(parent, 'synthetic', new AbortController().signal, async () => 'reject', () => undefined, () => undefined)).rejects.toThrow(
      /Nenhum modelo aprovado está disponível/,
    )
    expect(create).not.toHaveBeenCalled()
  })

  it('interrupts a child and its parent instead of switching an unapproved child model after spawn', async () => {
    const parent = agent()
    const childID = 'session-child-unapproved-model'
    let releaseEvents: (() => void) | undefined
    let openMidGate: (() => void) | undefined
    let finishEvents: (() => void) | undefined
    const eventReady = new Promise<void>((resolve) => (releaseEvents = resolve))
    const midGate = new Promise<void>((resolve) => (openMidGate = resolve))
    const eventsConsumed = new Promise<void>((resolve) => (finishEvents = resolve))
    const interrupt = vi.fn(async () => undefined)
    const childEvent = {
      type: 'session.created',
      data: {
        sessionID: childID,
        parentID: parent.sessionId,
        agent: 'general',
        title: 'Subtarefa não aprovada',
        model: { providerID: 'opencode', id: 'beam-free', variant: 'high' },
      },
    }
    const switchModel = vi.fn(async () => undefined)
    const prompt = vi.fn(async () => {
      if (prompt.mock.calls.length === 1) {
        releaseEvents?.()
        return
      }
      openMidGate?.()
      await eventsConsumed
    })
    mock.client = {
      server: { info: async () => ({ version: '2.0.32' }) },
      model: {
        list: async () => ({ data: [{ id: 'gpt-6-luna', providerID: 'openai', enabled: true, status: 'active', capabilities: { tools: true }, variants: [{ id: 'high' }], cost: [] }] }),
      },
      agent: { list: async () => ({ data: [{ id: 'general', mode: 'subagent', hidden: false, model: undefined }] }) },
      session: {
        get: async () => { throw { status: 404 } },
        create: vi.fn(),
        switchModel,
        update: vi.fn(),
        active: async () => ({}),
        list: async () => ({ data: [] }),
        prompt,
        interrupt,
      },
      event: {
        subscribe: ({ signal }: { signal: AbortSignal }) => ({
          async *[Symbol.asyncIterator]() {
            await eventReady
            await midGate
            yield childEvent
            yield { type: 'session.execution.succeeded', data: { sessionID: parent.sessionId } }
            finishEvents?.()
            if (!signal.aborted) await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
          },
        }),
      },
      permission: { list: async () => [], reply: vi.fn() },
      message: { list: async () => ({ data: [{ type: 'assistant', content: [{ type: 'text', text: PLAN }] }] }) },
    }

    const runtime = new OpenCodeRuntime()
    await expect(
      runtime.run(parent, 'synthetic', new AbortController().signal, async () => 'once', () => undefined, () => undefined),
    ).rejects.toThrow(/subagente.*modelo.*aprovado/i)
    expect(interrupt).toHaveBeenCalledWith({ sessionID: childID })
    expect(interrupt).toHaveBeenCalledWith({ sessionID: parent.sessionId })
    expect(switchModel).not.toHaveBeenCalledWith({
      sessionID: childID,
      model: { providerID: 'openai', id: 'gpt-6-luna', variant: 'high' },
    })
  })

  it('replays pending Office approval requests when resuming a persisted OpenCode session', async () => {
    const parent = agent()
    const permissionRequest = { id: 'pending-permission', sessionID: parent.sessionId, action: 'read', resources: ['src/a.ts'] }
    let releaseEvents: (() => void) | undefined
    let finishEvents: (() => void) | undefined
    const eventReady = new Promise<void>((resolve) => (releaseEvents = resolve))
    const eventsConsumed = new Promise<void>((resolve) => (finishEvents = resolve))
    const reply = vi.fn(async () => undefined)
    const prompt = vi.fn(async () => {
      releaseEvents?.()
      await eventsConsumed
    })
    mock.client = {
      server: { info: async () => ({ version: '2.0.32' }) },
      model: {
        list: async () => ({ data: [{ id: 'gpt-6-luna', providerID: 'openai', enabled: true, status: 'active', capabilities: { tools: true }, variants: [{ id: 'high' }], cost: [] }] }),
      },
      agent: { list: async () => ({ data: [{ id: 'general', mode: 'subagent', hidden: false, model: undefined }] }) },
      session: {
        get: async () => ({ ...parent, location: { directory: parent.cwd }, model: { id: 'gpt-6-luna', providerID: 'openai', variant: 'high' } }),
        create: vi.fn(),
        switchModel: vi.fn(),
        update: vi.fn(),
        list: async () => ({ data: [] }),
        active: async () => ({}),
        prompt,
        interrupt: async () => undefined,
      },
      event: {
        subscribe: ({ signal }: { signal: AbortSignal }) => ({
          async *[Symbol.asyncIterator]() {
            await eventReady
            yield { type: 'session.text.delta', data: { sessionID: parent.sessionId, delta: 'Resumed.' } }
            yield { type: 'session.execution.succeeded', data: { sessionID: parent.sessionId } }
            finishEvents?.()
            if (!signal.aborted) await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
          },
        }),
      },
      permission: { list: async () => [permissionRequest], reply },
      message: { list: async () => ({ data: [{ type: 'assistant', content: [{ type: 'text', text: PLAN }] }] }) },
    }
    const runtime = new OpenCodeRuntime()
    const requests: unknown[] = []
    await runtime.run(parent, 'Continue safely', new AbortController().signal, async (request) => {
      requests.push(request)
      return 'once'
    }, () => undefined, () => undefined)
    expect(requests).toEqual([expect.objectContaining({ requestID: 'pending-permission', action: 'read' })])
    expect(reply).toHaveBeenCalledWith({ sessionID: parent.sessionId, requestID: 'pending-permission', decision: 'once' })
    expect(prompt).toHaveBeenCalledTimes(2)
  })

  it('pauses without executing when the judge plan fails local validation', async () => {
    const parent = agent()
    const badPlan = JSON.stringify({
      objective: 'Concluir a tarefa',
      decisions: [
        {
          task: 'Subtarefa proibida',
          profile: 'explore',
          providerID: 'openai',
          modelID: 'gpt-6-luna',
          variant: 'high',
          rationale: 'Preferiria outro perfil para agilizar',
          confidence: 0.9,
        },
      ],
    })
    const create = vi.fn()
    const switchModel = vi.fn(async () => undefined)
    const interrupt = vi.fn(async () => undefined)
    const promptCalls: string[] = []
    mock.client = {
      server: { info: async () => ({ version: '2.0.32' }) },
      model: {
        list: async () => ({ data: [{ id: 'gpt-6-luna', providerID: 'openai', enabled: true, status: 'active', capabilities: { tools: true }, variants: [{ id: 'high' }], cost: [] }] }),
      },
      agent: { list: async () => ({ data: [{ id: 'general', mode: 'subagent', hidden: false, model: undefined }] }) },
      session: {
        get: async () => { throw { status: 404 } },
        create,
        switchModel,
        update: vi.fn(),
        list: async () => ({ data: [] }),
        active: async () => ({}),
        prompt: vi.fn(async (input: { text: string }) => {
          promptCalls.push(input.text)
        }),
        interrupt,
      },
      event: {
        subscribe: ({ signal }: { signal: AbortSignal }) => ({
          [Symbol.asyncIterator]() {
            return {
              async next() {
                if (signal.aborted) return { done: true as const, value: undefined }
                await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
                return { done: true as const, value: undefined }
              },
            }
          },
        }),
      },
      permission: { list: async () => [], reply: vi.fn() },
      message: { list: async () => ({ data: [{ type: 'assistant', content: [{ type: 'text', text: badPlan }] }] }) },
    }

    const runtime = new OpenCodeRuntime()
    await expect(
      runtime.run(parent, 'synthetic', new AbortController().signal, async () => 'once', () => undefined, () => undefined),
    ).rejects.toThrow(/não passou na validação local[\s\S]*perfil `explore` não está entre os aprovados/)
    expect(promptCalls).toHaveLength(1)
    expect(promptCalls[0]).toContain('ETAPA 1')
    expect(create).toHaveBeenCalled()
    expect(switchModel).not.toHaveBeenCalled()
  })

  it('fails closed when a subagent is born before the plan passes validation', async () => {
    const parent = agent()
    const earlyChildID = 'session-child-early'
    let releaseEvents: (() => void) | undefined
    const eventReady = new Promise<void>((resolve) => (releaseEvents = resolve))
    const create = vi.fn(async () => undefined)
    const switchModel = vi.fn(async () => undefined)
    const update = vi.fn(async () => undefined)
    const interrupt = vi.fn(async () => undefined)
    const children: SubagentInfo[] = []
    const prompt = vi.fn(async (_input: unknown, { signal }: { signal: AbortSignal }) => {
      if (prompt.mock.calls.length !== 1) return
      releaseEvents?.()
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
    })
    mock.client = {
      server: { info: async () => ({ version: '2.0.32' }) },
      model: {
        list: async () => ({
          location: { directory: parent.cwd },
          data: [{ id: 'gpt-6-luna', providerID: 'openai', enabled: true, status: 'active', capabilities: { tools: true }, variants: [{ id: 'high' }], cost: [] }],
        }),
      },
      agent: { list: async () => ({ location: { directory: parent.cwd }, data: [{ id: 'general', name: 'General', mode: 'subagent', hidden: false, model: undefined }] }) },
      session: {
        get: async () => { throw { status: 404 } },
        create,
        switchModel,
        update,
        list: async () => ({ data: [] }),
        active: async () => ({}),
        prompt,
        interrupt,
      },
      event: {
        subscribe: ({ signal }: { signal: AbortSignal }) => ({
          async *[Symbol.asyncIterator]() {
            await eventReady
            yield {
              type: 'session.created',
              data: { sessionID: earlyChildID, parentID: parent.sessionId, agent: 'general', title: 'Subtarefa prematura', model: { providerID: 'openai', id: 'gpt-6-luna', variant: 'high' } },
            }
            if (!signal.aborted) await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
          },
        }),
      },
      permission: { list: async () => [], reply: vi.fn() },
      message: { list: async () => ({ data: [{ type: 'assistant', content: [{ type: 'text', text: PLAN }] }] }) },
    }

    const runtime = new OpenCodeRuntime()
    await expect(
      runtime.run(parent, 'synthetic', new AbortController().signal, async () => 'once', (child) => children.push(child), () => undefined),
    ).rejects.toThrow(/antes da validação do plano/)
    expect(prompt).toHaveBeenCalledTimes(1)
    expect(interrupt).toHaveBeenCalledWith({ sessionID: earlyChildID })
    expect(interrupt).toHaveBeenCalledWith({ sessionID: parent.sessionId })
    const blocked = children.at(-1)
    expect(blocked?.status).toBe('failed')
    expect(blocked?.summary).toContain('antes da validação do plano')
  })

  it('fails closed when the judge delegates outside the validated plan and still audits it', async () => {
    const parent = agent()
    const childID = 'session-child-planned'
    const extraChildID = 'session-child-extra'
    const stageTwo: Array<{ type: string; data: Record<string, unknown> }> = [
      {
        type: 'session.created',
        data: { sessionID: childID, parentID: parent.sessionId, agent: 'general', title: 'Subtarefa planejada', model: { providerID: 'openai', id: 'gpt-6-luna', variant: 'high' } },
      },
      {
        type: 'session.created',
        data: { sessionID: extraChildID, parentID: parent.sessionId, agent: 'general', title: 'Subtarefa fora do plano', model: { providerID: 'openai', id: 'gpt-6-luna', variant: 'high' } },
      },
    ]
    let releaseEvents: (() => void) | undefined
    let openMidGate: (() => void) | undefined
    let finishEvents: (() => void) | undefined
    const eventReady = new Promise<void>((resolve) => (releaseEvents = resolve))
    const midGate = new Promise<void>((resolve) => (openMidGate = resolve))
    const eventsConsumed = new Promise<void>((resolve) => (finishEvents = resolve))
    const create = vi.fn(async () => undefined)
    const switchModel = vi.fn(async () => undefined)
    const update = vi.fn(async () => undefined)
    const interrupt = vi.fn(async () => undefined)
    const children: SubagentInfo[] = []
    const audit = vi.fn()
    const prompt = vi.fn(async () => {
      if (prompt.mock.calls.length === 1) {
        releaseEvents?.()
        return
      }
      openMidGate?.()
      await eventsConsumed
    })
    mock.client = {
      server: { info: async () => ({ version: '2.0.32' }) },
      model: {
        list: async () => ({
          location: { directory: parent.cwd },
          data: [{ id: 'gpt-6-luna', providerID: 'openai', enabled: true, status: 'active', capabilities: { tools: true }, variants: [{ id: 'high' }], cost: [] }],
        }),
      },
      agent: { list: async () => ({ location: { directory: parent.cwd }, data: [{ id: 'general', name: 'General', mode: 'subagent', hidden: false, model: undefined }] }) },
      session: {
        get: async () => { throw { status: 404 } },
        create,
        switchModel,
        update,
        list: async () => ({ data: [] }),
        active: async () => ({}),
        prompt,
        interrupt,
      },
      event: {
        subscribe: ({ signal }: { signal: AbortSignal }) => ({
          async *[Symbol.asyncIterator]() {
            await eventReady
            await midGate
            for (const event of stageTwo) yield event
            finishEvents?.()
            if (!signal.aborted) await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
          },
        }),
      },
      permission: { list: async () => [], reply: vi.fn() },
      message: { list: async () => ({ data: [{ type: 'assistant', content: [{ type: 'text', text: PLAN }] }] }) },
    }

    const runtime = new OpenCodeRuntime()
    await expect(
      runtime.run(parent, 'synthetic', new AbortController().signal, async () => 'once', (child) => children.push(child), () => undefined, 10, audit),
    ).rejects.toThrow(/fora do plano validado/)
    expect(prompt).toHaveBeenCalledTimes(2)
    expect(interrupt).toHaveBeenCalledWith({ sessionID: extraChildID })
    expect(interrupt).toHaveBeenCalledWith({ sessionID: parent.sessionId })
    const accepted = children.find((child) => child.id === childID)
    expect(accepted?.status).toBeUndefined()
    const blocked = children.at(-1)
    expect(blocked?.id).toBe(extraChildID)
    expect(blocked?.status).toBe('failed')
    expect(audit).toHaveBeenCalledTimes(1)
    const recorded = audit.mock.calls[0]?.[0] as { decisions: unknown[] }
    expect(recorded.decisions).toHaveLength(1)
  })

  it('adopts at most the cap of the desk when a resumed session has more active children', async () => {
    const parent = agent()
    const recovered = ['session-r1', 'session-r2', 'session-r3', 'session-r4', 'session-r5']
    const { update, interrupt } = resumedClient(parent, recovered.map((id) => ({ id })), recovered)
    const runtime = new OpenCodeRuntime()
    const children: SubagentInfo[] = []
    await runtime.run(parent, 'Continue safely', new AbortController().signal, async () => 'once', (child) => children.push(child), () => undefined)

    // Only what fits the desk is adopted, and the order of the list decides who.
    expect(children.filter((child) => !child.status).map((child) => child.id)).toEqual(['session-r1', 'session-r2', 'session-r3'])
    // The excess is stopped and reported as a failure, with the reason of the cap.
    const blocked = children.filter((child) => child.status === 'failed')
    expect(blocked.map((child) => child.id)).toEqual(['session-r4', 'session-r5'])
    for (const child of blocked) expect(child.summary).toContain('limite de 3')
    expect(interrupt).toHaveBeenCalledWith({ sessionID: 'session-r4' })
    expect(interrupt).toHaveBeenCalledWith({ sessionID: 'session-r5' })
    // The cap never stops the parent session.
    expect(interrupt).not.toHaveBeenCalledWith({ sessionID: parent.sessionId })
    // The adopted children keep the Office permissions; the blocked ones get none.
    const updated = update.mock.calls.map((call) => (call[0] as { sessionID: string }).sessionID)
    expect(updated).toEqual(expect.arrayContaining(['session-r1', 'session-r2', 'session-r3']))
    expect(updated).not.toContain('session-r4')
    expect(updated).not.toContain('session-r5')
  })

  it('keeps the first recovered children when the configured limit is smaller than the cap of the desk', async () => {
    const parent = agent()
    const recovered = ['session-r1', 'session-r2', 'session-r3']
    const { update, interrupt } = resumedClient(parent, recovered.map((id) => ({ id })), recovered)
    const runtime = new OpenCodeRuntime()
    const children: SubagentInfo[] = []
    await runtime.run(parent, 'Continue safely', new AbortController().signal, async () => 'once', (child) => children.push(child), () => undefined, 1)

    expect(children.filter((child) => !child.status).map((child) => child.id)).toEqual(['session-r1'])
    const blocked = children.filter((child) => child.status === 'failed')
    expect(blocked.map((child) => child.id)).toEqual(['session-r2', 'session-r3'])
    for (const child of blocked) expect(child.summary).toContain('limite de 1')
    expect(interrupt).toHaveBeenCalledWith({ sessionID: 'session-r2' })
    expect(interrupt).toHaveBeenCalledWith({ sessionID: 'session-r3' })
    expect(interrupt).not.toHaveBeenCalledWith({ sessionID: parent.sessionId })
    const updated = update.mock.calls.map((call) => (call[0] as { sessionID: string }).sessionID)
    expect(updated).toContain('session-r1')
    expect(updated).not.toContain('session-r2')
    expect(updated).not.toContain('session-r3')
  })

  it('adopts the oldest recovered children, whatever order the service lists them', async () => {
    const parent = agent()
    // The service answers in the opposite order: the desk decides by age, so the
    // same children are always the ones adopted.
    const recovered = ['session-r5', 'session-r4', 'session-r3', 'session-r2', 'session-r1'].map((id, index) => ({
      id,
      created: 5 - index,
    }))
    const { update, interrupt, pendingPermissions } = resumedClient(parent, recovered, recovered.map((child) => child.id))
    const runtime = new OpenCodeRuntime()
    const children: SubagentInfo[] = []
    await runtime.run(parent, 'Continue safely', new AbortController().signal, async () => 'once', (child) => children.push(child), () => undefined)

    // The three oldest are adopted; the two newest do not fit the desk.
    expect(children.filter((child) => !child.status).map((child) => child.id)).toEqual(['session-r1', 'session-r2', 'session-r3'])
    const blocked = children.filter((child) => child.status === 'failed')
    expect(blocked.map((child) => child.id)).toEqual(['session-r4', 'session-r5'])
    for (const child of blocked) expect(child.summary).toContain('limite de 3')
    // Only the excess is stopped: the parent session keeps running.
    expect(interrupt).toHaveBeenCalledWith({ sessionID: 'session-r4' })
    expect(interrupt).toHaveBeenCalledWith({ sessionID: 'session-r5' })
    expect(interrupt).not.toHaveBeenCalledWith({ sessionID: parent.sessionId })
    // The excess gets no Office permission and no pending-approval replay.
    const updated = update.mock.calls.map((call) => (call[0] as { sessionID: string }).sessionID)
    expect(updated).not.toContain('session-r4')
    expect(updated).not.toContain('session-r5')
    const asked = pendingPermissions.mock.calls.map((call) => call[0].sessionID)
    expect(asked).not.toContain('session-r4')
    expect(asked).not.toContain('session-r5')
  })

  it('breaks a tie between children born at the same instant by their id', async () => {
    const parent = agent()
    // Two children share the same age: the id decides, so the desk always
    // adopts the same ones.
    const recovered = [
      { id: 'session-b', created: 2 },
      { id: 'session-a', created: 2 },
      { id: 'session-c', created: 1 },
      { id: 'session-d', created: 3 },
    ]
    const { interrupt } = resumedClient(parent, recovered, recovered.map((child) => child.id))
    const runtime = new OpenCodeRuntime()
    const children: SubagentInfo[] = []
    await runtime.run(parent, 'Continue safely', new AbortController().signal, async () => 'once', (child) => children.push(child), () => undefined)

    expect(children.filter((child) => !child.status).map((child) => child.id)).toEqual(['session-c', 'session-a', 'session-b'])
    const blocked = children.filter((child) => child.status === 'failed')
    expect(blocked.map((child) => child.id)).toEqual(['session-d'])
    expect(blocked[0]?.summary).toContain('limite de 3')
    expect(interrupt).toHaveBeenCalledWith({ sessionID: 'session-d' })
    expect(interrupt).not.toHaveBeenCalledWith({ sessionID: parent.sessionId })
  })

  it('keeps a recovered child refused by the cap blocked when the stream reconnects', async () => {
    const parent = agent()
    const recovered = ['session-r1', 'session-r2', 'session-r3', 'session-r4', 'session-r5']
    const refused = ['session-r4', 'session-r5']
    // The mock remembers what the runtime stopped: a refused child really ends.
    const stopped = new Set<string>()
    const interrupt = vi.fn(async (input: unknown) => {
      const id = (input as { sessionID: string }).sessionID
      if (id !== parent.sessionId) stopped.add(id)
    })
    const update = vi.fn(async (_input: { sessionID: string }) => undefined)
    const list = vi.fn(async () => ({
      data: recovered.map((id, index) => ({
        id,
        parentID: parent.sessionId,
        agent: 'general',
        title: `Subtarefa recuperada ${index + 1}`,
        model: { providerID: 'openai', id: 'gpt-6-luna', variant: 'high' },
        cost: 0,
        tokens: { input: 0, output: 0 },
        time: { created: index + 1, updated: 2 },
        ...(stopped.has(id) ? { outcome: 'interrupted' } : {}),
      })),
    }))
    let releaseEvents: (() => void) | undefined
    let finishEvents: (() => void) | undefined
    const eventReady = new Promise<void>((resolve) => (releaseEvents = resolve))
    const eventsConsumed = new Promise<void>((resolve) => (finishEvents = resolve))
    let subscriptions = 0
    const prompt = vi.fn(async (_input: unknown) => {
      releaseEvents?.()
      await eventsConsumed
    })
    mock.client = {
      server: { info: async () => ({ version: '2.0.32' }) },
      model: {
        list: async () => ({
          location: { directory: parent.cwd },
          data: [{ id: 'gpt-6-luna', providerID: 'openai', enabled: true, status: 'active', capabilities: { tools: true }, variants: [{ id: 'high' }], cost: [] }],
        }),
      },
      agent: { list: async () => ({ location: { directory: parent.cwd }, data: [{ id: 'general', name: 'General', mode: 'subagent', hidden: false, model: undefined }] }) },
      session: {
        get: async () => ({ ...parent, location: { directory: parent.cwd }, model: { providerID: 'openai', id: 'gpt-6-luna', variant: 'high' } }),
        create: vi.fn(),
        switchModel: vi.fn(),
        update,
        list,
        active: async () => Object.fromEntries(recovered.filter((id) => !stopped.has(id)).map((id) => [id, { id }])),
        prompt,
        interrupt,
      },
      event: {
        subscribe: ({ signal }: { signal: AbortSignal }) => ({
          async *[Symbol.asyncIterator]() {
            subscriptions++
            const aborted = new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
            if (subscriptions === 1) {
              // The stream drops right away: the runtime reconnects and reconciles again.
              throw new Error('O stream SSE do OpenCode foi encerrado.')
            }
            await Promise.race([eventReady, aborted])
            if (signal.aborted) return
            // The refused child really stops: the late event must not rewrite the failure.
            yield { type: 'session.execution.interrupted', data: { sessionID: 'session-r4' } }
            yield { type: 'session.text.delta', data: { sessionID: parent.sessionId, delta: 'Resumed.' } }
            yield { type: 'session.execution.succeeded', data: { sessionID: parent.sessionId } }
            finishEvents?.()
            if (!signal.aborted) await aborted
          },
        }),
      },
      permission: { list: vi.fn(async () => []), reply: vi.fn(async () => undefined) },
      message: {
        list: async () => ({
          data: [{ type: 'assistant', cost: 0, tokens: { input: 8, output: 3 }, content: [{ type: 'text', text: PLAN }] }],
        }),
      },
    }

    const runtime = new OpenCodeRuntime()
    const children: SubagentInfo[] = []
    await runtime.run(parent, 'Continue safely', new AbortController().signal, async () => 'once', (child) => children.push(child), () => undefined)

    // The stream really dropped: the runtime reconciled a second time.
    expect(list.mock.calls.length).toBeGreaterThan(1)
    expect(children.filter((child) => !child.status).map((child) => child.id)).toEqual(['session-r1', 'session-r2', 'session-r3'])
    // The refusal is told once, as a failure: the late "stopped" never replaces it.
    const reports = children.filter((child) => refused.includes(child.id))
    expect(reports).toHaveLength(2)
    for (const report of reports) {
      expect(report.status).toBe('failed')
      expect(report.summary).toContain('limite de 3')
    }
    expect(children.some((child) => child.id === 'session-r4' && child.status === 'stopped')).toBe(false)
    expect(children.some((child) => child.id === 'session-r5' && child.status === 'stopped')).toBe(false)
    // The refused children are never adopted and never get the Office policy.
    const updated = update.mock.calls.map((call) => (call[0] as { sessionID: string }).sessionID)
    expect(updated).not.toContain('session-r4')
    expect(updated).not.toContain('session-r5')
    expect(interrupt).not.toHaveBeenCalledWith({ sessionID: parent.sessionId })
  })

  it('keeps a child refused during the run blocked when the stream reconnects', async () => {
    const parent = agent()
    const childIDs = ['session-c1', 'session-c2', 'session-c3', 'session-c4']
    const created: string[] = []
    const stopped = new Set<string>()
    const interrupt = vi.fn(async (input: unknown) => {
      const id = (input as { sessionID: string }).sessionID
      if (id !== parent.sessionId) stopped.add(id)
    })
    const update = vi.fn(async () => undefined)
    const list = vi.fn(async () => ({
      data: created.map((id, index) => ({
        id,
        parentID: parent.sessionId,
        agent: 'general',
        title: `Subtarefa ${index + 1}`,
        model: { providerID: 'openai', id: 'gpt-6-luna', variant: 'high' },
        cost: 0,
        tokens: { input: 0, output: 0 },
        time: { created: index + 1, updated: 2 },
        ...(stopped.has(id) ? { outcome: 'interrupted' } : {}),
      })),
    }))
    let releaseEvents: (() => void) | undefined
    let openMidGate: (() => void) | undefined
    let finishEvents: (() => void) | undefined
    const eventReady = new Promise<void>((resolve) => (releaseEvents = resolve))
    const midGate = new Promise<void>((resolve) => (openMidGate = resolve))
    const eventsConsumed = new Promise<void>((resolve) => (finishEvents = resolve))
    let subscriptions = 0
    const prompt = vi.fn(async (_input: unknown) => {
      if (prompt.mock.calls.length === 1) {
        releaseEvents?.()
        return
      }
      openMidGate?.()
      await eventsConsumed
    })
    mock.client = {
      server: { info: async () => ({ version: '2.0.32' }) },
      model: {
        list: async () => ({
          location: { directory: parent.cwd },
          data: [{ id: 'gpt-6-luna', providerID: 'openai', enabled: true, status: 'active', capabilities: { tools: true }, variants: [{ id: 'high' }], cost: [] }],
        }),
      },
      agent: { list: async () => ({ location: { directory: parent.cwd }, data: [{ id: 'general', name: 'General', mode: 'subagent', hidden: false, model: undefined }] }) },
      session: {
        get: async () => { throw { status: 404 } },
        create: vi.fn(async () => undefined),
        switchModel: vi.fn(async () => undefined),
        update,
        list,
        active: async () => Object.fromEntries(created.filter((id) => !stopped.has(id)).map((id) => [id, { id }])),
        prompt,
        interrupt,
      },
      event: {
        subscribe: ({ signal }: { signal: AbortSignal }) => ({
          async *[Symbol.asyncIterator]() {
            subscriptions++
            const aborted = new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
            await eventReady
            await midGate
            if (subscriptions === 1) {
              for (const id of childIDs) {
                created.push(id)
                yield {
                  type: 'session.created',
                  data: { sessionID: id, parentID: parent.sessionId, agent: 'general', title: `Subtarefa ${id}`, model: { providerID: 'openai', id: 'gpt-6-luna', variant: 'high' } },
                }
              }
              // The service announces the refused child again: the refusal stands.
              yield {
                type: 'session.created',
                data: { sessionID: 'session-c4', parentID: parent.sessionId, agent: 'general', title: 'Subtarefa session-c4', model: { providerID: 'openai', id: 'gpt-6-luna', variant: 'high' } },
              }
              // The stream drops right after the spawns: the runtime reconnects.
              throw new Error('O stream SSE do OpenCode foi encerrado.')
            }
            yield { type: 'session.text.delta', data: { sessionID: parent.sessionId, delta: 'OK' } }
            yield { type: 'session.execution.succeeded', data: { sessionID: parent.sessionId } }
            finishEvents?.()
            if (!signal.aborted) await aborted
          },
        }),
      },
      permission: { list: vi.fn(async () => []), reply: vi.fn(async () => undefined) },
      message: {
        list: async () => ({
          data: [{ type: 'assistant', cost: 0, tokens: { input: 8, output: 3 }, content: [{ type: 'text', text: PLAN_FOUR }] }],
        }),
      },
    }

    const runtime = new OpenCodeRuntime()
    const children: SubagentInfo[] = []
    await runtime.run(parent, 'Tarefa sintética', new AbortController().signal, async () => 'once', (child) => children.push(child), () => undefined)

    // The stream really dropped: the runtime reconciled a second time.
    expect(list.mock.calls.length).toBeGreaterThan(1)
    const refusedReports = children.filter((child) => child.id === 'session-c4')
    expect(refusedReports).toHaveLength(1)
    expect(refusedReports[0]?.status).toBe('failed')
    expect(refusedReports[0]?.summary).toContain('limite de 3')
    // The late stop of the refused child never rewrites the failure.
    expect(children.some((child) => child.id === 'session-c4' && child.status === 'stopped')).toBe(false)
    expect(interrupt).toHaveBeenCalledWith({ sessionID: 'session-c4' })
    expect(interrupt).not.toHaveBeenCalledWith({ sessionID: parent.sessionId })
  })

  it('still pauses a resumed run when a recovered child runs another model', async () => {
    const parent = agent()
    const { interrupt } = resumedClient(parent, [{ id: 'session-r-bad', model: { providerID: 'opencode', id: 'beam-free', variant: 'high' } }], ['session-r-bad'])
    const runtime = new OpenCodeRuntime()
    await expect(
      runtime.run(parent, 'Continue safely', new AbortController().signal, async () => 'once', () => undefined, () => undefined),
    ).rejects.toThrow(/modelo aprovado/)
    expect(interrupt).toHaveBeenCalledWith({ sessionID: 'session-r-bad' })
    expect(interrupt).toHaveBeenCalledWith({ sessionID: parent.sessionId })
  })
})
