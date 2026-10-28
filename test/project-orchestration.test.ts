import { describe, expect, it } from 'vitest'
import type { Actor, SquadProposalMember } from '@shared/types'
import type { AgentEngine } from '@shared/types/agents'
import type { ProjectOrchestrationError } from '@shared/types/project-orchestration'
import {
  ProjectOrchestrationError as ProjectOrchestrationErrorClass,
  approveArtifact,
  assertCanDistribute,
  assertClaudeOnly,
  assertIndependentReviewer,
  buildSpec,
  buildTickets,
  canFormSquad,
  createGrill,
  recordGrillDecision,
  redistribute,
  resolveFindings,
  submitForReview,
} from '../src/main/project-orchestration'

const player: Actor = { kind: 'player', name: 'Malu' }

const team = (): SquadProposalMember[] => [
  { id: 'maya', name: 'Maya', role: 'implementer', engine: 'claude', model: 'opus', account: '', focus: 'Implementa' },
  { id: 'caio', name: 'Caio', role: 'reviewer', engine: 'claude', model: '', account: '', focus: 'Revisa' },
]

const isOrchestrationError = (err: unknown): err is ProjectOrchestrationError =>
  err instanceof ProjectOrchestrationErrorClass && typeof (err as ProjectOrchestrationError).code === 'string'

describe('project orchestration — grill → spec → tickets (ticket #58)', () => {
  it('cria o grill como rascunho não aprovado', () => {
    const grill = createGrill('p1', 'Reestruturar a busca da loja')
    expect(grill.kind).toBe('grill')
    expect(grill.goal).toBe('Reestruturar a busca da loja')
    expect(grill.gate.approved).toBe(false)
    expect(grill.decisions).toEqual([])
  })

  it('registra decisões esclarecidas no grill', () => {
    const grill = createGrill('p1', 'Busca da loja')
    recordGrillDecision(grill, {
      question: 'Qual o escopo da primeira entrega?',
      answer: 'Busca por produto com filtro de categoria.',
      decidedBy: 'Malu',
    })
    expect(grill.decisions).toHaveLength(1)
    expect(grill.decisions[0]!.answer).toBe('Busca por produto com filtro de categoria.')
    expect(grill.decisions[0]!.decidedBy).toBe('Malu')
    expect(grill.decisions[0]!.id).toMatch(/^dec-/)
    expect(grill.decisions[0]!.decidedAt).toBeGreaterThanOrEqual(grill.createdAt)
    expect(grill.updatedAt).toBeGreaterThanOrEqual(grill.createdAt)
  })

  it('não constrói o spec antes de o grill ser aprovado', () => {
    const grill = createGrill('p1', 'Busca da loja')
    expect(() => buildSpec(grill)).toThrow(/não foi aprovado/)
  })

  it('constrói o spec a partir do grill aprovado', () => {
    const grill = createGrill('p1', 'Busca da loja')
    recordGrillDecision(grill, {
      question: 'Critério de aceite',
      answer: 'Retorna até 20 resultados por página.',
      decidedBy: 'Malu',
    })
    approveArtifact(grill, player)
    const spec = buildSpec(grill)
    expect(spec.kind).toBe('spec')
    expect(spec.goal).toBe('Busca da loja')
    expect(spec.grillId).toBe(grill.id)
    expect(spec.criteria).toContain('Retorna até 20 resultados por página.')
    expect(spec.gate.approved).toBe(false)
  })

  it('não constrói os tickets antes de o spec ser aprovado', () => {
    const grill = createGrill('p1', 'Busca da loja')
    approveArtifact(grill, player)
    const spec = buildSpec(grill)
    expect(() => buildTickets(spec)).toThrow(/não foi aprovado/)
  })

  it('constrói os tickets a partir do spec aprovado', () => {
    const grill = createGrill('p1', 'Busca da loja')
    approveArtifact(grill, player)
    const spec = buildSpec(grill)
    approveArtifact(spec, player)
    const tickets = buildTickets(spec)
    expect(tickets.kind).toBe('tickets')
    expect(tickets.goal).toBe('Busca da loja')
    expect(tickets.criteria).toEqual(spec.criteria)
    expect(tickets.specId).toBe(spec.id)
    expect(tickets.gate.approved).toBe(false)
  })
})

describe('project orchestration — aprovação e limite de duas revisões', () => {
  it('submete a revisão inicial com achados e não aprova', () => {
    const grill = createGrill('p1', 'Busca da loja')
    submitForReview(grill, ['O escopo está muito amplo.'])
    expect(grill.gate.reviewRounds).toBe(1)
    expect(grill.gate.findings).toEqual(['O escopo está muito amplo.'])
    expect(grill.gate.approved).toBe(false)
  })

  it('não aprova enquanto houver achados abertos', () => {
    const grill = createGrill('p1', 'Busca da loja')
    submitForReview(grill, ['Ajustar o escopo.'])
    expect(() => approveArtifact(grill, player)).toThrow(/achados abertos/)
    expect(grill.gate.approved).toBe(false)
  })

  it('aprova depois de resolver os achados', () => {
    const grill = createGrill('p1', 'Busca da loja')
    submitForReview(grill, ['Ajustar o escopo.'])
    resolveFindings(grill)
    approveArtifact(grill, player)
    expect(grill.gate.approved).toBe(true)
    expect(grill.gate.approvedBy).toBe('Malu')
    expect(grill.gate.approvedAt).toBeGreaterThan(0)
  })

  it('permite uma re-revisão após correções (segunda rodada)', () => {
    const grill = createGrill('p1', 'Busca da loja')
    submitForReview(grill, ['Primeiro achado.'])
    resolveFindings(grill)
    submitForReview(grill, ['Segundo achado.'])
    expect(grill.gate.reviewRounds).toBe(2)
    expect(grill.gate.findings).toEqual(['Segundo achado.'])
  })

  it('bloqueia uma terceira revisão com achados e pede decisão humana', () => {
    const grill = createGrill('p1', 'Busca da loja')
    submitForReview(grill, ['Achado 1.'])
    resolveFindings(grill)
    submitForReview(grill, ['Achado 2.'])
    expect(() => submitForReview(grill, ['Achado 3.'])).toThrow(
      /já passou por 2 revisões/,
    )
    expect(grill.gate.reviewRounds).toBe(2)
    expect(grill.gate.approved).toBe(false)
  })

  it('não aprova quando a segunda revisão ainda tem achados (limite esgotado)', () => {
    const grill = createGrill('p1', 'Busca da loja')
    submitForReview(grill, ['Achado 1.'])
    submitForReview(grill, ['Achado 2.']) // segunda rodada, achados ainda presentes
    expect(() => approveArtifact(grill, player)).toThrow(/achados abertos/)
    expect(grill.gate.approved).toBe(false)
    // uma terceira revisão com achados pede decisão humana
    expect(() => submitForReview(grill, ['Achado 3.'])).toThrow(
      /já passou por 2 revisões/,
    )
    expect(grill.gate.reviewRounds).toBe(2)
  })

  it('não permite terceira rodada mesmo após re-revisão sem achados', () => {
    const grill = createGrill('p1', 'Busca da loja')
    submitForReview(grill, ['Achado 1.'])
    resolveFindings(grill)
    submitForReview(grill, [])
    expect(() => submitForReview(grill, [])).toThrow(/2 revisões/)
    expect(grill.gate.reviewRounds).toBe(2)
    expect(grill.gate.approved).toBe(false)
  })

  it('exposa o código do erro de portão', () => {
    const grill = createGrill('p1', 'Busca da loja')
    try {
      buildSpec(grill)
    } catch (err) {
      expect(isOrchestrationError(err)).toBe(true)
      if (isOrchestrationError(err)) {
        expect(err.code).toBe('NOT_APPROVED')
      }
      return
    }
    throw new Error('esperava um ProjectOrchestrationError')
  })
})

describe('project orchestration — distribuição e squads (ticket #58)', () => {
  it('não forma squad a partir de tickets não aprovados', () => {
    const grill = createGrill('p1', 'Busca da loja')
    approveArtifact(grill, player)
    const spec = buildSpec(grill)
    approveArtifact(spec, player)
    const tickets = buildTickets(spec)
    expect(canFormSquad(tickets)).toBe(false)
  })

  it('forma squad somente a partir de tickets aprovados', () => {
    const grill = createGrill('p1', 'Busca da loja')
    approveArtifact(grill, player)
    const spec = buildSpec(grill)
    approveArtifact(spec, player)
    const tickets = buildTickets(spec)
    approveArtifact(tickets, player)
    expect(canFormSquad(tickets)).toBe(true)
  })

  it('exige aprovação antes de distribuir', () => {
    const grill = createGrill('p1', 'Busca da loja')
    approveArtifact(grill, player)
    const spec = buildSpec(grill)
    approveArtifact(spec, player)
    const tickets = buildTickets(spec)
    expect(() => assertCanDistribute(tickets)).toThrow(/antes da distribuição/)
  })

  it('redistribui subtarefas sem alterar objetivo nem critérios aprovados', () => {
    const grill = createGrill('p1', 'Busca da loja')
    approveArtifact(grill, player)
    const spec = buildSpec(grill)
    approveArtifact(spec, player)
    const tickets = buildTickets(spec)
    tickets.tickets.push('AO-10', 'AO-11')
    tickets.assignments = { 'AO-10': null, 'AO-11': 'sala-1' }
    approveArtifact(tickets, player)
    const goalBefore = tickets.goal
    const criteriaBefore = [...tickets.criteria]
    redistribute(tickets, [
      { ticketId: 'AO-10', fromSquad: null, toSquad: 'sala-1' },
      { ticketId: 'AO-11', fromSquad: 'sala-1', toSquad: null },
    ])
    expect(tickets.goal).toBe(goalBefore)
    expect(tickets.criteria).toEqual(criteriaBefore)
    expect(tickets.updatedAt).toBeGreaterThan(0)
  })

  it('aplica mudanças de atribuição quando redistribui subtarefas aprovadas', () => {
    const grill = createGrill('p1', 'Busca da loja')
    approveArtifact(grill, player)
    const spec = buildSpec(grill)
    approveArtifact(spec, player)
    const tickets = buildTickets(spec)
    tickets.tickets.push('AO-10')
    tickets.assignments = { 'AO-10': 'sala-1' }
    approveArtifact(tickets, player)

    redistribute(tickets, [{ ticketId: 'AO-10', fromSquad: 'sala-1', toSquad: 'sala-2' }])

    expect(tickets.assignments).toEqual({ 'AO-10': 'sala-2' })
  })

  it('não redistribui tickets que não pertencem ao conjunto aprovado', () => {
    const grill = createGrill('p1', 'Busca da loja')
    approveArtifact(grill, player)
    const spec = buildSpec(grill)
    approveArtifact(spec, player)
    const tickets = buildTickets(spec)
    tickets.tickets.push('AO-10')
    approveArtifact(tickets, player)
    expect(() => redistribute(tickets, [{ ticketId: 'AO-99', fromSquad: null, toSquad: 'sala-1' }])).toThrow(
      /não pertence a estes tickets aprovados/,
    )
  })
})

describe('project orchestration — papéis e motor (ticket #58)', () => {
  it('aceita equipe com implementador e revisor independentes', () => {
    expect(() => assertIndependentReviewer(team())).not.toThrow()
  })

  it('recusa equipe sem revisor', () => {
    const noReviewer: SquadProposalMember[] = [
      { id: 'maya', name: 'Maya', role: 'implementer', engine: 'claude', model: '', account: '', focus: 'Implementa' },
    ]
    expect(() => assertIndependentReviewer(noReviewer)).toThrow(/revisor independente/)
  })

  it('recusa revisor igual ao implementador', () => {
    const same: SquadProposalMember[] = [
      { id: 'maya', name: 'Maya', role: 'implementer', engine: 'claude', model: '', account: '', focus: 'Implementa' },
      { id: 'maya', name: 'Maya', role: 'reviewer', engine: 'claude', model: '', account: '', focus: 'Revisa' },
    ]
    expect(() => assertIndependentReviewer(same)).toThrow(/independente do implementador/)
  })

  it('recusa papel duplicado', () => {
    const dup: SquadProposalMember[] = [
      { id: 'a', name: 'A', role: 'reviewer', engine: 'claude', model: '', account: '', focus: 'Revisa' },
      { id: 'b', name: 'B', role: 'reviewer', engine: 'claude', model: '', account: '', focus: 'Revisa 2' },
    ]
    expect(() => assertIndependentReviewer(dup)).toThrow(/Mais de um membro/)
  })

  it('aceita somente Claude como motor ativo', () => {
    expect(() => assertClaudeOnly('claude')).not.toThrow()
  })

  it('recusa OpenCode como motor ativo', () => {
    const engine: AgentEngine = 'opencode'
    expect(() => assertClaudeOnly(engine)).toThrow(/somente com Claude/)
  })
})
