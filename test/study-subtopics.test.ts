import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkSubtopics, listsAgree, tocEntries, type OutlineEntry } from '../src/shared/study-outline'
import type { StudySubtopics } from '../src/shared/study-outline'
import { buildSubtopics, StudySubtopicStore, STUDY_SUBTOPICS_FILE } from '../src/main/study-subtopics'

const outline: OutlineEntry[] = Array.from({ length: 12 }, (_, id) => ({ id, title: `Seção ${id}`, page: 10 + id }))
const list = (...groups: number[][]) => groups.map((entries, i) => ({ name: `Parte ${i + 1}`, entries }))

describe('tocEntries', () => {
  it('reads title and page from lines that end in a page number', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `${i + 1}.1 Lei de Coulomb ${i} ........ ${20 + i}`).join('\n')
    const entries = tocEntries(['Sumário', lines])
    expect(entries).toHaveLength(10)
    expect(entries[0]).toMatchObject({ id: 0, title: '1.1 Lei de Coulomb 0', page: 20 })
  })
  it('finds no table of contents in ordinary text', () => {
    expect(tocEntries(['Uma página de texto comum.\nOutra linha 12'])).toEqual([])
  })
})

describe('checkSubtopics', () => {
  it('accepts a list with real sections, one subtopic each', () => {
    expect(checkSubtopics(list([0, 1], [2, 3], [4]), outline).ok).toBe(true)
  })
  it('refuses unknown sections, shared sections and a wrong count', () => {
    expect(checkSubtopics(list([0], [99], [2]), outline).ok).toBe(false)
    expect(checkSubtopics(list([0], [0, 1], [2]), outline).ok).toBe(false)
    expect(checkSubtopics(list([0], [1]), outline).ok).toBe(false)
  })
})

describe('buildSubtopics', () => {
  const same = list([0, 1], [2, 3], [4, 5])
  it('keeps the list when the two made apart agree', async () => {
    const ask = async () => ({ subtopics: same })
    const out = await buildSubtopics('Eletrostática', 'livro.pdf', outline, ask)
    expect(out).toMatchObject({ status: 'ok', agreed: true })
    expect(out.subtopics[0]!.sections[0]).toEqual({ title: 'Seção 0', page: 10 })
  })
  it('lets the third agent pick when they differ, and only between valid lists', async () => {
    let calls = 0
    const ask = async (system: string) => {
      if (system.includes('Two people')) return { pick: 'B' }
      return { subtopics: calls++ === 0 ? same : list([6, 7], [8, 9], [10, 11]) }
    }
    const out = await buildSubtopics('T', 'livro.pdf', outline, ask)
    expect(out).toMatchObject({ status: 'ok', agreed: false })
    expect(out.subtopics[0]!.sections[0]!.title).toBe('Seção 6')
  })
  it('stays without subtopics when no list is valid or the book has no index', async () => {
    const bad = async () => ({ subtopics: list([99], [98], [97]) })
    expect((await buildSubtopics('T', 'livro.pdf', outline, bad)).status).toBe('sem-acordo')
    expect((await buildSubtopics('T', 'livro.pdf', [], bad)).status).toBe('sem-indice')
  })
})

describe('listsAgree', () => {
  const base = list([0, 1], [2, 3], [4, 5])
  it('agrees when each part has a counterpart and the left-out sections are mostly the same', () => {
    expect(listsAgree(base, list([0, 1], [2], [3, 4, 5]))).toBe(true)
  })
  it('does not agree when a part has no counterpart or the lists cover other sections', () => {
    expect(listsAgree(base, list([0, 1], [2, 3], [6, 7]))).toBe(false)
    expect(listsAgree(base, list([0, 1, 2, 3, 4, 5], [6], [7]))).toBe(false)
  })
})

describe('StudySubtopicStore', () => {
  const dirs: string[] = []
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))
  const setup = () => {
    const dir = mkdtempSync(join(tmpdir(), 'subtopics-'))
    dirs.push(dir)
    return { dir, file: join(dir, STUDY_SUBTOPICS_FILE), store: new StudySubtopicStore(dir) }
  }
  const entry = (topic: string): StudySubtopics => ({ topic, source: 'L.pdf', builtAt: 1, status: 'sem-acordo', reason: 'x', subtopics: [] })

  it('keeps every topic when saves run at the same time', async () => {
    const { store } = setup()
    await Promise.all(['A', 'B', 'C'].map(async (t) => store.save(entry(t))))
    expect(Object.keys(store.read()).sort()).toEqual(['A', 'B', 'C'])
  })

  it('drops entries with a wrong shape when reading', () => {
    const { store, file } = setup()
    writeFileSync(file, JSON.stringify({ ok: entry('ok'), bad: { topic: 'bad', status: 'ok', subtopics: 'x' }, nope: 3 }))
    expect(Object.keys(store.read())).toEqual(['ok'])
  })

  it('does not erase the rest after a corrupt file: the bad file is kept and the backup comes back', () => {
    const { store, file, dir } = setup()
    store.save(entry('A'))
    store.read() // refreshes the .bak
    writeFileSync(file, '{ cortado')
    store.save(entry('B'))
    expect(Object.keys(store.read()).sort()).toEqual(['A', 'B'])
    expect(readdirSync(dir).some((f) => f.includes('corrupt'))).toBe(true)
    expect(readFileSync(file, 'utf8')).toContain('"A"')
  })
})
