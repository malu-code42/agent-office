import { describe, expect, it } from 'vitest'
import { decodeStudyBank, encodeStudyQuestion, rankStudyQuestions, type StudyQuestion } from '../src/shared/study-questions'
import {
  closeSync,
  existsSync,
  ftruncateSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StudyQuestionService } from '../src/main/study-questions'

const question = (overrides: Partial<StudyQuestion> = {}): StudyQuestion => ({
  id: 'q-12345678',
  topic: 'Probabilidade',
  tags: ['eventos'],
  question: 'Uma moeda é lançada. Qual a chance de cara?',
  answer: '1/2',
  answerStatus: 'verified',
  originKind: 'enem',
  sourceTitle: 'Prova sintética',
  sourceVisibility: 'public',
  sourceUrl: 'https://example.org/prova',
  attribution: 'Exemplo educacional',
  license: 'CC BY 4.0',
  ...overrides,
})

describe('study question bank codec', () => {
  it('round-trips records while preserving unrecognized markdown lines', () => {
    const source = '# Banco de questões\n\nTexto manual que não conheço\n'
    const decoded = decodeStudyBank(source)
    const updated = `${source}${encodeStudyQuestion(question())}\n`
    const again = decodeStudyBank(updated)
    expect(decoded.unknownLines).toEqual(['Texto manual que não conheço'])
    expect(again.questions).toEqual([question()])
    expect(again.unknownLines).toEqual(['Texto manual que não conheço'])
  })

  it('rejects duplicate ids and unsafe urls', () => {
    const line = encodeStudyQuestion(question())
    expect(() => decodeStudyBank(`${line}\n${line}`)).toThrow(/duplicado/i)
    expect(() => encodeStudyQuestion(question({ sourceUrl: 'file:///private/book.pdf' }))).toThrow(/URL/i)
  })

  it('ranks trusted local origins ENEM, contest, then book', () => {
    const rows = [question({ id: 'q-book0001', originKind: 'livro' }), question({ id: 'q-contest1', originKind: 'concurso' }), question()]
    expect(rankStudyQuestions(rows).map((row) => row.originKind)).toEqual(['enem', 'concurso', 'livro'])
  })

  it('limits field sizes and only regards verified answers as verified', () => {
    expect(() => encodeStudyQuestion(question({ question: 'x'.repeat(20_001) }))).toThrow()
    expect(decodeStudyBank(encodeStudyQuestion(question({ answerStatus: 'unverified' }))).questions[0]?.answerStatus).toBe('unverified')
  })

  it('only writes explicit selections and refuses stale snapshots', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'study-bank-'))
    try {
      const service = new StudyQuestionService(vault, {
        webSearch: async () => [question({ originKind: 'web', answerStatus: 'unverified' })],
      })
      const results = await service.search('Probabilidade')
      expect(existsSync(join(vault, 'questoes-estudo.md'))).toBe(false)
      expect(() => service.save(results.token, [question({ id: 'q-forged01', originKind: 'ia' })], true)).toThrow(/não veio desta busca/i)
      const refreshed = await service.search('Probabilidade')
      writeFileSync(join(vault, 'questoes-estudo.md'), '# edição no Obsidian\n')
      expect(() => service.save(refreshed.token, refreshed.web, true)).toThrow(/mudou/i)
      const fresh = await service.search('Probabilidade')
      service.save(fresh.token, fresh.web.slice(0, 1), true)
      expect(service.read().questions).toHaveLength(1)
      expect(() => service.save(fresh.token, fresh.web, true)).toThrow(/expirou/i)
    } finally {
      rmSync(vault, { recursive: true, force: true })
    }
  })

  it('generates candidates only after an explicit request following completed insufficient search', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'study-bank-'))
    try {
      let generated = 0
      const service = new StudyQuestionService(vault, {
        webSearch: async () => [],
        generate: async () => {
          generated++
          return [question({ id: 'q-generated1', originKind: 'enem', answerStatus: 'verified' })]
        },
      })
      const result = await service.search('Probabilidade', 1)
      expect(result).toMatchObject({ status: 'noResults', generated: [], canGenerate: true })
      expect(generated).toBe(0)
      const generation = await service.generate(result.token)
      expect(generated).toBe(1)
      expect(generation.generated[0]).toMatchObject({ originKind: 'ia', answerStatus: 'unverified' })
    } finally {
      rmSync(vault, { recursive: true, force: true })
    }
  })

  it('falls back to generation after a mocked WebSearch failure without logging its query', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'study-bank-'))
    try {
      let generated = 0
      const service = new StudyQuestionService(vault, {
        webSearch: async () => {
          throw new Error('synthetic failure')
        },
        generate: async () => {
          generated++
          return [question({ id: 'q-generated2', originKind: 'ia', answerStatus: 'unverified' })]
        },
      })
      const result = await service.search('Tópico sintético', 1)
      expect(result).toMatchObject({ status: 'error', generated: [], canGenerate: false })
      expect(generated).toBe(0)
    } finally {
      rmSync(vault, { recursive: true, force: true })
    }
  })

  it('persists only visible Markdown fields and reads manual edits back', () => {
    const encoded = encodeStudyQuestion(question())
    expect(encoded).not.toContain('<!--')
    const edited = encoded
      .replace('- Enunciado: Uma moeda é lançada. Qual a chance de cara?', '- Enunciado: Questão editada pela usuária?')
      .replace('- Resposta: 1/2', '- Resposta: 1/4')
    expect(decodeStudyBank(edited).questions[0]).toMatchObject({ question: 'Questão editada pela usuária?', answer: '1/4' })
  })

  it('uses approved local source snippets before WebSearch and derives origin from visible metadata', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'study-bank-'))
    try {
      const sources = join(vault, 'study sources')
      mkdirSync(sources)
      writeFileSync(
        join(sources, 'probabilidade.md'),
        [
          'Título: Simulado ENEM sintético',
          'Origem: enem',
          'Licença: domínio público',
          'Atribuição: material sintético',
          'URL: https://example.org/simulado',
          'Tópico: Probabilidade',
          'Questão: Qual a probabilidade de cara em uma moeda justa?',
          'Gabarito: 1/2',
        ].join('\n'),
      )
      let searched = 0
      const service = new StudyQuestionService(vault, {
        webSearch: async () => {
          searched++
          return []
        },
      })
      const result = await service.search('Probabilidade', 1)
      expect(result.sourceCandidates[0]).toMatchObject({ originKind: 'enem', sourceTitle: 'Simulado ENEM sintético' })
      expect(searched).toBe(0)
      expect(result.sourceCandidates[0]?.originKind).toBe('enem')
    } finally {
      rmSync(vault, { recursive: true, force: true })
    }
  })

  it('ranks source records globally so a later ENEM file outranks an earlier book file', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'study-bank-'))
    try {
      const sources = join(vault, 'study sources')
      mkdirSync(sources)
      const source = (title: string, origin: string, passage: string) =>
        [
          `Título: ${title}`,
          `Origem: ${origin}`,
          'Licença: CC BY 4.0',
          'Atribuição: fixture sintética',
          'URL: https://example.org/source',
          'Tópico: Probabilidade',
          `Questão: ${passage}`,
        ].join('\n')
      writeFileSync(join(sources, 'a-book.txt'), source('Livro sintético', 'livro', 'Questão sintética de Probabilidade no livro?'))
      writeFileSync(join(sources, 'z-enem.txt'), source('ENEM sintético', 'enem', 'Questão sintética ENEM de Probabilidade?'))
      const result = await new StudyQuestionService(vault, { webSearch: async () => [] }).search('Probabilidade', 1)
      expect(result.sourceCandidates).toHaveLength(1)
      expect(result.sourceCandidates[0]).toMatchObject({ originKind: 'enem', sourceTitle: 'ENEM sintético' })
    } finally {
      rmSync(vault, { recursive: true, force: true })
    }
  })

  it('scans a bounded listing past the file cap, excludes unrelated books, and ranks a later ENEM source first', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'study-bank-'))
    try {
      const sources = join(vault, 'study sources')
      mkdirSync(sources)
      for (let index = 0; index < 50; index++) {
        writeFileSync(
          join(sources, `book-${String(index).padStart(2, '0')}.txt`),
          [
            `Título: Livro alheio ${index}`,
            'Origem: livro',
            'Licença: direitos reservados',
            'Atribuição: fixture',
            'URL: https://example.org/unrelated',
            'Tópico: Álgebra linear',
            'Questão: Uma pergunta de álgebra?',
          ].join('\n'),
        )
      }
      writeFileSync(
        join(sources, 'zz-enem.txt'),
        [
          'Título: ENEM sintético tardio',
          'Origem: enem',
          'Licença: domínio público',
          'Atribuição: fixture',
          'URL: https://example.org/enem',
          'Tópico: Probabilidade',
          'Questão: Qual é a probabilidade de cara?',
        ].join('\n'),
      )
      const result = await new StudyQuestionService(vault, { webSearch: async () => [] }).search('Probabilidade', 1)
      expect(result.sourceCandidates).toHaveLength(1)
      expect(result.sourceCandidates[0]).toMatchObject({ originKind: 'enem', sourceTitle: 'ENEM sintético tardio' })
      expect(result.sourceCandidates.some((row) => row.sourceTitle.startsWith('Livro alheio'))).toBe(false)
    } finally {
      rmSync(vault, { recursive: true, force: true })
    }
  })

  it('does not emit metadata-only book candidates when a relevant file has no extractable question', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'study-bank-'))
    try {
      const sources = join(vault, 'study sources')
      mkdirSync(sources)
      writeFileSync(
        join(sources, 'book-no-question.txt'),
        [
          'Título: Livro sintético',
          'Origem: livro',
          'Licença: direitos reservados',
          'Atribuição: fixture',
          'URL: https://example.org/book',
          'Tópico: Probabilidade',
          'Apenas uma descrição geral da matéria.',
        ].join('\n'),
      )
      const result = await new StudyQuestionService(vault, { webSearch: async () => [] }).search('Probabilidade', 2)
      expect(result.sourceCandidates).toEqual([])
      expect(result.warning).toMatch(/sem enunciado extraível/i)
    } finally {
      rmSync(vault, { recursive: true, force: true })
    }
  })

  it('marks a header-scan cap as incomplete and refuses IA at the main-process token gate', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'study-bank-'))
    try {
      const sources = join(vault, 'study sources')
      mkdirSync(sources)
      const entry = [
        'Título: Fonte sintética',
        'Origem: livro',
        'Licença: CC BY 4.0',
        'Atribuição: fixture',
        'Tópico: Probabilidade',
        'Questão: Probabilidade sintética?',
      ].join('\n')
      for (let index = 0; index < 251; index++) writeFileSync(join(sources, `source-${String(index).padStart(3, '0')}.txt`), entry)
      let searched = 0
      let generated = 0
      const service = new StudyQuestionService(vault, {
        webSearch: async () => {
          searched++
          return []
        },
        generate: async () => {
          generated++
          return [question({ id: 'q-shouldnever', originKind: 'ia' })]
        },
      })
      const result = await service.search('Probabilidade', 1)
      expect(result.status).toBe('incomplete')
      expect(result.localScanComplete).toBe(false)
      expect(result.sourceCandidates).toEqual([])
      expect(result.warning).toMatch(/refine|selecione/i)
      expect(searched).toBe(0)
      expect(result.canGenerate).toBe(false)
      await expect(service.generate(result.token)).rejects.toThrow(/incompleta/i)
      expect(() => service.save(result.token, result.sourceCandidates, true)).toThrow(/incompleta/i)
      expect(generated).toBe(0)
    } finally {
      rmSync(vault, { recursive: true, force: true })
    }
  })

  it('marks a separate directory path-count cap incomplete before metadata inspection', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'study-bank-'))
    try {
      const bankQuestion = question({ id: 'q-bank0001', originKind: 'enem' })
      writeFileSync(join(vault, 'questoes-estudo.md'), `${encodeStudyQuestion(bankQuestion)}\n`)
      const sources = join(vault, 'study sources')
      mkdirSync(sources)
      const entry = [
        'Título: Fonte sintética',
        'Origem: livro',
        'Licença: CC BY 4.0',
        'Atribuição: fixture',
        'Tópico: Probabilidade',
        'Questão: Probabilidade sintética?',
      ].join('\n')
      for (let index = 0; index < 501; index++) writeFileSync(join(sources, `path-${String(index).padStart(3, '0')}.txt`), entry)
      let searched = 0
      let generated = 0
      const service = new StudyQuestionService(vault, {
        webSearch: async () => {
          searched++
          return []
        },
        generate: async () => {
          generated++
          return [question({ id: 'q-pathlimit', originKind: 'ia' })]
        },
      })
      const result = await service.search('Probabilidade', 2)
      expect(result.status).toBe('incomplete')
      expect(result.localScanComplete).toBe(false)
      expect(result.sourceCandidates).toEqual([])
      expect(result.warning).toMatch(/excede o limite seguro.*restrinja ou organize/i)
      expect(result.local).toEqual([bankQuestion])
      expect(result.canGenerate).toBe(false)
      expect(searched).toBe(0)
      await expect(service.generate(result.token)).rejects.toThrow(/incompleta/i)
      expect(() => service.save(result.token, result.sourceCandidates, true)).toThrow(/incompleta/i)
      expect(generated).toBe(0)
    } finally {
      rmSync(vault, { recursive: true, force: true })
    }
  })

  it('returns no partial source candidates when ENEM appears at different positions beyond the path cap', async () => {
    const createVault = (enemIndex: number) => {
      const vault = mkdtempSync(join(tmpdir(), 'study-bank-'))
      const sources = join(vault, 'study sources')
      mkdirSync(sources)
      for (let index = 0; index < 501; index++) {
        const isEnem = index === enemIndex
        const row = [
          `Título: ${isEnem ? 'ENEM sintético' : `Livro ${index}`}`,
          `Origem: ${isEnem ? 'enem' : 'livro'}`,
          'Licença: CC BY 4.0',
          'Atribuição: fixture',
          'Tópico: Probabilidade',
          'Questão: Probabilidade sintética?',
        ].join('\n')
        writeFileSync(join(sources, `source-${String(index).padStart(3, '0')}.txt`), row)
      }
      return vault
    }
    const enemFirst = createVault(0)
    const enemLast = createVault(500)
    try {
      const run = async (vault: string) => {
        let webCalls = 0
        let generationCalls = 0
        const service = new StudyQuestionService(vault, {
          webSearch: async () => {
            webCalls++
            return []
          },
          generate: async () => {
            generationCalls++
            return [question({ id: 'q-not-run', originKind: 'ia' })]
          },
        })
        const result = await service.search('Probabilidade', 1)
        expect(result.localScanComplete).toBe(false)
        expect(result.sourceCandidates).toEqual([])
        expect(result.warning).toMatch(/excede o limite seguro/i)
        expect(result.canGenerate).toBe(false)
        expect(webCalls).toBe(0)
        await expect(service.generate(result.token)).rejects.toThrow(/incompleta/i)
        expect(generationCalls).toBe(0)
        return result.status
      }
      expect(await run(enemFirst)).toBe(await run(enemLast))
    } finally {
      rmSync(enemFirst, { recursive: true, force: true })
      rmSync(enemLast, { recursive: true, force: true })
    }
  })

  it('marks the content-file cap incomplete and cannot generate after an insufficient web search', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'study-bank-'))
    try {
      const sources = join(vault, 'study sources')
      mkdirSync(sources)
      const source = (title: string) =>
        [
          `Título: ${title}`,
          'Origem: concurso',
          'Licença: CC BY 4.0',
          'Atribuição: fixture',
          'Tópico: Probabilidade',
          'Questão: Probabilidade sintética?',
        ].join('\n')
      for (let index = 0; index < 51; index++)
        writeFileSync(join(sources, `source-${String(index).padStart(2, '0')}.txt`), source(`Concurso ${index}`))
      let searched = 0
      let generated = 0
      const service = new StudyQuestionService(vault, {
        webSearch: async () => {
          searched++
          return []
        },
        generate: async () => {
          generated++
          return [question({ id: 'q-never2', originKind: 'ia' })]
        },
      })
      const result = await service.search('Probabilidade', 50)
      expect(result.status).toBe('incomplete')
      expect(result.localScanComplete).toBe(false)
      expect(result.sourceCandidates).toEqual([])
      expect(result.warning).toMatch(/limite|incompleta/i)
      expect(searched).toBe(0)
      expect(result.canGenerate).toBe(false)
      await expect(service.generate(result.token)).rejects.toThrow(/incompleta/i)
      expect(() => service.save(result.token, result.sourceCandidates, true)).toThrow(/incompleta/i)
      expect(searched).toBe(0)
      expect(generated).toBe(0)
    } finally {
      rmSync(vault, { recursive: true, force: true })
    }
  })

  it('treats exactly 20 relevant records as complete but flags a 21st record as overflow', async () => {
    const createVault = (count: number) => {
      const vault = mkdtempSync(join(tmpdir(), 'study-bank-'))
      const sources = join(vault, 'study sources')
      mkdirSync(sources)
      const lines = ['Título: Fonte sintética', 'Origem: concurso', 'Licença: CC BY 4.0', 'Atribuição: fixture', 'Tópico: Matemática']
      for (let index = 0; index < count; index++) lines.push(`Questão: Probabilidade fixture ${index}?`)
      writeFileSync(join(sources, 'questions.txt'), lines.join('\n'))
      return vault
    }
    const exactVault = createVault(20)
    const overflowVault = createVault(21)
    try {
      let exactWebCalls = 0
      const exact = await new StudyQuestionService(exactVault, {
        webSearch: async () => {
          exactWebCalls++
          return []
        },
        generate: async () => [question({ id: 'q-exact-ai01', originKind: 'ia' })],
      }).search('Probabilidade', 21)
      expect(exact.localScanComplete).toBe(true)
      expect(exact.sourceCandidates).toHaveLength(20)
      expect(exactWebCalls).toBe(1)

      let overflowWebCalls = 0
      let generated = 0
      const overflowService = new StudyQuestionService(overflowVault, {
        webSearch: async () => {
          overflowWebCalls++
          return []
        },
        generate: async () => {
          generated++
          return [question({ id: 'q-overflow-ai1', originKind: 'ia' })]
        },
      })
      const overflow = await overflowService.search('Probabilidade', 21)
      expect(overflow.localScanComplete).toBe(false)
      expect(overflow.sourceCandidates).toEqual([])
      expect(overflow.warning).toMatch(/Mais de 20 questões correspondem/i)
      expect(overflowWebCalls).toBe(0)
      await expect(overflowService.generate(overflow.token)).rejects.toThrow(/incompleta/i)
      expect(generated).toBe(0)
    } finally {
      rmSync(exactVault, { recursive: true, force: true })
      rmSync(overflowVault, { recursive: true, force: true })
    }
  })

  it('orders same-priority candidates deterministically across case and creation-order variants', async () => {
    const createVault = (fileOrder: string[]) => {
      const vault = mkdtempSync(join(tmpdir(), 'study-bank-'))
      const sources = join(vault, 'study sources')
      mkdirSync(sources)
      const source = (title: string) =>
        [
          `Título: ${title}`,
          'Origem: concurso',
          'Licença: CC BY 4.0',
          'Atribuição: fixture',
          'Tópico: Probabilidade',
          'Questão: Probabilidade sintética?',
        ].join('\n')
      for (const filename of fileOrder) writeFileSync(join(sources, filename), source(filename))
      return vault
    }
    const firstVault = createVault(['b.txt', 'A.txt'])
    const secondVault = createVault(['A.txt', 'b.txt'])
    try {
      const first = await new StudyQuestionService(firstVault, { webSearch: async () => [] }).search('Probabilidade', 1)
      const second = await new StudyQuestionService(secondVault, { webSearch: async () => [] }).search('Probabilidade', 1)
      expect(first.sourceCandidates[0]?.sourceTitle).toBe(second.sourceCandidates[0]?.sourceTitle)
    } finally {
      rmSync(firstVault, { recursive: true, force: true })
      rmSync(secondVault, { recursive: true, force: true })
    }
  })

  it('does not use file topic to match an unrelated book question and continues to WebSearch', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'study-bank-'))
    try {
      const sources = join(vault, 'study sources')
      mkdirSync(sources)
      writeFileSync(
        join(sources, 'calculo.txt'),
        [
          'Título: Livro de cálculo sintético',
          'Origem: livro',
          'Licença: CC BY 4.0',
          'Atribuição: fixture',
          'URL: https://example.org/calculo',
          'Tópico: Probabilidade',
          'Questão: Calcule a derivada da função x ao quadrado.',
        ].join('\n'),
      )
      let searched = 0
      const remote = question({
        id: 'q-webprob01',
        originKind: 'web',
        question: 'Uma questão sintética de Probabilidade?',
        answerStatus: 'unverified',
      })
      const result = await new StudyQuestionService(vault, {
        webSearch: async () => {
          searched++
          return [remote]
        },
      }).search('Probabilidade', 1)
      expect(result.sourceCandidates).toEqual([])
      expect(searched).toBe(1)
      expect(result.web[0]?.question).toContain('Probabilidade')
    } finally {
      rmSync(vault, { recursive: true, force: true })
    }
  })

  it('matches a question when item-level topic tags identify it, despite an unrelated stem', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'study-bank-'))
    try {
      const sources = join(vault, 'study sources')
      mkdirSync(sources)
      writeFileSync(
        join(sources, 'questao-tag.txt'),
        [
          'Título: Lista sintética',
          'Origem: concurso',
          'Licença: CC BY 4.0',
          'Atribuição: fixture',
          'URL: https://example.org/lista',
          'Tópico: Matemática',
          'Questão: Calcule a derivada da função x ao quadrado.',
          'Tags da questão: Probabilidade, estatística',
        ].join('\n'),
      )
      let searched = 0
      const result = await new StudyQuestionService(vault, {
        webSearch: async () => {
          searched++
          return []
        },
      }).search('Probabilidade', 1)
      expect(result.sourceCandidates[0]).toMatchObject({ originKind: 'concurso', question: 'Calcule a derivada da função x ao quadrado.' })
      expect(searched).toBe(0)
    } finally {
      rmSync(vault, { recursive: true, force: true })
    }
  })

  it('never treats a source license string as approval and provides metadata-only records', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'study-bank-'))
    try {
      const sources = join(vault, 'study sources')
      mkdirSync(sources)
      writeFileSync(
        join(sources, 'book.txt'),
        [
          'Título: Livro sintético',
          'Origem: livro',
          'Licença: CC-BY (alegada)',
          'Atribuição: fixture',
          'URL: https://example.org/book',
          'Tópico: Probabilidade',
          'Questão: Trecho sintético selecionável?',
          'Tags da questão: Probabilidade',
        ].join('\n'),
      )
      const result = await new StudyQuestionService(vault, { webSearch: async () => [] }).search('Probabilidade', 2)
      expect(result.sourceCandidates.some((row) => row.sourceOnly && !row.question && !row.verifiedByUser)).toBe(true)
      expect(result.sourceCandidates).toHaveLength(1)
      expect(result.sourceCandidates[0]).toMatchObject({ sourceOnly: true, license: 'CC-BY (alegada)' })
      expect(result.sourceCandidates[0]).not.toHaveProperty('verifiedByUser')
    } finally {
      rmSync(vault, { recursive: true, force: true })
    }
  })

  it('adds provenance verification fields only when the user explicitly confirms review', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'study-bank-'))
    try {
      const service = new StudyQuestionService(vault, {
        webSearch: async () => [question({ originKind: 'web', answerStatus: 'verified' })],
      })
      const first = await service.search('Probabilidade', 1)
      expect(() => service.save(first.token, first.web, false)).toThrow(/confirme.*procedência/i)
      const second = await service.search('Probabilidade', 1)
      service.save(second.token, second.web, true)
      expect(service.read().questions[0]).toMatchObject({
        verifiedByUser: true,
        verifiedAt: expect.any(String),
        answerStatus: 'unverified',
      })
    } finally {
      rmSync(vault, { recursive: true, force: true })
    }
  })

  it('does not auto-generate after empty completed search; generation requires explicit action', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'study-bank-'))
    try {
      let generated = 0
      const service = new StudyQuestionService(vault, {
        webSearch: async () => [],
        generate: async () => {
          generated++
          return [question({ id: 'q-generated3', originKind: 'ia', answerStatus: 'unverified' })]
        },
      })
      const result = await service.search('Probabilidade', 2)
      expect(result).toMatchObject({ status: 'noResults', canGenerate: true, generated: [] })
      expect(generated).toBe(0)
      const response = await service.generate(result.token)
      expect(generated).toBe(1)
      expect(response.generated[0]).toMatchObject({ originKind: 'ia', answerStatus: 'unverified' })
    } finally {
      rmSync(vault, { recursive: true, force: true })
    }
  })

  it('detects external edits after staging and preserves the edited file and exact old-version backup', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'study-bank-'))
    try {
      const file = join(vault, 'questoes-estudo.md')
      const original = '# Bank\nmanual text\n'
      writeFileSync(file, original)
      const service = new StudyQuestionService(
        vault,
        { webSearch: async () => [question({ originKind: 'web', answerStatus: 'unverified' })] },
        {
          atomicWrite: (path, contents, beforeRename) => {
            writeFileSync(file, '# Editado no Obsidian\n')
            beforeRename()
            writeFileSync(path, contents)
          },
        },
      )
      const result = await service.search('Probabilidade', 1)
      expect(() => service.save(result.token, result.web, true)).toThrow(/mudou/i)
      expect(readFileSync(file, 'utf8')).toBe('# Editado no Obsidian\n')
      expect(existsSync(`${file}.lock`)).toBe(false)
      const backups = join(vault, '.agent-office-backups')
      const backupName = readdirSync(backups)[0]!
      expect(readFileSync(join(backups, backupName), 'utf8')).toBe(original)
    } finally {
      rmSync(vault, { recursive: true, force: true })
    }
  })

  it('refuses oversized banks before reading and rejects excess line counts', () => {
    const vault = mkdtempSync(join(tmpdir(), 'study-bank-'))
    try {
      const path = join(vault, 'questoes-estudo.md')
      const fd = openSync(path, 'w')
      ftruncateSync(fd, 3 * 1024 * 1024)
      closeSync(fd)
      expect(() => new StudyQuestionService(vault).read()).toThrow(/grande|limite/i)
      expect(statSync(path).size).toBe(3 * 1024 * 1024)
      expect(() => decodeStudyBank(Array.from({ length: 25_002 }, () => 'x').join('\n'))).toThrow(/linhas/i)
    } finally {
      rmSync(vault, { recursive: true, force: true })
    }
  })

  it('reports unsupported source formats and does not generate when WebSearch is unavailable', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'study-bank-'))
    try {
      mkdirSync(join(vault, 'study sources'))
      writeFileSync(join(vault, 'study sources', 'scan.pdf'), 'synthetic pdf placeholder')
      let generated = 0
      const result = await new StudyQuestionService(vault, {
        generate: async () => {
          generated++
          return []
        },
      }).search('Probabilidade', 1)
      expect(result.status).toBe('incomplete')
      expect(result.localScanComplete).toBe(false)
      expect(result.warning).toMatch(/não suportada/i)
      expect(result.canGenerate).toBe(false)
      expect(generated).toBe(0)
    } finally {
      rmSync(vault, { recursive: true, force: true })
    }
  })

  it('downgrades WebSearch claims and preserves only a reviewable public URL', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'study-bank-'))
    try {
      const claimed = question({
        answerStatus: 'verified',
        originKind: 'enem',
        license: 'CC BY 4.0',
        sourceVisibility: 'public',
        verifiedByUser: true,
        verifiedAt: '2025-01-01T00:00:00.000Z',
      })
      const result = await new StudyQuestionService(vault, { webSearch: async () => [claimed] }).search('Probabilidade', 1)
      expect(result.web[0]).toMatchObject({
        originKind: 'web',
        answerStatus: 'unverified',
        sourceVisibility: 'unknown',
        license: 'Não verificada — confirmar na fonte',
      })
      expect(result.web[0]).not.toHaveProperty('verifiedByUser')
      expect(result.web[1]).toMatchObject({ sourceOnly: true, question: '', answerStatus: 'missing' })
    } finally {
      rmSync(vault, { recursive: true, force: true })
    }
  })

  it('keeps uncertain-license book sources link-only and does not expose the passage as a question', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'study-bank-'))
    try {
      const sources = join(vault, 'study sources')
      mkdirSync(sources)
      writeFileSync(
        join(sources, 'livro.txt'),
        [
          'Título: Livro sintético protegido',
          'Origem: livro',
          'Licença: direitos reservados',
          'Atribuição: Autoria sintética',
          'URL: https://example.org/livro',
          'Tópico: Probabilidade',
          'Questão: Trecho integral que não deve virar candidata.',
          'Tags da questão: Probabilidade',
          'Gabarito: 1/2',
        ].join('\n'),
      )
      const service = new StudyQuestionService(vault, { webSearch: async () => [] })
      const result = await service.search('Probabilidade', 2)
      expect(result.sourceCandidates).toHaveLength(1)
      expect(result.sourceCandidates[0]).toMatchObject({ sourceOnly: true, question: '' })
      expect(result.warning).toContain('https://example.org/livro')
      expect(JSON.stringify(result)).not.toContain('Trecho integral que não deve virar candidata')
      service.save(result.token, result.sourceCandidates, true)
      expect(service.read().questions[0]).toMatchObject({ sourceOnly: true, question: '', verifiedByUser: true })
      expect(JSON.stringify(service.read())).not.toContain('Trecho integral que não deve virar candidata')
    } finally {
      rmSync(vault, { recursive: true, force: true })
    }
  })

  it('refuses to save while the internal exclusive lock is held', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'study-bank-'))
    try {
      const bank = join(vault, 'questoes-estudo.md')
      const service = new StudyQuestionService(vault, {
        webSearch: async () => [question({ originKind: 'web', answerStatus: 'unverified' })],
      })
      const result = await service.search('Probabilidade', 1)
      writeFileSync(`${bank}.lock`, 'another office save')
      expect(() => service.save(result.token, result.web, true)).toThrow(/outra operação/i)
      expect(existsSync(bank)).toBe(false)
    } finally {
      rmSync(vault, { recursive: true, force: true })
    }
  })
})
