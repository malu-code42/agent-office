import type { AgentSummary } from './types'

/** Squad ticket work is published and recovered by the squad queue, never by result-card actions. */
export function isSquadTicketResultAgent(agent: Pick<AgentSummary, 'role' | 'squad' | 'ticketId'> | undefined): boolean {
  return agent?.role === 'orchestrator' && !!agent.squad && !!agent.ticketId
}
