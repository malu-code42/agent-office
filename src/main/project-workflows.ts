import { join } from 'node:path'
import type { BootstrapStatus, ProjectWorkflow, RedistributionChange } from '@shared/types/project-orchestration'
import { loadJson, reportLoad, writeJsonAtomic } from './fs-safe'

interface Data {
  workflows: ProjectWorkflow[]
}

const isObj = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const isStamp = (value: unknown) => value === null || typeof value === 'number'
const isStrings = (value: unknown) => Array.isArray(value) && value.every((item) => typeof item === 'string')
const BOOTSTRAP: readonly BootstrapStatus[] = ['pending', 'done', 'skipped']

/** Fields every saved workflow has, in both shapes: the ticket, assignment and redistribution part. */
function isCommon(row: Record<string, unknown>): boolean {
  const drafts = row.ticketDrafts
  const proposal = row.redistributionProposal
  return (
    typeof row.projectId === 'string' &&
    typeof row.goal === 'string' &&
    isStrings(row.criteria) &&
    isStrings(row.ticketIds) &&
    (drafts === undefined ||
      (Array.isArray(drafts) &&
        drafts.every((item) => isObj(item) && typeof item.title === 'string' && typeof item.description === 'string' && isStrings(item.acceptance)))) &&
    isStamp(row.ticketsApprovedAt) &&
    isObj(row.assignments) &&
    Object.values(row.assignments).every((item) => item === null || typeof item === 'string') &&
    (proposal === undefined ||
      (isObj(proposal) &&
        Array.isArray(proposal.changes) &&
        typeof proposal.proposedAt === 'number' &&
        isStamp(proposal.approvedAt) &&
        proposal.changes.every(
          (item) =>
            isObj(item) &&
            typeof item.ticketId === 'string' &&
            (item.fromSquad === null || typeof item.fromSquad === 'string') &&
            (item.toSquad === null || typeof item.toSquad === 'string'),
        ))) &&
    typeof row.updatedAt === 'number'
  )
}

/** The workflow saved before the EGM stages: goal, grill, spec, tickets. */
function isLegacyWorkflow(row: Record<string, unknown>): boolean {
  return typeof row.grill === 'string' && isStamp(row.grillApprovedAt) && typeof row.spec === 'string' && isStamp(row.specApprovedAt) && isCommon(row)
}

function isEgmWorkflow(row: Record<string, unknown>): boolean {
  const drift = row.driftReport
  return (
    BOOTSTRAP.includes(row.bootstrap as BootstrapStatus) &&
    isStamp(row.bootstrapAt) &&
    typeof row.brainstorm === 'string' &&
    isStamp(row.brainstormApprovedAt) &&
    typeof row.design === 'string' &&
    typeof row.designPath === 'string' &&
    isStamp(row.designApprovedAt) &&
    typeof row.review === 'string' &&
    isStamp(row.reviewApprovedAt) &&
    (drift === undefined || (isObj(drift) && typeof drift.summary === 'string' && typeof drift.at === 'number')) &&
    isCommon(row)
  )
}

/** A saved workflow in either shape: the EGM one, or the older grill/spec one (migrated on load). */
export function isStoredWorkflow(value: unknown): boolean {
  return isObj(value) && (isEgmWorkflow(value) || isLegacyWorkflow(value))
}

/** Marks the review stage of a workflow approved before the Goldfish review existed. */
export const LEGACY_REVIEW_NOTE = 'Fluxo anterior ao EGM: a especificação foi aprovada antes da Revisão Goldfish existir.'

/**
 * Brings a saved workflow to the EGM shape without losing anything: the grill becomes the
 * brainstorm summary and the spec the design doc, keeping their approval times. An approved
 * spec already carried the human review, so its time also approves the review stage and
 * tickets approved before keep working. The file is rewritten only on the next change.
 */
export function migrateWorkflow(value: unknown): ProjectWorkflow {
  const row = structuredClone(value) as Record<string, unknown>
  if (isEgmWorkflow(row)) return row as unknown as ProjectWorkflow
  const { grill, grillApprovedAt, spec, specApprovedAt, ...rest } = row as Record<string, unknown> & {
    grill: string
    grillApprovedAt: number | null
    spec: string
    specApprovedAt: number | null
  }
  return {
    ...(rest as unknown as ProjectWorkflow),
    bootstrap: 'pending',
    bootstrapAt: null,
    brainstorm: grill,
    brainstormApprovedAt: grillApprovedAt,
    design: spec,
    designPath: '',
    designApprovedAt: specApprovedAt,
    review: specApprovedAt ? LEGACY_REVIEW_NOTE : '',
    reviewApprovedAt: specApprovedAt,
  }
}

function isData(value: unknown): value is Data {
  return isObj(value) && Array.isArray(value.workflows) && value.workflows.every(isStoredWorkflow)
}

/** A design doc lives under docs/designs/ of the project, as a relative Markdown path. */
export function cleanDesignPath(path: string): string {
  const clean = path.trim().replaceAll('\\', '/').replace(/^\.\//, '')
  if (!clean) return ''
  if (clean.length > 300 || !/^docs\/designs\/.+\.md$/i.test(clean) || clean.split('/').some((part) => part === '..' || part === '.' || !part))
    throw new Error('O design doc precisa ficar em docs/designs/ do projeto, como um arquivo .md.')
  return clean
}

const empty = (projectId: string): ProjectWorkflow => ({
  projectId,
  goal: '',
  bootstrap: 'pending',
  bootstrapAt: null,
  brainstorm: '',
  brainstormApprovedAt: null,
  design: '',
  designPath: '',
  criteria: [],
  designApprovedAt: null,
  review: '',
  reviewApprovedAt: null,
  ticketIds: [],
  ticketDrafts: [],
  ticketsApprovedAt: null,
  assignments: {},
  updatedAt: Date.now(),
})

// What a change in a stage clears downstream, so nothing approved rests on a changed artifact.
const clearTickets = () => ({ ticketIds: [], ticketDrafts: [], ticketsApprovedAt: null, assignments: {}, redistributionProposal: undefined })
const clearReview = () => ({ review: '', reviewApprovedAt: null, ...clearTickets() })
const clearDesign = () => ({ design: '', designPath: '', criteria: [], designApprovedAt: null, ...clearReview() })

/** Project-level approved artifacts live in userData, not in the project or Obsidian vault. */
export class ProjectWorkflowStore {
  private readonly file: string
  private readonly workflows = new Map<string, ProjectWorkflow>()

  constructor(dataDirectory: string, private readonly now: () => number = Date.now) {
    this.file = join(dataDirectory, 'project-workflows.json')
    const loaded = loadJson<Data>(this.file, { valid: isData })
    reportLoad(this.file, loaded)
    if ('data' in loaded) for (const workflow of loaded.data.workflows) this.workflows.set(workflow.projectId, migrateWorkflow(workflow))
  }

  get(projectId: string): ProjectWorkflow {
    const workflow = this.workflows.get(projectId)
    return workflow ? structuredClone(workflow) : empty(projectId)
  }

  /** Bootstrap is optional and once per project: marking it never changes the other stages. */
  setBootstrap(projectId: string, status: BootstrapStatus): ProjectWorkflow {
    const current = this.get(projectId)
    return this.put({ ...current, bootstrap: status, bootstrapAt: status === 'pending' ? null : this.now(), updatedAt: this.now() })
  }

  saveBrainstorm(projectId: string, goal: string, brainstorm: string): ProjectWorkflow {
    const current = this.get(projectId)
    const changed = current.goal !== goal.trim() || current.brainstorm !== brainstorm.trim()
    return this.put({
      ...current,
      goal: goal.trim(),
      brainstorm: brainstorm.trim(),
      ...(changed ? { brainstormApprovedAt: null, ...clearDesign() } : {}),
      updatedAt: this.now(),
    })
  }

  approveBrainstorm(projectId: string): ProjectWorkflow {
    const current = this.require(projectId)
    if (!current.goal || !current.brainstorm) throw new Error('Preencha o objetivo e o brainstorm antes de aprovar.')
    return this.put({ ...current, brainstormApprovedAt: this.now(), ...clearDesign(), updatedAt: this.now() })
  }

  saveDesign(projectId: string, design: string, criteria: string[], designPath = ''): ProjectWorkflow {
    const current = this.require(projectId)
    if (!current.brainstormApprovedAt) throw new Error('Aprove o brainstorm antes de editar o rascunho do design.')
    const path = cleanDesignPath(designPath)
    const cleanCriteria = [...new Set(criteria.map((item) => item.trim()).filter(Boolean))]
    const changed =
      current.design !== design.trim() || current.designPath !== path || current.criteria.join('\0') !== cleanCriteria.join('\0')
    return this.put({
      ...current,
      design: design.trim(),
      designPath: path,
      criteria: cleanCriteria,
      ...(changed ? { designApprovedAt: null, ...clearReview() } : {}),
      updatedAt: this.now(),
    })
  }

  approveDesign(projectId: string): ProjectWorkflow {
    const current = this.require(projectId)
    if (!current.brainstormApprovedAt) throw new Error('Aprove o brainstorm antes do rascunho do design.')
    if (!current.design || current.criteria.length === 0) throw new Error('Preencha o design e ao menos um critério de aceite.')
    return this.put({ ...current, designApprovedAt: this.now(), ...clearReview(), updatedAt: this.now() })
  }

  saveReview(projectId: string, review: string): ProjectWorkflow {
    const current = this.require(projectId)
    if (!current.designApprovedAt) throw new Error('Aprove o rascunho do design antes da Revisão Goldfish.')
    const changed = current.review !== review.trim()
    return this.put({ ...current, review: review.trim(), ...(changed ? { reviewApprovedAt: null, ...clearTickets() } : {}), updatedAt: this.now() })
  }

  approveReview(projectId: string): ProjectWorkflow {
    const current = this.require(projectId)
    if (!current.designApprovedAt) throw new Error('Aprove o rascunho do design antes da Revisão Goldfish.')
    if (!current.review) throw new Error('Registre o resultado da Revisão Goldfish (o que você escolheu tratar) antes de aprovar.')
    return this.put({ ...current, reviewApprovedAt: this.now(), ...clearTickets(), updatedAt: this.now() })
  }

  saveTicketDrafts(projectId: string, ticketDrafts: NonNullable<ProjectWorkflow['ticketDrafts']>): ProjectWorkflow {
    const current = this.require(projectId)
    if (!current.reviewApprovedAt) throw new Error('Aprove a Revisão Goldfish antes de gerar tickets.')
    const drafts = ticketDrafts
      .map((ticket) => ({
        title: ticket.title.trim().slice(0, 200),
        description: ticket.description.trim().slice(0, 4000),
        acceptance: [...new Set(ticket.acceptance.map((item) => item.trim().slice(0, 500)).filter(Boolean))].slice(0, 20),
      }))
      .filter((ticket) => ticket.title)
    if (!drafts.length || drafts.length > 30) throw new Error('A geração precisa conter de 1 a 30 tickets válidos.')
    return this.put({ ...current, ...clearTickets(), ticketDrafts: drafts, updatedAt: this.now() })
  }

  saveTickets(projectId: string, ticketIds: string[]): ProjectWorkflow {
    const current = this.require(projectId)
    if (!current.reviewApprovedAt) throw new Error('Aprove a Revisão Goldfish antes de selecionar tickets.')
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
    if (!current.reviewApprovedAt) throw new Error('Aprove a Revisão Goldfish antes dos tickets.')
    if (current.ticketIds.length === 0 && !current.ticketDrafts?.length) throw new Error('Gere ou selecione ao menos um ticket antes de aprovar a distribuição.')
    return this.put({ ...current, ticketsApprovedAt: this.now(), redistributionProposal: undefined, updatedAt: this.now() })
  }

  /** Records a drift report (design docs vs code). It changes no stage: the user decides what to update. */
  saveDriftReport(projectId: string, summary: string): ProjectWorkflow {
    const current = this.require(projectId)
    if (!current.designApprovedAt) throw new Error('Aprove um design doc antes de pedir o relatório de drift.')
    const text = summary.trim().slice(0, 20_000)
    if (!text) throw new Error('O relatório de drift veio vazio.')
    return this.put({ ...current, driftReport: { summary: text, at: this.now() }, updatedAt: this.now() })
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
    if (!current?.brainstormApprovedAt || !current.designApprovedAt || !current.reviewApprovedAt || !current.ticketsApprovedAt)
      throw new Error('Aprove o brainstorm, o design, a Revisão Goldfish e os tickets antes de propor um squad.')
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
