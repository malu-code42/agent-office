import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlanningStore } from '../src/main/planning'
import { StudySubtopicStore } from '../src/main/study-subtopics'
import { assertTopicReady, type ReadinessSource } from '../src/main/study-readiness'
import { parseStudyTrail, STUDY_TRAIL_FILE } from '../src/shared/study-trail'

const ipc = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => unknown>() }))
// Fixture library: three passages for any topic inside the discipline's folders. No model, no web.
const fakeLibrary = vi.hoisted(() => ({
  search: vi.fn(async (query: string, scope?: readonly string[]) => ({
    hits: scope ? [1, 2, 3].map((n) => ({ id: `${query}-${n}`, sourceRef: `${scope[0]}/livro.txt#${n}`, title: 'Livro', excerpt: `Trecho ${n} sobre ${query}.`, line: n, score: 1 })) : [],
  })),
  inventory: vi.fn(async () => ({ sources: [] })),
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => ipc.handlers.set(channel, handler) },
  dialog: {},
}))
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }))
vi.mock('../src/main/study-library', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/study-library')>()
  return { ...actual, StudyLibrary: class { search = fakeLibrary.search; inventory = fakeLibrary.inventory } }
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
  writeFileSync(join(vault, STUDY_TRAIL_FILE), '## 2º período\n### [P2-HW] Hardware I — 60 h\n- [ ] [P2-HW-01] Circuitos elétricos.\n- [ ] [P2-HW-02] Diodos.')
  ipc.handlers.clear()
  fakeLibrary.search.mockClear()
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
  rmSync(vault, { recursive: true, force: true })
  rmSync(data, { recursive: true, force: true })
})

/** The readiness source the generators use, read the way the app reads it: the trail file and the stored report. */
const source = (): ReadinessSource => ({
  trail: () => parseStudyTrail(readFileSync(join(vault, STUDY_TRAIL_FILE), 'utf8')),
  reports: () => JSON.parse(readFileSync(join(data, 'study-readiness.json'), 'utf8')),
})

describe('checkStudyReadiness IPC', () => {
  it('grava o relatório e deixa pronto um tópico com fonte e subtemas', async () => {
    new StudySubtopicStore(data).save({
      topic: 'Circuitos elétricos',
      source: 'livro.txt',
      builtAt: 1,
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
})
