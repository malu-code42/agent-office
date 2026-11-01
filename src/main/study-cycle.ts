import {
  activeStudyCycle,
  advanceStudyCycle,
  answerStudyQuestion,
  answerStudyPracticeQuestion,
  answerStudyRetestQuestion,
  assessStudyQuestion,
  attachStudySource,
  createStudyCycleState,
  assessStudyRetestQuestion,
  completeStudyCycle,
  recordStudyNote,
  reviewStudyGap,
  resetActiveStudyCycle,
  resumeStudyCycle,
  startStudyPracticeRound,
  saveStudyPracticeResponse,
  startStudyRetest,
  type StudyCycleQuestion,
  type StudyCycleNote,
  type StudyPracticeQuestion,
  type StudyCycleState,
} from '@shared/study-cycle'
import { studyQuestionText, type StudyQuestion } from '@shared/study-questions'
import { tutorEvidence, type StudyTutorEvaluator } from './study-cycle-claude'
import { hashStudyQuestion } from './study-cycle-schema'
import { StudyCycleStore } from './study-cycle-store'

export interface StudyQuestionBank {
  read(): { questions: StudyQuestion[] }
}

export interface StudyNoteWriter {
  write(input: Omit<StudyCycleNote, 'savedAt'> & { savedAt?: number }): StudyCycleNote
}

/** Coordinates local bank snapshots, persisted diagnosis evidence, and explicit Tutor requests. */
export class StudyCycleService {
  constructor(
    private readonly store: StudyCycleStore,
    private readonly bank: StudyQuestionBank,
    private readonly evaluate: StudyTutorEvaluator,
    private readonly now: () => number = Date.now,
    private readonly noteWriter?: StudyNoteWriter,
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

  reviewGap(questionId: string, cause: string, nextStep: string): StudyCycleState {
    const next = reviewStudyGap(this.store.read(), questionId, cause, nextStep, this.now())
    this.store.write(next)
    return next
  }

  attachSource(questionId: string, sourceRef: string): StudyCycleState {
    const next = attachStudySource(this.store.read(), questionId, sourceRef, this.now())
    this.store.write(next)
    return next
  }

  saveNote(questionId: string, sourceRef: string, text: string): StudyCycleState {
    if (!this.noteWriter) throw new Error('O salvamento de notas de estudo não está disponível.')
    const cycle = activeStudyCycle(this.store.read())
    if (!cycle) throw new Error('Não há ciclo de estudo ativo.')
    const noteId = `sn-${cycle.id}-${questionId}-${createStableNoteSuffix(text)}`
    const current = this.store.read()
    const existing = activeStudyCycle(current)?.notes.find((note) => note.id === noteId)
    if (existing) {
      this.noteWriter.write(existing)
      return current
    }
    const draft = { id: noteId, gapQuestionId: questionId, sourceRef, text: text.trim(), savedAt: this.now() }
    recordStudyNote(current, draft, draft.savedAt)
    const note = this.noteWriter.write(draft)
    const next = recordStudyNote(current, note, this.now())
    this.store.write(next)
    return next
  }

  startPractice(questionLinks: { id: string; gapQuestionIds: string[] }[]): StudyCycleState {
    if (!Array.isArray(questionLinks) || questionLinks.length < 1 || questionLinks.length > 100)
      throw new Error('Planeje ao menos uma questão de prática.')
    const bank = this.bank.read().questions
    const questions: StudyPracticeQuestion[] = questionLinks.map(({ id, gapQuestionIds }) => {
      const source = bank.find((question) => question.id === id)
      if (!source || source.sourceOnly || !source.question.trim() || source.answerStatus !== 'verified' || !source.answer)
        throw new Error('A prática aceita somente questões do banco com gabarito conferido.')
      return {
        id: source.id,
        sourceHash: hashStudyQuestion(source),
        source,
        response: '',
        providedExcerpt: '',
        uncertain: false,
        assessment: null,
        gapQuestionIds,
      }
    })
    const next = startStudyPracticeRound(this.store.read(), questions, this.now())
    this.store.write(next)
    return next
  }

  startRetest(questionIds: string[]): StudyCycleState {
    if (!Array.isArray(questionIds) || questionIds.length < 10 || questionIds.length > 100)
      throw new Error('Selecione pelo menos 10 questões novas para o reteste.')
    const bank = this.bank.read().questions
    const questions: StudyCycleQuestion[] = questionIds.map((id) => {
      const source = bank.find((question) => question.id === id)
      if (!source || source.sourceOnly || !source.question.trim() || source.answerStatus !== 'verified' || !source.answer)
        throw new Error('O reteste aceita somente questões do banco com gabarito conferido.')
      return {
        id: source.id,
        sourceHash: hashStudyQuestion(source),
        source,
        response: '',
        providedExcerpt: '',
        uncertain: false,
        assessment: null,
      }
    })
    const next = startStudyRetest(this.store.read(), questions, this.now())
    this.store.write(next)
    return next
  }

  answerRetest(questionId: string, response: string): StudyCycleState {
    const next = answerStudyRetestQuestion(this.store.read(), questionId, response, this.now())
    this.store.write(next)
    return next
  }

  async verifyRetest(): Promise<StudyCycleState> {
    let state = this.store.read()
    const cycle = activeStudyCycle(state)
    const attempt = cycle?.retests.at(-1)
    if (!cycle || cycle.stage !== 'retest' || !attempt) throw new Error('Bonnie ainda não abriu um reteste.')
    if (attempt.questions.some((question) => !question.response))
      throw new Error('Responda todas as questões do reteste antes de conferir o resultado.')
    for (const question of attempt.questions) {
      if (question.assessment && question.assessment.kind !== 'pending' && question.assessment.kind !== 'uncertain') continue
      const evidence = tutorEvidence(question)
      if (!evidence) throw new Error('Há questão sem gabarito conferido; ela não pode contar no reteste.')
      const result = await this.evaluate({
        profile: 'verificador',
        question: studyQuestionText(question.source),
        studentAnswer: question.response,
        providedEvidence: evidence,
      })
      const latest = this.store.read()
      const latestCycle = activeStudyCycle(latest)
      const latestAttempt = latestCycle?.retests.at(-1)
      const latestQuestion = latestAttempt?.questions.find((item) => item.id === question.id)
      if (
        latestCycle?.id !== cycle.id ||
        latestAttempt?.id !== attempt.id ||
        latestQuestion?.response !== question.response ||
        latestQuestion.sourceHash !== question.sourceHash
      )
        throw new Error('O ciclo ou as respostas mudaram durante a conferência. Os dados foram preservados; tente novamente.')
      state = assessStudyRetestQuestion(latest, question.id, result, this.now())
      this.store.write(state)
    }
    return state
  }

  completeRetest(): StudyCycleState {
    const next = completeStudyCycle(this.store.read(), true, this.now())
    this.store.write(next)
    return next
  }

  answerPractice(questionId: string, response: string): StudyCycleState {
    const next = saveStudyPracticeResponse(this.store.read(), questionId, response, this.now())
    this.store.write(next)
    return next
  }

  async evaluatePracticeAnswer(questionId: string): Promise<StudyCycleState> {
    const current = this.store.read()
    const cycle = activeStudyCycle(current)
    const round = cycle?.practiceRounds.at(-1)
    const question = round?.questions.find((item) => item.id === questionId)
    if (!cycle || !round || !question?.response) throw new Error('Salve uma resposta antes de pedir a verificação do Tutor.')
    const evidence = tutorEvidence(question)
    if (!evidence) throw new Error('A questão não tem gabarito conferido; ela não pode contar na prática.')
    const result = await this.evaluate({
      profile: 'curador',
      question: studyQuestionText(question.source),
      studentAnswer: question.response,
      providedEvidence: evidence,
    })
    const latest = this.store.read()
    const latestCycle = activeStudyCycle(latest)
    const latestRound = latestCycle?.practiceRounds.at(-1)
    const latestQuestion = latestRound?.questions.find((item) => item.id === questionId)
    if (
      latestCycle?.id !== cycle.id ||
      latestRound?.id !== round.id ||
      latestQuestion?.response !== question.response ||
      latestQuestion.sourceHash !== question.sourceHash
    )
      throw new Error('O ciclo ou a resposta mudou durante a verificação. Os dados foram preservados; verifique novamente.')
    const checkedAt = this.now()
    const next = answerStudyPracticeQuestion(latest, questionId, question.response, { ...result, checkedAt }, checkedAt)
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
    const result = await this.evaluate({
      profile: 'tutor',
      question: studyQuestionText(question.source),
      studentAnswer: question.response,
      providedEvidence: evidence,
    })
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

  resume(cycleId: string): StudyCycleState {
    const next = resumeStudyCycle(this.store.read(), cycleId)
    this.store.write(next)
    return next
  }
}

function createStableNoteSuffix(text: string): string {
  let hash = 2166136261
  for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return (hash >>> 0).toString(36)
}
