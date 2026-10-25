import type { StudyQuestion } from './study-questions'

export type StudyCycleStage = 'diagnosis' | 'review-required' | 'practice' | 'retest-ready' | 'retest' | 'completed'
export type StudyAssessment = { kind: 'correct' | 'incorrect' | 'uncertain' | 'pending'; rationale: string; checkedAt: number }

export interface StudyGapReview {
  cause: string
  nextStep: string
  sourceRefs: string[]
}

export interface StudyPracticeQuestion extends StudyCycleQuestion {
  gapQuestionIds: string[]
}

export interface StudyPracticeRound {
  id: string
  questions: StudyPracticeQuestion[]
  startedAt: number
}

export interface StudyCycleNote {
  id: string
  gapQuestionId: string
  sourceRef: string
  text: string
  savedAt: number
}

export interface StudyRetestAttempt {
  id: string
  questions: StudyCycleQuestion[]
  startedAt: number
}

/** Immutable copy of the bank record used by this cycle; its hash identifies the exact source version. */
export interface StudyCycleQuestion {
  id: string
  sourceHash: string
  source: StudyQuestion
  response: string
  providedExcerpt: string
  uncertain: boolean | null
  assessment: StudyAssessment | null
  review?: StudyGapReview
}

export interface StudyCycle {
  id: string
  topic: string
  stage: StudyCycleStage
  startedAt: number
  updatedAt: number
  questions: StudyCycleQuestion[]
  practiceRounds: StudyPracticeRound[]
  notes: StudyCycleNote[]
  retests: StudyRetestAttempt[]
}

export interface StudyCycleState {
  activeId: string | null
  cycles: StudyCycle[]
}

export type StudyGate =
  { ready: false; reason: 'incomplete' | 'verification-pending' } | { ready: true; nextStage: 'review-required' | 'retest-ready' }

export function createStudyCycleState(
  topic: string,
  questions: StudyCycleQuestion[],
  now = Date.now(),
  previous?: StudyCycleState,
): StudyCycleState {
  const cleanTopic = topic.trim()
  if (!cleanTopic || cleanTopic.length > 200) throw new Error('Informe um tópico de até 200 caracteres.')
  if (!questions.length || questions.length > 100) throw new Error('Selecione de 1 a 100 questões do banco local.')
  const ids = new Set<string>()
  for (const question of questions) {
    if (ids.has(question.id)) throw new Error('A seleção contém questões repetidas.')
    ids.add(question.id)
  }
  const cycle: StudyCycle = {
    id: `sc-${now}-${Math.random().toString(36).slice(2, 10)}`,
    topic: cleanTopic,
    stage: 'diagnosis',
    startedAt: now,
    updatedAt: now,
    questions: questions.map((question) => ({ ...question, source: { ...question.source, tags: [...question.source.tags] } })),
    practiceRounds: [],
    notes: [],
    retests: [],
  }
  return { activeId: cycle.id, cycles: [...(previous?.cycles ?? []), cycle] }
}

export function answerStudyQuestion(
  state: StudyCycleState,
  questionId: string,
  response: string,
  uncertain: boolean,
  now = Date.now(),
  providedExcerpt = '',
): StudyCycleState {
  const cycle = activeCycle(state)
  if (cycle.stage !== 'diagnosis') throw new Error('O diagnóstico deste ciclo já foi encerrado.')
  const clean = response.trim()
  if (!clean || clean.length > 20_000) throw new Error('Escreva uma resposta de até 20.000 caracteres.')
  if (providedExcerpt.length > 20_000) throw new Error('O trecho de apoio pode ter até 20.000 caracteres.')
  const target = cycle.questions.find((question) => question.id === questionId)
  if (!target) throw new Error('Essa questão não pertence ao ciclo ativo.')
  return updateCycle(state, {
    ...cycle,
    updatedAt: now,
    questions: cycle.questions.map((question) =>
      question.id === questionId
        ? { ...question, response: clean, providedExcerpt: providedExcerpt.trim(), uncertain, assessment: null }
        : question,
    ),
  })
}

export function assessStudyQuestion(
  state: StudyCycleState,
  questionId: string,
  result: Pick<StudyAssessment, 'kind' | 'rationale'>,
  now = Date.now(),
): StudyCycleState {
  const cycle = activeCycle(state)
  if (cycle.stage !== 'diagnosis') throw new Error('O diagnóstico deste ciclo já foi encerrado.')
  const target = cycle.questions.find((question) => question.id === questionId)
  if (!target || !target.response || target.uncertain === null) throw new Error('Responda e marque a incerteza antes de verificar.')
  const hasEvidence = (target.source.answerStatus === 'verified' && !!target.source.answer) || !!target.providedExcerpt.trim()
  const kind =
    result.kind === 'pending' || !hasEvidence || (result.kind === 'uncertain' && !target.uncertain)
      ? 'pending'
      : target.uncertain
        ? 'uncertain'
        : result.kind
  return updateCycle(state, {
    ...cycle,
    updatedAt: now,
    questions: cycle.questions.map((question) =>
      question.id === questionId
        ? { ...question, assessment: { kind, rationale: result.rationale.slice(0, 2000), checkedAt: now } }
        : question,
    ),
  })
}

/** Diagnostic gate: no grade threshold. Missing evidence remains pending and cannot be treated as a clean result. */
export function evaluateStudyGate(cycle: StudyCycle): StudyGate {
  if (cycle.questions.some((question) => !question.response || question.uncertain === null)) return { ready: false, reason: 'incomplete' }
  if (cycle.questions.some((question) => !question.assessment || question.assessment.kind === 'pending'))
    return { ready: false, reason: 'verification-pending' }
  const needsReview = cycle.questions.some(
    (question) => question.assessment?.kind === 'incorrect' || question.assessment?.kind === 'uncertain' || question.uncertain,
  )
  return { ready: true, nextStage: needsReview ? 'review-required' : 'retest-ready' }
}

/** Bonnie's gate is explicit: callers must ask to advance after the objective criteria pass. */
export function advanceStudyCycle(state: StudyCycleState, now = Date.now()): StudyCycleState {
  const cycle = activeCycle(state)
  if (cycle.stage === 'diagnosis') {
    const gate = evaluateStudyGate(cycle)
    if (!gate.ready)
      throw new Error(
        gate.reason === 'incomplete'
          ? 'Responda todas as questões e marque sua incerteza.'
          : 'Há respostas em verificação; tente novamente quando houver evidência suficiente.',
      )
    return updateCycle(state, { ...cycle, stage: gate.nextStage, updatedAt: now })
  }
  if (cycle.stage === 'review-required') {
    const gaps = studyGaps(cycle)
    if (!gaps.length) throw new Error('Não há erros ou dúvidas para revisar; Bonnie deve liberar o reteste diretamente.')
    if (gaps.some((question) => !question.review?.cause.trim() || !question.review.nextStep.trim()))
      throw new Error('Registre a causa e o próximo passo de cada erro ou dúvida antes de continuar.')
    if (gaps.some((question) => !question.review?.sourceRefs.length))
      throw new Error('Consulte e vincule ao menos uma fonte local a cada erro ou dúvida antes da prática.')
    return updateCycle(state, { ...cycle, stage: 'practice', updatedAt: now })
  }
  if (cycle.stage === 'practice') {
    const round = cycle.practiceRounds.at(-1)
    if (!round?.questions.length) throw new Error('Planeje ao menos uma questão de prática ligada a um erro ou dúvida.')
    if (
      round.questions.some(
        (question) =>
          !question.response || !question.assessment || question.assessment.kind === 'pending' || question.assessment.kind === 'uncertain',
      )
    )
      throw new Error('Conclua a verificação de todas as questões da prática antes de calcular o resultado.')
    if (!cycle.notes.length) throw new Error('Registre ao menos uma nota durante a consulta de uma fonte.')
    if (practiceScore(round) < 80) throw new Error('O resultado ficou abaixo de 80%. Revise os erros e planeje questões novas.')
    return updateCycle(state, { ...cycle, stage: 'retest-ready', updatedAt: now })
  }
  throw new Error('O diagnóstico deste ciclo já foi encerrado.')
}

export function studyGaps(cycle: StudyCycle): StudyCycleQuestion[] {
  return cycle.questions.filter(
    (question) => question.uncertain === true || question.assessment?.kind === 'incorrect' || question.assessment?.kind === 'uncertain',
  )
}

export function reviewStudyGap(
  state: StudyCycleState,
  questionId: string,
  cause: string,
  nextStep: string,
  now = Date.now(),
): StudyCycleState {
  const cycle = activeCycle(state)
  if (cycle.stage !== 'review-required') throw new Error('Bonnie ainda não liberou a revisão de erros e dúvidas.')
  const target = studyGaps(cycle).find((question) => question.id === questionId)
  const cleanCause = cause.trim()
  const cleanNextStep = nextStep.trim()
  if (!target) throw new Error('Essa questão não tem erro ou dúvida pendente de revisão.')
  if (!cleanCause || cleanCause.length > 2000 || !cleanNextStep || cleanNextStep.length > 2000)
    throw new Error('Informe uma causa e um próximo passo, cada um com até 2.000 caracteres.')
  return updateCycle(state, {
    ...cycle,
    updatedAt: now,
    questions: cycle.questions.map((question) =>
      question.id === questionId
        ? { ...question, review: { cause: cleanCause, nextStep: cleanNextStep, sourceRefs: question.review?.sourceRefs ?? [] } }
        : question,
    ),
  })
}

export function attachStudySource(state: StudyCycleState, questionId: string, sourceRef: string, now = Date.now()): StudyCycleState {
  const cycle = activeCycle(state)
  if (cycle.stage !== 'review-required' && cycle.stage !== 'practice') throw new Error('Fontes ficam disponíveis na revisão e na prática.')
  const target = studyGaps(cycle).find((question) => question.id === questionId)
  const ref = sourceRef.trim()
  if (!target || !target.review) throw new Error('Registre a causa e o próximo passo antes de vincular uma fonte.')
  if (!ref || ref.length > 1000 || /[\r\n\0]/.test(ref)) throw new Error('Referência de fonte inválida.')
  if (target.review.sourceRefs.includes(ref)) return state
  return updateCycle(state, {
    ...cycle,
    updatedAt: now,
    questions: cycle.questions.map((question) =>
      question.id === questionId
        ? { ...question, review: { ...question.review!, sourceRefs: [...question.review!.sourceRefs, ref] } }
        : question,
    ),
  })
}

export function recordStudyNote(state: StudyCycleState, note: StudyCycleNote, now = Date.now()): StudyCycleState {
  const cycle = activeCycle(state)
  if (cycle.stage !== 'review-required' && cycle.stage !== 'practice')
    throw new Error('Bonnie ainda não liberou o registro de nota da consulta.')
  const gap = studyGaps(cycle).find((question) => question.id === note.gapQuestionId)
  const id = note.id.trim()
  const sourceRef = note.sourceRef.trim()
  const text = note.text.trim()
  if (!gap?.review || !gap.review.sourceRefs.includes(sourceRef))
    throw new Error('Vincule a nota a uma fonte consultada para este erro ou dúvida.')
  if (!id || id.length > 100 || cycle.notes.some((item) => item.id === id)) throw new Error('Identificador de nota inválido ou repetido.')
  if (!text || text.length > 10_000) throw new Error('Escreva uma nota de até 10.000 caracteres.')
  if (!Number.isFinite(note.savedAt)) throw new Error('Data da nota inválida.')
  return updateCycle(state, { ...cycle, notes: [...cycle.notes, { ...note, id, sourceRef, text }], updatedAt: now })
}

export function startStudyPracticeRound(state: StudyCycleState, questions: StudyPracticeQuestion[], now = Date.now()): StudyCycleState {
  const cycle = activeCycle(state)
  if (cycle.stage !== 'practice') throw new Error('Bonnie ainda não liberou a prática.')
  if (!questions.length || questions.length > 100) throw new Error('Planeje ao menos uma questão de prática.')
  const gaps = new Set(studyGaps(cycle).map((question) => question.id))
  const sourcedGaps = new Set(
    studyGaps(cycle)
      .filter((question) => question.review?.sourceRefs.length)
      .map((question) => question.id),
  )
  const usedIds = new Set(cycle.questions.map((question) => question.id))
  for (const round of cycle.practiceRounds) for (const item of round.questions) usedIds.add(item.id)
  const roundIds = new Set<string>()
  for (const question of questions) {
    if (!question.gapQuestionIds.length || question.gapQuestionIds.some((id) => !gaps.has(id) || !sourcedGaps.has(id)))
      throw new Error('Vincule cada questão de prática a um erro ou dúvida identificado.')
    if (usedIds.has(question.id) || roundIds.has(question.id)) throw new Error('A prática precisa usar questões novas, sem repetição.')
    roundIds.add(question.id)
  }
  const last = cycle.practiceRounds.at(-1)
  if (last && roundComplete(last) && practiceScore(last) >= 80)
    throw new Error('Bonnie já pode liberar o reteste; conclua esta etapa antes de iniciar outra rodada.')
  const round: StudyPracticeRound = { id: `pr-${now}-${Math.random().toString(36).slice(2, 10)}`, questions, startedAt: now }
  return updateCycle(state, { ...cycle, practiceRounds: [...cycle.practiceRounds, round], updatedAt: now })
}

export function answerStudyPracticeQuestion(
  state: StudyCycleState,
  questionId: string,
  response: string,
  assessment: StudyAssessment,
  now = Date.now(),
): StudyCycleState {
  const cycle = activeCycle(state)
  if (cycle.stage !== 'practice') throw new Error('Bonnie ainda não liberou a prática.')
  const round = cycle.practiceRounds.at(-1)
  if (!round) throw new Error('Planeje uma rodada de prática antes de responder.')
  const clean = response.trim()
  if (!clean || clean.length > 20_000) throw new Error('Escreva uma resposta de até 20.000 caracteres.')
  if (assessment.kind === 'correct' && !round.questions.find((question) => question.id === questionId)?.source.answer)
    throw new Error('Uma questão sem gabarito não pode contar como acerto.')
  if (!round.questions.some((question) => question.id === questionId))
    throw new Error('Essa questão não pertence à rodada de prática atual.')
  const rounds = cycle.practiceRounds.map((item) =>
    item.id === round.id
      ? {
          ...item,
          questions: item.questions.map((question) =>
            question.id === questionId ? { ...question, response: clean, assessment: { ...assessment, checkedAt: now } } : question,
          ),
        }
      : item,
  )
  return updateCycle(state, { ...cycle, practiceRounds: rounds, updatedAt: now })
}

export function saveStudyPracticeResponse(state: StudyCycleState, questionId: string, response: string, now = Date.now()): StudyCycleState {
  const cycle = activeCycle(state)
  if (cycle.stage !== 'practice') throw new Error('Bonnie ainda não liberou a prática.')
  const round = cycle.practiceRounds.at(-1)
  if (!round) throw new Error('Planeje uma rodada de prática antes de responder.')
  const clean = response.trim()
  if (!clean || clean.length > 20_000) throw new Error('Escreva uma resposta de até 20.000 caracteres.')
  if (!round.questions.some((question) => question.id === questionId))
    throw new Error('Essa questão não pertence à rodada de prática atual.')
  const rounds = cycle.practiceRounds.map((item) =>
    item.id === round.id
      ? {
          ...item,
          questions: item.questions.map((question) =>
            question.id === questionId ? { ...question, response: clean, assessment: null } : question,
          ),
        }
      : item,
  )
  return updateCycle(state, { ...cycle, practiceRounds: rounds, updatedAt: now })
}

export function practiceScore(round: StudyPracticeRound): number {
  if (!round.questions.length || !roundComplete(round)) return 0
  const correct = round.questions.filter((question) => question.assessment?.kind === 'correct').length
  return Math.floor((correct / round.questions.length) * 100)
}

/** Creates a fresh retest from at least ten never-before-used questions with verified keys. */
export function startStudyRetest(state: StudyCycleState, questions: StudyCycleQuestion[], now = Date.now()): StudyCycleState {
  const cycle = activeCycle(state)
  if (cycle.stage !== 'retest-ready' && cycle.stage !== 'retest') throw new Error('Bonnie ainda não liberou o reteste.')
  if (questions.length < 10 || questions.length > 100) throw new Error('O reteste precisa conter pelo menos 10 questões novas.')
  const latest = cycle.retests.at(-1)
  if (latest && retestScore(latest) !== null && retestScore(latest)! >= 80)
    throw new Error('O reteste já atingiu 80%; peça a confirmação da estudante para concluir o ciclo.')
  if (latest && latest.questions.some((question) => !question.response || !question.assessment))
    throw new Error('Responda e verifique todas as questões do reteste atual antes de planejar outro conjunto.')
  const usedIds = new Set(cycle.questions.map((question) => question.id))
  const usedPrompts = new Set(cycle.questions.map((question) => normalizePrompt(question.source.question)))
  for (const round of cycle.practiceRounds) {
    for (const question of round.questions) {
      usedIds.add(question.id)
      usedPrompts.add(normalizePrompt(question.source.question))
    }
  }
  for (const attempt of cycle.retests) {
    for (const question of attempt.questions) {
      usedIds.add(question.id)
      usedPrompts.add(normalizePrompt(question.source.question))
    }
  }
  const ids = new Set<string>()
  const prompts = new Set<string>()
  for (const question of questions) {
    const prompt = normalizePrompt(question.source.question)
    if (question.source.sourceOnly || question.source.answerStatus !== 'verified' || !question.source.answer)
      throw new Error('O reteste aceita somente questões com gabarito conferido.')
    if (usedIds.has(question.id) || ids.has(question.id) || usedPrompts.has(prompt) || prompts.has(prompt))
      throw new Error('O reteste precisa conter questões novas e sem repetição.')
    ids.add(question.id)
    prompts.add(prompt)
  }
  const attempt: StudyRetestAttempt = {
    id: `rt-${now}-${Math.random().toString(36).slice(2, 10)}`,
    startedAt: now,
    questions: questions.map((question) => ({
      ...question,
      source: { ...question.source, tags: [...question.source.tags] },
      response: '',
      providedExcerpt: '',
      uncertain: false,
      assessment: null,
    })),
  }
  return updateCycle(state, { ...cycle, stage: 'retest', retests: [...cycle.retests, attempt], updatedAt: now })
}

export function answerStudyRetestQuestion(state: StudyCycleState, questionId: string, response: string, now = Date.now()): StudyCycleState {
  const cycle = activeCycle(state)
  if (cycle.stage !== 'retest') throw new Error('Bonnie ainda não liberou o reteste.')
  const attempt = cycle.retests.at(-1)
  const clean = response.trim()
  if (!clean || clean.length > 20_000) throw new Error('Escreva uma resposta de até 20.000 caracteres.')
  if (!attempt?.questions.some((question) => question.id === questionId)) throw new Error('Essa questão não pertence ao reteste atual.')
  return updateCycle(state, {
    ...cycle,
    updatedAt: now,
    retests: cycle.retests.map((item) =>
      item.id === attempt.id
        ? {
            ...item,
            questions: item.questions.map((question) =>
              question.id === questionId ? { ...question, response: clean, assessment: null } : question,
            ),
          }
        : item,
    ),
  })
}

export function assessStudyRetestQuestion(
  state: StudyCycleState,
  questionId: string,
  result: Pick<StudyAssessment, 'kind' | 'rationale'>,
  now = Date.now(),
): StudyCycleState {
  const cycle = activeCycle(state)
  if (cycle.stage !== 'retest') throw new Error('Bonnie ainda não liberou o reteste.')
  const attempt = cycle.retests.at(-1)
  const target = attempt?.questions.find((question) => question.id === questionId)
  if (!attempt || !target?.response) throw new Error('Responda a questão antes de verificar o reteste.')
  return updateCycle(state, {
    ...cycle,
    updatedAt: now,
    retests: cycle.retests.map((item) =>
      item.id === attempt.id
        ? {
            ...item,
            questions: item.questions.map((question) =>
              question.id === questionId
                ? { ...question, assessment: { ...result, rationale: result.rationale.slice(0, 2000), checkedAt: now } }
                : question,
            ),
          }
        : item,
    ),
  })
}

/** Returns null until every retest answer has an evidence-backed correct/incorrect assessment. */
export function retestScore(attempt: StudyRetestAttempt): number | null {
  if (
    attempt.questions.length < 10 ||
    attempt.questions.some(
      (question) => !question.response || !question.assessment || !['correct', 'incorrect'].includes(question.assessment.kind),
    )
  )
    return null
  const correct = attempt.questions.filter((question) => question.assessment?.kind === 'correct').length
  return Math.floor((correct / attempt.questions.length) * 100)
}

/** Completion is separate from scoring: the student must confirm the result explicitly. */
export function completeStudyCycle(state: StudyCycleState, confirmed: boolean, now = Date.now()): StudyCycleState {
  const cycle = activeCycle(state)
  if (cycle.stage !== 'retest') throw new Error('O ciclo só pode ser concluído após o reteste.')
  const score = cycle.retests.at(-1) ? retestScore(cycle.retests.at(-1)!) : null
  if (score === null || score < 80) throw new Error('O reteste precisa de pelo menos 10 questões verificadas e 80% de acertos.')
  if (!confirmed) return state
  return updateCycle(state, { ...cycle, stage: 'completed', updatedAt: now })
}

function roundComplete(round: StudyPracticeRound): boolean {
  return (
    round.questions.length > 0 &&
    round.questions.every(
      (question) =>
        !!question.response && !!question.assessment && question.assessment.kind !== 'pending' && question.assessment.kind !== 'uncertain',
    )
  )
}

function normalizePrompt(prompt: string): string {
  return prompt.toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ').trim()
}

export function activeStudyCycle(state: StudyCycleState): StudyCycle | null {
  return state.cycles.find((cycle) => cycle.id === state.activeId) ?? null
}

/** Unpins the current cycle without deleting its evidence, so topic changes remain reversible. */
export function resetActiveStudyCycle(state: StudyCycleState): StudyCycleState {
  return { ...state, activeId: null }
}

export const emptyStudyCycleState = (): StudyCycleState => ({ activeId: null, cycles: [] })

function activeCycle(state: StudyCycleState): StudyCycle {
  const cycle = activeStudyCycle(state)
  if (!cycle) throw new Error('Não há ciclo de estudo ativo.')
  return cycle
}

function updateCycle(state: StudyCycleState, updated: StudyCycle): StudyCycleState {
  return { ...state, cycles: state.cycles.map((cycle) => (cycle.id === updated.id ? updated : cycle)) }
}
