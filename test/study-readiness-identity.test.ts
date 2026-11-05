import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertTopicReady,
  checkDisciplineReadiness,
  proveReadyTopics,
  StudyReadinessStore,
  suggestTopicBooks,
} from '../src/main/study-readiness'
import { generateIdeas } from '../src/main/study-ideas'
import { isStudyReadinessReady, type StudyReadiness, type StudyReadinessState } from '../src/shared/study-readiness'
import { parseStudyTrail } from '../src/shared/study-trail'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }))

const trail = parseStudyTrail('## 2º período\n### [P2-HW] Hardware I — 60 h\n- [ ] [P2-HW-01] Ondas.\n- [ ] [P2-HW-02] Ondas.')
const book = { title: 'Livro', author: 'Autor', url: 'https://example.org/livro', access: 'paid' as const }
const entry = (id: string | null, state: StudyReadinessState = 'pronto') => ({
  id,
  topic: 'Ondas',
  state,
  reason: 'Sem fonte.',
  folders: [],
})
const report = (...topics: StudyReadiness['topics']): StudyReadiness => ({ discipline: 'P2-HW', builtAt: 1, topics })
const roots: string[] = []
const store = () => {
  const root = mkdtempSync(join(tmpdir(), 'ao64-readiness-'))
  roots.push(root)
  return new StudyReadinessStore(root)
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('AO-64: identidade da prontidão', () => {
  it('rechecks the locked twin without borrowing the ready state or books of the first twin', async () => {
    const previous = report({ ...entry('P2-HW-01'), books: [book] }, entry('P2-HW-02', 'sem-fonte'))
    const search = vi.fn(async () => ({ hits: [] }))
    const checked = await checkDisciplineReadiness(
      trail,
      'P2-HW',
      {
        vault: 'fixture',
        library: { search, inventory: async () => ({ sources: [] }) },
        subtopics: { get: () => undefined },
      },
      2,
      previous,
    )
    expect(checked.topics[0]).toEqual(previous.topics[0])
    expect(checked.topics[1]).toMatchObject({ id: 'P2-HW-02', state: 'sem-fonte' })
    expect(checked.topics[1]!.books).toBeUndefined()
    expect(search).toHaveBeenCalledOnce()
  })

  it('keeps separate book lists on two locked twins when rechecking', async () => {
    const secondBook = { ...book, title: 'Outro livro' }
    const previous = report({ ...entry('P2-HW-02', 'travado'), books: [secondBook] }, { ...entry('P2-HW-01', 'sem-fonte'), books: [book] })
    const checked = await checkDisciplineReadiness(
      trail,
      'P2-HW',
      {
        vault: 'fixture',
        library: { search: async () => ({ hits: [] }), inventory: async () => ({ sources: [] }) },
        subtopics: { get: () => undefined },
      },
      2,
      previous,
    )
    expect(checked.topics.map((t) => t.books)).toEqual([[book], [secondBook]])
  })

  it('requires each ID to be ready even with identical titles', () => {
    expect(isStudyReadinessReady(report(entry('P2-HW-01'), entry('P2-HW-02', 'sem-fonte')), trail.topics)).toBe(false)
    expect(isStudyReadinessReady(report(entry('P2-HW-01', 'sem-fonte'), entry('P2-HW-02')), trail.topics)).toBe(false)
    expect(isStudyReadinessReady(report(entry('P2-HW-01'), entry('P2-HW-02')), trail.topics)).toBe(true)
    expect(isStudyReadinessReady(report(entry('P2-HW-01')), trail.topics)).toBe(false)
  })

  it('never substitutes a different ID and gives an exact ID precedence over a stale title', () => {
    const target = [trail.topics[1]!]
    expect(isStudyReadinessReady(report(entry('P2-HW-01')), target)).toBe(false)
    expect(isStudyReadinessReady(report({ ...entry('P2-HW-02'), topic: 'Nome antigo' }), target)).toBe(true)
    expect(isStudyReadinessReady(report(entry(null), entry('P2-HW-02', 'sem-fonte')), target)).toBe(false)
    expect(isStudyReadinessReady(report(entry('P2-HW-02'), entry('P2-HW-02', 'sem-fonte')), target)).toBe(false)
    expect(isStudyReadinessReady(report(entry('P2-HW-02')), [target[0]!, target[0]!])).toBe(false)
  })

  it('reads unique legacy titles, but denies ambiguous titles in either the trail or the report', () => {
    expect(isStudyReadinessReady(report(entry(null)), [trail.topics[0]!])).toBe(true)
    expect(isStudyReadinessReady(report(entry(null)), ['Ondas'])).toBe(true)
    expect(isStudyReadinessReady(report(entry(null)), trail.topics)).toBe(false)
    expect(isStudyReadinessReady(report(entry(null)), ['Ondas', 'Ondas'])).toBe(false)
    expect(isStudyReadinessReady(report(entry(null), entry(null, 'sem-fonte')), ['Ondas'])).toBe(false)
  })

  it('does not lend an ID-bearing report entry to a target that lost its ID', () => {
    const withoutId = [{ id: null, title: 'Ondas' }]
    expect(isStudyReadinessReady(report(entry('P2-HW-01')), withoutId)).toBe(false)
    expect(isStudyReadinessReady(report(entry('P2-HW-01')), ['Ondas'])).toBe(false)
    expect(isStudyReadinessReady(report(entry('')), withoutId)).toBe(false)
    expect(isStudyReadinessReady(report(entry('')), [trail.topics[0]!])).toBe(false)
    expect(isStudyReadinessReady(report(entry(null)), withoutId)).toBe(true)
  })

  it('upgrades an unambiguous legacy ready entry to the current trail ID without rechecking', async () => {
    const search = vi.fn(async () => ({ hits: [] }))
    const checked = await checkDisciplineReadiness(
      { ...trail, topics: trail.topics.slice(0, 1) },
      'P2-HW',
      {
        vault: 'fixture',
        library: { search, inventory: async () => ({ sources: [] }) },
        subtopics: { get: () => undefined },
      },
      2,
      report(entry(null)),
    )
    expect(checked.topics).toEqual([entry('P2-HW-01')])
    expect(search).not.toHaveBeenCalled()
  })

  it('does not inherit ambiguous legacy readiness or books when rechecking twins', async () => {
    const checked = await checkDisciplineReadiness(
      trail,
      'P2-HW',
      {
        vault: 'fixture',
        library: { search: async () => ({ hits: [] }), inventory: async () => ({ sources: [] }) },
        subtopics: { get: () => undefined },
      },
      2,
      report({ ...entry(null), books: [book] }),
    )
    expect(checked.topics.map((t) => t.state)).toEqual(['sem-fonte', 'sem-fonte'])
    expect(checked.topics.every((t) => !t.books)).toBe(true)
  })

  it('does not keep readiness from a removed ID just because the new topic has the same title', async () => {
    const checked = await checkDisciplineReadiness(
      { ...trail, topics: trail.topics.slice(1) },
      'P2-HW',
      {
        vault: 'fixture',
        library: { search: async () => ({ hits: [] }), inventory: async () => ({ sources: [] }) },
        subtopics: { get: () => undefined },
      },
      2,
      report({ ...entry('P2-HW-01'), books: [book] }),
    )
    expect(checked.topics[0]).toMatchObject({ id: 'P2-HW-02', state: 'sem-fonte' })
    expect(checked.topics[0]!.books).toBeUndefined()
  })

  it('reads persisted legacy entries that omitted the ID, without changing the file on read', () => {
    const saved = store()
    const legacy = JSON.parse(
      '{"discipline":"P2-HW","builtAt":1,"topics":[{"topic":"Ondas","state":"pronto","reason":"","folders":[]}]}',
    ) as StudyReadiness
    saved.save(legacy)
    const loaded = saved.read()['P2-HW']!
    expect(loaded).toEqual(legacy)
    expect(isStudyReadinessReady(loaded, trail.topics.slice(0, 1))).toBe(true)
    expect(isStudyReadinessReady(loaded, trail.topics)).toBe(false)
  })

  it('assigns suggested books only to the requested ID and refuses an ambiguous title before searching', async () => {
    const saved = store()
    saved.save(report(entry('P2-HW-01', 'sem-fonte'), entry('P2-HW-02', 'sem-fonte')))
    const search = vi.fn(async () => [book])
    await expect(suggestTopicBooks(saved, 'P2-HW', 'Ondas', search)).rejects.toThrow(/prontidão|repetido/)
    expect(search).not.toHaveBeenCalled()
    const next = await suggestTopicBooks(saved, 'P2-HW', 'P2-HW-02', search)
    expect(next.topics[0]!.books).toBeUndefined()
    expect(next.topics[1]!.books).toEqual([book])
  })

  it('does not apply a book search to a replacement topic with another ID', async () => {
    const saved = store()
    saved.save(report(entry('P2-HW-01', 'sem-fonte')))
    let release!: (books: (typeof book)[]) => void
    const pending = suggestTopicBooks(
      saved,
      'P2-HW',
      'Ondas',
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    saved.save(report(entry('P2-HW-02', 'sem-fonte')))
    release([book])
    await expect(pending).rejects.toThrow(/prontidão|novo/)
    expect(saved.read()['P2-HW']!.topics[0]!.books).toBeUndefined()
  })

  it('guards cards and ideas by ID, not the ready twin, and refuses title-only ambiguity', async () => {
    const source = { trail: () => trail, reports: () => ({ 'P2-HW': report(entry('P2-HW-01'), entry('P2-HW-02', 'sem-fonte')) }) }
    expect(() => assertTopicReady(source, trail.topics[0]!.label)).not.toThrow()
    expect(() => assertTopicReady(source, trail.topics[1]!.label)).toThrow(/ainda não está pronto/)
    expect(() => assertTopicReady(source, 'Ondas')).toThrow(/mais de|repetido/)
    expect(() => assertTopicReady(source, '[P2-HW-99] Ondas')).toThrow(/não está na trilha/)
    const ask = vi.fn(async () => ({ ideas: [] }))
    await expect(generateIdeas(trail.topics[1]!.label, ask, source)).rejects.toThrow(/ainda não está pronto/)
    expect(ask).not.toHaveBeenCalled()
  })

  it('uses legacy readiness for a unique topic in cards and ideas, but not for twins', () => {
    const reports = () => ({ 'P2-HW': report(entry(null)) })
    expect(() =>
      assertTopicReady({ trail: () => ({ ...trail, topics: trail.topics.slice(0, 1) }), reports }, trail.topics[0]!.label),
    ).not.toThrow()
    expect(() => assertTopicReady({ trail: () => trail, reports }, trail.topics[0]!.label)).toThrow(/relatório|novo/)
  })

  it('refuses ambiguous legacy proof before the question builder can call a model', async () => {
    const ask = vi.fn(async () => ({ error: 'unsupported' }))
    const search = vi.fn(async () => ({ hits: [] }))
    await expect(
      proveReadyTopics(trail, report(entry(null)), {
        store: store(),
        build: { library: { search }, bank: { read: () => ({ questions: [] }), appendChecked: vi.fn() }, ask },
      }),
    ).rejects.toThrow(/repetido|novo/)
    expect(ask).not.toHaveBeenCalled()
    expect(search).not.toHaveBeenCalled()
  })
})
