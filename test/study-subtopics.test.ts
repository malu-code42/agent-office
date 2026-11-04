import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkSubtopics, listsAgree, tocEntries, tocScore, type OutlineEntry } from '../src/shared/study-outline'
import type { StudySubtopics } from '../src/shared/study-outline'
import { dataNotices } from '../src/main/fs-safe'
import { buildSubtopics, buildTopicSubtopics, StudySubtopicStore, STUDY_SUBTOPICS_FILE } from '../src/main/study-subtopics'

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
  it('does not turn into ok when only one list is valid, even if the third agent picks it', async () => {
    let calls = 0
    const ask = async (system: string) =>
      system.includes('Two people') ? { pick: 'A' } : { subtopics: calls++ === 0 ? same : list([99], [98], [97]) }
    expect((await buildSubtopics('T', 'livro.pdf', outline, ask)).status).toBe('sem-acordo')
  })
  it('stays without subtopics when no list is valid or the book has no index', async () => {
    const bad = async () => ({ subtopics: list([99], [98], [97]) })
    expect((await buildSubtopics('T', 'livro.pdf', outline, bad)).status).toBe('sem-acordo')
    expect((await buildSubtopics('T', 'livro.pdf', [], bad)).status).toBe('sem-indice')
  })
})

describe('buildTopicSubtopics', () => {
  it('skips a short book without an index and uses the next one that has it', async () => {
    const library = {
      search: async () => ({ hits: [{ sourceRef: 'curto.pdf:1' }, { sourceRef: 'longo.pdf:2' }] as never }),
      outline: async (path: string) => (path === 'curto.pdf' ? [] : outline),
    }
    const out = await buildTopicSubtopics({ id: 'x', title: 'T', discipline: 'D' } as never, library, async () => ({
      subtopics: list([0, 1], [2, 3], [4, 5]),
    }))
    expect(out).toMatchObject({ status: 'ok', source: 'longo.pdf' })
    const none = await buildTopicSubtopics(
      { id: 'x', title: 'T', discipline: 'D' } as never,
      { ...library, outline: async () => [] },
      async () => null,
    )
    expect(none).toMatchObject({ status: 'sem-indice', source: 'curto.pdf' })
  })
})

describe('buildTopicSubtopics book choice', () => {
  it('uses the book whose table of contents is about the topic, not the first one that has a table', async () => {
    const about = Array.from({ length: 12 }, (_, id) => ({ id, title: `Portas lógicas parte ${id}`, page: 10 + id }))
    const library = {
      search: async () => ({ hits: [{ sourceRef: 'geral.pdf:1' }, { sourceRef: 'portas.pdf:2' }] as never }),
      outline: async (path: string) => (path === 'geral.pdf' ? outline : about),
    }
    const out = await buildTopicSubtopics({ id: 'x', title: 'Portas lógicas', discipline: 'D' } as never, library, async () => ({
      subtopics: list([0, 1], [2, 3], [4, 5]),
    }))
    expect(out).toMatchObject({ status: 'ok', source: 'portas.pdf' })
  })
})

describe('buildSubtopics reasons', () => {
  const same = list([0, 1], [2, 3], [4, 5])
  it('says which list broke a rule', async () => {
    const ask = async () => ({ subtopics: list([99], [98], [97]) })
    const out = await buildSubtopics('T', 'livro.pdf', outline, ask)
    expect(out.status).toBe('sem-acordo')
    expect(out.reason).toContain('Uma lista não passou nas regras')
    expect(out.reason).toContain('não existem no índice')
  })
  it('says the third agent picked none when both lists are valid and differ', async () => {
    let calls = 0
    const ask = async (system: string) =>
      system.includes('Two people') ? { pick: 'none' } : { subtopics: calls++ === 0 ? same : list([6, 7], [8, 9], [10, 11]) }
    const out = await buildSubtopics('T', 'livro.pdf', outline, ask)
    expect(out.status).toBe('sem-acordo')
    expect(out.reason).toContain('o árbitro não escolheu nenhuma')
  })
})

describe('tocScore', () => {
  it('counts the lines that share a word with the topic, ignoring accents, case and plurals', () => {
    const toc: OutlineEntry[] = [
      { id: 0, title: 'Portas Lógicas e circuitos', page: 1 },
      { id: 1, title: 'Porta comum', page: 2 },
      { id: 2, title: 'Lei de Ohm', page: 3 },
    ]
    expect(tocScore('Portas lógicas', toc)).toBe(2)
    expect(tocScore('Álgebra booleana', toc)).toBe(0)
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
  const entry = (topic: string): StudySubtopics => ({
    topic,
    source: 'L.pdf',
    builtAt: 1,
    status: 'sem-acordo',
    reason: 'x',
    subtopics: [],
  })

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

  it('warns the user when the file was corrupt and restored', () => {
    const { store, file } = setup()
    store.save(entry('A'))
    store.read()
    writeFileSync(file, '{ cortado')
    const before = dataNotices().length
    store.read()
    const added = dataNotices().slice(before)
    expect(added.some((n) => n.file === STUDY_SUBTOPICS_FILE && n.kind === 'restored')).toBe(true)
  })

  it('still returns the restored data when writing them back fails', () => {
    const { store, file } = setup()
    store.save(entry('A'))
    store.read()
    writeFileSync(file, '{ cortado')
    mkdirSync(file + '.tmp') // the atomic write cannot open its temp file
    expect(Object.keys(store.read())).toEqual(['A'])
  })

  it('writes the restored data back, so a save right after a restoring read keeps it', () => {
    const { store, file } = setup()
    store.save(entry('A'))
    store.read()
    writeFileSync(file, '{ cortado')
    expect(Object.keys(store.read())).toEqual(['A'])
    expect(JSON.parse(readFileSync(file, 'utf8'))).toHaveProperty('A')
    store.save(entry('B'))
    expect(Object.keys(store.read()).sort()).toEqual(['A', 'B'])
  })
})
