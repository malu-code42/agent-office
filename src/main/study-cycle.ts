import {
  activeStudyCycle,
  advanceStudyCycle,
  answerStudyQuestion,
  assessStudyQuestion,
  createStudyCycleState,
  resetActiveStudyCycle,
  type StudyCycleQuestion,
  type StudyCycleState,
} from '@shared/study-cycle'
import type { StudyQuestion } from '@shared/study-questions'
import { tutorEvidence, type StudyTutorEvaluator } from './study-cycle-claude'
import { hashStudyQuestion } from './study-cycle-schema'
import { StudyCycleStore } from './study-cycle-store'

export interface StudyQuestionBank {
  read(): { questions: StudyQuestion[] }
}

/** Coordinates local bank snapshots, persisted diagnosis evidence, and explicit Tutor requests. */
export class StudyCycleService {
  constructor(
    private readonly store: StudyCycleStore,
    private readonly bank: StudyQuestionBank,
    private readonly evaluate: StudyTutorEvaluator,
    private readonly now: () => number = Date.now,
  ) {}

  read(): StudyCycleState {
    return this.store.read()
  }

  start(topic: string, questionIds: string[]): StudyCycleState {
    if (!Array.isArray(questionIds) || questionIds.length < 1 || questionIds.length > 100)
      throw new Error('Selecione de 1 a 100 questões do banco local.')
    const bankQuestions = this.bank.read().questions
    const selected: StudyCycleQuestion[] = questionIds.map((id) => {
      const source = bankQuestions.find((question) => question.id === id)
      if (!source || source.sourceOnly || !source.question.trim())
        throw new Error('Uma questão selecionada não está disponível no banco local.')
      return {
        id: source.id,
        sourceHash: hashStudyQuestion(source),
        source,
        response: '',
        providedExcerpt: '',
        uncertain: null,
        assessment: null,
      }
    })
    const next = createStudyCycleState(topic, selected, this.now(), this.store.read())
    this.store.write(next)
    return next
  }

  answer(questionId: string, response: string, uncertain: boolean, providedExcerpt = ''): StudyCycleState {
    const next = answerStudyQuestion(this.store.read(), questionId, response, uncertain, this.now(), providedExcerpt)
    this.store.write(next)
    return next
  }

  async evaluateAnswer(questionId: string): Promise<StudyCycleState> {
    const current = this.store.read()
    const cycle = activeStudyCycle(current)
    const question = cycle?.questions.find((item) => item.id === questionId)
    if (!cycle || !question || !question.response || question.uncertain === null)
      throw new Error('Responda e marque sua incerteza antes de verificar.')
    const evidence = tutorEvidence(question)
    if (!evidence) {
      const next = assessStudyQuestion(
        current,
        questionId,
        { kind: 'pending', rationale: 'Sem gabarito conferido ou trecho de apoio fornecido; manter em verificação.' },
        this.now(),
      )
      this.store.write(next)
      return next
    }
    // Content leaves the device only on this explicit per-question action. Never log this payload.
    const result = await this.evaluate({ question: question.source.question, studentAnswer: question.response, providedEvidence: evidence })
    const latest = this.store.read()
    const latestCycle = activeStudyCycle(latest)
    const latestQuestion = latestCycle?.questions.find((item) => item.id === questionId)
    if (
      latestCycle?.id !== cycle.id ||
      latestQuestion?.response !== question.response ||
      latestQuestion.uncertain !== question.uncertain ||
      latestQuestion.providedExcerpt !== question.providedExcerpt ||
      latestQuestion.sourceHash !== question.sourceHash
    )
      throw new Error('O ciclo ou a resposta mudou durante a verificação. Os dados foram preservados; verifique novamente.')
    const next = assessStudyQuestion(latest, questionId, result, this.now())
    this.store.write(next)
    return next
  }

  advance(): StudyCycleState {
    const next = advanceStudyCycle(this.store.read(), this.now())
    this.store.write(next)
    return next
  }

  reset(): StudyCycleState {
    const next = resetActiveStudyCycle(this.store.read())
    this.store.write(next)
    return next
  }
}
