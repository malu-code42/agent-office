import type { AgentSummary, Look } from './types/agents'
import type { ProjectFloor, Settings } from './types/settings'

/** Emi's look on every floor: the approved pixel art's Emi (purple pigtails, coral shirt). */
export const EMI_LOOK: Look = { skin: '#f2c49b', hair: '#5a3d6e', hairStyle: 4, shirt: '#f29a7e', pants: '#4a5470', shoes: '#3f3a40' }

/** Stable ID of the Emi who lives on a project floor: one per floor, derived from the floor id. */
export function emiAgentId(floorId: string): string {
  return `agent-office:emi:${floorId}`
}

/** A fresh Emi for `floor`: works in its folder, stays on it and never takes a desk or a hire slot. */
export function emiAgentSummary(
  floor: Pick<ProjectFloor, 'id' | 'cwd'>,
  now = Date.now(),
  settings?: Pick<Settings, 'emiModel' | 'emiEffort'>,
): AgentSummary {
  const id = emiAgentId(floor.id)
  return {
    id,
    name: 'Emi',
    source: 'office',
    builtIn: 'emi',
    engine: 'claude',
    cwd: floor.cwd,
    project: floor.id,
    // Always asks: her plan and squad tools must reach the confirmation card, whatever the floor's mode.
    permissionMode: 'default',
    status: 'idle',
    activity: 'Pronta para montar os squads',
    desk: -1,
    look: EMI_LOOK,
    ...(settings?.emiModel ? { model: settings.emiModel } : {}),
    ...(settings?.emiEffort ? { effort: settings.emiEffort } : {}),
    costUsd: 0,
    createdAt: now,
  }
}
