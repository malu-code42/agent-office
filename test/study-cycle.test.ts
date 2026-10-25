import { describe, expect, it } from 'vitest'
import {
  activeStudyCycle,
  createStudyCycleState,
  answerStudyQuestion,
  assessStudyQuestion,
  advanceStudyCycle,
  evaluateStudyGate,
  type StudyCycleQuestion,
} from '../src/shared/study-cycle'

const question = (id: string, answerStatus: StudyCycleQuestion['source']['answerStatus'] = 'verified'): StudyCycleQuestion => ({
  id,
  sourceHash: `hash-${id}`,
  source: {
    id,
    topic: 'Probabilidade',
    tags: ['eventos'],
    question: `Questão ${id}`,
    answer: answerStatus === 'missing' ? undefined : '1/2',
    answerStatus,
    originKind: 'enem',
    sourceTitle: 'Prova sintética',
    sourceVisibility: 'public',
    attribution: 'Fixture sintética',
    license: 'CC BY 4.0',
  },
  response: '',
  providedExcerpt: '',
  uncertain: null,
  assessment: null,
})

describe('ciclo de diagnóstico', () => {
  it('bloqueia o gate até resposta e marcação explícita de incerteza em todas as questões', () => {
    const state = createStudyCycleState('Probabilidade', [question('q-12345678'), question('q-abcdefgh')], 10)
    expect(evaluateStudyGate(activeStudyCycle(state)!)).toMatchObject({ ready: false, reason: 'incomplete' })
    const answered = answerStudyQuestion(state, 'q-12345678', 'Minha resposta', false, 11)
    expect(evaluateStudyGate(activeStudyCycle(answered)!)).toMatchObject({ ready: false, reason: 'incomplete' })
    const complete = answerStudyQuestion(answered, 'q-abcdefgh', 'Não sei', true, 12)
    expect(evaluateStudyGate(activeStudyCycle(complete)!)).toMatchObject({ ready: false, reason: 'verification-pending' })
  })

  it('does not require a minimum score and releases retest when every assessment is correct without doubt', () => {
    let state = createStudyCycleState('Probabilidade', [question('q-12345678'), question('q-abcdefgh')], 10)
    for (const id of ['q-12345678', 'q-abcdefgh']) {
      state = answerStudyQuestion(state, id, 'Resposta', false, 11)
      state = assessStudyQuestion(state, id, { kind: 'correct', rationale: 'Evidência suficiente' }, 12)
    }
    expect(evaluateStudyGate(activeStudyCycle(state)!)).toMatchObject({ ready: true, nextStage: 'retest-ready' })
    expect(activeStudyCycle(state)?.questions.map((item) => item.assessment?.kind)).toEqual(['correct', 'correct'])
    expect(activeStudyCycle(state)?.stage).toBe('diagnosis')
    expect(activeStudyCycle(advanceStudyCycle(state, 13))?.stage).toBe('retest-ready')
  })

  it('routes wrong or uncertain evidence to review and keeps unsupported answers in verification', () => {
    let state = createStudyCycleState('Probabilidade', [question('q-12345678')], 10)
    state = answerStudyQuestion(state, 'q-12345678', 'Resposta', true, 11)
    state = assessStudyQuestion(state, 'q-12345678', { kind: 'uncertain', rationale: 'Não há evidência suficiente' }, 12)
    expect(evaluateStudyGate(activeStudyCycle(state)!)).toMatchObject({ ready: true, nextStage: 'review-required' })
    expect(activeStudyCycle(advanceStudyCycle(state, 13))?.stage).toBe('review-required')

    let noKey = createStudyCycleState('Probabilidade', [question('q-abcdefgh', 'missing')], 10)
    noKey = answerStudyQuestion(noKey, 'q-abcdefgh', 'Resposta', false, 11)
    noKey = assessStudyQuestion(noKey, 'q-abcdefgh', { kind: 'pending', rationale: 'Gabarito indisponível' }, 12)
    expect(evaluateStudyGate(activeStudyCycle(noKey)!)).toMatchObject({ ready: false, reason: 'verification-pending' })

    let insufficient = createStudyCycleState('Probabilidade', [question('q-insuff01')], 10)
    insufficient = answerStudyQuestion(insufficient, 'q-insuff01', 'Resposta', false, 11)
    insufficient = assessStudyQuestion(insufficient, 'q-insuff01', { kind: 'uncertain', rationale: 'Evidência insuficiente' }, 12)
    expect(activeStudyCycle(insufficient)?.questions[0]?.assessment?.kind).toBe('pending')
    expect(evaluateStudyGate(activeStudyCycle(insufficient)!)).toMatchObject({ ready: false, reason: 'verification-pending' })
  })

  it('preserves the exact question snapshot and previous cycle when a new topic starts', () => {
    const first = createStudyCycleState('Probabilidade', [question('q-12345678')], 10)
    const second = createStudyCycleState('Estatística', [question('q-abcdefgh')], 20, first)
    const restored = JSON.parse(JSON.stringify(second)) as typeof second
    expect(restored.cycles).toHaveLength(2)
    expect(restored.cycles[0]?.questions[0]?.sourceHash).toBe('hash-q-12345678')
    expect(activeStudyCycle(restored)?.topic).toBe('Estatística')
  })
})
