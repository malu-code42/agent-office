import { join } from 'node:path'
import type { ProjectWorkflow, RedistributionChange } from '@shared/types/project-orchestration'
import { loadJson, reportLoad, writeJsonAtomic } from './fs-safe'

interface Data {
  workflows: ProjectWorkflow[]
}

function isWorkflow(value: unknown): value is ProjectWorkflow {
  if (!value || typeof value !== 'object') return false
  const row = value as Partial<ProjectWorkflow>
  return (
    typeof row.projectId === 'string' &&
    typeof row.goal === 'string' &&
    typeof row.grill === 'string' &&
    (row.grillApprovedAt === null || typeof row.grillApprovedAt === 'number') &&
    typeof row.spec === 'string' &&
    Array.isArray(row.criteria) &&
    row.criteria.every((item) => typeof item === 'string') &&
    (row.specApprovedAt === null || typeof row.specApprovedAt === 'number') &&
    Array.isArray(row.ticketIds) &&
    row.ticketIds.every((item) => typeof item === 'string') &&
    (row.ticketDrafts === undefined || (Array.isArray(row.ticketDrafts) && row.ticketDrafts.every((item) =>
      !!item && typeof item === 'object' && typeof item.title === 'string' && typeof item.description === 'string' &&
      Array.isArray(item.acceptance) && item.acceptance.every((criterion) => typeof criterion === 'string')))) &&
    (row.ticketsApprovedAt === null || typeof row.ticketsApprovedAt === 'number') &&
    !!row.assignments &&
    typeof row.assignments === 'object' &&
    !Array.isArray(row.assignments) &&
    Object.values(row.assignments).every((item) => item === null || typeof item === 'string') &&
    (row.redistributionProposal === undefined || (!!row.redistributionProposal && Array.isArray(row.redistributionProposal.changes) &&
      typeof row.redistributionProposal.proposedAt === 'number' &&
      (row.redistributionProposal.approvedAt === null || typeof row.redistributionProposal.approvedAt === 'number') &&
      row.redistributionProposal.changes.every((item) => !!item && typeof item.ticketId === 'string' &&
        (item.fromSquad === null || typeof item.fromSquad === 'string') && (item.toSquad === null || typeof item.toSquad === 'string')))) &&
    typeof row.updatedAt === 'number'
  )
}

function isData(value: unknown): value is Data {
  return !!value && typeof value === 'object' && Array.isArray((value as Data).workflows) && (value as Data).workflows.every(isWorkflow)
}

const empty = (projectId: string): ProjectWorkflow => ({
  projectId,
  goal: '',
  grill: '',
  grillApprovedAt: null,
  spec: '',
  criteria: [],
  specApprovedAt: null,
  ticketIds: [],
  ticketDrafts: [],
  ticketsApprovedAt: null,
  assignments: {},
  updatedAt: Date.now(),
})

/** Project-level approved artifacts live in userData, not in the project or Obsidian vault. */
export class ProjectWorkflowStore {
  private readonly file: string
  private readonly workflows = new Map<string, ProjectWorkflow>()

  constructor(dataDirectory: string, private readonly now: () => number = Date.now) {
    this.file = join(dataDirectory, 'project-workflows.json')
    const loaded = loadJson<Data>(this.file, { valid: isData })
    reportLoad(this.file, loaded)
    if ('data' in loaded) for (const workflow of loaded.data.workflows) this.workflows.set(workflow.projectId, workflow)
  }

  get(projectId: string): ProjectWorkflow {
    const workflow = this.workflows.get(projectId)
    return workflow ? structuredClone(workflow) : empty(projectId)
  }

  saveGrill(projectId: string, goal: string, grill: string): ProjectWorkflow {
    const current = this.get(projectId)
    const changed = current.goal !== goal.trim() || current.grill !== grill.trim()
    const next: ProjectWorkflow = {
      ...current,
      goal: goal.trim(),
      grill: grill.trim(),
      ...(changed ? { grillApprovedAt: null, spec: '', criteria: [], specApprovedAt: null, ticketIds: [], ticketDrafts: [], ticketsApprovedAt: null, assignments: {}, redistributionProposal: undefined } : {}),
      updatedAt: this.now(),
    }
    return this.put(next)
  }

  approveGrill(projectId: string): ProjectWorkflow {
    const current = this.require(projectId)
    if (!current.goal || !current.grill) throw new Error('Preencha o objetivo e o grill antes de aprovar.')
    return this.put({ ...current, grillApprovedAt: this.now(), spec: '', criteria: [], specApprovedAt: null, ticketIds: [], ticketDrafts: [], ticketsApprovedAt: null, assignments: {}, redistributionProposal: undefined, updatedAt: this.now() })
  }

  saveSpec(projectId: string, spec: string, criteria: string[]): ProjectWorkflow {
    const current = this.require(projectId)
    if (!current.grillApprovedAt) throw new Error('Aprove o grill antes de editar a especificação.')
    const cleanCriteria = [...new Set(criteria.map((item) => item.trim()).filter(Boolean))]
    const changed = current.spec !== spec.trim() || current.criteria.join('\0') !== cleanCriteria.join('\0')
    return this.put({
      ...current,
      spec: spec.trim(),
      criteria: cleanCriteria,
      ...(changed ? { specApprovedAt: null, ticketIds: [], ticketDrafts: [], ticketsApprovedAt: null, assignments: {}, redistributionProposal: undefined } : {}),
      updatedAt: this.now(),
    })
  }

  approveSpec(projectId: string): ProjectWorkflow {
    const current = this.require(projectId)
    if (!current.grillApprovedAt) throw new Error('Aprove o grill antes da especificação.')
    if (!current.spec || current.criteria.length === 0) throw new Error('Preencha a especificação e ao menos um critério de aceite.')
    return this.put({ ...current, specApprovedAt: this.now(), ticketIds: [], ticketDrafts: [], ticketsApprovedAt: null, assignments: {}, redistributionProposal: undefined, updatedAt: this.now() })
  }

  saveTicketDrafts(projectId: string, ticketDrafts: NonNullable<ProjectWorkflow['ticketDrafts']>): ProjectWorkflow {
    const current = this.require(projectId)
    if (!current.specApprovedAt) throw new Error('Aprove a especificação antes de gerar tickets.')
    const drafts = ticketDrafts.map((ticket) => ({
      title: ticket.title.trim().slice(0, 200),
      description: ticket.description.trim().slice(0, 4000),
      acceptance: [...new Set(ticket.acceptance.map((item) => item.trim().slice(0, 500)).filter(Boolean))].slice(0, 20),
    })).filter((ticket) => ticket.title)
    if (!drafts.length || drafts.length > 30) throw new Error('A geração precisa conter de 1 a 30 tickets válidos.')
    return this.put({ ...current, ticketDrafts: drafts, ticketIds: [], ticketsApprovedAt: null, assignments: {}, redistributionProposal: undefined, updatedAt: this.now() })
  }

  saveTickets(projectId: string, ticketIds: string[]): ProjectWorkflow {
    const current = this.require(projectId)
    if (!current.specApprovedAt) throw new Error('Aprove a especificação antes de selecionar tickets.')
    const ids = [...new Set(ticketIds)]
    if (ids.some((id) => !id.trim())) throw new Error('Há um ID de ticket inválido.')
    const changed = current.ticketIds.join('\0') !== ids.join('\0')
    return this.put({
      ...current,
      ticketIds: ids,
      ...(ids.length ? { ticketDrafts: [] } : {}),
      ...(changed ? { ticketsApprovedAt: null, assignments: {}, redistributionProposal: undefined } : {}),
      updatedAt: this.now(),
    })
  }

  approveTickets(projectId: string): ProjectWorkflow {
    const current = this.require(projectId)
    if (!current.specApprovedAt) throw new Error('Aprove a especificação antes dos tickets.')
    if (current.ticketIds.length === 0 && !current.ticketDrafts?.length) throw new Error('Gere ou selecione ao menos um ticket antes de aprovar a distribuição.')
    return this.put({ ...current, ticketsApprovedAt: this.now(), redistributionProposal: undefined, updatedAt: this.now() })
  }

  saveRedistributionProposal(projectId: string, changes: RedistributionChange[]): ProjectWorkflow {
    const current = this.require(projectId)
    if (!current.ticketsApprovedAt) throw new Error('Aprove os tickets antes de propor redistribuição.')
    const seen = new Set<string>()
    for (const change of changes) {
      if (!current.ticketIds.includes(change.ticketId) || seen.has(change.ticketId))
        throw new Error('A proposta só pode redistribuir tickets aprovados, uma vez cada.')
      if (Object.hasOwn(current.assignments, change.ticketId) && (current.assignments[change.ticketId] ?? null) !== change.fromSquad)
        throw new Error(`A atribuição de ${change.ticketId} mudou; gere uma nova proposta.`)
      seen.add(change.ticketId)
    }
    return this.put({ ...current, redistributionProposal: { changes: structuredClone(changes), proposedAt: this.now(), approvedAt: null }, updatedAt: this.now() })
  }

  approveRedistribution(projectId: string): ProjectWorkflow {
    const current = this.require(projectId)
    const proposal = current.redistributionProposal
    if (!current.ticketsApprovedAt || !proposal) throw new Error('Não há proposta de redistribuição para aprovar.')
    const assignments = { ...current.assignments }
    for (const change of proposal.changes) assignments[change.ticketId] = change.toSquad
    return this.put({ ...current, assignments, redistributionProposal: { ...proposal, approvedAt: this.now() }, updatedAt: this.now() })
  }

  setAssignment(projectId: string, ticketId: string, squad: string | null): ProjectWorkflow {
    const current = this.require(projectId)
    if (!current.ticketsApprovedAt || !current.ticketIds.includes(ticketId))
      throw new Error('A atribuição só pode mudar para um ticket aprovado.')
    return this.put({ ...current, assignments: { ...current.assignments, [ticketId]: squad }, updatedAt: this.now() })
  }

  assertApprovedTickets(projectId: string, ticketIds: string[]): void {
    const current = this.workflows.get(projectId)
    if (!current?.grillApprovedAt || !current.specApprovedAt || !current.ticketsApprovedAt)
      throw new Error('Aprove o grill, a especificação e os tickets antes de propor um squad.')
    if (ticketIds.some((id) => !current.ticketIds.includes(id)))
      throw new Error('O squad só pode receber tickets incluídos na distribuição aprovada.')
  }

  private require(projectId: string): ProjectWorkflow {
    const current = this.workflows.get(projectId)
    if (!current) throw new Error('Inicie o fluxo do projeto antes de continuar.')
    return structuredClone(current)
  }

  private put(workflow: ProjectWorkflow): ProjectWorkflow {
    const next = new Map(this.workflows)
    next.set(workflow.projectId, structuredClone(workflow))
    writeJsonAtomic(this.file, { workflows: [...next.values()] } satisfies Data)
    this.workflows.set(workflow.projectId, structuredClone(workflow))
    return structuredClone(workflow)
  }
}
