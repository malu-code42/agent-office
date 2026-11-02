import { describe, expect, it } from 'vitest'
import { checkSubtopics, listsAgree, tocEntries, type OutlineEntry } from '../src/shared/study-outline'
import { buildSubtopics } from '../src/main/study-subtopics'

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
