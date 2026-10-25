import type { StudyQuestion } from './study-questions'

export type StudyCycleStage = 'diagnosis' | 'review-required' | 'retest-ready'
export type StudyAssessment = { kind: 'correct' | 'incorrect' | 'uncertain' | 'pending'; rationale: string; checkedAt: number }

/** Immutable copy of the bank record used by this cycle; its hash identifies the exact source version. */
export interface StudyCycleQuestion {
  id: string
  sourceHash: string
  source: StudyQuestion
  response: string
  providedExcerpt: string
  uncertain: boolean | null
  assessment: StudyAssessment | null
}

export interface StudyCycle {
  id: string
  topic: string
  stage: StudyCycleStage
  startedAt: number
  updatedAt: number
  questions: StudyCycleQuestion[]
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
  const gate = evaluateStudyGate(cycle)
  if (!gate.ready)
    throw new Error(
      gate.reason === 'incomplete'
        ? 'Responda todas as questões e marque sua incerteza.'
        : 'Há respostas em verificação; tente novamente quando houver evidência suficiente.',
    )
  return updateCycle(state, { ...cycle, stage: gate.nextStage, updatedAt: now })
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
