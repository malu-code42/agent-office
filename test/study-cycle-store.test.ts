import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { StudyQuestion } from '../src/shared/study-questions'
import { StudyCycleService } from '../src/main/study-cycle'
import { StudyCycleStore } from '../src/main/study-cycle-store'
import { parseTutorResult, tutorEvidence } from '../src/main/study-cycle-claude'

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
})
