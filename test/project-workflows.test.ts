import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ProjectWorkflowStore } from '../src/main/project-workflows'

const dirs: string[] = []
const store = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ao-project-workflow-'))
  dirs.push(dir)
  return { dir, value: new ProjectWorkflowStore(dir, () => 100) }
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('ProjectWorkflowStore (ticket #58)', () => {
  it('persists manually authored approvals and unlocks stages in order', () => {
    const { dir, value } = store()
    value.saveGrill('project-1', 'Busca acessível', 'Entender usuários e escopo.')
    expect(() => value.saveSpec('project-1', 'Busca', ['Acessível'])).toThrow(/Aprove o grill/)
    value.approveGrill('project-1')
    value.saveSpec('project-1', 'Busca com filtros.', ['Navegação por teclado', 'Resultados paginados'])
    value.approveSpec('project-1')
    value.saveTickets('project-1', ['ticket-1'])
    value.approveTickets('project-1')

    const resumed = new ProjectWorkflowStore(dir, () => 101).get('project-1')
    expect(resumed).toMatchObject({
      goal: 'Busca acessível',
      grillApprovedAt: 100,
      specApprovedAt: 100,
      ticketsApprovedAt: 100,
      ticketIds: ['ticket-1'],
    })
    expect(() => new ProjectWorkflowStore(dir).assertApprovedTickets('project-1', ['other-ticket'])).toThrow(/distribuição aprovada/)
    expect(() => new ProjectWorkflowStore(dir).assertApprovedTickets('project-1', ['ticket-1'])).not.toThrow()
  })

  it('invalidates downstream approvals when an approved artifact changes', () => {
    const { value } = store()
    value.saveGrill('project-1', 'Objetivo', 'Discussão')
    value.approveGrill('project-1')
    value.saveSpec('project-1', 'Spec', ['Critério'])
    value.approveSpec('project-1')
    value.saveTickets('project-1', ['ticket-1'])
    value.approveTickets('project-1')

    value.saveSpec('project-1', 'Spec atualizada', ['Critério'])
    expect(value.get('project-1')).toMatchObject({ specApprovedAt: null, ticketsApprovedAt: null, ticketIds: [] })
    expect(() => value.assertApprovedTickets('project-1', ['ticket-1'])).toThrow(/Aprove o grill/)
  })

  it('deduplicates ticket references and refuses approval of an empty distribution', () => {
    const { value } = store()
    value.saveGrill('project-1', 'Objetivo', 'Discussão')
    value.approveGrill('project-1')
    value.saveSpec('project-1', 'Spec', ['Critério'])
    value.approveSpec('project-1')
    value.saveTickets('project-1', ['ticket-1', 'ticket-1'])
    expect(value.get('project-1').ticketIds).toEqual(['ticket-1'])
    value.saveTickets('project-1', [])
    expect(() => value.approveTickets('project-1')).toThrow(/Gere ou selecione/)
  })

  it('persists generated ticket drafts without approval and allows approval only after a draft or selection exists', () => {
    const { dir, value } = store()
    value.saveGrill('project-1', 'Objetivo', 'Grill aprovado')
    value.approveGrill('project-1')
    value.saveSpec('project-1', 'Spec aprovada', ['Critério'])
    value.approveSpec('project-1')
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
    value.saveGrill('project-1', 'Objetivo', 'Grill')
    value.approveGrill('project-1')
    value.saveSpec('project-1', 'Spec', ['Critério'])
    value.approveSpec('project-1')
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

  it('does not expose an approval in memory when atomic persistence fails', () => {
    const { dir, value } = store()
    mkdirSync(join(dir, 'project-workflows.json'))

    expect(() => value.saveGrill('project-1', 'Objetivo', 'Discussão')).toThrow()
    expect(value.get('project-1')).toMatchObject({ goal: '', grill: '', grillApprovedAt: null })
  })
})
