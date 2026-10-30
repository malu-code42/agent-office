import { HOME_INTERACTIONS, HOME_ROOMS, HOME_TABLE_AT, HOME_TABLE_SEATS, LUNA_SEAT } from '../world/home-layout'
import type { Grid } from '../world/pathfinding'

/** Rejects stale elevator/arrival callbacks after house presence was ended. */
export function canContinueHomeArrival(goal: string | null, resident: boolean): boolean {
  return goal === 'home' && resident
}

/** Called from the Casa, an agent stays in the house, as agents called upstairs stay on their project floor. */
export const stayHomeByDefault = (project: unknown): boolean => !project

/** The chairs at Luna's table handed out to residents, in order. */
const CHAIRS = HOME_TABLE_SEATS.filter((_, i) => i !== LUNA_SEAT)

/** Lowest seat number no other resident holds: a seat stays with its agent while it lives in the house. */
export function freeHomeSeat(taken: Iterable<number | null>): number {
  const used = new Set(taken)
  let n = 0
  while (used.has(n)) n++
  return n
}

export interface HomeSpot {
  tile: [number, number]
  point: { x: number; z: number }
  sit: boolean
}

/**
 * Where resident seat n goes: a chair at Luna's table or, past the chairs, a free floor tile of
 * the office around the table, closest first; null when the office has no room left.
 */
export function homeSpot(grid: Grid, n: number): HomeSpot | null {
  const chair = CHAIRS[n]
  if (chair) return { tile: [Math.floor(chair.x), Math.floor(chair.z)], point: { x: chair.x, z: chair.z }, sit: true }
  // shortcut: extra residents stand around the table instead of getting new chairs; the office
  // fits dozens, add chairs to the layout if residents ever crowd it.
  const [x0, z0, x1, z1] = HOME_ROOMS.find((room) => room.id === 'office')!.rect
  const tiles: [number, number][] = []
  for (let x = x0; x < x1; x++) {
    for (let z = z0; z < z1; z++) {
      if (!grid.walkable(x, z)) continue
      // Chairs are not blocked on the grid: standing agents keep clear of them and of the boards' tiles.
      if (HOME_TABLE_SEATS.some((s) => Math.hypot(x + 0.5 - s.x, z + 0.5 - s.z) < 1)) continue
      if (HOME_INTERACTIONS.some(({ approach: [ax, az] }) => ax === x && az === z)) continue
      tiles.push([x, z])
    }
  }
  const dist = ([x, z]: [number, number]) => Math.hypot(x + 0.5 - HOME_TABLE_AT.x, z + 0.5 - HOME_TABLE_AT.z)
  tiles.sort((a, b) => dist(a) - dist(b) || a[0] - b[0] || a[1] - b[1])
  const tile = tiles[n - CHAIRS.length]
  return tile ? { tile, point: { x: tile[0] + 0.5, z: tile[1] + 0.5 }, sit: false } : null
}
