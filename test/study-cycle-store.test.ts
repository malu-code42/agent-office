import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { StudyQuestion } from '../src/shared/study-questions'
import { StudyCycleService } from '../src/main/study-cycle'
import { StudyCycleStore } from '../src/main/study-cycle-store'
import { parseTutorResult, tutorEvidence } from '../src/main/study-cycle-claude'
import { hashStudyQuestion, isStudyCycleState } from '../src/main/study-cycle-schema'
import { retestScore } from '../src/shared/study-cycle'
import {
  advanceStudyCycle,
  answerStudyPracticeQuestion,
  answerStudyQuestion,
  assessStudyQuestion,
  attachStudySource,
  createStudyCycleState,
  reviewStudyGap,
} from '../src/shared/study-cycle'

const question = (overrides: Partial<StudyQuestion> = {}): StudyQuestion => ({
  id: 'q-12345678',
  topic: 'Probabilidade',
  tags: [],
  question: 'Qual a chance de cara?',
  answer: '1/2',
  answerStatus: 'verified',
  originKind: 'enem',
  sourceTitle: 'Fixture',
  sourceVisibility: 'public',
  attribution: 'Teste sintético',
  license: 'CC BY 4.0',
  ...overrides,
})

describe('persistência do ciclo de estudo', () => {
  it('aceita somente decisão JSON conhecida e evidência de gabarito conferido ou trecho escolhido', () => {
    expect(parseTutorResult('{"kind":"correct","rationale":"O gabarito sustenta."}')).toEqual({
      kind: 'correct',
      rationale: 'O gabarito sustenta.',
    })
    expect(parseTutorResult('isso não é JSON').kind).toBe('pending')
    expect(parseTutorResult('{"kind":"correct","rationale":"ok","extra":true}').kind).toBe('pending')
    const unverified = {
      id: 'q-abcdefgh',
      sourceHash: 'a'.repeat(64),
      source: question({ answerStatus: 'unverified' }),
      response: 'r',
      providedExcerpt: '',
      uncertain: false,
      assessment: null,
    }
    expect(tutorEvidence(unverified)).toBe('')
    expect(tutorEvidence({ ...unverified, providedExcerpt: 'Trecho escolhido' })).toBe('Trecho escolhido')
  })

  it('snapshots apenas IDs do banco local e retoma a evidência após recriar o store', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'study-cycle-'))
    try {
      const bankQuestion = question()
      const bank = { read: () => ({ questions: [bankQuestion] }) }
      const store = new StudyCycleStore(dir)
      let called = 0
      const service = new StudyCycleService(
        store,
        bank,
        async (input) => {
          called++
          expect(input).toEqual({
            question: bankQuestion.question,
            studentAnswer: 'Minha resposta',
            providedEvidence: 'Gabarito conferido: 1/2',
          })
          return { kind: 'correct', rationale: 'O gabarito conferido sustenta a resposta.' }
        },
        () => 123,
      )
      const started = service.start('Probabilidade', [bankQuestion.id])
      expect(started.activeId).toBeTruthy()
      expect(called).toBe(0)
      service.answer(bankQuestion.id, 'Minha resposta', false)
      expect(called).toBe(0)

      const resumed = new StudyCycleService(
        new StudyCycleStore(dir),
        bank,
        async () => {
          called++
          return { kind: 'correct', rationale: 'Evidência suficiente.' }
        },
        () => 124,
      )
      await resumed.evaluateAnswer(bankQuestion.id)
      expect(called).toBe(1)
      expect(new StudyCycleStore(dir).read().cycles[0]?.questions[0]).toMatchObject({
        response: 'Minha resposta',
        uncertain: false,
        assessment: { kind: 'correct' },
        source: bankQuestion,
      })
      bankQuestion.question = 'Questão editada no banco'
      expect(new StudyCycleStore(dir).read().cycles[0]?.questions[0]?.source.question).toBe('Qual a chance de cara?')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('never calls Tutor without trusted key or selected excerpt and keeps failed evaluations retryable', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'study-cycle-'))
    try {
      let calls = 0
      const missing = question({ id: 'q-abcdefgh', answer: undefined, answerStatus: 'missing' })
      const bank = { read: () => ({ questions: [missing] }) }
      const service = new StudyCycleService(new StudyCycleStore(dir), bank, async () => {
        calls++
        throw new Error('quota')
      })
      service.start('Probabilidade', [missing.id])
      service.answer(missing.id, 'Resposta', false)
      await service.evaluateAnswer(missing.id)
      expect(calls).toBe(0)
      expect(new StudyCycleStore(dir).read().cycles[0]?.questions[0]?.assessment?.kind).toBe('pending')

      service.answer(missing.id, 'Resposta revisada', false, 'Trecho de apoio')
      await expect(service.evaluateAnswer(missing.id)).rejects.toThrow('quota')
      expect(calls).toBe(1)
      expect(new StudyCycleStore(dir).read().cycles[0]?.questions[0]).toMatchObject({
        response: 'Resposta revisada',
        providedExcerpt: 'Trecho de apoio',
        assessment: null,
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not apply a Tutor result to a replacement cycle with the same question ID', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'study-cycle-'))
    try {
      const bankQuestion = question()
      const bank = { read: () => ({ questions: [bankQuestion] }) }
      let finishEvaluation!: (result: { kind: 'correct'; rationale: string }) => void
      const service = new StudyCycleService(new StudyCycleStore(dir), bank, () => new Promise((resolve) => (finishEvaluation = resolve)))

      service.start('Probabilidade A', [bankQuestion.id])
      service.answer(bankQuestion.id, 'Resposta igual', false)
      const pendingEvaluation = service.evaluateAnswer(bankQuestion.id)

      service.reset()
      service.start('Probabilidade B', [bankQuestion.id])
      service.answer(bankQuestion.id, 'Resposta igual', false)
      finishEvaluation({ kind: 'correct', rationale: 'Resultado do ciclo anterior.' })

      await expect(pendingEvaluation).rejects.toThrow(/ciclo ou a resposta mudou/i)
      expect(new StudyCycleStore(dir).read().cycles.at(-1)?.questions[0]?.assessment).toBeNull()
      expect(new StudyCycleStore(dir).read().cycles.at(-1)?.topic).toBe('Probabilidade B')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses IDs absent from the local bank without external calls', () => {
    const dir = mkdtempSync(join(tmpdir(), 'study-cycle-'))
    try {
      const service = new StudyCycleService(new StudyCycleStore(dir), { read: () => ({ questions: [] }) }, async () => {
        throw new Error('must not be called')
      })
      expect(() => service.start('Probabilidade', ['q-12345678'])).toThrow(/banco local/i)
      expect(new StudyCycleStore(dir).read().cycles).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('checks a complete retest only after explicit submit and requires confirmation to conclude', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'study-cycle-'))
    try {
      const diagnostic = question({ id: 'q-diag00003' })
      const retestQuestions = Array.from({ length: 10 }, (_, index) =>
        question({ id: `q-live${String(index).padStart(5, '0')}`, question: `Questão inédita ${index}?` }),
      )
      const bank = { read: () => ({ questions: [diagnostic, ...retestQuestions] }) }
      let calls = 0
      const service = new StudyCycleService(new StudyCycleStore(dir), bank, async (input) => {
        calls++
        expect(input.providedEvidence).toBe('Gabarito conferido: 1/2')
        return { kind: calls === 1 || calls <= 9 ? 'correct' : 'incorrect', rationale: 'Conferência independente.' }
      })
      service.start('Probabilidade', [diagnostic.id])
      service.answer(diagnostic.id, 'Resposta', false)
      expect(calls).toBe(0)
      await service.evaluateAnswer(diagnostic.id)
      service.advance()
      expect(service.read().cycles[0]?.stage).toBe('retest-ready')
      service.startRetest(retestQuestions.map((item) => item.id))
      await expect(service.verifyRetest()).rejects.toThrow(/responda todas/i)
      expect(calls).toBe(1)
      for (const [index, item] of retestQuestions.entries()) service.answerRetest(item.id, `Minha resposta ${index}`)
      expect(calls).toBe(1)
      const checked = await service.verifyRetest()
      const attempt = checked.cycles[0]?.retests[0]
      expect(attempt?.questions).toHaveLength(10)
      expect(retestScore(attempt!)).toBe(80)
      expect(calls).toBe(11)
      expect(service.read()).toEqual(checked)
      expect(service.read().cycles[0]?.stage).toBe('retest')
      expect(service.completeRetest().cycles[0]?.stage).toBe('completed')
      expect(new StudyCycleStore(dir).read().cycles[0]?.stage).toBe('completed')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses a persisted completed state without a verified passing retest', () => {
    const state = createStudyCycleState(
      'Probabilidade',
      [
        {
          id: 'q-diagnostic01',
          sourceHash: hashStudyQuestion(question({ id: 'q-diagnostic01' })),
          source: question({ id: 'q-diagnostic01' }),
          response: '',
          providedExcerpt: '',
          uncertain: null,
          assessment: null,
        },
      ],
      10,
    )
    const forged = {
      ...state,
      cycles: state.cycles.map((cycle) => ({ ...cycle, stage: 'completed' as const })),
    }
    expect(isStudyCycleState(forged)).toBe(false)
  })

  it('persists reviewed gaps, source-linked notes and practice results across service recreation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'study-cycle-'))
    try {
      const diagnostic = question({ id: 'q-gap00001' })
      const practice = question({ id: 'q-prac00001', question: 'Qual é a chance complementar?' })
      const bank = { read: () => ({ questions: [diagnostic, practice] }) }
      const noteWriter = {
        write: (input: { id: string; gapQuestionId: string; sourceRef: string; text: string; savedAt?: number }) => ({
          ...input,
          savedAt: input.savedAt ?? 123,
        }),
      }
      const service = new StudyCycleService(
        new StudyCycleStore(dir),
        bank,
        async (input) =>
          input.question === diagnostic.question
            ? { kind: 'incorrect', rationale: 'A evidência mostra a lacuna.' }
            : { kind: 'correct', rationale: 'O gabarito confere.' },
        () => 123,
        noteWriter,
      )
      service.start('Probabilidade', [diagnostic.id])
      service.answer(diagnostic.id, 'Resposta incorreta', false)
      await service.evaluateAnswer(diagnostic.id)
      service.advance()
      service.reviewGap(diagnostic.id, 'Confundi casos independentes', 'Rever o exemplo do material')
      service.attachSource(diagnostic.id, 'study sources/probabilidade.md#eventos:3')
      service.advance()
      service.saveNote(diagnostic.id, 'study sources/probabilidade.md#eventos:3', 'Multiplicar apenas quando forem independentes.')
      service.startPractice([{ id: practice.id, gapQuestionIds: [diagnostic.id] }])
      service.answerPractice(practice.id, 'Resposta correta')
      await service.evaluatePracticeAnswer(practice.id)

      const resumed = new StudyCycleService(new StudyCycleStore(dir), bank, async () => {
        throw new Error('não deve verificar novamente na retomada')
      })
      expect(resumed.read().cycles[0]).toMatchObject({
        stage: 'practice',
        notes: [{ sourceRef: 'study sources/probabilidade.md#eventos:3' }],
        questions: [{ review: { cause: 'Confundi casos independentes', nextStep: 'Rever o exemplo do material' } }],
        practiceRounds: [{ questions: [{ response: 'Resposta correta', assessment: { kind: 'correct' } }] }],
      })
      expect(resumed.advance().cycles[0]?.stage).toBe('retest-ready')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps practice blocked below 80 percent and requires a new question round', () => {
    const dir = mkdtempSync(join(tmpdir(), 'study-cycle-'))
    try {
      const diagnostic = question({ id: 'q-gap00002' })
      const practiceA = question({ id: 'q-prac00002' })
      const practiceB = question({ id: 'q-prac00003' })
      const bank = { read: () => ({ questions: [diagnostic, practiceA, practiceB] }) }
      const store = new StudyCycleStore(dir)
      const service = new StudyCycleService(
        store,
        bank,
        async () => ({ kind: 'incorrect', rationale: 'Ainda não.' }),
        () => 123,
        {
          write: (input) => ({ ...input, savedAt: input.savedAt ?? 123 }),
        },
      )
      service.start('Probabilidade', [diagnostic.id])
      service.answer(diagnostic.id, 'Resposta', false)
      const state = store.read()
      store.write(assessStudyQuestion(state, diagnostic.id, { kind: 'incorrect', rationale: 'Fixture' }, 123))
      service.advance()
      service.reviewGap(diagnostic.id, 'Erro', 'Rever')
      service.attachSource(diagnostic.id, 'study sources/one.md#one:1')
      service.advance()
      service.saveNote(diagnostic.id, 'study sources/one.md#one:1', 'Nota da fonte')
      service.startPractice([{ id: practiceA.id, gapQuestionIds: [diagnostic.id] }])
      service.answerPractice(practiceA.id, 'Resposta')
      const scoreState = store.read()
      store.write(
        answerStudyPracticeQuestion(scoreState, practiceA.id, 'Resposta', { kind: 'incorrect', rationale: 'Fixture', checkedAt: 123 }, 123),
      )
      expect(() => service.advance()).toThrow(/abaixo de 80%/i)
      expect(() => service.startPractice([{ id: practiceA.id, gapQuestionIds: [diagnostic.id] }])).toThrow(/novas/i)
      expect(() => service.startPractice([{ id: practiceB.id, gapQuestionIds: [diagnostic.id] }])).not.toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses a practice item without a verified answer key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'study-cycle-'))
    try {
      const diagnostic = question({ id: 'q-gap00003' })
      const unverified = question({ id: 'q-unver0001', answerStatus: 'unverified' })
      const bank = { read: () => ({ questions: [diagnostic, unverified] }) }
      const store = new StudyCycleStore(dir)
      let state = createStudyCycleState(
        'Probabilidade',
        [
          {
            id: diagnostic.id,
            sourceHash: hashStudyQuestion(diagnostic),
            source: diagnostic,
            response: '',
            providedExcerpt: '',
            uncertain: null,
            assessment: null,
          },
        ],
        10,
      )
      state = answerStudyQuestion(state, diagnostic.id, 'Resposta incorreta', false, 11)
      state = assessStudyQuestion(state, diagnostic.id, { kind: 'incorrect', rationale: 'Fixture' }, 12)
      state = advanceStudyCycle(state, 13)
      state = reviewStudyGap(state, diagnostic.id, 'Erro', 'Rever', 14)
      state = attachStudySource(state, diagnostic.id, 'study sources/one.md#one:1', 14)
      state = advanceStudyCycle(state, 15)
      store.write(state)
      const service = new StudyCycleService(store, bank, async () => ({ kind: 'correct', rationale: 'fixture' }))
      expect(() => service.startPractice([{ id: unverified.id, gapQuestionIds: [diagnostic.id] }])).toThrow(/gabarito conferido/i)
      expect(store.read().cycles[0]?.practiceRounds).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('migrates a pre-practice cycle file without discarding diagnostic evidence', () => {
    const dir = mkdtempSync(join(tmpdir(), 'study-cycle-'))
    try {
      const state = {
        activeId: 'sc-1-abcdefgh',
        cycles: [
          {
            id: 'sc-1-abcdefgh',
            topic: 'Probabilidade',
            stage: 'review-required',
            startedAt: 1,
            updatedAt: 2,
            questions: [
              {
                id: 'q-12345678',
                sourceHash: hashStudyQuestion(question()),
                source: question(),
                response: 'Resposta',
                providedExcerpt: '',
                uncertain: false,
                assessment: { kind: 'incorrect', rationale: 'Fixture', checkedAt: 2 },
              },
            ],
          },
        ],
      }
      writeFileSync(join(dir, 'study-cycle.json'), JSON.stringify(state))
      const migrated = new StudyCycleStore(dir).read()
      expect(migrated.cycles[0]).toMatchObject({
        topic: 'Probabilidade',
        stage: 'review-required',
        questions: [{ response: 'Resposta', assessment: { kind: 'incorrect' } }],
        practiceRounds: [],
        notes: [],
        retests: [],
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
