import { beforeEach, describe, expect, it, vi } from 'vitest'

const { queryMock, mainAccountMock, accountEnvMock, findClaudeMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  mainAccountMock: vi.fn(() => 'main'),
  accountEnvMock: vi.fn(() => ({ TEST_ACCOUNT: 'main' })),
  findClaudeMock: vi.fn(() => 'claude-test'),
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: queryMock }))
vi.mock('../src/main/accounts', () => ({ mainAccount: mainAccountMock, accountEnv: accountEnvMock }))
vi.mock('../src/main/claude-path', () => ({ findClaude: findClaudeMock }))

import { claudeWritingInterpreter } from '../src/main/writing-claude'

function sdkStream(message: unknown) {
  const close = vi.fn()
  const stream = {
    async *[Symbol.asyncIterator]() {
      yield message
    },
    close,
  }
  return { stream, close }
}

describe('claudeWritingInterpreter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('faz uma chamada isolada sem ferramentas/sessão e retorna texto puro', async () => {
    const { stream, close } = sdkStream({ type: 'result', subtype: 'success', result: 'Texto revisado.' })
    queryMock.mockReturnValue(stream)
    const abort = new AbortController()
    await expect(claudeWritingInterpreter().interpret('Contexto sintético.', abort.signal)).resolves.toBe('Texto revisado.')
    expect(queryMock).toHaveBeenCalledOnce()
    const args = queryMock.mock.calls[0]![0]
    expect(args.prompt).toBe('Contexto sintético.')
    expect(args.options).toMatchObject({ tools: [], persistSession: false, maxTurns: 1, pathToClaudeCodeExecutable: 'claude-test' })
    expect(args.options.systemPrompt).toContain('Work as Agatha')
    expect(args.options.systemPrompt).toContain('plain text')
    expect(args.options.env).toMatchObject({ TEST_ACCOUNT: 'main', AGENT_OFFICE_MANAGED: '1' })
    expect(close).toHaveBeenCalledOnce()
  })

  it('traduz falha SDK sem propagar conteúdo da resposta', async () => {
    const { stream } = sdkStream({ type: 'result', subtype: 'error', result: 'CONTEÚDO SENSÍVEL' })
    queryMock.mockReturnValue(stream)
    await expect(claudeWritingInterpreter().interpret('ctx', new AbortController().signal)).rejects.toThrow(/resposta válida/)
  })

  it('propaga abort já solicitado ao controlador do SDK', async () => {
    const { stream } = sdkStream({ type: 'result', subtype: 'success', result: 'Texto.' })
    queryMock.mockReturnValue(stream)
    const abort = new AbortController()
    abort.abort()
    await claudeWritingInterpreter().interpret('ctx', abort.signal)
    expect(queryMock.mock.calls[0]![0].options.abortController.signal.aborted).toBe(true)
  })

  it('não chama SDK quando Claude não está disponível', async () => {
    findClaudeMock.mockReturnValueOnce(null as never)
    await expect(claudeWritingInterpreter().interpret('ctx', new AbortController().signal)).rejects.toThrow()
    expect(queryMock).not.toHaveBeenCalled()
  })
})
