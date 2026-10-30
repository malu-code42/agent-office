import type { AgentSummary } from './types/agents'
import { lookFromSeed } from './describe'
import type { Settings } from './types/settings'

/** Stable ID for Luna's built-in coordinator in the ordinary agent roster and chat. */
export const LUNA_AGENT_ID = 'agent-office:luna'

export function lunaAgentSummary(now = Date.now(), settings?: Pick<Settings, 'lunaLook' | 'lunaModel' | 'lunaEffort'>): AgentSummary {
  return {
    id: LUNA_AGENT_ID,
    name: 'Luna',
    source: 'office',
    builtIn: 'luna',
    engine: 'claude',
    cwd: '',
    // #101: an ordinary session; the office's permission policy and cards decide each tool.
    permissionMode: 'default',
    status: 'idle',
    activity: 'Pronta para ajudar',
    desk: -1,
    look: settings?.lunaLook ?? lookFromSeed(LUNA_AGENT_ID),
    ...(settings?.lunaModel ? { model: settings.lunaModel } : {}),
    ...(settings?.lunaEffort ? { effort: settings.lunaEffort } : {}),
    costUsd: 0,
    createdAt: now,
  }
}
