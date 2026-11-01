// The automatic question bank: the questions are written from the discipline's books and checked by a
// chain of agents (author, quote check, similarity, blind solver, verifier). No one reviews them by hand.

export const STUDY_BANK_DEFAULT_PER_TOPIC = 20
export const STUDY_BANK_MAX_PER_TOPIC = 50

/** One step of the agent chain, in order. */
export type StudyBankStep = 'author' | 'quote' | 'similar' | 'solver' | 'verifier'
export const STUDY_BANK_STEPS: readonly StudyBankStep[] = ['author', 'quote', 'similar', 'solver', 'verifier']
export const STUDY_BANK_STEP_LABEL: Record<StudyBankStep, string> = {
  author: 'autor',
  quote: 'citação',
  similar: 'semelhança',
  solver: 'resolvedor cego',
  verifier: 'verificador',
}

/** Why a topic ended below its goal. */
export type StudyBankReason = 'no-book' | 'no-passage' | 'little' | 'similar' | 'refused' | 'complete'

export const STUDY_BANK_REASON: Record<StudyBankReason, { chip: string; text: string }> = {
  'no-book': { chip: 'Sem livro local', text: 'Sem livro local para esta disciplina: indique um livro.' },
  'no-passage': { chip: 'Nenhum trecho', text: 'Nenhum trecho dos livros cita o tópico.' },
  little: { chip: 'Pouco material', text: 'O livro tem pouco material sobre o tópico.' },
  similar: { chip: 'Parecidas demais', text: 'As questões novas saíram parecidas demais com as que já existem.' },
  refused: { chip: 'Verificador recusou', text: 'O verificador recusou as questões: a resposta não estava clara no livro.' },
  complete: { chip: 'Já tem questões', text: 'Já tinha questões novas suficientes; não foi mexido.' },
}

export interface StudyBankTopicResult {
  /** Trail id, e.g. P2-ED-05 (null when the trail item has none). */
  id: string | null
  topic: string
  discipline: string
  /** Discipline id, e.g. P2-ED. */
  disciplineId: string
  goal: number
  /** Questions not yet answered that the topic already had. */
  had: number
  added: number
  reason?: StudyBankReason
  /** For 'no-book': the folder where a book for the discipline goes. */
  folder?: string
}

/** Why the whole run stopped early. */
export type StudyBankStop = 'cancelled' | 'unavailable' | 'full' | 'changed' | 'interrupted' | 'error'

export interface StudyBankJob {
  status: 'running' | 'done' | 'stopped'
  /** Discipline id (P2-ED) or undefined for all; topic label or undefined for all its topics. */
  discipline?: string
  topic?: string
  perTopic: number
  /** Topics in this run and how many are done. */
  total: number
  done: number
  current?: { topic: string; discipline: string; made: number; goal: number; step?: StudyBankStep; source?: string }
  added: number
  results: StudyBankTopicResult[]
  stop?: StudyBankStop
  /** Plain message for the stop (e.g. the Claude error). */
  message?: string
  startedAt: number
  updatedAt: number
}

export interface StudyBankRequest {
  discipline?: string
  topic?: string
  perTopic?: number
}

/** The discipline id of a trail item id: P2-ED-05 → P2-ED. */
export const disciplineIdOf = (topicId: string | null | undefined): string => topicId?.replace(/-\d+$/, '') ?? ''

/** What marks a question written and checked by the agent chain (never reviewed by hand). */
export const STUDY_AGENT_ATTRIBUTION =
  'Questão elaborada por IA a partir da fonte e conferida por agentes (autor, resolvedor cego e verificador)'
export const STUDY_AGENT_LICENSE = 'Elaborada a partir da fonte — sem revisão humana'

export const isAgentVerified = (q: { attribution: string; answerStatus: string }): boolean =>
  q.answerStatus === 'verified' && q.attribution === STUDY_AGENT_ATTRIBUTION

const QUOTE = /\s*Trecho da fonte: «([\s\S]+)»\s*$/

/** The rationale without the quoted passage, and the passage (agent questions keep it at the end of the rationale). */
export function splitStudyRationale(rationale: string | undefined): { rationale: string; quote?: string } {
  if (!rationale) return { rationale: '' }
  const match = QUOTE.exec(rationale)
  return match ? { rationale: rationale.slice(0, match.index).trim(), quote: match[1]!.trim() } : { rationale }
}

const BOOKS = 'study sources/textbooks/'
const COURSE = 'study sources/course materials/'

/** Where each discipline of the trail (by its id) reads from: vault folders under the study sources. */
export const DISCIPLINE_SOURCES: Record<string, readonly string[]> = {
  'P1-ICC': [`${BOOKS}Introdução à Ciência da Computação/`],
  'P1-IP': [`${BOOKS}Algoritmos/`, `${BOOKS}Fundamentos de Programação/`],
  'P1-LMD': [`${BOOKS}Lógica e Matemática Discreta/`],
  'P1-MB': [`${BOOKS}Matemática/`],
  'P2-HW': [`${BOOKS}Eletrônica/`, `${BOOKS}Física/`, `${BOOKS}Organização de Computadores/`, `${COURSE}Hardware I/`],
  'P2-ED': [`${BOOKS}Estruturas de Dados/`, `${COURSE}Estrutura de Dados/`],
  'P2-POO': [`${BOOKS}Programação Orientada a Objetos/`],
  'P2-CC': [`${BOOKS}Matemática/`],
}

/**
 * The folders a discipline's questions come from. A discipline with no folder of its own (e.g.
 * Metodologia Científica) reads `study sources/textbooks/<discipline name>/`: putting a book there is
 * how the user indicates one.
 */
export function studyBankFolders(disciplineId: string, disciplineName: string): { folders: readonly string[]; fallback: boolean } {
  const own = DISCIPLINE_SOURCES[disciplineId]
  if (own?.length) return { folders: own, fallback: false }
  return { folders: [`${BOOKS}${disciplineName.replace(/[\\/]/g, ' ').trim()}/`], fallback: true }
}
