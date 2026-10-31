// The Casa (ground floor) of the 2D world, as scripts/pixel-art/export_app.py describes it
// (assets/pixel/casa.json), and the spots the game walks people to there. Pure (no DOM),
// so the tests check it. Layout numbers are art units (16 per tile) unless
// named in tiles. buildCasa2d (world2d/floor.ts) makes the floor the game walks on.

import type { HomeAction, HomeChair, HomePlan } from '../world/home-layout'
import type { Partition } from '../world/layout'
import type { Grid } from '../world/pathfinding'
import type { Footprint } from './depth'
import { headingOf, TILE } from './iso'
import { grid2d, type Placement, type SeatArt } from './layout'

type Rect = [number, number, number, number]

/** What a click on something of the Casa does: a home action, the skull, the totem, the user's computer. */
export type CasaAct = HomeAction | 'skull' | 'totem' | 'computer'

export interface CasaLayout {
  tile: number
  /** Tiles. */
  size: [number, number]
  canvas: [number, number]
  origin: [number, number]
  base: string
  /** Furniture and half walls; the clickable pieces carry their action. */
  static: (Placement & { act?: CasaAct })[]
  walls: Partition[]
  blocked: [number, number][]
  /** Clickable things drawn in the base image (the wall boards): their box on the native canvas. */
  hot: { act: CasaAct; box: Rect }[]
  /** Where the HTML tags float, by name: art units x, y and height. */
  tags: Record<string, [number, number, number]>
  /** The Claude FM screen (top-left, top-right, bottom-left), art units x, y, height. */
  tv: [number, number, number][]
  /** Luna's table: its middle and its chairs, Luna's first. */
  table: { center: [number, number]; seats: SeatArt[] }
  /** The user's chair and desk. */
  voce: { seat: SeatArt; desk: Footprint }
  /** Where idle agents sit, play or stand, and the point they look at. */
  hang: { at: [number, number]; look: [number, number]; kind: 'sit' | 'stand' | 'play' }[]
  /** Names shown when the pointer is over a part of the floor (tiles). */
  zones: { name: string; rect: Rect }[]
  elevator: { tile: [number, number]; point: [number, number]; door: [number, number, number] }
}

const chairOf = (s: SeatArt): HomeChair => ({ x: s.at[0] / TILE, z: s.at[1] / TILE, face: headingOf(s.dir) })
const inRect = (r: Rect, x: number, z: number) => x >= r[0] && x < r[2] && z >= r[1] && z < r[3]

/** The zone of a tile, by name; the first one listed wins. */
export function zoneAt(layout: CasaLayout, x: number, z: number): string | null {
  return layout.zones.find((zone) => inRect(zone.rect, x, z))?.name ?? null
}

function zone(layout: CasaLayout, name: string): Rect {
  const found = layout.zones.find((z) => z.name === name)
  if (!found) throw new Error(`casa.json sem a zona ${name}`)
  return found.rect
}

/**
 * The spots of the 2D Casa: the user's chair and the visitors around it, Luna's table and
 * the residents' chairs, the idle agents' corners and the hall by the elevator.
 */
export function casaPlan(layout: CasaLayout, grid: Grid = grid2d(layout)): HomePlan {
  const boss = chairOf(layout.voce.seat)
  const bossTile: [number, number] = [Math.floor(boss.x), Math.floor(boss.z)]
  const corner = zone(layout, 'Sua mesa')
  const [luna, ...chairs] = layout.table.seats.map(chairOf)
  const seatTiles = new Set(layout.table.seats.map((s) => `${Math.floor(s.at[0] / TILE)},${Math.floor(s.at[1] / TILE)}`))
  const free = (rect: Rect) => {
    const out: [number, number][] = []
    for (let z = rect[1]; z < rect[3]; z++) for (let x = rect[0]; x < rect[2]; x++) if (grid.walkable(x, z)) out.push([x, z])
    return out
  }
  // visitors: about a step and a half from the chair, the ones the camera sees (north of it) first
  const visit = free(corner)
    .filter(([x, z]) => !(x === bossTile[0] && z === bossTile[1]))
    .map((t): [[number, number], number] => {
      const d = Math.hypot(t[0] + 0.5 - boss.x, t[1] + 0.5 - boss.z)
      return [t, Math.abs(d - 1.5) + (t[1] > bossTile[1] ? 1 : 0)]
    })
    .sort((a, b) => a[1] - b[1] || a[0][0] - b[0][0] || a[0][1] - b[0][1])
    .map(([t]) => t)
    .slice(0, 12)
  // the tiles on both sides of the doors of the half walls stay clear for passing
  const keepClear: [number, number][] = layout.walls
    .flatMap((w) =>
      w.axis === 'x'
        ? w.doors.flatMap((d): [number, number][] => [
            [w.at - 1, d],
            [w.at, d],
          ])
        : [],
    )
    .filter(([x, z]) => grid.walkable(x, z))
  const hang = layout.hang.map((h) => {
    const x = h.at[0] / TILE
    const z = h.at[1] / TILE
    const approach = grid.walkable(Math.floor(x), Math.floor(z))
      ? ([Math.floor(x), Math.floor(z)] as [number, number])
      : (grid.nearestWalkable(Math.floor(x), Math.floor(z)) ?? layout.elevator.tile)
    return { x, z, look: [h.look[0] / TILE, h.look[1] / TILE] as [number, number], approach, kind: h.kind }
  })
  const [ex, ez] = layout.elevator.point
  const hall = free(zone(layout, 'Entrada'))
    .filter(([x, z]) => z >= 2 && z <= 5 && !seatTiles.has(`${x},${z}`))
    .sort((a, b) => Math.hypot(a[0] + 0.5 - ex, a[1] + 0.5 - ez) - Math.hypot(b[0] + 0.5 - ex, b[1] + 0.5 - ez))
  return {
    size: layout.size,
    elevator: { tile: layout.elevator.tile, point: { x: ex, z: ez } },
    boss,
    inBossRoom: (x, z) => inRect(corner, x, z),
    noVisit: (x, z) => x === bossTile[0] && z === bossTile[1],
    visit,
    table: { x: layout.table.center[0] / TILE, z: layout.table.center[1] / TILE },
    luna,
    chairs,
    around: zone(layout, 'Mesa da Luna'),
    keepClear,
    hang,
    desks: [],
    overflow: hall.slice(0, 8),
  }
}

/** What the 2D renderer needs about the Casa. */
export interface CasaFlat {
  kind: 'casa'
  layout: CasaLayout
}
