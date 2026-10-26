/**
 * The size of the office (AO-42): four regular agents plus at most one temporary one. A regular agent
 * is hired into the office with a task of its project; the 5th hire (and any beyond, while no
 * temporary exists) becomes temporary until a regular seat opens. Nothing here fires anyone: the
 * decision only marks the new hire or refuses the one beyond the two limits.
 */
import type { AgentSummary } from './types/agents'

/** How many office agents the office keeps as regular. */
export const REGULAR_AGENT_CAP = 4

/** Messages for the user (pt-BR) when a hire cannot go through the cap. */
export const NO_TEMPORARY_SEAT_MESSAGE =
  'Escritório cheio: já há 4 agentes efetivos e 1 temporário. Reserve um agente antes de contratar ou chamar outro.'

type AgentCapResult = 'regular' | 'temporary' | 'refuse'

/** Who counts against the cap: an office agent working a task, not a terminal session, not an orchestrator, not a temporary one. */
export function countsAsRegular(s: AgentSummary): boolean {
  return (
    s.source === 'office' &&
    !s.builtIn &&
    s.role !== 'orchestrator' &&
    s.status !== 'stopped' &&
    s.temporary !== true &&
    s.departed !== true
  )
}

/** Whether a temporary agent of the office already exists (even stopped, it holds the seat no. 5). */
export function hasTemporary(agents: AgentSummary[]): boolean {
  return agents.some((s) => s.source === 'office' && s.role !== 'orchestrator' && s.temporary === true && s.departed !== true)
}

/** What a new agent in the office would be: the next regular seat, the one temporary seat, or full. */
export function agentCapDecision(agents: AgentSummary[]): { regular: number; result: AgentCapResult } {
  const regular = agents.filter(countsAsRegular).length
  if (regular < REGULAR_AGENT_CAP) return { regular, result: 'regular' }
  if (!hasTemporary(agents)) return { regular, result: 'temporary' }
  return { regular, result: 'refuse' }
}

/** A synchronous reservation ledger for agent creation paths that await worktree setup. */
export class AgentCapReservations {
  private pending: AgentSummary[] = []

  reserve(agents: AgentSummary[]): { temporary: boolean; release: () => void } {
    const decision = agentCapDecision([...agents, ...this.pending])
    if (decision.result === 'refuse') throw new Error(NO_TEMPORARY_SEAT_MESSAGE)
    const reservation: AgentSummary = {
      id: `reservation-${this.pending.length}-${Date.now()}`,
      name: '',
      source: 'office',
      cwd: '',
      permissionMode: 'default',
      status: 'starting',
      activity: '',
      desk: 0,
      look: { skin: '', hair: '', hairStyle: 0, shirt: '', pants: '', shoes: '' },
      costUsd: 0,
      createdAt: Date.now(),
      ...(decision.result === 'temporary' ? { temporary: true } : {}),
    }
    this.pending.push(reservation)
    return {
      temporary: decision.result === 'temporary',
      release: () => {
        this.pending = this.pending.filter((item) => item !== reservation)
      },
    }
  }
}
