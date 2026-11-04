import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkDisciplineReadiness, openableFolder, SerialQueue, StudyReadinessStore, suggestTopicBooks } from '../src/main/study-readiness'
import type { StudyBookSuggestion } from '../src/shared/study-bank'
import type { StudyLibraryHit, StudySourceInfo } from '../src/shared/study-library'
import type { StudySubtopics } from '../src/shared/study-outline'
import { isStudyReadinessReady, type StudyReadinessState } from '../src/shared/study-readiness'
import { parseStudyTrail } from '../src/shared/study-trail'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }))

const TOPICS = [
  'Circuitos elétricos',
  'Amplificadores',
  'Diodos',
  'Transistores',
  'Ondas',
  'Óptica',
  'Álgebra booleana',
  'Portas lógicas',
  'Somadores',
  'Flip-flops',
  'Registradores',
  'Memórias',
  'Processadores',
]
const trail = parseStudyTrail(
  [
    '## 2º período',
    '### [P2-HW] Hardware I — 60 h',
    ...TOPICS.map((name, i) => `- [ ] [P2-HW-${String(i + 1).padStart(2, '0')}] ${name}.`),
    '### [P1-ICC] Introdução à Ciência da Computação — 60 h',
    '- [ ] [P1-ICC-01] Sistemas de numeração.',
  ].join('\n'),
)
const VAULT = join(tmpdir(), 'cofre-teste')
const HW_FOLDERS = [
  'study sources/textbooks/Eletrônica/',
  'study sources/textbooks/Física/',
  'study sources/textbooks/Organização de Computadores/',
].map((f) => join(VAULT, f))

const passage = (n: number, folder = 'Eletrônica'): StudyLibraryHit => ({
  id: `h${n}`,
  sourceRef: `study sources/textbooks/${folder}/Livro.pdf#Página ${n}`,
  title: 'Página',
  excerpt: `Trecho ${n} do livro.`,
  line: 0,
  score: 1,
})

/** A hit the search gives for a file found by its name only (no readable text). */
const nameHit = (path: string): StudyLibraryHit => ({
  id: `n-${path}`,
  sourceRef: path,
  title: 'Digital',
  excerpt: 'Eletrônica · Encontrado pelo nome; Cora não lê o conteúdo deste formato.',
  line: 0,
  score: 1,
})

/**
 * Passages for the topics in `counts`, only inside the discipline's own folders; `names` gives the
 * files the search finds by name for a topic.
 */
function library(counts: Record<string, number> = {}, sources: StudySourceInfo[] = [], names: Record<string, string[]> = {}, missingFolder?: true) {
  const search = vi.fn(async (query: string, scope?: readonly string[]) => {
    // A library-wide search (no scope) finds a book of another discipline: it must never reach the report.
    if (!scope) return { hits: [passage(1, 'Lógica e Matemática Discreta')] }
    const n = counts[query] ?? 0
    return { hits: [...Array.from({ length: n }, (_, i) => passage(i + 1)), ...(names[query] ?? []).map(nameHit)] }
  })
  const inventory = vi.fn(async () => ({ sources, ...(missingFolder ? { missingFolder } : {}) }))
  return { search, inventory }
}

const noSubtopics = { get: () => undefined }
const subtopicsOk = { get: (): StudySubtopics => ({ topic: 'x', source: 'L.pdf', builtAt: 1, status: 'ok', subtopics: [{ name: 'A', sections: [] }] }) }

const scannedPdf = (path: string): StudySourceInfo => ({
  path,
  name: path.split('/').pop()!,
  ext: '.pdf',
  size: 10,
  status: 'lida',
  scanned: true,
})

describe('checkDisciplineReadiness', () => {
  it('lists the 13 topics of Hardware I with state, reason and full folder paths, never building subtopics', async () => {
    const lib = library()
    // The subtopics builder reads a book and may call a model: the readiness check must never reach it.
    const subtopics = { get: vi.fn(() => undefined), build: vi.fn() }
    const report = await checkDisciplineReadiness(trail, 'P2-HW', { vault: VAULT, library: lib, subtopics }, 5)
    expect(report).toMatchObject({ discipline: 'P2-HW', builtAt: 5 })
    expect(report.topics).toHaveLength(13)
    for (const topic of report.topics) {
      expect(topic.state).toBe('sem-fonte')
      expect(topic.reason).toContain(topic.topic)
      expect(topic.folders).toEqual(HW_FOLDERS)
      expect(topic).not.toHaveProperty('books')
    }
    expect(lib.search.mock.calls.every(([, scope]) => scope !== undefined)).toBe(true)
    expect(subtopics.build).not.toHaveBeenCalled()
    expect(query).not.toHaveBeenCalled()
  })

  it('reports a topic with no passage in the discipline folders as sem-fonte, not filled from the library', async () => {
    const report = await checkDisciplineReadiness(trail, 'P2-HW', { vault: VAULT, library: library({ Ondas: 0 }), subtopics: noSubtopics })
    expect(report.topics.find((t) => t.topic === 'Ondas')).toMatchObject({ state: 'sem-fonte' })
  })

  it('says the study sources folder does not exist when the inventory reports it missing', async () => {
    const report = await checkDisciplineReadiness(trail, 'P2-HW', { vault: VAULT, library: library({}, [], {}, true), subtopics: noSubtopics })
    const ondas = report.topics.find((t) => t.topic === 'Ondas')!
    expect(ondas.state).toBe('sem-fonte')
    expect(ondas.reason).toContain('não existe')
    expect(ondas.reason).toContain('crie-a e coloque o livro')
    expect(ondas.reason).toContain(HW_FOLDERS[0]!)
  })

  it('marks a topic with one or two passages as poucos-trechos', async () => {
    const report = await checkDisciplineReadiness(trail, 'P2-HW', { vault: VAULT, library: library({ Amplificadores: 2 }), subtopics: noSubtopics })
    expect(report.topics.find((t) => t.topic === 'Amplificadores')).toMatchObject({ state: 'poucos-trechos' })
    expect(report.topics.find((t) => t.topic === 'Amplificadores')!.reason).toContain('2 trecho')
  })

  it('marks a topic whose subtopics did not agree as sem-subtemas, with the reason', async () => {
    const disagreed: StudySubtopics = { topic: 'Diodos', source: 'Livro.pdf', builtAt: 1, status: 'sem-acordo', reason: 'As listas não concordaram.', subtopics: [] }
    const report = await checkDisciplineReadiness(trail, 'P2-HW', {
      vault: VAULT,
      library: library({ Diodos: 3 }),
      subtopics: { get: (t) => (t === 'Diodos' ? disagreed : undefined) },
    })
    expect(report.topics.find((t) => t.topic === 'Diodos')).toMatchObject({ state: 'sem-subtemas', reason: 'As listas não concordaram.' })
  })

  it('marks a topic whose own scanned PDF (found by name) has no text as precisa-ocr, with the folder to put the book in', async () => {
    const path = 'study sources/textbooks/Eletrônica/Diodos.pdf'
    const report = await checkDisciplineReadiness(trail, 'P2-HW', {
      vault: VAULT,
      library: library({}, [scannedPdf(path)], { Diodos: [path] }),
      subtopics: noSubtopics,
    })
    const diodos = report.topics.find((t) => t.topic === 'Diodos')
    expect(diodos).toMatchObject({ state: 'precisa-ocr' })
    expect(diodos!.reason).toContain('Diodos.pdf')
    expect(diodos!.reason).toContain('PDF com texto selecionável')
    expect(diodos!.reason).toContain(HW_FOLDERS[0]!)
    expect(diodos!.reason).not.toMatch(/OCR/)
    expect(report.topics.some((t) => t.state === 'pronto')).toBe(false)
  })

  it('does not mark a topic covered by a text book as precisa-ocr, even with a scanned PDF in the folders', async () => {
    const path = 'study sources/textbooks/Eletrônica/Diodos.pdf'
    const report = await checkDisciplineReadiness(trail, 'P2-HW', {
      vault: VAULT,
      library: library({ Ondas: 3 }, [scannedPdf(path)], { Diodos: [path] }),
      subtopics: noSubtopics,
    })
    expect(report.topics.find((t) => t.topic === 'Ondas')).toMatchObject({ state: 'sem-subtemas' })
    expect(report.topics.find((t) => t.topic === 'Diodos')).toMatchObject({ state: 'precisa-ocr' })
  })

  it('does not mark a topic precisa-ocr when its scanned PDF is in the folders but other pages of its text books match', async () => {
    const path = 'study sources/textbooks/Eletrônica/Diodos.pdf'
    const report = await checkDisciplineReadiness(trail, 'P2-HW', {
      vault: VAULT,
      library: library({ Diodos: 3 }, [scannedPdf(path)], { Diodos: [path] }),
      subtopics: noSubtopics,
    })
    expect(report.topics.find((t) => t.topic === 'Diodos')).toMatchObject({ state: 'sem-subtemas' })
    expect(report.topics.some((t) => t.state === 'precisa-ocr')).toBe(false)
  })

  it('keeps a topic sem-fonte when the scanned PDF in the folders is not a candidate for it', async () => {
    const report = await checkDisciplineReadiness(trail, 'P2-HW', {
      vault: VAULT,
      library: library({}, [scannedPdf('study sources/textbooks/Eletrônica/Digital.pdf')]),
      subtopics: noSubtopics,
    })
    expect(report.topics.find((t) => t.topic === 'Diodos')).toMatchObject({ state: 'sem-fonte' })
    expect(report.topics.some((t) => t.state === 'precisa-ocr')).toBe(false)
  })

  it('checks again only the topics that are not ready, and keeps the ready ones as they were', async () => {
    const first = await checkDisciplineReadiness(trail, 'P2-HW', { vault: VAULT, library: library({ 'Circuitos elétricos': 3 }), subtopics: subtopicsOk }, 1)
    const again = library({ Amplificadores: 3 })
    const second = await checkDisciplineReadiness(trail, 'P2-HW', { vault: VAULT, library: again, subtopics: subtopicsOk }, 2, first)
    expect(second.topics[0]).toEqual(first.topics[0])
    expect(second.topics[1]!.state).toBe('pronto')
    expect(again.search.mock.calls.map(([query]) => query)).not.toContain('Circuitos elétricos')
  })

  it('keeps the books found for a topic that is still not ready when it is checked again', async () => {
    const first = await checkDisciplineReadiness(trail, 'P2-HW', { vault: VAULT, library: library(), subtopics: noSubtopics }, 1)
    const book = { title: 'Diodos e Transistores', author: 'Autor', url: 'https://exemplo.org/livro', access: 'paid' as const }
    const withBooks = { ...first, topics: first.topics.map((t) => (t.topic === 'Diodos' ? { ...t, books: [book] } : t)) }
    const again = await checkDisciplineReadiness(trail, 'P2-HW', { vault: VAULT, library: library(), subtopics: noSubtopics }, 2, withBooks)
    expect(again.topics.find((t) => t.topic === 'Diodos')).toMatchObject({ state: 'sem-fonte', books: [book] })
  })

  it('is ready only when every topic of the discipline is pronto', () => {
    const topic = (name: string, state: StudyReadinessState) => ({ id: null, topic: name, state, reason: '', folders: [] })
    const titles = ['A', 'B']
    expect(isStudyReadinessReady({ discipline: 'P2-HW', builtAt: 1, topics: [topic('A', 'pronto'), topic('B', 'pronto')] }, titles)).toBe(true)
    expect(isStudyReadinessReady({ discipline: 'P2-HW', builtAt: 1, topics: [topic('A', 'pronto'), topic('B', 'sem-fonte')] }, titles)).toBe(false)
    expect(isStudyReadinessReady({ discipline: 'P2-HW', builtAt: 1, topics: [] }, titles)).toBe(false)
    expect(isStudyReadinessReady({ discipline: 'P2-HW', builtAt: 1, topics: [topic('A', 'pronto'), topic('B', 'pronto')] }, [])).toBe(false)
    expect(isStudyReadinessReady(undefined, titles)).toBe(false)
  })

  it('is not ready when a topic was added to the trail after the check', () => {
    const topic = (name: string) => ({ id: null, topic: name, state: 'pronto' as const, reason: '', folders: [] })
    const report = { discipline: 'P2-HW', builtAt: 1, topics: [topic('A'), topic('B')] }
    expect(isStudyReadinessReady(report, ['A', 'B', 'Tópico novo'])).toBe(false)
    expect(isStudyReadinessReady(report, ['A', 'B'])).toBe(true)
  })

  it('refuses a discipline with no topics in the trail', async () => {
    await expect(checkDisciplineReadiness(trail, 'P9-XX', { vault: VAULT, library: library(), subtopics: noSubtopics })).rejects.toThrow(/Nenhum tópico/)
  })
})

describe('StudyReadinessStore', () => {
  let dir = ''
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('keeps each discipline last report across a restart, and replaces only that discipline', async () => {
    dir = mkdtempSync(join(tmpdir(), 'readiness-'))
    const hw = await checkDisciplineReadiness(trail, 'P2-HW', { vault: VAULT, library: library(), subtopics: noSubtopics }, 1)
    const icc = await checkDisciplineReadiness(trail, 'P1-ICC', { vault: VAULT, library: library(), subtopics: noSubtopics }, 2)
    new StudyReadinessStore(dir).save(hw)
    new StudyReadinessStore(dir).save(icc)
    const newer = { ...hw, builtAt: 3, topics: hw.topics.slice(0, 1) }
    new StudyReadinessStore(dir).save(newer)

    const restarted = new StudyReadinessStore(dir).read()
    expect(restarted['P2-HW']).toEqual(newer)
    expect(restarted['P1-ICC']).toEqual(icc)
  })

  it('reads nothing from a missing file', () => {
    dir = mkdtempSync(join(tmpdir(), 'readiness-'))
    expect(new StudyReadinessStore(dir).read()).toEqual({})
  })
})

describe('book search, folder and queue', () => {
  let dir = ''
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
  const book = { title: 'Diodos e Transistores', author: 'Autor', url: 'https://exemplo.org/livro', access: 'paid' as const }

  it('the build check blocks a discipline whose topic added after the last report is not pronto', async () => {
    // The last report had only the first topic, ready; the rest of the trail was added since.
    const last = await checkDisciplineReadiness(trail, 'P2-HW', { vault: VAULT, library: library({ 'Circuitos elétricos': 3 }), subtopics: subtopicsOk }, 1)
    const older = { ...last, topics: last.topics.slice(0, 1) }
    const rechecked = await checkDisciplineReadiness(trail, 'P2-HW', { vault: VAULT, library: library({ 'Circuitos elétricos': 3 }), subtopics: subtopicsOk }, 2, older)
    expect(isStudyReadinessReady(rechecked, TOPICS)).toBe(false)
    expect(rechecked.topics.find((t) => t.topic === 'Amplificadores')).toMatchObject({ state: 'sem-fonte' })
  })

  it('does not mark a topic pronto when its subtopics list is empty, so its total would be 0', async () => {
    const empty = { get: (): StudySubtopics => ({ topic: 'x', source: 'L.pdf', builtAt: 1, status: 'ok', subtopics: [] }) }
    const report = await checkDisciplineReadiness(trail, 'P2-HW', { vault: VAULT, library: library({ 'Circuitos elétricos': 3 }), subtopics: empty }, 1)
    expect(report.topics[0]).toMatchObject({ state: 'sem-subtemas' })
  })

  it('puts the books on the topic and keeps a check that finished while the search ran', async () => {
    dir = mkdtempSync(join(tmpdir(), 'readiness-'))
    const store = new StudyReadinessStore(dir)
    const base = await checkDisciplineReadiness(trail, 'P2-HW', { vault: VAULT, library: library(), subtopics: noSubtopics }, 1)
    store.save(base)
    let release!: (books: StudyBookSuggestion[]) => void
    const pending = suggestTopicBooks(store, 'P2-HW', 'Diodos', () => new Promise((resolve) => (release = resolve)))
    // A check of the discipline saves a new report while the search is still waiting.
    store.save({ ...base, builtAt: 9, topics: base.topics.map((t) => (t.topic === 'Amplificadores' ? { ...t, reason: 'nova' } : t)) })
    release([book])
    const result = await pending
    expect(store.read()['P2-HW']).toEqual(result)
    expect(result.builtAt).toBe(9)
    expect(result.topics.find((t) => t.topic === 'Amplificadores')?.reason).toBe('nova')
    expect(result.topics.find((t) => t.topic === 'Diodos')?.books).toEqual([book])
  })

  it('does not search for a topic the saved report does not have, and does not write', async () => {
    dir = mkdtempSync(join(tmpdir(), 'readiness-'))
    const store = new StudyReadinessStore(dir)
    const search = vi.fn(async () => [book])
    await expect(suggestTopicBooks(store, 'P2-HW', 'Diodos', search)).rejects.toThrow(/prontidão/)
    expect(search).not.toHaveBeenCalled()
    expect(store.read()).toEqual({})
  })

  it('opens only a folder the saved report names', async () => {
    dir = mkdtempSync(join(tmpdir(), 'readiness-'))
    const store = new StudyReadinessStore(dir)
    const base = await checkDisciplineReadiness(trail, 'P2-HW', { vault: VAULT, library: library(), subtopics: noSubtopics }, 1)
    store.save(base)
    const folder = base.topics[0]!.folders[0]!
    expect(openableFolder(store, folder)).toBe(folder)
    expect(() => openableFolder(store, join(VAULT, 'outra pasta'))).toThrow(/não está no relatório/)
  })

  it('runs queued jobs one after another, and a failed job does not stop the next', async () => {
    const queue = new SerialQueue()
    const order: string[] = []
    let release!: () => void
    const first = queue.run(() => new Promise<void>((resolve) => (release = () => (order.push('a'), resolve()))))
    const failed = queue.run(() => Promise.reject(new Error('falhou'))).then(
      () => 'ok',
      (error: Error) => error.message,
    )
    const last = queue.run(async () => void order.push('b'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(order).toEqual([])
    release()
    await first
    expect(await failed).toBe('falhou')
    await last
    expect(order).toEqual(['a', 'b'])
  })
})
