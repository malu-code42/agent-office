import { describe, expect, it } from 'vitest'
import {
  questionsForTopic,
  rankStudySources,
  studyQueryOfQuestion,
  studySourceLevel,
  studySourceRange,
  type StudySourceDoc,
} from '../src/shared/study-sources'
import { studyGaps, type StudyCycle, type StudyCycleQuestion } from '../src/shared/study-cycle'
import type { StudyQuestion } from '../src/shared/study-questions'

const pdf = (path: string, pages: string[]): StudySourceDoc => ({
  path,
  title: path.split('/').at(-1)!,
  kind: 'pdf',
  units: pages.map((text, i) => ({ n: i + 1, text })),
})

const book = pdf('study sources/ED/livro.pdf', [
  'Sumário',
  'Pilhas e recursão',
  'Fila: estrutura FIFO com vetor.',
  'Nada aqui.',
  'Fila circular; fila de prioridade.',
  'Exercícios de fila.',
  'Árvores binárias',
  'Grafos',
])

describe('Cora: ranking local de fontes', () => {
  it('joins the dense pages around the best one into a start–end range, bridging one empty page', () => {
    const [r] = rankStudySources([book], 'fila')
    expect(r).toMatchObject({ start: 3, end: 6, range: 'p. 3–6', kind: 'pdf' })
    expect(r!.snippet).toMatch(/fila/i)
  })

  it('ranks best to worst and scales the score in five levels', () => {
    const slides: StudySourceDoc = {
      path: 'study sources/aula.pptx',
      title: 'aula.pptx',
      kind: 'pptx',
      units: [
        { n: 1, text: 'Introdução' },
        { n: 2, text: 'Estrutura de dados: fila' },
      ],
    }
    const notes: StudySourceDoc = {
      path: 'study sources/notas.md',
      title: 'notas.md',
      kind: 'md',
      units: [
        { n: 1, heading: 'Pilhas', text: 'LIFO' },
        { n: 2, heading: 'Fila', text: 'chegada' },
        { n: 3, heading: 'Fila circular', text: 'fila que dá a volta' },
      ],
    }
    const out = rankStudySources([notes, book, slides], 'fila, estrutura de dados')
    expect(out[0]).toMatchObject({ title: 'aula.pptx', range: 'slide 2', level: 5, label: 'Muito relevante' })
    expect(out.map((r) => r.title)).toEqual(['aula.pptx', 'livro.pdf', 'notas.md'])
    expect(out.at(-1)).toMatchObject({ range: 'seções 2–3', startHeading: 'Fila', endHeading: 'Fila circular' })
    for (let i = 1; i < out.length; i++) expect(out[i - 1]!.score).toBeGreaterThanOrEqual(out[i]!.score)
    expect([95, 80, 79, 60, 59, 40, 39, 20, 19, 0].map(studySourceLevel)).toEqual([5, 5, 4, 4, 3, 3, 2, 2, 1, 1])
  })

  it('names the range in the unit of each format', () => {
    expect(studySourceRange('pdf', 12, 18)).toBe('p. 12–18')
    expect(studySourceRange('pdf', 4, 4)).toBe('p. 4')
    expect(studySourceRange('pptx', 3, 5)).toBe('slides 3–5')
    expect(studySourceRange('md', 2, 2)).toBe('seção 2')
    expect(studySourceRange('txt', 1, 40)).toBe('linhas 1–40')
  })

  it('leaves out what does not talk about the request and returns nothing for an empty one', () => {
    expect(rankStudySources([book], 'probabilidade')).toEqual([])
    expect(rankStudySources([book], 'de, a')).toEqual([])
  })

  it('in a long book, a term on every page (dados) does not stretch the range: the specific one (fila) leads', () => {
    const pages = Array.from({ length: 40 }, (_, i) => (i >= 20 && i < 24 ? 'fila de dados; fila' : 'estrutura de dados'))
    const [r] = rankStudySources([pdf('study sources/livro grande.pdf', pages)], 'fila, estrutura de dados')
    expect(r).toMatchObject({ start: 21, end: 24 })
  })

  it('caps a range at 30 units', () => {
    const long = pdf(
      'study sources/longo.pdf',
      Array.from({ length: 80 }, () => 'fila fila'),
    )
    const [r] = rankStudySources([long], 'fila')
    expect(r!.end - r!.start + 1).toBeLessThanOrEqual(30)
  })
})

const bankQuestion = (id: string, topic: string, tags: string[], question: string): StudyQuestion => ({
  id,
  topic,
  tags,
  question,
  answerStatus: 'verified',
  answer: 'x',
  originKind: 'enem',
  sourceTitle: 'Banco',
  sourceVisibility: 'local',
  attribution: 'a',
  license: 'l',
})

describe('fim do ciclo: cada questão errada vira um pedido à Cora', () => {
  it('builds the request from the topic (without the trail id), the tags and telling words of the question', () => {
    const q = studyQueryOfQuestion({
      topic: '[P2-ED-05] Filas',
      tags: ['estrutura de dados'],
      question: 'Explique qual é a diferença entre enfileirar e desenfileirar numa fila circular.',
    })
    expect(q.startsWith('Filas, estrutura de dados, ')).toBe(true)
    expect(q).toContain('desenfileirar')
    expect(q).not.toMatch(/explique|P2-ED/i)
    expect(q.length).toBeLessThanOrEqual(200)
  })

  it('maps each wrong or doubtful question to its ranked sources', () => {
    const asked = (id: string, topic: string, kind: 'correct' | 'incorrect', uncertain = false): StudyCycleQuestion => ({
      id,
      sourceHash: 'h',
      source: bankQuestion(id, topic, [], `Pergunta sobre ${topic}?`),
      response: 'r',
      providedExcerpt: '',
      uncertain,
      assessment: { kind, rationale: '', checkedAt: 1 },
    })
    const cycle = {
      questions: [
        asked('q-1', 'Fila circular', 'incorrect'),
        asked('q-2', 'Pilhas', 'correct'),
        asked('q-3', 'Árvores binárias', 'correct', true),
      ],
    } as unknown as StudyCycle
    const wrong = studyGaps(cycle)
    expect(wrong.map((q) => q.id)).toEqual(['q-1', 'q-3'])
    const lists = wrong.map((q) => rankStudySources([book], studyQueryOfQuestion(q.source)))
    // the circular queue is on page 5 only; the plain queue pages around it score below the cut
    expect(lists[0]![0]).toMatchObject({ title: 'livro.pdf', range: 'p. 5' })
    expect(lists[1]![0]).toMatchObject({ title: 'livro.pdf', range: 'p. 7' })
  })

  it('picks bank questions about a trail topic for a new cycle', () => {
    const bank = [
      bankQuestion('q-a', 'Filas', ['estrutura de dados'], 'O que é FIFO?'),
      bankQuestion('q-b', 'Pilhas', [], 'O que é LIFO?'),
      { ...bankQuestion('q-c', 'Filas', [], ''), sourceOnly: true as const },
    ]
    expect(questionsForTopic(bank, '[P2-ED-05] Filas').map((q) => q.id)).toEqual(['q-a'])
  })
})
