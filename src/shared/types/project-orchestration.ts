// ---------- project orchestration (ticket #58) ----------
// Emi conduz o fluxo grill-with-docs → to-spec → to-tickets. Cada artefato é
// aprovado pela usuária antes do próximo, e só trabalho aprovado forma squads.

/**
 * Máximo de rodadas de revisão por artefato: a revisão inicial mais uma
 * re-revisão após correções. Ainda com achados após isso, pausa para decisão
 * humana; nunca aprova nem distribui automaticamente.
 */
export const MAX_REVIEW_ROUNDS = 2

/** O portão de aprovação de um artefato. Nada é distribuído antes de abrir. */
export interface ApprovalGate {
  /** O artefato foi aprovado. */
  approved: boolean
  /** Quando foi aprovado. */
  approvedAt: number | null
  /** Quem aprovou. */
  approvedBy: string | null
  /** Quantas revisões passou (no máximo MAX_REVIEW_ROUNDS). */
  reviewRounds: number
  /** Achados abertos da última revisão; não vazios bloqueiam aprovação e distribuição. */
  findings: string[]
}

export function newApprovalGate(): ApprovalGate {
  return { approved: false, approvedAt: null, approvedBy: null, reviewRounds: 0, findings: [] }
}

/** Uma decisão esclarecida no grill: pergunta + resposta registrada. */
export interface GrillDecision {
  id: string
  question: string
  answer: string
  decidedBy: string
  decidedAt: number
}

export interface GrillArtifact {
  id: string
  projectId: string
  kind: 'grill'
  goal: string
  decisions: GrillDecision[]
  gate: ApprovalGate
  createdAt: number
  updatedAt: number
}

export interface SpecArtifact {
  id: string
  projectId: string
  kind: 'spec'
  /** O grill aprovado do qual este spec é construído. */
  grillId: string
  goal: string
  criteria: string[]
  scope: string
  gate: ApprovalGate
  createdAt: number
  updatedAt: number
}

export interface TicketsArtifact {
  id: string
  projectId: string
  kind: 'tickets'
  /** O spec aprovado do qual estes tickets são construídos. */
  specId: string
  goal: string
  criteria: string[]
  /** Um ticket por linha, na ordem do quadro. */
  tickets: string[]
  /** Atribuição atual das subtarefas aprovadas, por ID de ticket. */
  assignments?: Record<string, string | null>
  gate: ApprovalGate
  createdAt: number
  updatedAt: number
}

/** Uma redistribuição move um subtarefa entre squads; nunca muda objetivo nem critérios aprovados. */
export interface RedistributionChange {
  ticketId: string
  fromSquad: string | null
  toSquad: string | null
}

/** User-authored project floor workflow. Each approval unlocks only the next stage. */
export interface ProjectWorkflow {
  projectId: string
  goal: string
  grill: string
  grillApprovedAt: number | null
  spec: string
  criteria: string[]
  specApprovedAt: number | null
  ticketIds: string[]
  /** Claude's unapproved ticket breakdown; converted to board tickets only on approval. */
  ticketDrafts?: Array<{ title: string; description: string; acceptance: string[] }>
  ticketsApprovedAt: number | null
  assignments: Record<string, string | null>
  redistributionProposal?: { changes: RedistributionChange[]; proposedAt: number; approvedAt: number | null }
  updatedAt: number
}

export type ProjectArtifact = GrillArtifact | SpecArtifact | TicketsArtifact

/** Códigos dos erros de portão de orquestração. */
export type OrchestrationErrorCode =
  | 'NOT_APPROVED'
  | 'PREVIOUS_NOT_APPROVED'
  | 'REVIEW_LIMIT'
  | 'GOAL_CHANGED'
  | 'CRITERIA_CHANGED'
  | 'NOT_CLAUDE'
  | 'NO_REVIEWER'
  | 'INVALID_ARTIFACT'

export interface ProjectOrchestrationError extends Error {
  code: OrchestrationErrorCode
}
