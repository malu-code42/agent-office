// ---------- project orchestration (ticket #58) ----------
// Emi conduz o fluxo do Elephant-Goldfish Model: brainstorm → rascunho do design →
// Revisão Goldfish → tickets. Cada artefato é aprovado pela usuária antes do próximo,
// e só trabalho aprovado forma squads.

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

/** Uma decisão esclarecida no brainstorm: pergunta + resposta registrada. */
export interface BrainstormDecision {
  id: string
  question: string
  answer: string
  decidedBy: string
  decidedAt: number
}

/** Brainstorm do EGM: o conceito esclarecido com a usuária, que vira o concepts_brief.md. */
export interface BrainstormArtifact {
  id: string
  projectId: string
  kind: 'brainstorm'
  goal: string
  decisions: BrainstormDecision[]
  gate: ApprovalGate
  createdAt: number
  updatedAt: number
}

/** Rascunho do design do EGM: o design doc em docs/designs/, construído do brainstorm aprovado. */
export interface DesignArtifact {
  id: string
  projectId: string
  kind: 'design'
  /** O brainstorm aprovado do qual este design é construído. */
  brainstormId: string
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
  /** O design doc aprovado (e revisado) do qual estes tickets são construídos. */
  designId: string
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

/** Bootstrap do EGM (READMEs + docs/designs/SITEMAP.md): opcional, uma vez por projeto. */
export type BootstrapStatus = 'pending' | 'done' | 'skipped'

/**
 * Fluxo do andar de projeto no Elephant-Goldfish Model (EGM): bootstrap → brainstorm →
 * rascunho do design → Revisão Goldfish → tickets → squads, com relatório de drift sob demanda.
 * Cada aprovação humana destrava só a etapa seguinte.
 */
export interface ProjectWorkflow {
  projectId: string
  goal: string
  /** Bootstrap do contexto do código; opcional e não bloqueia as etapas. */
  bootstrap: BootstrapStatus
  bootstrapAt: number | null
  /** O concepts brief (concepts_brief.md) ou seu resumo. */
  brainstorm: string
  brainstormApprovedAt: number | null
  /** O design doc (ou seu resumo), com o plano de implementação. */
  design: string
  /** Caminho relativo do design doc no projeto, em docs/designs/; vazio quando não há arquivo. */
  designPath: string
  criteria: string[]
  designApprovedAt: number | null
  /** Resultado da Revisão Goldfish: os achados que a usuária escolheu tratar e como foram resolvidos. */
  review: string
  reviewApprovedAt: number | null
  ticketIds: string[]
  /** Claude's unapproved ticket breakdown; converted to board tickets only on approval. */
  ticketDrafts?: Array<{ title: string; description: string; acceptance: string[] }>
  ticketsApprovedAt: number | null
  assignments: Record<string, string | null>
  redistributionProposal?: { changes: RedistributionChange[]; proposedAt: number; approvedAt: number | null }
  /** Último relatório de drift (design docs × código); sob demanda, sugerido semanalmente. */
  driftReport?: { summary: string; at: number }
  updatedAt: number
}

export type ProjectArtifact = BrainstormArtifact | DesignArtifact | TicketsArtifact

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
