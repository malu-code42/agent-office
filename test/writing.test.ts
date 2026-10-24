import { describe, expect, it } from 'vitest'
import {
  VERSION_ID,
  WritingSnippet,
  appendSnippet,
  appendVersion,
  parseWriting,
  serializeWriting,
  type WritingVersion,
} from '../src/shared/writing'

const originalArgs = {
  id: 'wabc12345',
  title: 'Rascunho inicial',
  body: '# Título\n\nTexto original.',
  createdAt: '2026-10-24T10:00:00.000Z',
  versionId: 'vabc12345',
}

describe('WritingSnippet', () => {
  it('preserva o Original e acrescenta revisão baseada em qualquer versão existente', () => {
    const snippet = WritingSnippet.createOriginal(originalArgs)
    const first = snippet.version('vabc12345')
    const revised = snippet.appendVersion({
      versionId: 'vdef67890',
      baseVersionId: first.versionId,
      body: 'Texto revisado.',
      createdAt: '2026-10-24T11:00:00.000Z',
    })

    expect(first).toMatchObject({ number: 1, source: 'original', body: originalArgs.body })
    expect(revised).toMatchObject({ number: 2, source: 'escrita', baseVersionId: first.versionId })
    expect(snippet.version(first.versionId)).toEqual(first)
    expect(snippet.latestVersion()).toEqual(revised)
    expect(() => (snippet.versions as WritingVersion[]).pop()).toThrow()
  })

  it('valida IDs, título, corpo e instrução com mensagens em pt-BR', () => {
    expect(() => WritingSnippet.createOriginal({ ...originalArgs, title: 'linha 1\nlinha 2' })).toThrow(/título/i)
    expect(() => WritingSnippet.createOriginal({ ...originalArgs, title: 'x'.repeat(201) })).toThrow(/200 caracteres/i)
    expect(WritingSnippet.createOriginal({ ...originalArgs, title: 'x'.repeat(200) }).title).toHaveLength(200)
    expect(() => WritingSnippet.createOriginal({ ...originalArgs, body: '' })).toThrow(/corpo/i)
    expect(() => WritingSnippet.createOriginal({ ...originalArgs, id: 'invalid' })).toThrow(/ID/i)
    const snippet = WritingSnippet.createOriginal(originalArgs)
    expect(() =>
      snippet.appendVersion({
        versionId: 'vdef67890',
        baseVersionId: 'vnope1234',
        body: 'ok',
        createdAt: '2026-10-24T11:00:00.000Z',
      }),
    ).toThrow(/versão base/i)
    expect(() =>
      snippet.appendVersion({
        versionId: 'vabc12345',
        baseVersionId: 'vabc12345',
        body: 'ok',
        createdAt: '2026-10-24T11:00:00.000Z',
      }),
    ).toThrow(/ID de versão/i)
    expect(() => WritingSnippet.validateInstruction('')).toThrow(/instrução/i)
    expect(() => WritingSnippet.validateInstruction('x'.repeat(2_001))).toThrow(/2\.000/)
    expect(WritingSnippet.validateInstruction('x'.repeat(2_000))).toBe('x'.repeat(2_000))
  })
})

describe('codec de escrita.md', () => {
  it.each(['\n', '\r\n'])('faz round-trip exato com Markdown e %j', (eol) => {
    const body = ['# Título', '', '<b>HTML</b>', '```ts', 'const x = 1', '```'].join(eol)
    const snippet = WritingSnippet.createOriginal({ ...originalArgs, body })
    const encoded = serializeWriting(appendSnippet(parseWriting('Notas livres' + eol), snippet))
    expect(serializeWriting(parseWriting(encoded))).toBe(encoded)
    expect(parseWriting(encoded).snippets[0]?.latestVersion().body).toBe(body)
  })

  it('preserva conteúdo desconhecido e permite acrescentar sem descartá-lo', () => {
    const input = '# Cabeçalho desconhecido\ncomentário livre\n'
    const snippet = WritingSnippet.createOriginal(originalArgs)
    const doc = appendSnippet(parseWriting(input), snippet)
    expect(serializeWriting(doc)).toContain(input)
    expect(serializeWriting(doc)).toContain('office-writing:begin:')
    expect(serializeWriting(parseWriting(serializeWriting(doc)))).toBe(serializeWriting(doc))
  })

  it('rejeita IDs duplicados, metadados malformados, ordem inválida e corpo vazio/longo', () => {
    const snippet = WritingSnippet.createOriginal(originalArgs)
    const encoded = serializeWriting(appendSnippet(parseWriting(''), snippet))
    const withRevision = serializeWriting(
      appendVersion(
        parseWriting(encoded),
        snippet.id,
        snippet.appendVersion({
          versionId: 'vdef67890',
          baseVersionId: 'vabc12345',
          body: 'revisão',
          createdAt: '2026-10-24T11:00:00.000Z',
        }),
      ),
    )
    expect(() => parseWriting(encoded + encoded)).toThrow(/duplicad/i)
    expect(() => parseWriting(withRevision.replace('"number":2', '"number":3'))).toThrow(/ordem|sequência/i)
    expect(() => parseWriting(encoded.replace(/office-writing:version[^\n]*/, 'office-writing:version ruim'))).toThrow(
      /inválid|versão salva/i,
    )
    expect(() => WritingSnippet.createOriginal({ ...originalArgs, body: 'x'.repeat(50_001) })).toThrow(/50\.000/)
    expect(() => WritingSnippet.createOriginal({ ...originalArgs, body: '' })).toThrow(/vazio|corpo/i)
  })

  it('aceita 50.000 caracteres e não aceita delimitador de fechamento no conteúdo', () => {
    const body = 'x'.repeat(50_000)
    const snippet = WritingSnippet.createOriginal({ ...originalArgs, body })
    expect(snippet.latestVersion().body).toHaveLength(50_000)
    const serialized = serializeWriting(appendSnippet(parseWriting(''), snippet))
    expect(parseWriting(serialized).snippets[0]?.latestVersion().body).toBe(body)
    const collision = '<!-- office-writing:end:vabc12345 -->'
    expect(() => WritingSnippet.createOriginal({ ...originalArgs, body: collision })).toThrow(/delimitador/i)
  })

  it('appendVersion mantém literalmente o bloco antigo e conteúdo desconhecido', () => {
    const snippet = WritingSnippet.createOriginal(originalArgs)
    const firstDoc = appendSnippet(parseWriting('linha desconhecida\n'), snippet)
    const before = serializeWriting(firstDoc)
    const revised = snippet.appendVersion({
      versionId: 'vdef67890',
      baseVersionId: 'vabc12345',
      body: 'nova versão',
      createdAt: '2026-10-24T11:00:00.000Z',
    })
    const after = serializeWriting(appendVersion(firstDoc, snippet.id, revised))
    expect(after).toContain(before)
    expect(after).toContain('linha desconhecida\n')
    expect(parseWriting(after).snippets[0]?.versions).toHaveLength(2)
  })
})

describe('integridade das versoes', () => {
  it('rejeita versao cuja base referencia o proprio ID ao restaurar ou analisar', () => {
    const original = WritingSnippet.createOriginal(originalArgs).latestVersion()
    const selfReferential: WritingVersion = {
      versionId: 'vdef67890',
      number: 2,
      createdAt: '2026-10-24T11:00:00.000Z',
      source: 'escrita',
      baseVersionId: 'vdef67890',
      body: 'revisao',
    }
    expect(() => WritingSnippet.restore(originalArgs.id, originalArgs.title, [original, selfReferential])).toThrow(/base/i)

    const snippet = WritingSnippet.createOriginal(originalArgs)
    const document = appendSnippet(parseWriting(''), snippet)
    const revised = snippet.appendVersion({
      versionId: 'vdef67890',
      baseVersionId: 'vabc12345',
      body: 'revisao',
      createdAt: '2026-10-24T11:00:00.000Z',
    })
    const encoded = serializeWriting(appendVersion(document, snippet.id, revised))
    const selfBased = encoded.replace('"baseVersionId":"vabc12345"', '"baseVersionId":"vdef67890"')
    expect(() => parseWriting(selfBased)).toThrow(/base/i)
  })
})

describe('IDs gerados', () => {
  it('gera ID criptograficamente aleatorio compat?vel com VERSION_ID e aceita ID fixo', () => {
    const generated = WritingSnippet.createOriginal({ ...originalArgs, versionId: undefined }).latestVersion().versionId
    expect(VERSION_ID.test(generated)).toBe(true)
    expect(WritingSnippet.createOriginal(originalArgs).latestVersion().versionId).toBe(originalArgs.versionId)
  })
})
