/**
 * AO-101: state of a card with several questions in sequence (AskUserQuestion takes up to 4):
 * which question is open, the partial answers and the review screen. Pure and immutable:
 * every function returns a new state (or the same object when the move is not allowed).
 */
export interface FlowQuestion {
  question: string
  multiSelect: boolean
}

export interface FlowAnswer {
  chosen: string[]
  other: string
}

export interface FlowState {
  multi: boolean[]
  index: number
  answers: FlowAnswer[]
  reviewing: boolean
  /** Came from "Editar" in the review: after answering, go straight back to it. */
  fromReview: boolean
}

export function createFlow(questions: FlowQuestion[]): FlowState {
  return {
    multi: questions.map((q) => q.multiSelect),
    index: 0,
    answers: questions.map(() => ({ chosen: [], other: '' })),
    reviewing: false,
    fromReview: false,
  }
}

export function isAnswered(f: FlowState, i: number): boolean {
  const a = f.answers[i]
  return !!a && (a.chosen.length > 0 || a.other.trim() !== '')
}

export function answeredCount(f: FlowState): number {
  return f.answers.filter((_, i) => isAnswered(f, i)).length
}

/** Only with every question answered (and at least one question). */
export function canSubmit(f: FlowState): boolean {
  return f.answers.length > 0 && answeredCount(f) === f.answers.length
}

function withAnswer(f: FlowState, i: number, a: FlowAnswer): FlowState {
  return { ...f, answers: f.answers.map((x, j) => (j === i ? a : x)) }
}

/** Picks an option. Single choice replaces the mark (and clears "Outra resposta"); multiple choice toggles it. */
export function toggleOption(f: FlowState, i: number, label: string): FlowState {
  const a = f.answers[i]
  if (!a) return f
  if (f.multi[i]) {
    const chosen = a.chosen.includes(label) ? a.chosen.filter((c) => c !== label) : [...a.chosen, label]
    return withAnswer(f, i, { ...a, chosen })
  }
  return withAnswer(f, i, { chosen: [label], other: '' })
}

/** Typing in "Outra resposta" unmarks the option of a single choice; multiple choice keeps its marks. */
export function setOther(f: FlowState, i: number, text: string): FlowState {
  const a = f.answers[i]
  if (!a) return f
  return withAnswer(f, i, { chosen: !f.multi[i] && text ? [] : a.chosen, other: text })
}

/** Próxima: blocked while the open question has no answer. After the last one, opens the review. */
export function goNext(f: FlowState): FlowState {
  if (f.reviewing || !isAnswered(f, f.index)) return f
  if (f.fromReview || f.index >= f.answers.length - 1) return { ...f, reviewing: true, fromReview: false }
  return { ...f, index: f.index + 1 }
}

/** Voltar: from the review to the last question; from a question to the previous one (or back to the review it came from). */
export function goBack(f: FlowState): FlowState {
  if (f.reviewing) return { ...f, reviewing: false, index: f.answers.length - 1 }
  if (f.fromReview) return { ...f, reviewing: true, fromReview: false }
  if (f.index <= 0) return f
  return { ...f, index: f.index - 1 }
}

/** Click on a step of the list: opens that question from anywhere (also from the review, which then comes back to it). */
export function jump(f: FlowState, i: number): FlowState {
  if (i < 0 || i >= f.answers.length) return f
  if (!f.reviewing && i === f.index) return f
  return { ...f, reviewing: false, index: i, fromReview: f.reviewing || f.fromReview }
}

/** "Editar" in the review. */
export function edit(f: FlowState, i: number): FlowState {
  if (i < 0 || i >= f.answers.length) return f
  return { ...f, reviewing: false, fromReview: true, index: i }
}

/** The text of one answer, as the agent has always received it: marks in order, then "Outra resposta", joined by ", ". */
export function answerText(f: FlowState, i: number): string {
  const a = f.answers[i]
  if (!a) return ''
  const extra = a.other.trim()
  return [...a.chosen, ...(extra ? [extra] : [])].join(', ')
}

/** question text -> answer text, the same contract as before; null while any question is unanswered. */
export function buildAnswers(questions: FlowQuestion[], f: FlowState): Record<string, string> | null {
  if (!canSubmit(f)) return null
  const result: Record<string, string> = {}
  questions.forEach((q, i) => (result[q.question] = answerText(f, i)))
  return result
}

/** Footer of a sequence: "1 respondida · 3 faltam". */
export function progressText(f: FlowState): string {
  const total = f.answers.length
  const done = answeredCount(f)
  const left = total - done
  return `${done} respondida${done === 1 ? '' : 's'} · ${left} ${left === 1 ? 'falta' : 'faltam'}`
}

/** Header counter of a sequence: "2 de 4"; the review is "4 de 4". Empty for a single question. */
export function positionText(f: FlowState): string {
  const total = f.answers.length
  if (total < 2) return ''
  return `${f.reviewing ? total : f.index + 1} de ${total}`
}

/** Spoken state of a step of the list. */
export function stepState(f: FlowState, i: number): 'pergunta atual' | 'respondida' | 'ainda sem resposta' {
  if (!f.reviewing && i === f.index) return 'pergunta atual'
  return isAnswered(f, i) ? 'respondida' : 'ainda sem resposta'
}

/** Help text of the footer of a single question. */
export function helpText(multiSelect: boolean): string {
  return multiSelect ? 'Escolha uma ou mais respostas, ou escreva a sua.' : 'Escolha uma resposta ou escreva a sua.'
}

/** The question line of the review: a multiple choice says how many marks it has ("marcou 2"). */
export function reviewQuestion(q: FlowQuestion, f: FlowState, i: number): string {
  const n = f.answers[i]?.chosen.length ?? 0
  return q.multiSelect && n > 1 ? `${q.question} (marcou ${n})` : q.question
}

/** The answer line of the review: parts separated by " · " (the agent still gets answerText). */
export function reviewAnswer(f: FlowState, i: number): string {
  const a = f.answers[i]
  if (!a) return ''
  const extra = a.other.trim()
  return [...a.chosen, ...(extra ? [extra] : [])].join(' · ')
}
