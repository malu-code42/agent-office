import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { brainForTicket } from '../src/main/ticket-brain'
import { loadSquads, memberAgents } from '../src/main/squads'
import { squadFilePlan, writeSquad } from '../src/main/squad-writer'
import type { SquadProposalComposition } from '@shared/types'

// AO-86: o modelo e o esforço julgados para o ticket e para cada membro chegam a quem roda.

describe('brainForTicket', () => {
  it('usa o par do ticket quando ele traz modelo e esforço', () => {
    const brain = brainForTicket({ model: 'claude-opus-5-5', effort: 'high' }, { model: 'claude-sonnet-5-5', effort: 'low' })
    expect(brain).toEqual({ model: 'claude-opus-5-5', effort: 'high' })
  })

  it('usa o padrão das configurações quando o ticket não traz modelo', () => {
    const brain = brainForTicket({}, { model: 'claude-sonnet-5-5', effort: 'medium' })
    expect(brain).toEqual({ model: 'claude-sonnet-5-5', effort: 'medium' })
  })

  it('completa só o que falta: modelo do ticket com esforço padrão', () => {
    const brain = brainForTicket({ model: 'claude-opus-5-5' }, { model: 'claude-sonnet-5-5', effort: 'medium' })
    expect(brain).toEqual({ model: 'claude-opus-5-5', effort: 'medium' })
  })

  it('sem ticket nem padrão deixa o modelo em aberto, nunca um Haiku fixo', () => {
    expect(brainForTicket({}, {})).toEqual({ model: undefined, effort: undefined })
  })
})

describe('modelo e esforço dos membros do squad', () => {
  const composition = (): SquadProposalComposition => ({
    name: 'Squad da Sala 1',
    members: [
      { id: 'maya', name: 'Maya', role: 'implementer', engine: 'claude', model: 'opus', effort: 'high', account: '', focus: 'Escreve o código' },
      { id: 'caio', name: 'Caio', role: 'reviewer', engine: 'claude', model: '', account: '', focus: 'Revisa' },
    ],
  })

  it('grava no squad e entrega ao subagente que roda; quem não escolheu herda', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ao86-members-'))
    const plan = squadFilePlan(composition(), 'Squad da Sala 1', 'Refazer a busca')
    plan.code = 'sala-1'
    writeSquad(cwd, plan)

    const squad = loadSquads(cwd).find((s) => s.code === 'sala-1')!
    const agents = memberAgents(squad)

    expect(agents.maya).toMatchObject({ model: 'opus', effort: 'high' })
    // Sem escolha própria o membro herda o modelo e o esforço do orquestrador (o par do ticket).
    expect(agents.caio?.model).toBeUndefined()
    expect(agents.caio?.effort).toBeUndefined()
  })
})
