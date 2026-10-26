import { describe, expect, it } from 'vitest'
import {
  activeStudyCycle,
  createStudyCycleState,
  answerStudyQuestion,
  assessStudyQuestion,
  advanceStudyCycle,
  reviewStudyGap,
  startStudyPracticeRound,
  answerStudyPracticeQuestion,
  practiceScore,
  startStudyRetest,
  answerStudyRetestQuestion,
  assessStudyRetestQuestion,
  retestScore,
  completeStudyCycle,
  attachStudySource,
  recordStudyNote,
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
    const review = advanceStudyCycle(state, 13)
    expect(activeStudyCycle(review)?.stage).toBe('review-required')
    expect(() => advanceStudyCycle(review, 14)).toThrow(/causa e o próximo passo/i)

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

  it('does not close the error-review gate until each gap has a cause and next step', () => {
    const q = question('q-review01')
    const state = createStudyCycleState('Probabilidade', [q], 10)
    const answered = answerStudyQuestion(state, q.id, 'Resposta errada', false, 11)
    const marked = assessStudyQuestion(answered, q.id, { kind: 'incorrect', rationale: 'O gabarito diverge.' }, 12)
    const reviewReady = advanceStudyCycle(marked, 13)
    expect(activeStudyCycle(reviewReady)?.stage).toBe('review-required')
    expect(() => advanceStudyCycle(reviewReady, 14)).toThrow(/causa e o próximo passo/i)
    const withCause = reviewStudyGap(reviewReady, q.id, 'Confundi os eventos', 'Rever o princípio da contagem', 15)
    expect(() => advanceStudyCycle(withCause, 16)).toThrow(/vincule ao menos uma fonte/i)
    const withSource = attachStudySource(withCause, q.id, 'study sources/probabilidade.md#eventos:1', 16)
    expect(activeStudyCycle(advanceStudyCycle(withSource, 17))?.stage).toBe('practice')
  })

  it('requires non-empty new practice linked to gaps and blocks zero denominator or missing notes', () => {
    let state = createStudyCycleState('Probabilidade', [question('q-review01')], 10)
    state = answerStudyQuestion(state, 'q-review01', 'Resposta errada', false, 11)
    state = assessStudyQuestion(state, 'q-review01', { kind: 'incorrect', rationale: 'Não confere.' }, 12)
    state = advanceStudyCycle(state, 13)
    state = reviewStudyGap(state, 'q-review01', 'Erro de leitura', 'Rever exemplos', 14)
    state = attachStudySource(state, 'q-review01', 'study sources/probabilidade.md#contagem', 14)
    state = advanceStudyCycle(state, 15)
    expect(() => advanceStudyCycle(state, 16)).toThrow(/ao menos uma questão/i)
    const practice = (id: string) => ({ ...question(id), gapQuestionIds: ['q-review01'] })
    state = startStudyPracticeRound(state, [practice('q-practice01')], 16)
    expect(() => startStudyPracticeRound(state, [practice('q-review01')], 16)).toThrow(/novas/i)
    state = answerStudyPracticeQuestion(
      state,
      'q-practice01',
      'Resposta',
      { kind: 'correct', rationale: 'Gabarito conferido.', checkedAt: 17 },
      17,
    )
    expect(() => advanceStudyCycle(state, 18)).toThrow(/nota/i)
  })

  it('scores only answered verified practice items and requires 80 percent before release', () => {
    let state = createStudyCycleState('Probabilidade', [question('q-review01')], 10)
    state = answerStudyQuestion(state, 'q-review01', 'Resposta errada', false, 11)
    state = assessStudyQuestion(state, 'q-review01', { kind: 'incorrect', rationale: 'Não confere.' }, 12)
    state = advanceStudyCycle(state, 13)
    state = reviewStudyGap(state, 'q-review01', 'Erro de leitura', 'Rever exemplos', 14)
    state = attachStudySource(state, 'q-review01', 'study sources/probabilidade.md#contagem', 14)
    state = advanceStudyCycle(state, 15)
    state = recordStudyNote(
      state,
      {
        id: 'note-1',
        gapQuestionId: 'q-review01',
        sourceRef: 'study sources/probabilidade.md#contagem',
        text: 'Vou listar os casos possíveis antes de calcular.',
        savedAt: 16,
      },
      16,
    )
    state = startStudyPracticeRound(
      state,
      ['q-practice01', 'q-practice02', 'q-practice03', 'q-practice04', 'q-practice05'].map((id) => ({
        ...question(id),
        gapQuestionIds: ['q-review01'],
      })),
      16,
    )
    let answered = state
    for (const [index, id] of ['q-practice01', 'q-practice02', 'q-practice03', 'q-practice04', 'q-practice05'].entries()) {
      answered = answerStudyPracticeQuestion(
        answered,
        id,
        'Resposta',
        { kind: index === 0 ? 'incorrect' : 'correct', rationale: 'Gabarito conferido.', checkedAt: 20 + index },
        20 + index,
      )
    }
    const round = activeStudyCycle(answered)!.practiceRounds[0]!
    expect(practiceScore(round)).toBe(80)
    expect(activeStudyCycle(advanceStudyCycle(answered, 30))?.stage).toBe('retest-ready')
  })

  it('keeps unsupported practice answers pending and allows an explicit new set without scoring them', () => {
    let state = createStudyCycleState('Probabilidade', [question('q-review02')], 10)
    state = answerStudyQuestion(state, 'q-review02', 'Resposta errada', false, 11)
    state = assessStudyQuestion(state, 'q-review02', { kind: 'incorrect', rationale: 'Não confere.' }, 12)
    state = advanceStudyCycle(state, 13)
    state = reviewStudyGap(state, 'q-review02', 'Erro de leitura', 'Rever exemplos', 14)
    state = attachStudySource(state, 'q-review02', 'study sources/probabilidade.md#contagem', 14)
    state = advanceStudyCycle(state, 15)
    state = recordStudyNote(
      state,
      {
        id: 'note-pending',
        gapQuestionId: 'q-review02',
        sourceRef: 'study sources/probabilidade.md#contagem',
        text: 'Separar os casos antes de resolver.',
        savedAt: 16,
      },
      16,
    )
    state = startStudyPracticeRound(state, [{ ...question('q-practice06'), gapQuestionIds: ['q-review02'] }], 17)
    state = answerStudyPracticeQuestion(
      state,
      'q-practice06',
      'Resposta',
      { kind: 'pending', rationale: 'Evidência insuficiente', checkedAt: 18 },
      18,
    )
    expect(practiceScore(activeStudyCycle(state)!.practiceRounds.at(-1)!)).toBe(0)
    expect(() => advanceStudyCycle(state, 19)).toThrow(/conclua a verificação/i)
    state = startStudyPracticeRound(state, [{ ...question('q-practice07'), gapQuestionIds: ['q-review02'] }], 20)
    expect(activeStudyCycle(state)?.practiceRounds).toHaveLength(2)
    expect(activeStudyCycle(state)?.practiceRounds[0]?.questions[0]?.assessment?.kind).toBe('pending')
    expect(() => startStudyPracticeRound(state, [{ ...question('q-practice07'), gapQuestionIds: ['q-review02'] }], 21)).toThrow(/novas/i)
  })

  it('requires ten distinct verified new questions, at least 80 percent and explicit confirmation', () => {
    let state = createStudyCycleState('Probabilidade', [question('q-diag00001')], 10)
    state = answerStudyQuestion(state, 'q-diag00001', 'Resposta', false, 11)
    state = assessStudyQuestion(state, 'q-diag00001', { kind: 'correct', rationale: 'Fixture correta.' }, 12)
    state = advanceStudyCycle(state, 13)
    expect(activeStudyCycle(state)?.stage).toBe('retest-ready')

    const retestQuestions = Array.from({ length: 10 }, (_, index) => question(`q-retest${String(index).padStart(2, '0')}`))
    const repeated = question('q-repeat001')
    repeated.source.question = question('q-diag00001').source.question
    const noKey = question('q-nokey001', 'unverified')
    expect(() => startStudyRetest(state, retestQuestions.slice(0, 9), 14)).toThrow(/pelo menos 10/i)
    expect(() => startStudyRetest(state, [repeated, ...retestQuestions.slice(1)], 14)).toThrow(/novas e sem repetição/i)
    expect(() => startStudyRetest(state, [noKey, ...retestQuestions.slice(1)], 14)).toThrow(/gabarito conferido/i)
    state = startStudyRetest(state, retestQuestions, 14)
    expect(activeStudyCycle(state)?.stage).toBe('retest')
    expect(retestScore(activeStudyCycle(state)!.retests[0]!)).toBeNull()
    for (const [index, item] of retestQuestions.entries()) {
      state = answerStudyRetestQuestion(state, item.id, `Resposta ${index}`, 20 + index)
      state = assessStudyRetestQuestion(
        state,
        item.id,
        { kind: index < 8 ? 'correct' : 'incorrect', rationale: 'Verificada sem dicas.' },
        30 + index,
      )
    }
    expect(retestScore(activeStudyCycle(state)!.retests[0]!)).toBe(80)
    expect(completeStudyCycle(state, false, 50)).toBe(state)
    expect(activeStudyCycle(completeStudyCycle(state, true, 51))?.stage).toBe('completed')
  })

  it('keeps an under-80 retest open and rejects questions already used in practice', () => {
    let state = createStudyCycleState('Probabilidade', [question('q-diag00002')], 10)
    state = answerStudyQuestion(state, 'q-diag00002', 'Resposta', false, 11)
    state = assessStudyQuestion(state, 'q-diag00002', { kind: 'correct', rationale: 'Fixture correta.' }, 12)
    state = advanceStudyCycle(state, 13)
    const retest = Array.from({ length: 10 }, (_, index) => question(`q-retestx${String(index).padStart(2, '0')}`))
    state = startStudyRetest(state, retest, 14)
    for (const item of retest) {
      state = answerStudyRetestQuestion(state, item.id, 'Resposta', 20)
      state = assessStudyRetestQuestion(state, item.id, { kind: 'incorrect', rationale: 'Não confere.' }, 21)
    }
    expect(() => startStudyRetest(state, [question('q-diag00002'), ...retest.slice(1)], 22)).toThrow(/novas e sem repetição/i)
    expect(retestScore(activeStudyCycle(state)!.retests[0]!)).toBe(0)
    expect(() => completeStudyCycle(state, true, 22)).toThrow(/80%/i)
    expect(activeStudyCycle(state)?.stage).toBe('retest')
  })
})
