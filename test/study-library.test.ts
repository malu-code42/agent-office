import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { StudyLibrary, StudyNotesWriter } from '../src/main/study-library'

const roots: string[] = []
const fixture = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'study-library-'))
  roots.push(root)
  return root
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

  it('não devolve conteúdo parcial se a biblioteca excede o limite seguro', () => {
    const vault = fixture()
    const sources = join(vault, 'study sources')
    mkdirSync(sources)
    writeFileSync(join(sources, 'grande.txt'), `Probabilidade ${'conteúdo '.repeat(140_000)}`)
    const result = new StudyLibrary(vault).search('probabilidade')
    expect(result.complete).toBe(false)
    expect(result.hits).toEqual([])
    expect(result.warning).toMatch(/limite de leitura/i)
  })

  it('avisa quando existem formatos que Cora não consegue ler, sem fingir cobertura completa', () => {
    const vault = fixture()
    const sources = join(vault, 'study sources')
    mkdirSync(sources)
    writeFileSync(join(sources, 'material.pdf'), 'fixture binária')
    const result = new StudyLibrary(vault).search('probabilidade')
    expect(result.complete).toBe(false)
    expect(result.hits).toEqual([])
    expect(result.warning).toMatch(/\.md e \.txt/i)
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
