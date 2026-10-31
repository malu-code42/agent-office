import type { AgentSummary, Look } from './types/agents'
import type { Settings } from './types/settings'

/** Stable ID of Bonnie, the study floor's director, in the roster and chat. */
export const BONNIE_AGENT_ID = 'agent-office:bonnie'

/** Bonnie's look in her portrait: the approved pixel art's Bonnie (sprite variant 3). */
export const BONNIE_LOOK: Look = { skin: '#a8714b', hair: '#3b2a24', hairStyle: 3, shirt: '#f0d27e', pants: '#6a5545', shoes: '#3f3030' }

/**
 * A fresh Bonnie: talks with the user about the study floor (trail, cycle, schedule, Cora's
 * sources) from her office. She never takes a desk or a hire slot and works through her own tools.
 */
export function bonnieAgentSummary(now = Date.now(), settings?: Pick<Settings, 'bonnieModel' | 'bonnieEffort'>): AgentSummary {
  return {
    id: BONNIE_AGENT_ID,
    name: 'Bonnie',
    source: 'office',
    builtIn: 'bonnie',
    engine: 'claude',
    cwd: '',
    // Always asks: anything outside her own study tools reaches the policy, which keeps her off the files.
    permissionMode: 'default',
    status: 'idle',
    activity: 'Pronta para conversar sobre os estudos',
    desk: -1,
    look: BONNIE_LOOK,
    ...(settings?.bonnieModel ? { model: settings.bonnieModel } : {}),
    ...(settings?.bonnieEffort ? { effort: settings.bonnieEffort } : {}),
    costUsd: 0,
    createdAt: now,
  }
}
