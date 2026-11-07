import type { AgentSummary } from '@shared/types'

/**
 * AO-105: there is no meeting room any more. A project agent with a pending result waits at its own desk (the player
 * clicks it or its notification to read); everyone else keeps the House behavior.
 */
export function resultDestination(agent: AgentSummary, projectFloorExists: boolean): 'desk' | 'house' {
  return agent.project && projectFloorExists ? 'desk' : 'house'
}
