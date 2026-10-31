// Where the skull's victim falls (motor-2d gap): an agent struck while on a sofa or bean bag is first
// put on the nearest free floor tile, so it does not fall flat over the furniture.

import type { Pose } from '../world2d/avatar'

interface WalkGrid {
  nearestWalkable(x: number, z: number, avoid?: (x: number, z: number) => boolean): [number, number] | null
}

/**
 * The point a struck agent falls on, or null when it falls where it is. Lounging on a sofa or bean bag (pose
 * `relax`), it is the middle of the nearest walkable tile nobody else stands on (`taken`), the sofa's own
 * tile excluded. A desk chair keeps the old fall: the agent drops beside its desk.
 */
export function strikeSpot(
  grid: WalkGrid,
  at: { x: number; z: number },
  pose: Pose,
  taken: (x: number, z: number) => boolean = () => false,
): { x: number; z: number } | null {
  const x = Math.floor(at.x)
  const z = Math.floor(at.z)
  if (pose !== 'relax') return null
  const tile = grid.nearestWalkable(x, z, (i, j) => (i === x && j === z) || taken(i, j))
  return tile ? { x: tile[0] + 0.5, z: tile[1] + 0.5 } : null
}
