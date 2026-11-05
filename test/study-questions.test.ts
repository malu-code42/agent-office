import { describe, expect, it } from 'vitest'
import {
  choiceOf,
  decodeStudyBank,
  encodeStudyQuestion,
  freshChoiceCount,
  gradeChoice,
  isChoiceQuestion,
  rankStudyQuestions,
  refersToMissingText,
  STUDY_BANK_LINE_LIMIT,
  studyQuestionText,
  validateStudyQuestion,
  type StudyQuestion,
} from '../src/shared/study-questions'
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
import { STUDY_BANK_BYTE_LIMIT, StudyQuestionService } from '../src/main/study-questions'
import { tinyPdf } from './helpers/tiny-pdf'
import { studyMathParts } from '../src/renderer/src/ui/study-math'

describe('study question formulas', () => {
  it('keeps ordinary text and renders inline and block formulas', () => {
    expect(studyMathParts('Questão antiga')).toEqual([{ text: 'Questão antiga' }])
    const parts = studyMathParts('Se $x^2$ então $$\\frac{1}{2}$$.')
    expect(parts[0]).toEqual({ text: 'Se ' })
    expect(parts[1]).toMatchObject({ display: false, html: expect.stringContaining('katex') })
    expect(parts[3]).toMatchObject({ display: true, html: expect.stringContaining('katex-display') })
  })

  it('preserves invalid formulas and unmatched delimiters', () => {
    expect(studyMathParts('Antes $\\notacommand{x}$ e $aberta')).toEqual([
      { text: 'Antes ' },
      { text: '$\\notacommand{x}$' },
      { text: ' e $aberta' },
    ])
  })

  it('preserves currency while rendering nearby numeric and block formulas', () => {
    const currency = 'De $5 and $10, ou R$ 5 e R$ 10.'
    expect(studyMathParts(currency)).toEqual([{ text: currency }])
    const parts = studyMathParts('Custos $5 e $10; calcule $5 + 2$ e $$x^2$$.')
    expect(parts[0]).toEqual({ text: 'Custos $5 e $10; calcule ' })
    expect(parts[1]).toMatchObject({ display: false, html: expect.stringContaining('katex') })
    expect(parts[3]).toMatchObject({ display: true, html: expect.stringContaining('katex-display') })
    expect(studyMathParts('$5$')[0]).toMatchObject({ display: false })
    expect(studyMathParts('$1,25$')[0]).toMatchObject({ display: false })
    expect(studyMathParts('Preço $5. Depois $x$.')[0]).toEqual({ text: 'Preço $5. Depois ' })
  })

  it('keeps escaped dollar signs literal without consuming subsequent formulas', () => {
    const parts = studyMathParts('Preço \\$5 e \\$10; valor $x$ e $$y$$.')
    expect(parts[0]).toEqual({ text: 'Preço \\$5 e \\$10; valor ' })
    expect(parts[1]).toMatchObject({ display: false })
    expect(parts[3]).toMatchObject({ display: true })
  })

  it('renders an inline formula followed immediately by a digit', () => {
    const parts = studyMathParts('$x$2 e $$y$$3')
    expect(parts[0]).toMatchObject({ display: false, html: expect.stringContaining('katex') })
    expect(parts[1]).toEqual({ text: '2 e ' })
    expect(parts[2]).toMatchObject({ display: true, html: expect.stringContaining('katex-display') })
    expect(parts[3]).toEqual({ text: '3' })
  })

  it('never treats HTML as markup and refuses unsafe latex commands', () => {
    const parts = studyMathParts('<script>alert(1)</script> $\\href{javascript:alert(1)}{clique}$ <img src=x onerror=alert(1)>')
    expect(parts[0]).toEqual({ text: '<script>alert(1)</script> ' })
    expect(parts[2]).toEqual({ text: ' <img src=x onerror=alert(1)>' })
    const formula = parts[1]!
    expect('html' in formula && formula.html).not.toMatch(/<a\b|href=|<script|<img\b/i)
  })
})

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

  it('round-trips the subtopic and reads a record written before it existed', () => {
    expect(decodeStudyBank(encodeStudyQuestion(question({ subtopic: 'Lei de Coulomb' }))).questions[0]!.subtopic).toBe('Lei de Coulomb')
    const old = encodeStudyQuestion(question()).replace(/^- Subtema: .*\n/m, '')
    expect(old).not.toContain('Subtema')
    expect(decodeStudyBank(old).questions[0]).toEqual(question())
    expect(decodeStudyBank(encodeStudyQuestion(question())).questions[0]!.subtopic).toBeUndefined()
  })

  it('round-trips a multiple choice question with its passage and checks the key letter', () => {
    const choice = question({
      passage: 'A Ciência da Computação estuda algoritmos.',
      question: 'Segundo o texto, o que a Ciência da Computação estuda?',
      options: ['Algoritmos', 'Planilhas', 'Redes elétricas'],
      answer: 'A',
    })
    expect(decodeStudyBank(encodeStudyQuestion(choice)).questions).toEqual([choice])
    expect(studyQuestionText(choice)).toBe(
      'Trecho:\nA Ciência da Computação estuda algoritmos.\n\nSegundo o texto, o que a Ciência da Computação estuda?\n\nA) Algoritmos\nB) Planilhas\nC) Redes elétricas',
    )
    expect(() => validateStudyQuestion({ ...choice, answer: 'D' })).toThrow(/letra/i)
    expect(() => validateStudyQuestion({ ...choice, options: ['só uma'] })).toThrow(/alternativas/i)
  })

  it('keeps the line breaks and backslashes of a multi-line passage through the bank file', () => {
    const multi = question({ passage: 'Dados:\nx = 3\ncaminho C:\\temp\\n', question: 'Quanto vale x?' })
    const line = encodeStudyQuestion(multi)
    expect(line.split('\n').filter((row) => row.startsWith('- Trecho:'))).toHaveLength(1)
    expect(decodeStudyBank(line).questions).toEqual([multi])
  })

  it('grades a multiple-choice answer by its letter, with no model', () => {
    const choice = question({ options: ['1/4', '1/2', '1/3', '1', '0'], answer: 'B' })
    expect(choiceOf(' b) ')).toBe('B')
    expect(choiceOf('Errado')).toBeNull()
    expect(gradeChoice(choice, 'B')?.kind).toBe('correct')
    expect(gradeChoice(choice, 'C')).toMatchObject({ kind: 'incorrect', rationale: expect.stringContaining('B) 1/2') })
    expect(gradeChoice(question(), 'B')).toBeNull()
    expect(isChoiceQuestion(choice)).toBe(true)
    expect(isChoiceQuestion(question())).toBe(false)
  })

  it('counts only new multiple-choice questions of the subtopic', () => {
    const choice = { ...question(), subtopic: 'A', options: ['x', 'y'], answer: 'B' }
    const open = { ...question(), subtopic: 'A' }
    const other = { ...choice, subtopic: 'B' }
    expect(freshChoiceCount([choice, open, other], 'A', () => false)).toBe(1)
    expect(freshChoiceCount([choice, open, other], 'A', () => true)).toBe(0)
  })

  it('flags a statement that cites a text nobody shows', () => {
    expect(refersToMissingText({ question: 'Segundo o texto, o que é um bit?' })).toBe(true)
    expect(refersToMissingText({ question: 'O que é um bit?', options: ['Conforme o trecho acima', 'Um dígito'] })).toBe(true)
    expect(refersToMissingText({ question: 'Segundo o autor, o que é um bit?' })).toBe(true)
    expect(refersToMissingText({ question: 'Qual a tensão da fonte de alimentação?' })).toBe(false)
    expect(refersToMissingText({ question: 'O que é um bit?', options: ['Um dígito', 'Um byte'] })).toBe(false)
    expect(refersToMissingText({ passage: 'Um bit é um dígito.', question: 'Segundo o texto, o que é um bit?' })).toBe(false)
  })

  it('removes the unusable questions from the bank file after a backup, keeping the rest', () => {
    const vault = mkdtempSync(join(tmpdir(), 'study-bank-'))
    try {
      const choice = question({ id: 'q-choice01', options: ['1/4', '1/2', '1/3', '1', '0'], answer: 'B' })
      const orphan = question({ id: 'q-orphan01', question: 'Segundo o texto, qual a chance?', options: ['1/4', '1/2'], answer: 'B' })
      const text = `# Banco\n\nNota manual\n\n${encodeStudyQuestion(question())}\n${encodeStudyQuestion(choice)}\n${encodeStudyQuestion(orphan)}\n`
      writeFileSync(join(vault, 'questoes-estudo.md'), text)
      const service = new StudyQuestionService(vault, { webSearch: async () => [] })
      expect(service.removeUnusableQuestions()).toBe(2)
      const after = decodeStudyBank(readFileSync(join(vault, 'questoes-estudo.md'), 'utf8'))
      expect(after.questions.map((q) => q.id)).toEqual(['q-choice01'])
      expect(after.unknownLines).toEqual(['Nota manual'])
      expect(readdirSync(join(vault, '.agent-office-backups'))).toHaveLength(1)
      expect(service.removeUnusableQuestions()).toBe(0)
    } finally {
      rmSync(vault, { recursive: true, force: true })
    }
  })

  it('removes only the chosen questions after a backup', () => {
    const vault = mkdtempSync(join(tmpdir(), 'study-bank-'))
    try {
      const mk = (id: string) => question({ id, question: `Pergunta ${id}`, options: ['1/4', '1/2', '1/3', '1', '0'], answer: 'B' })
      writeFileSync(
        join(vault, 'questoes-estudo.md'),
        ['q-aaaaaaaa', 'q-bbbbbbbb', 'q-cccccccc'].map((id) => encodeStudyQuestion(mk(id))).join('\n'),
      )
      const service = new StudyQuestionService(vault, { webSearch: async () => [] })
      expect(service.removeQuestions(['q-aaaaaaaa', 'q-cccccccc', 'q-naoexiste'])).toBe(2)
      expect(decodeStudyBank(readFileSync(join(vault, 'questoes-estudo.md'), 'utf8')).questions.map((q) => q.id)).toEqual(['q-bbbbbbbb'])
      expect(readdirSync(join(vault, '.agent-office-backups'))).toHaveLength(1)
    } finally {
      rmSync(vault, { recursive: true, force: true })
    }
  })

  it('drops questions whose source left "study sources" and refuses new ones from outside it', () => {
    const vault = mkdtempSync(join(tmpdir(), 'study-bank-'))
    try {
      mkdirSync(join(vault, 'study sources', 'textbooks'), { recursive: true })
      writeFileSync(join(vault, 'study sources', 'textbooks', 'ok.md'), 'texto')
      const mk = (id: string, sourceReference?: string) =>
        question({ id, options: ['1/4', '1/2', '1/3', '1', '0'], answer: 'B', ...(sourceReference ? { sourceReference } : {}) })
      const kept = mk('q-keep0001', 'study sources/textbooks/ok.md#Página 2')
      const gone = mk('q-gone0001', 'study sources/course materials/x.pptx#Slide 3')
      const web = mk('q-web00001')
      writeFileSync(join(vault, 'questoes-estudo.md'), [kept, gone, web].map(encodeStudyQuestion).join('\n'))
      const service = new StudyQuestionService(vault, { webSearch: async () => [] })
      expect(service.removeOrphanQuestions()).toBe(1)
      expect(service.read().questions.map((q) => q.id)).toEqual(['q-keep0001', 'q-web00001'])
      expect(() => service.appendChecked([mk('q-out00001', 'course materials/x.pptx#Slide 3')])).toThrow(/fora da pasta/)
    } finally {
      rmSync(vault, { recursive: true, force: true })
    }
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

  it('reads the passage and lettered alternatives of a local source question', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'study-bank-'))
    try {
      const sources = join(vault, 'study sources')
      mkdirSync(sources)
      writeFileSync(
        join(sources, 'computacao.md'),
        [
          'Título: Simulado ENEM sintético',
          'Origem: enem',
          'Licença: domínio público',
          'Atribuição: material sintético',
          'Tópico: Computação',
          'Questão: Segundo o texto, qual estudo é a pedra angular da Ciência da Computação?',
          'Trecho: Os algoritmos são a pedra angular da Ciência da Computação.',
          'Eles aparecem em todo o livro.',
          'A) Algoritmos',
          'B) Planilhas',
          'Gabarito: A) Algoritmos',
        ].join('\n'),
      )
      const service = new StudyQuestionService(vault, { webSearch: async () => [] })
      const result = await service.search('Computação', 1)
      expect(result.sourceCandidates[0]).toMatchObject({
        passage: 'Os algoritmos são a pedra angular da Ciência da Computação.\nEles aparecem em todo o livro.',
        options: ['Algoritmos', 'Planilhas'],
        answer: 'A',
      })
    } finally {
      rmSync(vault, { recursive: true, force: true })
    }
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
      ftruncateSync(fd, STUDY_BANK_BYTE_LIMIT + 1024 * 1024)
      closeSync(fd)
      expect(() => new StudyQuestionService(vault).read()).toThrow(/grande|limite/i)
      expect(statSync(path).size).toBe(STUDY_BANK_BYTE_LIMIT + 1024 * 1024)
      expect(() => decodeStudyBank(Array.from({ length: STUDY_BANK_LINE_LIMIT + 2 }, () => 'x').join('\n'))).toThrow(/linhas/i)
    } finally {
      rmSync(vault, { recursive: true, force: true })
    }
  })

  it('reads the question lines of a local PDF source like a text source', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'study-bank-'))
    try {
      mkdirSync(join(vault, 'study sources'))
      writeFileSync(
        join(vault, 'study sources', 'simulado.pdf'),
        tinyPdf([
          [
            'Título: Simulado ENEM sintético em PDF',
            'Origem: enem',
            'Licença: domínio público',
            'Atribuição: material sintético',
            'Tópico: Probabilidade',
            'Questão: Qual a probabilidade de sair cara numa moeda justa?',
            'Gabarito: 1/2',
          ].join('\n'),
        ]),
      )
      const result = await new StudyQuestionService(vault, { webSearch: async () => [] }, { pdfCacheDir: join(vault, '.cache') }).search(
        'Probabilidade',
        1,
      )
      expect(result.localScanComplete).toBe(true)
      expect(result.sourceCandidates[0]).toMatchObject({
        originKind: 'enem',
        sourceTitle: 'Simulado ENEM sintético em PDF',
        question: 'Qual a probabilidade de sair cara numa moeda justa?',
        sourceReference: 'simulado.pdf',
      })
    } finally {
      rmSync(vault, { recursive: true, force: true })
    }
  })

  it('reports a PDF it cannot read as an incomplete local scan', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'study-bank-'))
    try {
      mkdirSync(join(vault, 'study sources'))
      writeFileSync(join(vault, 'study sources', 'scan.pdf'), 'synthetic pdf placeholder')
      const result = await new StudyQuestionService(vault, {}).search('Probabilidade', 1)
      expect(result.localScanComplete).toBe(false)
      expect(result.warning).toMatch(/PDF sem texto legível ignorado: scan\.pdf/)
    } finally {
      rmSync(vault, { recursive: true, force: true })
    }
  })

  it('reports unsupported source formats and does not generate when WebSearch is unavailable', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'study-bank-'))
    try {
      mkdirSync(join(vault, 'study sources'))
      writeFileSync(join(vault, 'study sources', 'scan.docx'), 'synthetic docx placeholder')
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
