import type { AgentSummary } from './types/agents'
import type { ProjectFloor } from './types/settings'
import { lookFromSeed } from './describe'

/** Stable ID of the Emi who lives on a project floor: one per floor, derived from the floor id. */
export function emiAgentId(floorId: string): string {
  return `agent-office:emi:${floorId}`
}

/** A fresh Emi for `floor`: works in its folder, stays on it and never takes a desk or a hire slot. */
export function emiAgentSummary(floor: Pick<ProjectFloor, 'id' | 'cwd'>, now = Date.now()): AgentSummary {
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
    look: lookFromSeed(id),
    costUsd: 0,
    createdAt: now,
  }
}
