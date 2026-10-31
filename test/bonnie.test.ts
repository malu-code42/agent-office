import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { BONNIE_AGENT_ID } from '../src/shared/bonnie'
import { agentCapDecision } from '../src/shared/agent-cap'
import { buildClassSchedule } from '../src/shared/class-schedule'
import {
  createStudyCycleState,
  resetActiveStudyCycle,
  resumeStudyCycle,
  type StudyCycleQuestion,
  type StudyCycleState,
} from '../src/shared/study-cycle'
import type { StudyQuestion } from '../src/shared/study-questions'
import { parseStudyTrail } from '../src/shared/study-trail'
import { BONNIE_BLOCKED_TOOLS, bonnieToolDefs, type BonnieToolDeps } from '../src/main/bonnie-tools'

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

const TRAIL = [
  '## 2º período',
  '### [P2-ED] Estrutura de Dados — 45 h',
  '- [x] [P2-ED-01] Listas.',
  '- [ ] [P2-ED-05] Filas.',
  '- [ ] [P2-ED-06] Pilhas.',
].join('\n')

const bankQuestion = (id: string, topic: string): StudyQuestion => ({
  id,
  topic,
  tags: [],
  question: `Pergunta sintética sobre ${topic}?`,
  answer: 'Resposta secreta do gabarito',
  answerStatus: 'verified',
  originKind: 'enem',
  sourceTitle: 'Banco',
  sourceVisibility: 'local',
  attribution: 'a',
  license: 'l',
})

function studyDeps() {
  let state: StudyCycleState = { activeId: null, cycles: [] }
  const bank = [bankQuestion('q-filas001', 'Filas'), bankQuestion('q-filas002', 'Filas'), bankQuestion('q-pilha001', 'Pilhas')]
  const deps: BonnieToolDeps = {
    trail: () => parseStudyTrail(TRAIL),
    cycles: () => state,
    bank: () => bank,
    start: (topic, ids) => {
      const questions = ids.map((id): StudyCycleQuestion => ({
        id,
        sourceHash: 'h',
        source: bank.find((q) => q.id === id)!,
        response: 'minha resposta secreta',
        providedExcerpt: '',
        uncertain: false,
        assessment: null,
      }))
      state = createStudyCycleState(topic, questions, 10, state)
      return state
    },
    resume: (id) => (state = resumeStudyCycle(state, id)),
    setAside: () => (state = resetActiveStudyCycle(state)),
    schedule: () =>
      buildClassSchedule(
        '# Aulas\n- id: ed | dia: segunda | hora: 19:00 | título: Estrutura de Dados · Aula sobre filas\n',
        new Date(2026, 9, 26),
      ),
    recommend: vi.fn(async (theme: string) => ({
      query: theme,
      recommendations: [
        {
          path: 'study sources/ED/livro.pdf',
          title: 'livro.pdf',
          kind: 'pdf' as const,
          start: 12,
          end: 18,
          range: 'p. 12–18',
          score: 91,
          level: 5 as const,
          label: 'Muito relevante',
          snippet: 'TRECHO LOCAL QUE NÃO VAI AO CLAUDE',
        },
      ],
    })),
    openSource: vi.fn(async () => undefined),
  }
  return { deps, state: () => state }
}

async function call(deps: BonnieToolDeps, name: string, args: Record<string, unknown> = {}) {
  const def = bonnieToolDefs(deps).find((t) => t.name === name)!
  const out = (await def.handler(args as never, {} as never)) as { content: { text: string }[]; isError?: boolean }
  return { text: out.content[0]!.text, isError: out.isError === true }
}

describe('ferramentas da Bonnie (mcp__estudos__)', () => {
  it('lista a trilha por disciplina com o estado de cada tópico', async () => {
    const { deps } = studyDeps()
    const { text } = await call(deps, 'trail_list')
    expect(text).toContain('## Estrutura de Dados (2º período) — 2 em aberto de 3')
    expect(text).toContain('- [Marcado na trilha] [P2-ED-01] Listas')
    expect(text).toContain('- [Não iniciado] [P2-ED-05] Filas')
  })

  it('começa um tópico com as questões do banco, guarda o anterior e retoma sem perder nada', async () => {
    const { deps, state } = studyDeps()
    const first = await call(deps, 'cycle_start', { topic: '[P2-ED-05] Filas' })
    expect(first.isError).toBe(false)
    expect(first.text).toContain('2 questão(ões)')
    const filas = state().activeId!
    const second = await call(deps, 'cycle_start', { topic: '[P2-ED-06] Pilhas' })
    expect(second.text).toContain('O ciclo anterior ficou guardado')
    expect(state().cycles).toHaveLength(2)
    const back = await call(deps, 'cycle_start', { topic: '[P2-ED-05] Filas' })
    expect(back.text).toContain('retomado')
    expect(state().activeId).toBe(filas)
    const aside = await call(deps, 'cycle_switch')
    expect(aside.text).toContain('Nenhum ciclo ativo')
    expect(state().cycles).toHaveLength(2)
  })

  it('sem questões do banco sobre o tópico, explica o que fazer e não cria ciclo', async () => {
    const { deps, state } = studyDeps()
    const out = await call(deps, 'cycle_start', { topic: '[P2-ED-01] Listas' })
    expect(out.isError).toBe(true)
    expect(out.text).toMatch(/não tem questões/)
    expect(state().cycles).toHaveLength(0)
  })

  it('o estado do ciclo e as fontes da Cora não levam respostas, gabaritos nem conteúdo dos arquivos', async () => {
    const { deps } = studyDeps()
    await call(deps, 'cycle_start', { topic: '[P2-ED-05] Filas' })
    const status = await call(deps, 'cycle_status')
    expect(status.text).toContain('Etapa: diagnóstico')
    expect(status.text).toContain('Diagnóstico: 2 de 2 respondidas')
    expect(status.text).not.toMatch(/secreta|Pergunta sintética/)
    const cora = await call(deps, 'ask_cora', { theme: 'fila, estrutura de dados' })
    expect(cora.text).toContain('1. livro.pdf — p. 12–18 · Muito relevante (91/100) · study sources/ED/livro.pdf')
    expect(cora.text).not.toContain('TRECHO LOCAL')
    expect((await call(deps, 'schedule_read')).text).toMatch(/Seg 26\/10 \(hoje\) 19:00 · Estrutura de Dados · Aula sobre filas/)
    await call(deps, 'open_source', { path: 'study sources/ED/livro.pdf' })
    expect(deps.openSource).toHaveBeenCalledWith('study sources/ED/livro.pdf', undefined)
    await call(deps, 'open_source', { path: 'study sources/ED/livro.pdf', page: 12 })
    expect(deps.openSource).toHaveBeenLastCalledWith('study sources/ED/livro.pdf', 12)
  })
})

type Ask = (
  agent: unknown,
  tool: string,
  input: Record<string, unknown>,
  opts: { signal: AbortSignal },
) => Promise<{ behavior: string; message?: string }>

async function office() {
  app.setPath('userData', mkdtempSync(join(tmpdir(), 'ao-bonnie-')))
  const vault = mkdtempSync(join(tmpdir(), 'ao-bonnie-vault-'))
  writeFileSync(join(vault, 'trilha zettel.md'), TRAIL)
  const { Store } = await import('../src/main/store')
  const { AgentManager } = await import('../src/main/agents')
  const store = new Store()
  store.settings = { ...store.settings, vaultPath: vault }
  return { Store, AgentManager, store, vault, manager: new AgentManager(store) }
}

describe('a Bonnie, agente fixa do andar de estudos', () => {
  it('já existe, não ocupa vaga de contratação e não pode ser dispensada', async () => {
    const { manager, store } = await office()
    expect(manager.list().find((a) => a.id === BONNIE_AGENT_ID)).toMatchObject({
      name: 'Bonnie',
      builtIn: 'bonnie',
      desk: -1,
      permissionMode: 'default',
    })
    expect(agentCapDecision(manager.list())).toEqual({ regular: 0, result: 'regular' })
    expect(() => manager.fire(BONNIE_AGENT_ID)).toThrow(/não pode ser dispensada/)
    manager.shutdown()
    store.flush()
  })

  it('conversa numa pasta vazia, só com as ferramentas de estudo: sem arquivos, terminal, web, plugins nem quadro', async () => {
    const { manager, store } = await office()
    const { BONNIE_PROMPT } = await import('../src/main/bonnie-prompt')
    manager.bonnieTools = vi.fn(() => ({ type: 'sdk', name: 'estudos' }) as never)
    manager.officeTools = vi.fn(() => ({ type: 'sdk', name: 'office' }) as never)
    sdk.calls.length = 0
    await manager.sendMessage(BONNIE_AGENT_ID, 'Onde estou na trilha?')
    await vi.waitFor(() => expect(sdk.calls).toHaveLength(1))
    const options = sdk.calls[0]!.options
    expect(options.cwd).toBe(join(store.dataDirectory, 'bonnie'))
    expect((options.systemPrompt as { append: string }).append).toBe(BONNIE_PROMPT)
    expect(Object.keys(options.mcpServers as object)).toEqual(['estudos'])
    expect(options.plugins).toEqual([])
    expect(options.disallowedTools).toEqual(expect.arrayContaining(['Read', 'Grep', 'Glob', 'Bash', 'Write', 'Edit', 'WebFetch']))
    expect(BONNIE_BLOCKED_TOOLS).toContain('Read')
    manager.shutdown()
    store.flush()
  })

  it('as ferramentas de estudo rodam direto; ler o vault, o terminal e ferramentas de plugins são recusados', async () => {
    const { manager, store, vault } = await office()
    const internals = manager as unknown as { agents: Map<string, unknown>; askPlayer: Ask }
    const bonnie = internals.agents.get(BONNIE_AGENT_ID)
    const ask = (tool: string, input: Record<string, unknown>) =>
      internals.askPlayer.call(manager, bonnie, tool, input, { signal: new AbortController().signal })
    expect((await ask('mcp__estudos__ask_cora', { theme: 'fila' })).behavior).toBe('allow')
    expect((await ask('mcp__estudos__cycle_start', { topic: 'Filas' })).behavior).toBe('allow')
    const refused: [string, Record<string, unknown>][] = [
      ['Read', { file_path: join(vault, 'study sources', 'livro.pdf') }],
      ['Read', { file_path: join(store.dataDirectory, 'bonnie', 'x.md') }],
      ['Bash', { command: 'cat trilha*' }],
      ['mcp__context-mode__ctx_execute_file', { path: join(vault, 'notas.md') }],
      ['mcp__casa__tasks_list', {}],
    ]
    for (const [tool, input] of refused) {
      const answer = await ask(tool, input)
      expect(answer.behavior).toBe('deny')
      expect(answer.message).toMatch(/ferramentas do andar de estudos/)
    }
    expect(manager.pendingRequests()).toEqual([])
    manager.shutdown()
    store.flush()
  })

  it('o modelo e o esforço dela vêm dos ajustes e voltam depois de reabrir', async () => {
    const { Store, AgentManager, manager, store } = await office()
    store.settings = { ...store.settings, bonnieModel: 'sonnet', bonnieEffort: 'high' }
    manager.setBonniePreferences(store.settings)
    expect(manager.list().find((a) => a.id === BONNIE_AGENT_ID)).toMatchObject({ model: 'sonnet', effort: 'high' })
    manager.shutdown()
    store.flush()
    const reopened = new AgentManager(new Store())
    expect(reopened.list().filter((a) => a.builtIn === 'bonnie')).toEqual([
      expect.objectContaining({ id: BONNIE_AGENT_ID, model: 'sonnet', effort: 'high' }),
    ])
    reopened.shutdown()
  })
})
