import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectWorkflow } from '../src/shared/types'

const { query } = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query }))
vi.mock('../src/main/accounts', () => ({ mainAccount: () => ({ id: 'main', name: 'Principal', provider: 'claude', color: '#000' }), accountEnv: () => ({ PATH: 'safe-test-path' }) }))
vi.mock('../src/main/claude-path', () => ({ findClaude: () => 'claude-test-executable' }))

import { claudeProjectWorkflowGenerator } from '../src/main/project-workflow-claude'

const workflow: ProjectWorkflow = {
  projectId: 'project-1', goal: 'Busca acessível', bootstrap: 'done', bootstrapAt: 1,
  brainstorm: 'Brainstorm aprovado: usuários de teclado', brainstormApprovedAt: 1,
  design: 'Busca por teclado', designPath: 'docs/designs/busca.md', criteria: ['Usável por teclado'], designApprovedAt: 2,
  review: '', reviewApprovedAt: null,
  ticketIds: [], ticketDrafts: [], ticketsApprovedAt: null, assignments: {}, updatedAt: 3,
}

const answer = (result: string) => ({
  close: vi.fn(),
  async *[Symbol.asyncIterator]() {
    yield { type: 'result', subtype: 'success', result }
  },
})

describe('claudeProjectWorkflowGenerator', () => {
  beforeEach(() => query.mockReset())

  it('uses a single tool-free, non-persistent Claude turn and returns parsed draft JSON', async () => {
    const reply = answer('{"design":"Busca","criteria":["Acessível"]}')
    query.mockReturnValue(reply)
    const generator = claudeProjectWorkflowGenerator({ defaultModel: 'claude-sonnet-4-5' })

    const result = await generator.generate({ kind: 'design', workflow, documents: [{ path: 'docs/brief.md', content: 'Usuários precisam de busca.' }] })

    expect(result).toEqual({ design: 'Busca', criteria: ['Acessível'] })
    expect(query).toHaveBeenCalledOnce()
    const request = query.mock.calls[0][0]
    expect(request.prompt).toContain('docs/brief.md')
    expect(request.prompt).toContain('EGM draft stage')
    expect(request.options.systemPrompt).toContain('Elephant-Goldfish Model')
    expect(request.options).toMatchObject({
      cwd: expect.any(String), model: 'claude-sonnet-4-5', pathToClaudeCodeExecutable: 'claude-test-executable',
      tools: [], maxTurns: 1, permissionMode: 'default', persistSession: false,
      env: { PATH: 'safe-test-path', AGENT_OFFICE_MANAGED: '1' },
    })
    expect(reply.close).toHaveBeenCalledOnce()
  })

  it('the Goldfish review sees only the design doc: no brainstorm, no conversation, no project documents', async () => {
    query.mockReturnValue(answer('{"review":"Alta: falta paginação."}'))
    const generator = claudeProjectWorkflowGenerator({})

    await generator.generate({ kind: 'review', workflow, documents: [{ path: 'docs/segredo-do-contexto.md', content: 'contexto' }] })

    const prompt: string = query.mock.calls[0][0].prompt
    expect(prompt).toContain('Busca por teclado')
    expect(prompt).toContain('docs/designs/busca.md')
    expect(prompt).toContain('memoryless Goldfish reviewer')
    expect(prompt).not.toContain('Brainstorm aprovado')
    expect(prompt).not.toContain('docs/segredo-do-contexto.md')
  })

  it('rejects malformed Claude output instead of silently substituting a draft', async () => {
    query.mockReturnValue(answer('not json'))
    const generator = claudeProjectWorkflowGenerator({})

    await expect(generator.generate({ kind: 'brainstorm', workflow, documents: [] })).rejects.toThrow(/formato esperado/)
  })
})
