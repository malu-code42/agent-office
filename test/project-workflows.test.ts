import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LEGACY_REVIEW_NOTE, ProjectWorkflowStore, isStoredWorkflow, migrateWorkflow } from '../src/main/project-workflows'
import { DATA_SHAPES } from '../src/main/backups'

const LEGACY = join(__dirname, 'fixtures', 'project-workflows-legacy.json')
const dirs: string[] = []
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ao-project-workflow-'))
  dirs.push(dir)
  return dir
}
const store = () => {
  const dir = tempDir()
  return { dir, value: new ProjectWorkflowStore(dir, () => 100) }
}

/** Brainstorm, design and Goldfish review approved: what tickets need. */
const approveUpToReview = (value: ProjectWorkflowStore, projectId = 'project-1') => {
  value.saveBrainstorm(projectId, 'Objetivo', 'Concepts brief')
  value.approveBrainstorm(projectId)
  value.saveDesign(projectId, 'Design doc', ['Critério'])
  value.approveDesign(projectId)
  value.saveReview(projectId, 'Achados escolhidos e resolvidos')
  value.approveReview(projectId)
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('ProjectWorkflowStore — etapas do EGM', () => {
  it('persists approvals and unlocks brainstorm → design → Goldfish review → tickets in order', () => {
    const { dir, value } = store()
    value.saveBrainstorm('project-1', 'Busca acessível', 'Entender usuários e escopo.')
    expect(() => value.saveDesign('project-1', 'Busca', ['Acessível'])).toThrow(/Aprove o brainstorm/)
    value.approveBrainstorm('project-1')
    value.saveDesign('project-1', 'Busca com filtros.', ['Navegação por teclado', 'Resultados paginados'], 'docs/designs/busca.md')
    expect(() => value.saveReview('project-1', 'Achados')).toThrow(/Aprove o rascunho do design/)
    value.approveDesign('project-1')
    expect(() => value.saveTickets('project-1', ['ticket-1'])).toThrow(/Aprove a Revisão Goldfish/)
    expect(() => value.approveReview('project-1')).toThrow(/Registre o resultado da Revisão Goldfish/)
    value.saveReview('project-1', 'Zoom-out: limitar resultados. Tratado.')
    value.approveReview('project-1')
    value.saveTickets('project-1', ['ticket-1'])
    value.approveTickets('project-1')

    const resumed = new ProjectWorkflowStore(dir, () => 101).get('project-1')
    expect(resumed).toMatchObject({
      goal: 'Busca acessível',
      brainstormApprovedAt: 100,
      designPath: 'docs/designs/busca.md',
      designApprovedAt: 100,
      reviewApprovedAt: 100,
      ticketsApprovedAt: 100,
      ticketIds: ['ticket-1'],
    })
    expect(() => new ProjectWorkflowStore(dir).assertApprovedTickets('project-1', ['other-ticket'])).toThrow(/distribuição aprovada/)
    expect(() => new ProjectWorkflowStore(dir).assertApprovedTickets('project-1', ['ticket-1'])).not.toThrow()
  })

  it('bootstrap is optional, once per project, and never moves the other stages', () => {
    const { value } = store()
    expect(value.get('project-1').bootstrap).toBe('pending')
    expect(value.setBootstrap('project-1', 'skipped')).toMatchObject({ bootstrap: 'skipped', bootstrapAt: 100, brainstormApprovedAt: null })
    approveUpToReview(value)
    expect(value.setBootstrap('project-1', 'done')).toMatchObject({ bootstrap: 'done', reviewApprovedAt: 100 })
    expect(value.setBootstrap('project-1', 'pending')).toMatchObject({ bootstrap: 'pending', bootstrapAt: null })
  })

  it('keeps the design doc inside docs/designs/', () => {
    const { value } = store()
    value.saveBrainstorm('project-1', 'Objetivo', 'Brief')
    value.approveBrainstorm('project-1')
    expect(value.saveDesign('project-1', 'D', ['C'], '.\\docs\\designs\\busca.md').designPath).toBe('docs/designs/busca.md')
    for (const bad of ['../fora.md', 'docs/designs/../../x.md', 'src/main.ts', '/docs/designs/a.md', 'docs/designs/a.txt'])
      expect(() => value.saveDesign('project-1', 'D', ['C'], bad)).toThrow(/docs\/designs/)
  })

  it('invalidates downstream approvals when an approved artifact changes', () => {
    const { value } = store()
    approveUpToReview(value)
    value.saveTickets('project-1', ['ticket-1'])
    value.approveTickets('project-1')

    value.saveReview('project-1', 'Outra decisão')
    expect(value.get('project-1')).toMatchObject({ designApprovedAt: 100, reviewApprovedAt: null, ticketsApprovedAt: null, ticketIds: [] })

    value.saveDesign('project-1', 'Design atualizado', ['Critério'])
    expect(value.get('project-1')).toMatchObject({ designApprovedAt: null, review: '', reviewApprovedAt: null })
    expect(() => value.assertApprovedTickets('project-1', ['ticket-1'])).toThrow(/Aprove o brainstorm, o design, a Revisão Goldfish/)
  })

  it('deduplicates ticket references and refuses approval of an empty distribution', () => {
    const { value } = store()
    approveUpToReview(value)
    value.saveTickets('project-1', ['ticket-1', 'ticket-1'])
    expect(value.get('project-1').ticketIds).toEqual(['ticket-1'])
    value.saveTickets('project-1', [])
    expect(() => value.approveTickets('project-1')).toThrow(/Gere ou selecione/)
  })

  it('persists generated ticket drafts without approval and allows approval only after a draft or selection exists', () => {
    const { dir, value } = store()
    approveUpToReview(value)
    value.saveTicketDrafts('project-1', [{ title: '  Implementar busca  ', description: '  Como usuário...', acceptance: [' Teclado ', '', 'Teclado'] }])

    expect(value.get('project-1')).toMatchObject({
      ticketDrafts: [{ title: 'Implementar busca', description: 'Como usuário...', acceptance: ['Teclado'] }],
      ticketIds: [],
      ticketsApprovedAt: null,
    })
    const resumed = new ProjectWorkflowStore(dir, () => 101)
    expect(resumed.approveTickets('project-1').ticketsApprovedAt).toBe(101)
  })

  it('keeps redistribution as an unapproved proposal and only changes recorded assignments after approval', () => {
    const { value } = store()
    approveUpToReview(value)
    value.saveTickets('project-1', ['ticket-1'])
    value.approveTickets('project-1')
    value.setAssignment('project-1', 'ticket-1', 'squad-a')

    const proposed = value.saveRedistributionProposal('project-1', [{ ticketId: 'ticket-1', fromSquad: 'squad-a', toSquad: 'squad-b' }])
    expect(proposed.redistributionProposal?.approvedAt).toBeNull()
    expect(proposed.assignments['ticket-1']).toBe('squad-a')
    expect(value.approveRedistribution('project-1')).toMatchObject({
      assignments: { 'ticket-1': 'squad-b' },
      redistributionProposal: { approvedAt: 100 },
    })
  })

  it('records a drift report on demand without touching any approval', () => {
    const { dir, value } = store()
    value.saveBrainstorm('project-1', 'Objetivo', 'Brief')
    value.approveBrainstorm('project-1')
    expect(() => value.saveDriftReport('project-1', 'x')).toThrow(/Aprove um design doc/)
    approveUpToReview(value)
    value.saveTickets('project-1', ['ticket-1'])
    value.approveTickets('project-1')
    expect(() => value.saveDriftReport('project-1', '   ')).toThrow(/vazio/)
    const saved = value.saveDriftReport('project-1', ' Busca sem paginação no código. ')
    expect(saved).toMatchObject({ driftReport: { summary: 'Busca sem paginação no código.', at: 100 }, ticketsApprovedAt: 100, reviewApprovedAt: 100 })
    expect(new ProjectWorkflowStore(dir).get('project-1').driftReport?.summary).toBe('Busca sem paginação no código.')
  })

  it('does not expose an approval in memory when atomic persistence fails', () => {
    const { dir, value } = store()
    mkdirSync(join(dir, 'project-workflows.json'))

    expect(() => value.saveBrainstorm('project-1', 'Objetivo', 'Discussão')).toThrow()
    expect(value.get('project-1')).toMatchObject({ goal: '', brainstorm: '', brainstormApprovedAt: null })
  })
})

describe('migração do fluxo anterior (grill/spec) para o EGM', () => {
  const legacyStore = () => {
    const dir = tempDir()
    copyFileSync(LEGACY, join(dir, 'project-workflows.json'))
    return { dir, value: new ProjectWorkflowStore(dir, () => 200) }
  }

  it('loads saved grill/spec workflows without losing data or approval times', () => {
    const { value } = legacyStore()
    const loja = value.get('loja')
    expect(loja).toMatchObject({
      goal: 'Busca acessível na loja',
      bootstrap: 'pending',
      bootstrapAt: null,
      brainstorm: 'Decisões: busca por produto e categoria; fora do escopo: busca por voz.',
      brainstormApprovedAt: 1760000000000,
      design: '# Busca\nResultados paginados, navegação por teclado.',
      designPath: '',
      criteria: ['Navegação por teclado', '20 resultados por página'],
      designApprovedAt: 1760000100000,
      review: LEGACY_REVIEW_NOTE,
      reviewApprovedAt: 1760000100000,
      ticketIds: ['t-1', 't-2'],
      ticketsApprovedAt: 1760000200000,
      assignments: { 't-1': 'sala-1', 't-2': null },
      redistributionProposal: { changes: [{ ticketId: 't-2', fromSquad: null, toSquad: 'sala-1' }], proposedAt: 1760000300000, approvedAt: null },
      updatedAt: 1760000300000,
    })
    expect(loja).not.toHaveProperty('grill')
    expect(loja).not.toHaveProperty('spec')
    // Tickets approved in the old flow keep forming squads.
    expect(() => value.assertApprovedTickets('loja', ['t-1'])).not.toThrow()

    expect(value.get('blog')).toMatchObject({
      brainstorm: 'Perguntas em aberto: frequência e provedor de e-mail.',
      brainstormApprovedAt: null,
      design: '',
      designApprovedAt: null,
      review: '',
      reviewApprovedAt: null,
    })
  })

  it('leaves the old file untouched until a change, then writes only the EGM shape', () => {
    const { dir, value } = legacyStore()
    const before = readFileSync(join(dir, 'project-workflows.json'), 'utf8')
    value.get('loja')
    expect(readFileSync(join(dir, 'project-workflows.json'), 'utf8')).toBe(before)

    value.setBootstrap('blog', 'skipped')
    const written = JSON.parse(readFileSync(join(dir, 'project-workflows.json'), 'utf8')) as { workflows: Record<string, unknown>[] }
    expect(written.workflows).toHaveLength(2)
    for (const row of written.workflows) {
      expect(row).not.toHaveProperty('grill')
      expect(row).not.toHaveProperty('specApprovedAt')
      expect(isStoredWorkflow(row)).toBe(true)
    }
    expect(new ProjectWorkflowStore(dir).get('loja')).toMatchObject({ reviewApprovedAt: 1760000100000, ticketsApprovedAt: 1760000200000 })
  })

  it('a migrated workflow continues with the EGM stages', () => {
    const { value } = legacyStore()
    value.approveBrainstorm('blog')
    value.saveDesign('blog', 'Newsletter semanal por e-mail', ['Envio às segundas'], 'docs/designs/newsletter.md')
    value.approveDesign('blog')
    expect(value.get('blog')).toMatchObject({ designApprovedAt: 200, review: '', reviewApprovedAt: null })
  })

  it('migrateWorkflow keeps EGM rows as they are and is idempotent', () => {
    const legacy = (JSON.parse(readFileSync(LEGACY, 'utf8')) as { workflows: unknown[] }).workflows[0]
    const once = migrateWorkflow(legacy)
    expect(migrateWorkflow(once)).toEqual(once)
  })

  it('backups accept the old and the new shapes and refuse a broken one', () => {
    const legacy = JSON.parse(readFileSync(LEGACY, 'utf8')) as { workflows: Record<string, unknown>[] }
    const check = DATA_SHAPES['project-workflows.json']
    expect(check(legacy)).toBe(true)
    const egm = { workflows: legacy.workflows.map(migrateWorkflow) }
    expect(check(egm)).toBe(true)
    expect(check({ workflows: [...legacy.workflows, ...egm.workflows] })).toBe(true)
    expect(check({ workflows: [{ ...egm.workflows[0], bootstrap: 'talvez' }] })).toBe(false)
    expect(check({ workflows: [{ ...legacy.workflows[0], grill: 3 }] })).toBe(false)
    expect(check({ workflows: [{ projectId: 'x' }] })).toBe(false)
  })
})
