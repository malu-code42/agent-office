// What a click or a hover over a squad room lands on (AO-106). The scene is isometric and draws only the two back
// walls, so a room answers on the back wall it touches (the whiteboard side). The room at the corner nearest the
// viewer touches none: it answers on its coordinator's desk and its floor. Pure: the sprite test comes in as a
// function, so the rule is checked without a canvas.

import { onNorthWall, onWestWall, TILE, toFloor, type Px } from './iso'
import type { ProjectLayout } from './layout'

/** Height of the back walls, in art units (the generator's WALL_H). */
export const WALL_H = 56

type Solid = (frame: string, u: number, v: number) => boolean

/** The tile (x, z) a point of the floor falls in, if it is in one of the rectangles of a room. */
export function inRects(rects: readonly (readonly number[])[], at: { x: number; z: number }): boolean {
  return rects.some((r) => at.x >= r[0] && at.z >= r[1] && at.x < r[2] && at.z < r[3])
}

/** The room a click at an art pixel lands on, or -1. */
export function roomUnder(layout: Pick<ProjectLayout, 'origin' | 'rooms'>, p: Px, solid: Solid): number {
  const { origin, rooms } = layout
  return rooms.findIndex((room) => {
    const [x0, z0, x1, z1] = room.rect
    if (room.back === 'west') return onWestWall(origin, p, z0 * TILE, z1 * TILE, WALL_H)
    if (room.back === 'north') return onNorthWall(origin, p, x0 * TILE, x1 * TILE, WALL_H)
    const desk = room.coordinator.desk.green
    if (solid(desk.f, p.x - desk.x, p.y - desk.y)) return true
    return inRects(room.rects, toFloor(origin, p.x, p.y))
  })
}
