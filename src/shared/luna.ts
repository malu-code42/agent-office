import type { AgentSummary } from './types/agents'
import { lookFromSeed } from './describe'

/** Stable ID for Luna's built-in coordinator in the ordinary agent roster and chat. */
export const LUNA_AGENT_ID = 'agent-office:luna'

export function lunaAgentSummary(now = Date.now()): AgentSummary {
  return {
    id: LUNA_AGENT_ID,
    name: 'Luna',
    source: 'office',
    builtIn: 'luna',
    engine: 'claude',
    cwd: '',
    permissionMode: 'plan',
    status: 'idle',
    activity: 'Pronta para ajudar',
    desk: -1,
    look: lookFromSeed(LUNA_AGENT_ID),
    costUsd: 0,
    createdAt: now,
  }
}
