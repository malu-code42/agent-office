import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { deflateRawSync } from 'node:zlib'
import { StudyLibrary, StudyNotesWriter } from '../src/main/study-library'
import { scoreStudyText, studySnippet, tokenizeStudyQuery } from '../src/shared/study-library'

const roots: string[] = []
const fixture = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'study-library-'))
  roots.push(root)
  return root
}

/** A minimal zip (deflate) with these files, as a .pptx is. */
function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const data = deflateRawSync(Buffer.from(text))
    const nameBuf = Buffer.from(name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(text.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0)
    entry.writeUInt16LE(8, 10)
    entry.writeUInt32LE(data.length, 20)
    entry.writeUInt32LE(text.length, 24)
    entry.writeUInt16LE(nameBuf.length, 28)
    entry.writeUInt32LE(offset, 42)
    locals.push(local, nameBuf, data)
    central.push(entry, nameBuf)
    offset += 30 + nameBuf.length + data.length
  }
  const cd = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Cora: biblioteca somente local', () => {
  it('reports an empty local library without trying a remote fallback', () => {
    const result = new StudyLibrary(fixture()).search('probabilidade')
    expect(result.complete).toBe(true)
    expect(result.hits).toEqual([])
    expect(result.warning).toMatch(/ainda não existe/i)
  })

  it('busca conteúdo em arquivos Markdown locais e devolve uma referência citável', () => {
    const vault = fixture()
    const sources = join(vault, 'study sources', 'matemática')
    mkdirSync(sources, { recursive: true })
    writeFileSync(
      join(sources, 'probabilidade.md'),
      '# Eventos independentes\n\nA probabilidade conjunta de eventos independentes é o produto das probabilidades.\n',
    )
    const library = new StudyLibrary(vault)
    const result = library.search('probabilidade conjunta')
    expect(result.complete).toBe(true)
    expect(result.hits[0]).toMatchObject({
      sourceRef: 'study sources/matemática/probabilidade.md#Eventos independentes:3',
      title: 'Eventos independentes',
      line: 3,
    })
    expect(library.source(result.token, result.hits[0]!.id)).toEqual(result.hits[0])
    expect(() => library.source(result.token, 'missing-hit-id-00000')).toThrow(/busca local/i)
  })

  it('lê o que cabe e busca pelo nome o que passa do limite, avisando', () => {
    const vault = fixture()
    const sources = join(vault, 'study sources')
    mkdirSync(sources)
    writeFileSync(join(sources, 'probabilidade grande.txt'), `Probabilidade ${'conteúdo '.repeat(140_000)}`)
    writeFileSync(join(sources, 'eventos.md'), 'A probabilidade de eventos independentes.\n')
    const result = new StudyLibrary(vault).search('probabilidade')
    expect(result.complete).toBe(false)
    expect(result.hits.map((hit) => hit.sourceRef)).toEqual(['study sources/eventos.md:1', 'study sources/probabilidade grande.txt'])
    expect(result.warning).toMatch(/limite de leitura/i)
  })

  it('busca PDFs pelo nome e pela pasta, avisando que o conteúdo não é lido', () => {
    const vault = fixture()
    const sources = join(vault, 'study sources', 'Estrutura de Dados')
    mkdirSync(sources, { recursive: true })
    writeFileSync(join(sources, 'Aula 06 Filas.pdf'), 'fixture binária')
    writeFileSync(join(sources, 'Aula 02 Listas.pdf'), 'fixture binária')
    writeFileSync(join(vault, 'study sources', 'Cálculo.pdf'), 'fixture binária')
    const result = new StudyLibrary(vault).search('fila, estrutura de dados')
    expect(result.complete).toBe(false)
    expect(result.hits.map((hit) => hit.title)).toEqual(['Aula 06 Filas.pdf', 'Aula 02 Listas.pdf'])
    expect(result.hits[0]).toMatchObject({ sourceRef: 'study sources/Estrutura de Dados/Aula 06 Filas.pdf', line: 0 })
    expect(result.hits[0]!.excerpt).toMatch(/pelo nome/)
    expect(result.warning).toMatch(/3 PDF/)
  })

  it('busca sem acento e sem diferenciar maiúsculas, ranqueando por termos e mostrando o trecho', () => {
    const vault = fixture()
    const sources = join(vault, 'study sources')
    mkdirSync(sources)
    writeFileSync(
      join(sources, 'ed.md'),
      [
        '# Pilhas',
        '',
        'Uma pilha guarda dados em ordem LIFO.',
        '',
        '# Filas',
        '',
        `${'Texto de abertura. '.repeat(40)}A FILA é uma Estrutura de Dados FIFO.`,
      ].join('\n'),
    )
    const result = new StudyLibrary(vault).search('filas, estrutura de dados')
    expect(result.complete).toBe(true)
    expect(result.hits[0]).toMatchObject({ title: 'Filas', line: 7 })
    expect(result.hits[0]!.excerpt.startsWith('…')).toBe(true)
    expect(result.hits[0]!.excerpt).toContain('A FILA é uma Estrutura de Dados FIFO.')
    expect(result.hits[1]).toMatchObject({ title: 'Pilhas' })
    expect(result.hits[0]!.score).toBeGreaterThan(result.hits[1]!.score)
  })

  it('lê o texto dos slides de uma apresentação .pptx', () => {
    const vault = fixture()
    const sources = join(vault, 'study sources')
    mkdirSync(sources)
    writeFileSync(
      join(sources, 'aula.pptx'),
      zip({
        'ppt/slides/slide2.xml': '<p:sld><a:p><a:r><a:t>Fila de prioridade &amp; heap</a:t></a:r></a:p></p:sld>',
        'ppt/slides/slide1.xml': '<p:sld><a:p><a:t>Introdução</a:t></a:p></p:sld>',
      }),
    )
    const result = new StudyLibrary(vault).search('heap')
    expect(result.complete).toBe(true)
    expect(result.hits).toHaveLength(1)
    expect(result.hits[0]).toMatchObject({
      title: 'Slide 2',
      sourceRef: 'study sources/aula.pptx#Slide 2',
      line: 0,
      excerpt: 'Fila de prioridade & heap',
    })
  })
})

describe('tokenizeStudyQuery e scoreStudyText', () => {
  it('separa termos por vírgula e espaço, sem acentos, maiúsculas, plural nem palavras vazias', () => {
    expect(tokenizeStudyQuery('Fila, Estrutura de Dados; ÁRVORES')).toEqual({
      terms: ['fila', 'estrutura', 'dado', 'arvore'],
      phrases: ['estrutura de dados'],
    })
    expect(tokenizeStudyQuery('de, a').terms).toEqual([])
  })

  it('pontua mais quem tem mais termos e a frase inteira; zero sem termos', () => {
    const q = tokenizeStudyQuery('fila, estrutura de dados')
    const both = scoreStudyText('Filas são estruturas de dados.', q)
    const one = scoreStudyText('Uma fila no banco.', q)
    expect(both).toBeGreaterThan(one)
    expect(one).toBeGreaterThan(0)
    expect(scoreStudyText('perfilado', q)).toBe(0)
  })

  it('recorta o trecho em volta do primeiro termo', () => {
    const q = tokenizeStudyQuery('heap')
    const text = `${'a '.repeat(300)}o heap binário ${'b '.repeat(300)}`
    const cut = studySnippet(text, q, 100)
    expect(cut).toMatch(/^….*heap binário.*…$/)
    expect(cut.length).toBeLessThanOrEqual(102)
  })
})

describe('notas de estudo Obsidian', () => {
  it('append-only atomic note save preserves existing text, backs it up and deduplicates retries', () => {
    const vault = fixture()
    const noteFile = join(vault, 'notas-estudo.md')
    const old = '# Minhas notas\n\nNota anterior.\n'
    writeFileSync(noteFile, old)
    const writer = new StudyNotesWriter(vault)
    const entry = {
      id: 'sn-sc-123-abcdefgh-q-12345678-hash',
      gapQuestionId: 'q-12345678',
      sourceRef: 'study sources/probabilidade.md#Eventos:3',
      text: 'Vou conferir primeiro se os eventos são independentes.',
      savedAt: Date.UTC(2026, 9, 25),
    }
    writer.write(entry)
    writer.write(entry)
    const saved = readFileSync(noteFile, 'utf8')
    expect(saved).toContain(old.trim())
    expect(saved.match(/agent-office-study-note:/g)).toHaveLength(1)
    expect(saved).toContain(entry.sourceRef)
    expect(saved).toContain(entry.text)
    expect(readFileSync(`${noteFile}.bak`, 'utf8')).toBe(old)
  })
})
