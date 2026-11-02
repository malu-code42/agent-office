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
  it('reads single-space pages after a section number or a chapter word (real books print them so)', () => {
    const lines = [
      '1. Funções Vetoriais 5',
      ...Array.from({ length: 6 }, (_, i) => `1.${i + 1} Seção de exemplo ${i} ${6 + i * 4}`),
      'Capítulo 2 Campo elétrico 45',
    ].join('\n')
    const entries = tocEntries([lines])
    expect(entries).toHaveLength(8)
    expect(entries[0]).toMatchObject({ title: '1. Funções Vetoriais', page: 5 })
    expect(entries[7]).toMatchObject({ title: 'Capítulo 2 Campo elétrico', page: 45 })
  })
  it('does not take running headers or table rows with a single space for entries', () => {
    const headers = Array.from({ length: 12 }, (_, i) => `${i * 2 + 2} Título do Livro Capítulo ${i + 1}`).join('\n')
    const rows = Array.from({ length: 12 }, () => 'Integração em larga escala 100').join('\n')
    expect(tocEntries([headers, rows])).toEqual([])
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
