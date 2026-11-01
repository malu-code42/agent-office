import { describe, expect, it } from 'vitest'
import { NO_DISCIPLINE, studyBankStats } from '../src/shared/study-bank-stats'
import { STUDY_AGENT_ATTRIBUTION } from '../src/shared/study-bank'
import type { StudyQuestion } from '../src/shared/study-questions'
import { parseStudyTrail } from '../src/shared/study-trail'

const TRAIL = parseStudyTrail(
  [
    '## 1º período',
    '### [P1-LMD] Lógica e Matemática Discreta — 90 h',
    '- [x] [P1-LMD-01] Proposições e conectivos.',
    '- [ ] [P1-LMD-02] Tabelas-verdade.',
    '## 2º período',
    '### [P2-ED] Estrutura de Dados — 45 h',
    '- [ ] [P2-ED-01] Listas.',
    '- [ ] [P2-ED-05] Filas.',
  ].join('\n'),
)

let n = 0
const q = (topic: string, over: Partial<StudyQuestion> = {}): StudyQuestion => ({
  id: `q-test-${String(++n).padStart(8, '0')}`,
  topic,
  tags: [],
  question: 'Enunciado',
  answerStatus: 'unverified',
  originKind: 'enem',
  sourceTitle: 'Fonte',
  sourceVisibility: 'public',
  attribution: 'Autor',
  license: 'CC BY',
  ...over,
})

describe('studyBankStats', () => {
  it('counts the bank by origin and answer status', () => {
    const stats = studyBankStats(
      [
        q('Filas', { originKind: 'enem', answerStatus: 'verified' }),
        q('Filas', { originKind: 'ia', answerStatus: 'unverified' }),
        q('Listas', { originKind: 'livro', answerStatus: 'missing' }),
        q('Listas', { originKind: 'livro', answerStatus: 'verified' }),
      ],
      TRAIL.topics,
    )
    expect(stats.total).toBe(4)
    expect(stats.byOrigin).toEqual({ enem: 1, concurso: 0, livro: 2, web: 0, ia: 1 })
    expect(stats.byAnswer).toEqual({ verified: 2, unverified: 1, missing: 1 })
  })

  it('finds the discipline by label, title or id, ignoring accents and case', () => {
    const stats = studyBankStats(
      [
        q('[P2-ED-05] Filas'),
        q('filas'),
        q('P2-ED-05'),
        q('[p2-ed-01] qualquer nome'),
        q('TABELAS-VERDADE'),
        q('proposicoes e conectivos'),
      ],
      TRAIL.topics,
    )
    expect(stats.disciplines.map((d) => [d.discipline, d.count])).toEqual([
      ['Estrutura de Dados', 4],
      ['Lógica e Matemática Discreta', 2],
    ])
    expect(stats.disciplines[0]!.topics.map((t) => [t.topic, t.count])).toEqual([
      [TRAIL.topics.find((t) => t.id === 'P2-ED-05')!.title, 3],
      [TRAIL.topics.find((t) => t.id === 'P2-ED-01')!.title, 1],
    ])
  })

  it('puts topics outside the trail under "Sem disciplina", sorted largest first', () => {
    const stats = studyBankStats([q('Termodinâmica'), q('Termodinâmica'), q('Óptica'), q('Filas')], TRAIL.topics)
    expect(stats.disciplines[0]).toEqual({
      discipline: NO_DISCIPLINE,
      count: 3,
      fresh: 3,
      below: 0,
      topics: [
        { topic: 'Termodinâmica', count: 2, fresh: 2, below: false, ids: [expect.any(String), expect.any(String)] },
        { topic: 'Óptica', count: 1, fresh: 1, below: false, ids: [expect.any(String)] },
      ],
    })
    expect(stats.disciplines[1]!.discipline).toBe('Estrutura de Dados')
  })

  it('lists every trail topic, marks the ones below the goal of new questions and counts seals', () => {
    const agent = { attribution: STUDY_AGENT_ATTRIBUTION, answerStatus: 'verified' as const }
    const filas = [q('Filas', agent), q('Filas', agent), q('Filas', { verifiedByUser: true, verifiedAt: '2026-10-12T00:00:00.000Z' })]
    const answered = new Set([filas[0]!.id])
    const stats = studyBankStats(filas, TRAIL.topics, { goal: 2, isAnswered: (x) => answered.has(x.id) })
    expect(stats.answered).toBe(1)
    expect(stats.byReview).toEqual({ agents: 2, none: 1 })
    const ed = stats.disciplines.find((d) => d.discipline === 'Estrutura de Dados')!
    expect(ed.topics.find((t) => t.id === 'P2-ED-05')).toMatchObject({ count: 3, fresh: 2, below: false })
    expect(ed.topics.find((t) => t.id === 'P2-ED-01')).toMatchObject({ count: 0, fresh: 0, below: true })
    expect(stats.below).toBe(3)
  })

  it('handles an empty bank and a missing trail', () => {
    expect(studyBankStats([], []).disciplines).toEqual([])
    expect(studyBankStats([q('Filas')], []).disciplines[0]!.discipline).toBe(NO_DISCIPLINE)
  })
})
