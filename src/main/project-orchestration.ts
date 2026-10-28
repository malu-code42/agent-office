import { randomUUID } from 'node:crypto'
import { MAX_REVIEW_ROUNDS, newApprovalGate } from '@shared/types/project-orchestration'
import type {
  ApprovalGate,
  AgentEngine,
  GrillArtifact,
  GrillDecision,
  OrchestrationErrorCode,
  ProjectArtifact,
  RedistributionChange,
  SquadProposalMember,
  SpecArtifact,
  TicketsArtifact,
} from '@shared/types'
import type { Actor } from '@shared/types/tickets'

const now = () => Date.now()

export class ProjectOrchestrationError extends Error {
  readonly code: OrchestrationErrorCode
  constructor(code: OrchestrationErrorCode, message: string) {
    super(message)
    this.name = 'ProjectOrchestrationError'
    this.code = code
  }
}

function requireApproved(artifact: ProjectArtifact, what: string): void {
  if (!artifact.gate.approved) {
    throw new ProjectOrchestrationError(
      'NOT_APPROVED',
      `${what} ainda não foi aprovado. Aprove o artefato anterior antes de continuar.`,
    )
  }
}

/** Cria o rascunho do grill. Nada é aprovado ainda. */
export function createGrill(projectId: string, goal: string): GrillArtifact {
  const created = now()
  return {
    id: `grill-${randomUUID().slice(0, 8)}`,
    projectId,
    kind: 'grill',
    goal: goal.trim(),
    decisions: [],
    gate: newApprovalGate(),
    createdAt: created,
    updatedAt: created,
  }
}

/** Registra uma decisão esclarecida no grill. */
export function recordGrillDecision(
  grill: GrillArtifact,
  decision: Pick<GrillDecision, 'question' | 'answer' | 'decidedBy'>,
): void {
  if (!decision.question || !decision.answer || !decision.decidedBy) {
    throw new Error('Informe a pergunta, a resposta e quem decidiu.')
  }
  grill.decisions.push({
    id: `dec-${randomUUID().slice(0, 8)}`,
    question: decision.question.trim(),
    answer: decision.answer.trim(),
    decidedBy: decision.decidedBy,
    decidedAt: now(),
  })
  grill.updatedAt = now()
}

/** Submete o artefato a uma revisão. Achados não vazios bloqueiam a aprovação. */
export function submitForReview(artifact: ProjectArtifact, findings: string[]): void {
  const next = artifact.gate.reviewRounds + 1
  if (next > MAX_REVIEW_ROUNDS) {
    throw new ProjectOrchestrationError(
      'REVIEW_LIMIT',
      `O artefato já passou por ${MAX_REVIEW_ROUNDS} revisões. Pare para decisão humana; não aprove nem distribua automaticamente.`,
    )
  }
  artifact.gate.reviewRounds = next
  artifact.gate.findings = [...findings]
  artifact.gate.approved = false
  artifact.updatedAt = now()
}

/** Limpa os achados após correções, deixando o artefato apto a ser aprovado. */
export function resolveFindings(artifact: ProjectArtifact): void {
  artifact.gate.findings = []
  artifact.updatedAt = now()
}

/** Aprovação humana do artefato. Recusa achados abertos e excede do limite de revisões. */
export function approveArtifact(artifact: ProjectArtifact, by: Actor): void {
  if (artifact.gate.findings.length > 0) {
    throw new ProjectOrchestrationError('NOT_APPROVED', 'Há achados abertos na revisão. Resolva-os antes de aprovar.')
  }
  if (artifact.gate.reviewRounds > MAX_REVIEW_ROUNDS) {
    throw new ProjectOrchestrationError('REVIEW_LIMIT', 'Limite de revisões atingido. Pare para decisão humana antes de aprovar.')
  }
  artifact.gate.approved = true
  artifact.gate.approvedAt = now()
  artifact.gate.approvedBy = by.name
  artifact.updatedAt = now()
}

/** Constrói o spec a partir de um grill já aprovado. */
export function buildSpec(grill: GrillArtifact): SpecArtifact {
  requireApproved(grill, 'O grill')
  const created = now()
  return {
    id: `spec-${randomUUID().slice(0, 8)}`,
    projectId: grill.projectId,
    kind: 'spec',
    grillId: grill.id,
    goal: grill.goal,
    criteria: grill.decisions.map((decision) => decision.answer).filter((text) => text.length > 0),
    scope: '',
    gate: newApprovalGate(),
    createdAt: created,
    updatedAt: created,
  }
}

/** Constrói os tickets a partir de um spec já aprovado. */
export function buildTickets(spec: SpecArtifact): TicketsArtifact {
  requireApproved(spec, 'O spec')
  const created = now()
  return {
    id: `tickets-${randomUUID().slice(0, 8)}`,
    projectId: spec.projectId,
    kind: 'tickets',
    specId: spec.id,
    goal: spec.goal,
    criteria: [...spec.criteria],
    tickets: [],
    gate: newApprovalGate(),
    createdAt: created,
    updatedAt: created,
  }
}

/** Exige tickets aprovados antes de qualquer distribuição; só trabalho aprovado forma squads. */
export function assertCanDistribute(tickets: TicketsArtifact): void {
  if (!tickets.gate.approved) {
    throw new ProjectOrchestrationError(
      'NOT_APPROVED',
      'Os tickets precisam ser aprovados antes da distribuição. Só trabalho aprovado forma squads.',
    )
  }
}

export function canFormSquad(tickets: TicketsArtifact): boolean {
  return tickets.gate.approved
}

/**
 * Redistribui subtarefas entre squads. Objetivo e critérios aprovados são
 * invariantes: esta operação não os altera.
 */
export function redistribute(tickets: TicketsArtifact, changes: RedistributionChange[]): void {
  assertCanDistribute(tickets)
  const known = new Set(tickets.tickets)
  const changed = new Set<string>()
  for (const change of changes) {
    if (!known.has(change.ticketId)) {
      throw new ProjectOrchestrationError('INVALID_ARTIFACT', `O ticket ${change.ticketId} não pertence a estes tickets aprovados.`)
    }
    if (changed.has(change.ticketId)) {
      throw new ProjectOrchestrationError('INVALID_ARTIFACT', `O ticket ${change.ticketId} aparece mais de uma vez na redistribuição.`)
    }
    const current = tickets.assignments?.[change.ticketId] ?? null
    if (current !== change.fromSquad) {
      throw new ProjectOrchestrationError('INVALID_ARTIFACT', `A atribuição do ticket ${change.ticketId} mudou; atualize e tente novamente.`)
    }
    changed.add(change.ticketId)
  }
  tickets.assignments ??= {}
  for (const change of changes) tickets.assignments[change.ticketId] = change.toSquad
  tickets.updatedAt = now()
}

/** O código exige implementador e revisor independentes; o revisor apenas avalia e aponta achados. */
export function assertIndependentReviewer(members: SquadProposalMember[]): void {
  const roles = new Map<string, string>()
  for (const member of members) {
    if (member.role) {
      if (roles.has(member.role)) {
        throw new ProjectOrchestrationError('NO_REVIEWER', `Mais de um membro está definido como ${member.role}.`)
      }
      roles.set(member.role, member.id)
    }
  }
  const implementer = roles.get('implementer')
  const reviewer = roles.get('reviewer')
  if (!reviewer) {
    throw new ProjectOrchestrationError(
      'NO_REVIEWER',
      'Defina um revisor independente. O revisor avalia e aponta achados; não implementa nem aprova o próprio trabalho.',
    )
  }
  if (implementer && reviewer === implementer) {
    throw new ProjectOrchestrationError('NO_REVIEWER', 'O revisor deve ser independente do implementador.')
  }
}

/** Claude é o único motor ativo; OpenCode é histórico somente leitura. */
export function assertClaudeOnly(engine: AgentEngine): void {
  if (engine !== 'claude') {
    throw new ProjectOrchestrationError(
      'NOT_CLAUDE',
      'O Agent Office roda somente com Claude. OpenCode é apenas histórico de leitura e não executa tarefas.',
    )
  }
}

/** Tipagem de ajuda para o portão de aprovação, exposta para testes. */
export type { ApprovalGate }
