import { describe, expect, it } from 'vitest'
import { AgentCapReservations, agentCapDecision, countsAsRegular, hasTemporary, REGULAR_AGENT_CAP } from '../src/shared/agent-cap'
import type { AgentSummary } from '../src/shared/types/agents'

/**
 * The cap of the office (AO-42): four regular agents plus one temporary seat. The count is pure —
 * it reads what manager.list() holds — and the decision only marks the new hire as temporary, or
 * refuses when the two seats are taken. Nothing here fires anyone.
 */

const officeAgent = (over: Partial<AgentSummary> = {}): AgentSummary => ({
  id: 'a1',
  name: 'Agente',
  source: 'office',
  cwd: 'C:/projeto',
  permissionMode: 'default',
  status: 'idle',
  activity: '',
  desk: 1,
  look: { skin: '', hair: '', hairStyle: 0, shirt: '', pants: '', shoes: '' },
  costUsd: 0,
  createdAt: 0,
  ...over,
})

const regulars = (n: number): AgentSummary[] => Array.from({ length: n }, (_, i) => officeAgent({ id: `a${i}`, name: `A${i}` }))

describe('o limite do escritório', () => {
  it('o limite é 4 efetivos', () => {
    expect(REGULAR_AGENT_CAP).toBe(4)
  })

  it('quem conta: agente do escritório, sem papel, não parado e não temporário; quem não conta: terminal, orquestrador e temporário', () => {
    expect(countsAsRegular(officeAgent())).toBe(true)
    expect(countsAsRegular(officeAgent({ source: 'terminal' }))).toBe(false)
    expect(countsAsRegular(officeAgent({ role: 'orchestrator' }))).toBe(false)
    expect(countsAsRegular(officeAgent({ status: 'stopped' }))).toBe(false)
    expect(countsAsRegular(officeAgent({ temporary: true }))).toBe(false)
    expect(countsAsRegular(officeAgent({ departed: true }))).toBe(false)
    // Um stopped temporário não conta na fila dos 4, mas segue segurando o lugar 5.
    expect(hasTemporary([officeAgent({ temporary: true, status: 'stopped' })])).toBe(true)
    expect(hasTemporary([officeAgent({ temporary: true, departed: true })])).toBe(false)
    expect(hasTemporary([officeAgent()])).toBe(false)
  })

  it('abaixo do limite: a contratação é efetiva; no limite: o próximo é temporário', () => {
    expect(agentCapDecision([])).toEqual({ regular: 0, result: 'regular' })
    expect(agentCapDecision(regulars(3))).toEqual({ regular: 3, result: 'regular' })
    expect(agentCapDecision(regulars(4))).toEqual({ regular: 4, result: 'temporary' })
  })

  it('com um temporário existente e as 4 vagas cheias, ninguém mais entra', () => {
    for (const extra of [officeAgent({ id: 'tmp', temporary: true }), officeAgent({ id: 'tmp', temporary: true, status: 'stopped' })]) {
      expect(agentCapDecision([...regulars(4), extra])).toEqual({ regular: 4, result: 'refuse' })
    }
    // Com regular extra contado como efetivo (não deveria acontecer), também recusa.
    expect(agentCapDecision([...regulars(5), officeAgent({ temporary: true })]).result).toBe('refuse')
  })

  it('um efetivo parado abre vaga: com 3 contando, o próximo volta a ser efetivo', () => {
    const agents = regulars(4)
    agents[1].status = 'stopped'
    expect(agentCapDecision(agents)).toEqual({ regular: 3, result: 'regular' })
  })

  it('a vaga temporária é única no escritório: orquestrador nunca a ocupa nem a conta', () => {
    const agents = regulars(4)
    agents.push(officeAgent({ role: 'orchestrator' }))
    expect(agentCapDecision(agents).result).toBe('temporary')
  })

  it('reserva o último lugar antes de operações assíncronas concorrentes', () => {
    const reservations = new AgentCapReservations()
    const full = regulars(4)
    const a = reservations.reserve(full)
    expect(a.temporary).toBe(true)
    expect(() => reservations.reserve(full)).toThrow(/4 agentes efetivos e 1 temporário/)
    a.release()
    expect(reservations.reserve(full).temporary).toBe(true)
  })

  it('libera uma reserva que falhou sem perder vagas', () => {
    const reservations = new AgentCapReservations()
    const seat = reservations.reserve(regulars(3))
    seat.release()
    expect(reservations.reserve(regulars(3)).temporary).toBe(false)
  })
})
