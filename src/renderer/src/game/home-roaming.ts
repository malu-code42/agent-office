import { HOME_ROOMS, HOME_SPAWN_TILE } from '../world/home-layout'
import type { Grid } from '../world/pathfinding'

const PRIVATE_ROOM = 'bedroom'
const ELEVATOR_CLEARANCE = 2

/** Selects a reachable, unoccupied public-house tile; null means there is no safe move yet. */
export function homeRoamTarget(
  grid: Grid,
  from: [number, number],
  occupied: [number, number][],
  random: () => number = Math.random,
): [number, number] | null {
  const choices: [number, number][] = []
  for (const room of HOME_ROOMS) {
    if (room.id === PRIVATE_ROOM) continue
    const [x0, z0, x1, z1] = room.rect
    for (let x = x0; x < x1; x++) {
      for (let z = z0; z < z1; z++) {
        if (!grid.walkable(x, z)) continue
        if (Math.abs(x - HOME_SPAWN_TILE[0]) <= ELEVATOR_CLEARANCE && z <= HOME_SPAWN_TILE[1] + 1) continue
        if (Math.hypot(x - from[0], z - from[1]) < 2) continue
        if (occupied.some(([ox, oz]) => Math.hypot(x - ox, z - oz) < 1.5)) continue
        choices.push([x, z])
      }
    }
  }
  if (!choices.length) return null
  const start = Math.min(choices.length - 1, Math.floor(Math.max(0, Math.min(0.999999, random())) * choices.length))
  for (let offset = 0; offset < choices.length; offset++) {
    const target = choices[(start + offset) % choices.length]
    const path = grid.findPath(from[0], from[1], target[0], target[1])
    if (path && !path.some(([px, pz]) => occupied.some(([ox, oz]) => Math.hypot(px - ox, pz - oz) < 1))) return target
  }
  return null
}
