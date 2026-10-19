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
})
