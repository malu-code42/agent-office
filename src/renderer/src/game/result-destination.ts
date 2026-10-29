import type { AgentResult, AgentSummary } from '@shared/types'

export type Walkability = (x: number, z: number) => boolean

/** Project results stay on their own project floor; permission requests remain at the House table. */
export function resultDestination(agent: AgentSummary, projectFloorExists: boolean): 'meeting' | 'house' {
  return agent.project && projectFloorExists ? 'meeting' : 'house'
}

/** Selects the newest pending result for a clicked project meeting room. */
export function latestProjectResult(
  projectId: string,
  agents: Iterable<AgentSummary>,
  results: Iterable<AgentResult>,
): { agent: AgentSummary; result: AgentResult } | null {
  const byId = new Map([...agents].filter((agent) => agent.project === projectId).map((agent) => [agent.id, agent]))
  let latest: { agent: AgentSummary; result: AgentResult } | null = null
  for (const result of results) {
    const agent = byId.get(result.agentId)
    if (agent && (!latest || result.createdAt > latest.result.createdAt)) latest = { agent, result }
  }
  return latest
}

/** Chooses an unoccupied walkable tile in the director room, closest to the meeting table. */
export function meetingWaitSpot(
  walkable: Walkability,
  occupied: Iterable<readonly [number, number]>,
  room: readonly [number, number, number, number],
  table: { x: number; z: number },
): [number, number] | null {
  const [x0, z0, x1, z1] = room
  const taken = new Set([...occupied].map(([x, z]) => `${x},${z}`))
  const candidates: [number, number, number][] = []
  for (let x = x0; x < x1; x++) {
    for (let z = z0; z < z1; z++) {
      if (!walkable(x, z) || taken.has(`${x},${z}`)) continue
      candidates.push([x, z, Math.hypot(x + 0.5 - table.x, z + 0.5 - table.z)])
    }
  }
  candidates.sort((a, b) => a[2] - b[2])
  return candidates.length ? [candidates[0][0], candidates[0][1]] : null
}
