import { describe, expect, it, vi } from 'vitest'

// The question to the approved model: the timeout has to stop the session too, not
// only the stream of events, or the popup waits forever.

const mock = vi.hoisted(() => ({
  client: undefined as unknown,
  calls: [] as string[],
  promptSignal: undefined as AbortSignal | undefined,
  streamSignal: undefined as AbortSignal | undefined,
  createSignal: undefined as AbortSignal | undefined,
}))

vi.mock('../src/main/opencode/runtime', () => ({
  openCodeClient: async () => mock.client,
}))

const { askApprovedModel, TIMEOUT_MESSAGE } = await import('../src/main/opencode/ask')

/** A client with the approved model available and a prompt that never answers. */
function fakeClient(): unknown {
  return {
    model: {
      list: async () => ({
        data: [
          {
            providerID: 'openai',
            id: 'gpt-6-luna',
            enabled: true,
            status: 'active',
            capabilities: { tools: true },
            variants: [{ id: 'high' }],
          },
        ],
      }),
    },
    event: {
      subscribe: ({ signal }: { signal?: AbortSignal }) => {
        mock.streamSignal = signal
        // A stream só acaba com o sinal; nunca chega nenhum evento.
        return {
          next: () =>
            new Promise<IteratorResult<unknown>>((resolve) => {
              const done = () => resolve({ done: true, value: undefined })
              if (signal?.aborted) done()
              else signal?.addEventListener('abort', done, { once: true })
            }),
          [Symbol.asyncIterator]() {
            return this
          },
        }
      },
    },
    session: {
      create: async () => ({}),
      prompt: async (_body: unknown, opts?: { signal?: AbortSignal }) => {
        mock.promptSignal = opts?.signal
        // The model never answers: only the timeout ends this.
        return new Promise(() => {})
      },
      interrupt: async () => {
        mock.calls.push('interrupt')
      },
      remove: async () => {
        mock.calls.push('remove')
      },
    },
    permission: { reply: async () => ({}) },
    message: { list: async () => ({ data: [] }) },
  }
}

const ask = (opts: { signal?: AbortSignal; timeoutMs?: number }) =>
  askApprovedModel('qual é a equipe deste squad?', { cwd: '/tmp/projeto', title: 'Proposta de squad', ...opts })

describe('a pergunta ao modelo', () => {
  it('uma pergunta que nunca responde dá timeout e vira o erro da popup', async () => {
    mock.client = fakeClient()
    mock.calls = []
    await expect(ask({ timeoutMs: 40 })).rejects.toThrow(TIMEOUT_MESSAGE)
    // A sessão foi interrompida e jogada fora: nada continua rodando.
    expect(mock.calls).toContain('interrupt')
    expect(mock.calls).toContain('remove')
  })

  it('o timeout para a sessão e o stream de eventos com o mesmo sinal', async () => {
    mock.client = fakeClient()
    await expect(ask({ timeoutMs: 40 })).rejects.toThrow(TIMEOUT_MESSAGE)
    // O sinal que a sessão recebeu é o mesmo que o stream recebeu, e está abortado.
    expect(mock.promptSignal).toBeDefined()
    expect(mock.streamSignal).toBe(mock.promptSignal)
    expect(mock.promptSignal?.aborted).toBe(true)
  })

  it('o jogador desistindo também para a pergunta', async () => {
    mock.client = fakeClient()
    const control = new AbortController()
    const promise = ask({ signal: control.signal, timeoutMs: 10_000 })
    control.abort()
    const err = await promise.then(
      () => undefined,
      (e) => e,
    )
    expect(err).toBeDefined()
    expect(mock.promptSignal?.aborted).toBe(true)
  })

  it('sem modelo aprovado, a pergunta nem é feita', async () => {
    mock.client = {
      ...(fakeClient() as Record<string, unknown>),
      model: { list: async () => ({ data: [] }) },
    }
    await expect(ask({ timeoutMs: 40 })).rejects.toThrow(/Nenhum modelo aprovado/)
  })
})

describe('o timeout que para tudo', () => {
  it('a criação da sessão também recebe o sinal', async () => {
    // A criação pode demorar tanto quanto a resposta: ela não pode prender a popup.
    mock.client = {
      ...(fakeClient() as Record<string, unknown>),
      session: {
        create: async (_body: unknown, opts?: { signal?: AbortSignal }) => {
          mock.createSignal = opts?.signal
          return new Promise(() => {})
        },
        prompt: async () => ({}),
        interrupt: async () => {
          mock.calls.push('interrupt')
        },
        remove: async () => {
          mock.calls.push('remove')
        },
      },
    }
    mock.calls = []
    await expect(ask({ timeoutMs: 40 })).rejects.toThrow(TIMEOUT_MESSAGE)
    expect(mock.createSignal?.aborted).toBe(true)
    // A sessão que não chegou a ser criada é jogada fora do mesmo jeito.
    expect(mock.calls).toContain('remove')
  })

  it('um prompt que ignora o sinal não segura a popup', async () => {
    // A sessão ignora o abort e continua pendurada: o office não espera por ela.
    mock.client = {
      ...(fakeClient() as Record<string, unknown>),
      session: {
        create: async () => ({}),
        prompt: async () => new Promise(() => {}),
        interrupt: async () => {
          mock.calls.push('interrupt')
        },
        remove: async () => {
          mock.calls.push('remove')
        },
      },
    }
    mock.calls = []
    await expect(ask({ timeoutMs: 40 })).rejects.toThrow(TIMEOUT_MESSAGE)
    // A sessão pendurada é interrompida e removida.
    expect(mock.calls).toEqual(expect.arrayContaining(['interrupt', 'remove']))
  })

  it('a sessão é interrompida quando a pessoa desiste, não só no tempo', async () => {
    mock.client = fakeClient()
    mock.calls = []
    const control = new AbortController()
    const promise = ask({ signal: control.signal, timeoutMs: 10_000 })
    control.abort()
    await expect(promise).rejects.toThrow()
    expect(mock.calls).toContain('interrupt')
    expect(mock.calls).toContain('remove')
  })
})
