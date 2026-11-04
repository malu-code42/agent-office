import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkDisciplineReadiness, StudyReadinessStore } from '../src/main/study-readiness'
import type { StudyLibraryHit, StudySourceInfo } from '../src/shared/study-library'
import type { StudySubtopics } from '../src/shared/study-outline'
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
const HW_FOLDERS = [
  'study sources/textbooks/Eletrônica/',
  'study sources/textbooks/Física/',
  'study sources/textbooks/Organização de Computadores/',
]

const passage = (n: number, folder = 'Eletrônica'): StudyLibraryHit => ({
  id: `h${n}`,
  sourceRef: `study sources/textbooks/${folder}/Livro.pdf#Página ${n}`,
  title: 'Página',
  excerpt: `Trecho ${n} do livro.`,
  line: 0,
  score: 1,
})

/** Passages for the topics in `counts`, only inside the discipline's own folders. */
function library(counts: Record<string, number> = {}, sources: StudySourceInfo[] = []) {
  const search = vi.fn(async (query: string, scope?: readonly string[]) => {
    // A library-wide search (no scope) finds a book of another discipline: it must never reach the report.
    if (!scope) return { hits: [passage(1, 'Lógica e Matemática Discreta')] }
    const n = counts[query] ?? 0
    return { hits: Array.from({ length: n }, (_, i) => passage(i + 1)) }
  })
  const inventory = vi.fn(async () => ({ sources }))
  return { search, inventory }
}

const subtopicsOk = (topic: string): StudySubtopics => ({
  topic,
  source: 'Livro.pdf',
  builtAt: 1,
  status: 'ok',
  subtopics: [{ name: 'Parte', sections: [] }],
})

const noSubtopics = { get: () => undefined }

describe('checkDisciplineReadiness', () => {
  it('lists the 13 topics of Hardware I with state, reason and folders, without calling a model', async () => {
    const lib = library()
    const report = await checkDisciplineReadiness(trail, 'P2-HW', { library: lib, subtopics: noSubtopics }, 5)
    expect(report).toMatchObject({ discipline: 'P2-HW', builtAt: 5 })
    expect(report.topics).toHaveLength(13)
    for (const topic of report.topics) {
      expect(topic.state).toBe('sem-fonte')
      expect(topic.reason).toContain(topic.topic)
      expect(topic.folders).toEqual(HW_FOLDERS)
    }
    expect(lib.search.mock.calls.every(([, scope]) => scope !== undefined)).toBe(true)
  })

  it('reports a topic with no passage in the discipline folders as sem-fonte, not filled from the library', async () => {
    const report = await checkDisciplineReadiness(trail, 'P2-HW', { library: library({ Ondas: 0 }), subtopics: noSubtopics })
    expect(report.topics.find((t) => t.topic === 'Ondas')).toMatchObject({ state: 'sem-fonte' })
  })

  it('suggests books only for the topics with no source', async () => {
    const suggestBooks = vi.fn(async () => [{ title: 'Livro', author: 'A', url: 'https://x.org/l', access: 'open' as const }])
    const lib = library({ Diodos: 3, Transistores: 3, Ondas: 3, Óptica: 3, Memórias: 3, Processadores: 3 })
    const report = await checkDisciplineReadiness(trail, 'P2-HW', { library: lib, subtopics: { get: (t) => subtopicsOk(t) }, suggestBooks })
    expect(suggestBooks).toHaveBeenCalledTimes(7)
    expect(report.topics.find((t) => t.topic === 'Diodos')).toMatchObject({ state: 'pronto' })
    expect(report.topics.find((t) => t.topic === 'Circuitos elétricos')?.books).toHaveLength(1)
  })

  it('keeps the topic sem-fonte when the book suggestion fails', async () => {
    const suggestBooks = vi.fn(async () => {
      throw new Error('offline')
    })
    const report = await checkDisciplineReadiness(trail, 'P2-HW', { library: library(), subtopics: noSubtopics, suggestBooks })
    expect(report.topics[0]).toMatchObject({ state: 'sem-fonte' })
    expect(report.topics[0]!.books).toBeUndefined()
  })

  it('marks a topic with one or two passages as poucos-trechos', async () => {
    const report = await checkDisciplineReadiness(trail, 'P2-HW', { library: library({ Amplificadores: 2 }), subtopics: noSubtopics })
    expect(report.topics.find((t) => t.topic === 'Amplificadores')).toMatchObject({ state: 'poucos-trechos' })
    expect(report.topics.find((t) => t.topic === 'Amplificadores')!.reason).toContain('2 trecho')
  })

  it('marks a topic whose subtopics did not agree as sem-subtemas, with the reason', async () => {
    const disagreed: StudySubtopics = { topic: 'Diodos', source: 'Livro.pdf', builtAt: 1, status: 'sem-acordo', reason: 'As listas não concordaram.', subtopics: [] }
    const report = await checkDisciplineReadiness(trail, 'P2-HW', {
      library: library({ Diodos: 3 }),
      subtopics: { get: (t) => (t === 'Diodos' ? disagreed : undefined) },
    })
    expect(report.topics.find((t) => t.topic === 'Diodos')).toMatchObject({ state: 'sem-subtemas', reason: 'As listas não concordaram.' })
  })

  it('marks a topic whose only book is a PDF with no text as precisa-ocr, and counts none of its passages', async () => {
    const scanned: StudySourceInfo = {
      path: 'study sources/textbooks/Eletrônica/Digital.pdf',
      name: 'Digital.pdf',
      ext: '.pdf',
      size: 10,
      status: 'lida',
      scanned: true,
    }
    const report = await checkDisciplineReadiness(trail, 'P2-HW', { library: library({}, [scanned]), subtopics: noSubtopics })
    const digital = report.topics.find((t) => t.topic === 'Diodos')
    expect(digital).toMatchObject({ state: 'precisa-ocr' })
    expect(digital!.reason).toContain('Digital.pdf')
    expect(report.topics.some((t) => t.state === 'pronto')).toBe(false)
  })

  it('refuses a discipline with no topics in the trail', async () => {
    await expect(checkDisciplineReadiness(trail, 'P9-XX', { library: library(), subtopics: noSubtopics })).rejects.toThrow(/Nenhum tópico/)
  })
})

describe('StudyReadinessStore', () => {
  let dir = ''
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('keeps each discipline last report across a restart, and replaces only that discipline', async () => {
    dir = mkdtempSync(join(tmpdir(), 'readiness-'))
    const hw = await checkDisciplineReadiness(trail, 'P2-HW', { library: library(), subtopics: noSubtopics }, 1)
    const icc = await checkDisciplineReadiness(trail, 'P1-ICC', { library: library(), subtopics: noSubtopics }, 2)
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
