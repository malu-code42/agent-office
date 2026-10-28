import { beforeEach, describe, expect, it, vi } from 'vitest'

const { query } = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query }))
vi.mock('../src/main/accounts', () => ({ mainAccount: () => ({ id: 'main', name: 'Principal', provider: 'claude', color: '#000' }), accountEnv: () => ({ PATH: 'safe-test-path' }) }))
vi.mock('../src/main/claude-path', () => ({ findClaude: () => 'claude-test-executable' }))

import { claudeProjectWorkflowGenerator } from '../src/main/project-workflow-claude'

const workflow = {
  projectId: 'project-1', goal: 'Busca acessível', grill: 'Grill aprovado', grillApprovedAt: 1,
  spec: 'Busca por teclado', criteria: ['Usável por teclado'], specApprovedAt: 2,
  ticketIds: [], ticketDrafts: [], ticketsApprovedAt: null, assignments: {}, updatedAt: 3,
}

describe('claudeProjectWorkflowGenerator', () => {
  beforeEach(() => query.mockReset())

  it('uses a single tool-free, non-persistent Claude turn and returns parsed draft JSON', async () => {
    const close = vi.fn()
    query.mockReturnValue({
      close,
      async *[Symbol.asyncIterator]() {
        yield { type: 'result', subtype: 'success', result: '{"spec":"Busca","criteria":["Acessível"]}' }
      },
    })
    const generator = claudeProjectWorkflowGenerator({ defaultModel: 'claude-sonnet-4-5' })

    const result = await generator.generate({ kind: 'spec', workflow, documents: [{ path: 'docs/brief.md', content: 'Usuários precisam de busca.' }] })

    expect(result).toEqual({ spec: 'Busca', criteria: ['Acessível'] })
    expect(query).toHaveBeenCalledOnce()
    const request = query.mock.calls[0][0]
    expect(request.prompt).toContain('docs/brief.md')
    expect(request.options).toMatchObject({
      cwd: expect.any(String), model: 'claude-sonnet-4-5', pathToClaudeCodeExecutable: 'claude-test-executable',
      tools: [], maxTurns: 1, permissionMode: 'default', persistSession: false,
      env: { PATH: 'safe-test-path', AGENT_OFFICE_MANAGED: '1' },
    })
    expect(close).toHaveBeenCalledOnce()
  })

  it('rejects malformed Claude output instead of silently substituting a draft', async () => {
    query.mockReturnValue({
      close: vi.fn(),
      async *[Symbol.asyncIterator]() {
        yield { type: 'result', subtype: 'success', result: 'not json' }
      },
    })
    const generator = claudeProjectWorkflowGenerator({})

    await expect(generator.generate({ kind: 'grill', workflow, documents: [] })).rejects.toThrow(/formato esperado/)
  })
})
