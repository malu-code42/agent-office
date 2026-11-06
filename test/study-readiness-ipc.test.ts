import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlanningStore } from '../src/main/planning'
import { StudySubtopicStore } from '../src/main/study-subtopics'
import { assertTopicReady, StudyReadinessStore, type ReadinessSource } from '../src/main/study-readiness'
import { SUBTOPICS_RULE } from '../src/shared/study-outline'
import { StudyQuestionService } from '../src/main/study-questions'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { parseStudyTrail, STUDY_TRAIL_FILE } from '../src/shared/study-trail'

const ipc = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => unknown>() }))
const bookSearch = vi.hoisted(() =>
  vi.fn(async () => [{ title: 'Livro', author: 'Autor', url: 'https://example.org/livro', access: 'paid' as const }]),
)
const startBank = vi.hoisted(() => vi.fn(() => ({ status: 'running' })))
// Fixture library: three passages for any topic inside the discipline's folders. No model, no web.
const fakeLibrary = vi.hoisted(() => ({
  search: vi.fn(async (query: string, scope?: readonly string[]) => ({
    hits: scope
      ? [1, 2, 3].map((n) => ({
          id: `${query}-${n}`,
          sourceRef: `${scope[0]}/livro.txt#${n}`,
          title: 'Livro',
          excerpt: `Trecho ${n} sobre ${query}.`,
          line: n,
          score: 1,
        }))
      : [],
  })),
  inventory: vi.fn(async () => ({ sources: [] })),
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => ipc.handlers.set(channel, handler) },
  dialog: {},
}))
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }))
vi.mock('../src/main/study-book-suggestions', () => ({ suggestBooks: bookSearch }))
vi.mock('../src/main/study-bank-job', () => ({
  StudyBankJobs: class {
    start = startBank
    status = () => undefined
  },
}))
vi.mock('../src/main/study-library', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/study-library')>()
  return {
    ...actual,
    StudyLibrary: class {
      search = fakeLibrary.search
      inventory = fakeLibrary.inventory
    },
  }
})

const { registerTasksIpc } = await import('../src/main/ipc/tasks')
const invoke = (channel: string, ...args: unknown[]) => ipc.handlers.get(channel)!(undefined, ...args)

let vault: string
let data: string
let settings: { vaultPath?: string }

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), 'ao-readiness-vault-'))
  data = mkdtempSync(join(tmpdir(), 'ao-readiness-data-'))
  settings = { vaultPath: vault }
  writeFileSync(
    join(vault, STUDY_TRAIL_FILE),
    '## 2º período\n### [P2-HW] Hardware I — 60 h\n- [ ] [P2-HW-01] Circuitos elétricos.\n- [ ] [P2-HW-02] Diodos.',
  )
  ipc.handlers.clear()
  fakeLibrary.search.mockClear()
  bookSearch.mockClear()
  startBank.mockClear()
  registerTasksIpc({
    win: () => ({}) as never,
    store: {
      dataDirectory: data,
      get settings() {
        return settings
      },
    } as never,
    planning: new PlanningStore(data),
    broadcast: vi.fn(),
  } as never)
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(vault, { recursive: true, force: true })
  rmSync(data, { recursive: true, force: true })
})

/** The readiness source the generators use, read the way the app reads it: the trail file and the stored report. */
const source = (): ReadinessSource => ({
  trail: () => parseStudyTrail(readFileSync(join(vault, STUDY_TRAIL_FILE), 'utf8')),
  reports: () => JSON.parse(readFileSync(join(data, 'study-readiness.json'), 'utf8')),
})

describe('checkStudyReadiness IPC', () => {
  it('revalida fontes ao montar, sem alterar a reconferência dos prontos', async () => {
    const saved = new StudyReadinessStore(data)
    saved.save({
      discipline: 'P2-HW',
      builtAt: 1,
      topics: [
        { id: 'P2-HW-01', topic: 'Circuitos elétricos', state: 'pronto', reason: 'Antes pronto', folders: [] },
        { id: 'P2-HW-02', topic: 'Diodos', state: 'pronto', reason: 'Antes pronto', folders: [] },
      ],
    })
    const remove = vi.spyOn(StudyQuestionService.prototype, 'removeUnusableQuestions')
    fakeLibrary.search.mockImplementationOnce(async () => ({ hits: [] }))

    const rechecked = (await invoke('office:checkStudyReadiness', 'P2-HW')) as { topics: { state: string; reason: string }[] }
    expect(rechecked.topics.map((t) => t.reason)).toEqual(['Antes pronto', 'Antes pronto'])
    expect(fakeLibrary.search).not.toHaveBeenCalled()
    await expect(invoke('office:startStudyBank', { discipline: 'P2-HW', perSubtopic: 1 })).rejects.toThrow(/sem prontidão/)
    expect(saved.read()['P2-HW']!.topics[0]).toMatchObject({ state: 'sem-fonte', reason: expect.stringMatching(/Nenhum trecho/) })
    expect(startBank).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
    expect(query).not.toHaveBeenCalled()
    expect(bookSearch).not.toHaveBeenCalled()
    remove.mockRestore()
  })

  it('inicia o banco quando as fontes dos tópicos prontos ainda existem', async () => {
    new StudyReadinessStore(data).save({
      discipline: 'P2-HW',
      builtAt: 1,
      topics: [
        { id: 'P2-HW-01', topic: 'Circuitos elétricos', state: 'pronto', reason: 'Antes pronto', folders: [] },
        { id: 'P2-HW-02', topic: 'Diodos', state: 'pronto', reason: 'Antes pronto', folders: [] },
      ],
    })
    const remove = vi.spyOn(StudyQuestionService.prototype, 'removeUnusableQuestions').mockReturnValue(0)
    await expect(invoke('office:startStudyBank', { discipline: 'P2-HW', perSubtopic: 1 })).resolves.toMatchObject({ status: 'running' })
    expect(fakeLibrary.search).toHaveBeenCalledTimes(2)
    expect(startBank).toHaveBeenCalledOnce()
    remove.mockRestore()
  })
  it('grava o relatório e deixa pronto um tópico com fonte e subtemas', async () => {
    new StudySubtopicStore(data).save({
      topic: 'Circuitos elétricos',
      source: 'livro.txt',
      builtAt: 1,
      rule: SUBTOPICS_RULE,
      status: 'ok',
      agreed: true,
      subtopics: [{ name: 'Lei de Ohm', sections: [] }],
    })

    const report = (await invoke('office:checkStudyReadiness', 'P2-HW')) as { topics: { id: string; state: string }[] }

    expect(report.topics.find((t) => t.id === 'P2-HW-01')?.state).toBe('pronto')
    // Only the topic with stored subtopics is ready; the other one has no subtopics yet.
    expect(report.topics.find((t) => t.id === 'P2-HW-02')?.state).toBe('sem-subtemas')
    expect(await invoke('office:readStudyReadiness')).toMatchObject({ 'P2-HW': { discipline: 'P2-HW' } })
    expect(() => assertTopicReady(source(), 'Circuitos elétricos')).not.toThrow()
  })

  it('mantém o tópico sem subtemas travado no assertTopicReady, com o motivo', async () => {
    await invoke('office:checkStudyReadiness', 'P2-HW')

    expect(() => assertTopicReady(source(), 'Circuitos elétricos')).toThrow(/ainda não está pronto: .*subtemas/)
  })

  it('recusa disciplina fora do formato antes de ler livros', async () => {
    await expect(invoke('office:checkStudyReadiness', '../etc')).rejects.toThrow(/Disciplina inválida/)
    expect(fakeLibrary.search).not.toHaveBeenCalled()
  })

  it('não inicia o banco quando só um dos tópicos de título repetido está pronto', async () => {
    writeFileSync(
      join(vault, STUDY_TRAIL_FILE),
      '## 2º período\n### [P2-HW] Hardware I — 60 h\n- [ ] [P2-HW-01] Ondas.\n- [ ] [P2-HW-02] Ondas.',
    )
    new StudyReadinessStore(data).save({
      discipline: 'P2-HW',
      builtAt: 1,
      topics: [
        { id: 'P2-HW-01', topic: 'Ondas', state: 'pronto', reason: '', folders: [] },
        { id: 'P2-HW-02', topic: 'Ondas', state: 'sem-subtemas', reason: 'Sem subtemas.', folders: [] },
      ],
    })
    await expect(invoke('office:startStudyBank', { discipline: 'P2-HW', perSubtopic: 1 })).rejects.toThrow(/sem prontidão/)
    expect(startBank).not.toHaveBeenCalled()
    expect(new StudyReadinessStore(data).read()['P2-HW']!.topics.map((t) => [t.id, t.state])).toEqual([
      ['P2-HW-01', 'pronto'],
      ['P2-HW-02', 'sem-subtemas'],
    ])
  })

  it('propaga o ID dos livros, usando o título apenas na busca e sem alterar o outro tópico', async () => {
    writeFileSync(
      join(vault, STUDY_TRAIL_FILE),
      '## 2º período\n### [P2-HW] Hardware I — 60 h\n- [ ] [P2-HW-01] Ondas.\n- [ ] [P2-HW-02] Ondas.',
    )
    const saved = new StudyReadinessStore(data)
    saved.save({
      discipline: 'P2-HW',
      builtAt: 1,
      topics: ['P2-HW-01', 'P2-HW-02'].map((id) => ({ id, topic: 'Ondas', state: 'sem-fonte', reason: '', folders: [] })),
    })
    await expect(invoke('office:suggestStudyBooks', 'P2-HW', 'Ondas')).rejects.toThrow(/repetido/)
    expect(bookSearch).not.toHaveBeenCalled()
    await invoke('office:suggestStudyBooks', 'P2-HW', 'P2-HW-02')
    expect(bookSearch).toHaveBeenCalledWith('Ondas', 'Hardware I')
    expect(saved.read()['P2-HW']!.topics.map((t) => !!t.books)).toEqual([false, true])
  })

  it('não busca livros para um ID removido nem para um título legado ambíguo na trilha', async () => {
    writeFileSync(
      join(vault, STUDY_TRAIL_FILE),
      '## 2º período\n### [P2-HW] Hardware I — 60 h\n- [ ] [P2-HW-01] Ondas.\n- [ ] [P2-HW-02] Ondas.',
    )
    const saved = new StudyReadinessStore(data)
    for (const id of [null, 'P2-HW-99']) {
      saved.save({ discipline: 'P2-HW', builtAt: 1, topics: [{ id, topic: 'Ondas', state: 'sem-fonte', reason: '', folders: [] }] })
      await expect(invoke('office:suggestStudyBooks', 'P2-HW', id ?? 'Ondas')).rejects.toThrow(/prontidão.*novo/)
    }
    expect(bookSearch).not.toHaveBeenCalled()
  })
})
