import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StudyBankJobs } from '../src/main/study-bank-job'
import { checkDisciplineReadiness, openableFolder, proveReadyTopics, SerialQueue, STUDY_READINESS_FILE, StudyReadinessStore, suggestTopicBooks } from '../src/main/study-readiness'
import type { StudyBookSuggestion } from '../src/shared/study-bank'
import { STUDY_AGENT_ATTRIBUTION, STUDY_AGENT_LICENSE } from '../src/shared/study-bank'
import type { StudyLibraryHit, StudySourceInfo } from '../src/shared/study-library'
import { SUBTOPICS_RULE, type StudySubtopics } from '../src/shared/study-outline'
import { isStudyReadinessReady, type StudyReadinessState } from '../src/shared/study-readiness'
import type { StudyQuestion } from '../src/shared/study-questions'
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
const subtopicsOk = { get: (): StudySubtopics => ({ topic: 'x', source: 'L.pdf', builtAt: 1, rule: SUBTOPICS_RULE, status: 'ok', subtopics: [{ name: 'A', sections: [] }] }) }

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
    const disagreed: StudySubtopics = { topic: 'Diodos', source: 'Livro.pdf', builtAt: 1, rule: SUBTOPICS_RULE, status: 'sem-acordo', reason: 'As listas não concordaram.', subtopics: [] }
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
    expect(diodos!.reason).toContain('Tire esse arquivo da pasta')
    expect(diodos!.reason).toContain('adicione um PDF com texto')
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

  it('keeps the saved report byte for byte when the bank window is dismissed', async () => {
    dir = mkdtempSync(join(tmpdir(), 'readiness-'))
    const report = await checkDisciplineReadiness(trail, 'P2-HW', { vault: VAULT, library: library(), subtopics: noSubtopics }, 1)
    new StudyReadinessStore(dir).save(report)
    const file = join(dir, STUDY_READINESS_FILE)
    const before = readFileSync(file, 'utf8')

    new StudyBankJobs(dir, () => {}).dismiss()

    expect(readFileSync(file, 'utf8')).toBe(before)
    expect(new StudyReadinessStore(dir).read()).toEqual({ 'P2-HW': report })
  })

  it('replaces the saved report when the preparation runs again', async () => {
    dir = mkdtempSync(join(tmpdir(), 'readiness-'))
    const store = new StudyReadinessStore(dir)
    const first = await checkDisciplineReadiness(trail, 'P2-HW', { vault: VAULT, library: library(), subtopics: noSubtopics }, 1)
    store.save(first)

    const again = await checkDisciplineReadiness(trail, 'P2-HW', { vault: VAULT, library: library({ Ondas: 3 }), subtopics: noSubtopics }, 2, first)
    store.save(again)

    const saved = new StudyReadinessStore(dir).read()['P2-HW']
    expect(saved).toEqual(again)
    expect(saved!.builtAt).toBe(2)
    expect(saved!.topics.find((t) => t.topic === 'Ondas')).toMatchObject({ state: 'sem-subtemas' })
  })

  it('keeps the saved report byte for byte when the bank window is dismissed while a build runs', async () => {
    dir = mkdtempSync(join(tmpdir(), 'readiness-'))
    const report = await checkDisciplineReadiness(trail, 'P2-HW', { vault: VAULT, library: library(), subtopics: noSubtopics }, 1)
    new StudyReadinessStore(dir).save(report)
    const file = join(dir, STUDY_READINESS_FILE)
    const before = readFileSync(file, 'utf8')
    const jobs = new StudyBankJobs(dir, () => {})
    jobs.start(trail, { discipline: 'P2-HW' }, () => new Promise<never>(() => {}))

    jobs.dismiss()

    expect(jobs.status()?.status).toBe('running')
    expect(readFileSync(file, 'utf8')).toBe(before)
    expect(new StudyReadinessStore(dir).read()).toEqual({ 'P2-HW': report })
  })

  it('keeps the saved report intact when the check throws before it is saved', async () => {
    dir = mkdtempSync(join(tmpdir(), 'readiness-'))
    const store = new StudyReadinessStore(dir)
    const first = await checkDisciplineReadiness(trail, 'P2-HW', { vault: VAULT, library: library(), subtopics: noSubtopics }, 1)
    store.save(first)
    const file = join(dir, STUDY_READINESS_FILE)
    const before = readFileSync(file, 'utf8')
    const broken = { ...library(), search: vi.fn(async () => { throw new Error('Falha na busca') }) }

    await expect(
      checkDisciplineReadiness(trail, 'P2-HW', { vault: VAULT, library: broken, subtopics: noSubtopics }, 2, first),
    ).rejects.toThrow('Falha na busca')

    expect(readFileSync(file, 'utf8')).toBe(before)
    expect(new StudyReadinessStore(dir).read()).toEqual({ 'P2-HW': first })
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
    const empty = { get: (): StudySubtopics => ({ topic: 'x', source: 'L.pdf', builtAt: 1, rule: SUBTOPICS_RULE, status: 'ok', subtopics: [] }) }
    const report = await checkDisciplineReadiness(trail, 'P2-HW', { vault: VAULT, library: library({ 'Circuitos elétricos': 3 }), subtopics: empty }, 1)
    expect(report.topics[0]).toMatchObject({ state: 'sem-subtemas' })
  })

  it('puts the books on the topic and keeps a check that finished while the search ran', async () => {
    dir = mkdtempSync(join(tmpdir(), 'readiness-'))
    const store = new StudyReadinessStore(dir)
    const base = await checkDisciplineReadiness(trail, 'P2-HW', { vault: VAULT, library: library(), subtopics: noSubtopics }, 1)
    store.save(base)
    let release!: (books: StudyBookSuggestion[]) => void
    const pending = suggestTopicBooks(store, 'P2-HW', 'Diodos', () => new Promise((resolve) => (release = resolve)), new SerialQueue())
    // A check of the discipline saves a new report while the search is still waiting.
    store.save({ ...base, builtAt: 9, topics: base.topics.map((t) => (t.topic === 'Amplificadores' ? { ...t, reason: 'nova' } : t)) })
    release([book])
    const result = await pending
    expect(store.read()['P2-HW']).toEqual(result)
    expect(result.builtAt).toBe(9)
    expect(result.topics.find((t) => t.topic === 'Amplificadores')?.reason).toBe('nova')
    expect(result.topics.find((t) => t.topic === 'Diodos')?.books).toEqual([book])
  })

  it('lets a queued check finish while the book search is still pending', async () => {
    dir = mkdtempSync(join(tmpdir(), 'readiness-'))
    const store = new StudyReadinessStore(dir)
    const base = await checkDisciplineReadiness(trail, 'P2-HW', { vault: VAULT, library: library(), subtopics: noSubtopics }, 1)
    store.save(base)
    const queue = new SerialQueue()
    let release!: (books: StudyBookSuggestion[]) => void
    let searching = false
    const search = () => {
      searching = true
      return new Promise<StudyBookSuggestion[]>((resolve) => (release = resolve))
    }
    const pending = suggestTopicBooks(store, 'P2-HW', 'Diodos', search, queue)
    // Same wiring as checkDiscipline in src/main/ipc/tasks.ts: a check queued on the shared readiness queue.
    const checked = await queue.run(() =>
      checkDisciplineReadiness(trail, 'P2-HW', { vault: VAULT, library: library(), subtopics: noSubtopics }, 2),
    )
    expect(searching).toBe(true)
    expect(checked.builtAt).toBe(2)
    release([book])
    expect((await pending).topics.find((t) => t.topic === 'Diodos')?.books).toEqual([book])
  })

  it('does not search for a topic the saved report does not have, and does not write', async () => {
    dir = mkdtempSync(join(tmpdir(), 'readiness-'))
    const store = new StudyReadinessStore(dir)
    const search = vi.fn(async () => [book])
    await expect(suggestTopicBooks(store, 'P2-HW', 'Diodos', search, new SerialQueue())).rejects.toThrow(/prontidão/)
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

describe('proveReadyTopics', () => {
  let dir = ''
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const okEntry: StudySubtopics = {
    topic: 'Ondas',
    source: 'Livro.pdf',
    builtAt: 1,
    rule: SUBTOPICS_RULE,
    status: 'ok',
    subtopics: [{ name: 'Propagação', sections: [] }],
  }
  const subtopics = { get: (t: string) => (t === 'Ondas' ? okEntry : undefined), build: vi.fn() }

  /** Only the topics in `withPassages` (default Ondas) have passages: three each, with their own words so none repeats another. */
  const passages = (n: number): StudyLibraryHit => ({
    ...passage(n),
    excerpt: `termo${n}alfa termo${n}beta termo${n}gama termo${n}delta`,
  })
  const proofLibrary = (withPassages: string[] = ['Ondas']) => ({
    search: vi.fn(async (query: string, scope?: readonly string[]) => ({
      hits: scope && withPassages.includes(query) ? [1, 2, 3].map(passages) : [],
    })),
    inventory: vi.fn(async () => ({ sources: [] as StudySourceInfo[] })),
  })

  async function readyReport() {
    const checked = await checkDisciplineReadiness(trail, 'P2-HW', { vault: VAULT, library: proofLibrary(), subtopics }, 1)
    expect(checked.topics.find((t) => t.topic === 'Ondas')).toMatchObject({ state: 'pronto' })
    return checked
  }

  /** The chain's model: a question on the topic whose quote is in the passages, solved correctly by default. */
  function proofAsk(options: { author?: unknown; answer?: string } = {}) {
    return vi.fn(async (system: string, payload: unknown) => {
      if (system.includes('write one multiple-choice study question')) {
        const topic = (payload as { topic: string }).topic
        return (
          options.author ?? {
            question: `Qual é a definição de ${topic}?`,
            choices: ['Oscilação que se propaga', 'Corrente contínua fixa', 'Tensão sem variação', 'Campo estático puro', 'Carga parada'],
            correct: 'A',
            rationale: 'Definição.',
            needed: 'Conceito básico.',
            quote: 'termo1alfa termo1beta termo1gama termo1delta',
          }
        )
      }
      if (system.includes('Answer the multiple-choice study question')) return { answer: options.answer ?? 'A' }
      return { verdict: 'ok', reason: '' }
    })
  }

  function bankOf(initial: StudyQuestion[] = []) {
    const questions = [...initial]
    const appendChecked = vi.fn((rows: StudyQuestion[]) => (questions.push(...rows), { added: rows.length, skipped: 0 }))
    return { questions, appendChecked, bank: { read: () => ({ questions }), appendChecked } }
  }

  const authorCalls = (ask: ReturnType<typeof proofAsk>) =>
    ask.mock.calls.filter(([system]) => String(system).includes('write one multiple-choice study question'))

  it('makes a question only for the ready topics: a topic with no source never reaches the model', async () => {
    dir = mkdtempSync(join(tmpdir(), 'readiness-'))
    const report = await readyReport()
    expect(report.topics.filter((t) => t.state !== 'pronto').length).toBe(12)
    const ask = proofAsk()
    const { questions, bank } = bankOf()
    const store = new StudyReadinessStore(dir)
    const out = await proveReadyTopics(trail, report, { build: { library: proofLibrary(), bank, ask }, store })
    expect(authorCalls(ask)).toHaveLength(1)
    expect(authorCalls(ask)[0]![1]).toMatchObject({ topic: 'Ondas' })
    expect(questions.map((q) => q.topic)).toEqual(['Ondas'])
    expect(out.report.topics.filter((t) => t.state === 'pronto')).toHaveLength(1)
  })

  it('keeps an approved question in the bank, so the topic needs no more questions', async () => {
    dir = mkdtempSync(join(tmpdir(), 'readiness-'))
    const report = await readyReport()
    const ask = proofAsk()
    const { questions, bank } = bankOf()
    const store = new StudyReadinessStore(dir)
    const out = await proveReadyTopics(trail, report, { build: { library: proofLibrary(), bank, ask }, store })
    expect(questions).toHaveLength(1)
    expect(questions[0]).toMatchObject({ topic: 'Ondas', answerStatus: 'verified', answer: 'A' })
    expect(out.report.topics.find((t) => t.topic === 'Ondas')).toMatchObject({ state: 'pronto' })
    expect(out.report.topics.find((t) => t.topic === 'Ondas')!.failure).toBeUndefined()

    const again = proofAsk()
    await proveReadyTopics(trail, out.report, { build: { library: proofLibrary(), bank, ask: again }, store })
    expect(authorCalls(again)).toHaveLength(0)
    expect(questions).toHaveLength(1)
  })

  it.each([
    ['unsupported', { author: { error: 'unsupported' } }, {}],
    ['refused', {}, { answer: 'B' }],
    ['similar', {}, {}],
  ] as const)('locks the topic with the %s reason and saves it in the stored report', async (failure, proof, solve) => {
    dir = mkdtempSync(join(tmpdir(), 'readiness-'))
    const report = await readyReport()
    const ask = proofAsk({ ...proof, ...solve })
    // A question already on the topic and answered: the author's repeat of it must count as similar.
    const answered: StudyQuestion[] =
      failure === 'similar' ? [{ ...proofQuestion(), question: 'Qual é a definição de ondas mecânicas?' }] : []
    const { bank } = bankOf(answered)
    const store = new StudyReadinessStore(dir)
    const isAnswered = (q: StudyQuestion) => answered.includes(q)
    const out = await proveReadyTopics(trail, report, { build: { library: proofLibrary(), bank, ask, isAnswered }, store })
    const topic = out.report.topics.find((t) => t.topic === 'Ondas')!
    expect(topic).toMatchObject({ state: 'travado', failure })
    expect(topic.reason).toBeTruthy()
    expect(store.read()['P2-HW']!.topics.find((t) => t.topic === 'Ondas')).toMatchObject({ state: 'travado', failure })
  })

  it('leaves a topic ready when the model stops (no question was judged)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'readiness-'))
    const report = await readyReport()
    const ask = vi.fn(async () => {
      throw new Error('Claude Code não encontrado.')
    })
    const { bank } = bankOf()
    const store = new StudyReadinessStore(dir)
    const out = await proveReadyTopics(trail, report, { build: { library: proofLibrary(), bank, ask }, store })
    expect(out.stop).toBe('unavailable')
    expect(out.report.topics.find((t) => t.topic === 'Ondas')).toMatchObject({ state: 'pronto' })
    expect(store.read()).toEqual({})
  })

  it('never asks the model for a topic that is not ready, even when the books have passages for it', async () => {
    dir = mkdtempSync(join(tmpdir(), 'readiness-'))
    // Diodos has three passages but no subtopics: the readiness check says sem-subtemas.
    const lib = proofLibrary(['Ondas', 'Diodos'])
    const report = await checkDisciplineReadiness(trail, 'P2-HW', { vault: VAULT, library: lib, subtopics }, 1)
    expect(report.topics.find((t) => t.topic === 'Diodos')).toMatchObject({ state: 'sem-subtemas' })
    const ask = proofAsk()
    const { bank } = bankOf()
    await proveReadyTopics(trail, report, { build: { library: lib, bank, ask }, store: new StudyReadinessStore(dir) })
    expect(authorCalls(ask).map(([, payload]) => (payload as { topic: string }).topic)).toEqual(['Ondas'])
  })

  it('finds the topic by its id when its title has accents, and locks that topic', async () => {
    dir = mkdtempSync(join(tmpdir(), 'readiness-'))
    const optica = { get: (t: string) => (t === 'Óptica' ? { ...okEntry, topic: 'Óptica' } : undefined), build: vi.fn() }
    const report = await checkDisciplineReadiness(trail, 'P2-HW', { vault: VAULT, library: proofLibrary(['Óptica']), subtopics: optica }, 1)
    expect(report.topics.find((t) => t.topic === 'Óptica')).toMatchObject({ id: 'P2-HW-06', state: 'pronto' })
    const ask = proofAsk({ author: { error: 'unsupported' } })
    const { bank } = bankOf()
    const store = new StudyReadinessStore(dir)
    const out = await proveReadyTopics(trail, report, { build: { library: proofLibrary(['Óptica']), bank, ask }, store })
    expect(authorCalls(ask)).toHaveLength(1)
    expect(out.report.topics.find((t) => t.topic === 'Óptica')).toMatchObject({ id: 'P2-HW-06', state: 'travado', failure: 'unsupported' })
    expect(out.report.topics.filter((t) => t.state === 'travado')).toHaveLength(1)
  })

  it('proves only the topic whose id is given when two topics of the trail share a title', async () => {
    dir = mkdtempSync(join(tmpdir(), 'readiness-'))
    const twinTrail = parseStudyTrail(['## 2º período', '### [P2-HW] Hardware I — 60 h', '- [ ] [P2-HW-01] Ondas.', '- [ ] [P2-HW-02] Ondas.'].join('\n'))
    const twins = [
      { id: 'P2-HW-01', topic: 'Ondas', state: 'sem-fonte' as const, reason: 'Sem fonte.', folders: [] },
      { id: 'P2-HW-02', topic: 'Ondas', state: 'pronto' as const, reason: '3 trechos e 1 subtemas.', folders: [] },
    ]
    const report = { discipline: 'P2-HW', builtAt: 1, topics: twins }
    const ask = proofAsk({ author: { error: 'unsupported' } })
    const { bank } = bankOf()
    const store = new StudyReadinessStore(dir)
    const out = await proveReadyTopics(twinTrail, report, { build: { library: proofLibrary(), bank, ask }, store })
    expect(authorCalls(ask)).toHaveLength(1)
    expect(out.report.topics[0]).toMatchObject({ id: 'P2-HW-01', state: 'sem-fonte' })
    expect(out.report.topics[1]).toMatchObject({ id: 'P2-HW-02', state: 'travado', failure: 'unsupported' })
  })

  it('saves the lock on top of the stored report: a stale report keeps every topic and the other discipline', async () => {
    dir = mkdtempSync(join(tmpdir(), 'readiness-'))
    const store = new StudyReadinessStore(dir)
    const stored = await readyReport()
    store.save(stored)
    const other = { discipline: 'P2-ED', builtAt: 2, topics: [{ id: 'P2-ED-01', topic: 'Álgebra', state: 'sem-fonte' as const, reason: 'r', folders: [] }] }
    store.save(other)
    // An old report of the discipline: only Ondas, and still ready.
    const stale = { discipline: 'P2-HW', builtAt: 0, topics: stored.topics.filter((t) => t.topic === 'Ondas') }
    const { bank } = bankOf()
    await proveReadyTopics(trail, stale, { build: { library: proofLibrary(), bank, ask: proofAsk({ author: { error: 'unsupported' } }) }, store })
    const saved = store.read()
    expect(saved['P2-HW']!.topics).toHaveLength(13)
    expect(saved['P2-HW']!.topics.find((t) => t.topic === 'Ondas')).toMatchObject({ state: 'travado', failure: 'unsupported' })
    expect(saved['P2-HW']!.topics.filter((t) => t.topic !== 'Ondas')).toEqual(stored.topics.filter((t) => t.topic !== 'Ondas'))
    expect(saved['P2-ED']).toEqual(other)
  })

  it('does not lock a topic that a newer check has already marked not ready', async () => {
    dir = mkdtempSync(join(tmpdir(), 'readiness-'))
    const store = new StudyReadinessStore(dir)
    const stored = await readyReport()
    // The newer check found the source gone: Ondas is sem-fonte in the stored report.
    store.save({ ...stored, builtAt: 9, topics: stored.topics.map((t) => (t.topic === 'Ondas' ? { ...t, state: 'sem-fonte' as const } : t)) })
    const ask = proofAsk()
    const { bank } = bankOf()
    await proveReadyTopics(trail, stored, { build: { library: proofLibrary(), bank, ask }, store })
    expect(authorCalls(ask)).toHaveLength(0)
    expect(store.read()['P2-HW']!.topics.find((t) => t.topic === 'Ondas')).toMatchObject({ state: 'sem-fonte' })
  })

  it('asks one question for a topic with subtopics, not one per subtopic, and its ready reason names them', async () => {
    dir = mkdtempSync(join(tmpdir(), 'readiness-'))
    const report = await readyReport()
    expect(report.topics.find((t) => t.topic === 'Ondas')).toMatchObject({ reason: '3 trechos e 1 subtemas.' })
    // Two subtopics given to the builder: the proof still makes one question on the topic, not one per subtopic.
    const twoSubtopics = { get: () => ({ ...okEntry, subtopics: [{ name: 'Propagação', sections: [] }, { name: 'Reflexão', sections: [] }] }), build: vi.fn() }
    const ask = proofAsk()
    const { questions, bank } = bankOf()
    const out = await proveReadyTopics(trail, report, { build: { library: proofLibrary(), bank, ask, subtopics: twoSubtopics }, store: new StudyReadinessStore(dir) })
    expect(authorCalls(ask).map(([, payload]) => (payload as { topic: string }).topic)).toEqual(['Ondas'])
    expect(questions).toHaveLength(1)
    expect(out.report.topics.find((t) => t.topic === 'Ondas')).toMatchObject({ state: 'pronto' })
  })
})

const proofQuestion = (): StudyQuestion => ({
  id: 'q-answered',
  topic: 'Ondas',
  tags: ['P2-HW'],
  question: 'Qual é a definição de ondas mecânicas?',
  options: ['Oscilação que se propaga', 'Corrente contínua fixa', 'Tensão sem variação', 'Campo estático puro', 'Carga parada'],
  answer: 'A',
  rationale: 'Definição.',
  answerStatus: 'verified',
  originKind: 'livro',
  sourceTitle: 'Livro.pdf',
  sourceVisibility: 'local',
  sourceReference: 'study sources/textbooks/Eletrônica/Livro.pdf#Página 1',
  attribution: STUDY_AGENT_ATTRIBUTION,
  license: STUDY_AGENT_LICENSE,
})
