// 2:1 isometric projection of the pixel-art floors (scripts/pixel-art). One tile is
// 32x16 art pixels; game x runs to the lower right, game z to the lower left, height up.
// Pure math, no DOM: the renderer, the hit-tests and the tests share it.

/** Art units per tile (the generator's world unit is one art pixel horizontally). */
export const TILE = 16

export type Dir = 'FL' | 'FR' | 'BL' | 'BR'

export interface Px {
  x: number
  y: number
}

/** Art pixel of a game point (tiles; y = height in tiles) on a canvas whose floor corner sits at `origin`. */
export function toScreen(origin: readonly [number, number], x: number, z: number, y = 0): Px {
  return { x: origin[0] + (x - z) * TILE, y: origin[1] + ((x + z) * TILE) / 2 - y * TILE }
}

/** The floor point (tiles) under an art pixel. */
export function toFloor(origin: readonly [number, number], sx: number, sy: number): { x: number; z: number } {
  const u = (sx - origin[0]) / TILE // x - z
  const v = (2 * (sy - origin[1])) / TILE // x + z
  return { x: (u + v) / 2, z: (v - u) / 2 }
}

/** Art pixel of a point in art units (x, y on the floor, z up), as the generator projects it. */
export function artToScreen(origin: readonly [number, number], x: number, y: number, z = 0): Px {
  return { x: origin[0] + x - y, y: origin[1] + (x + y) / 2 - z }
}

/**
 * The sprite direction for a heading (radians, 0 = towards +z, like Avatar.face):
 * front when it walks down the screen, right when it walks to the right.
 */
export function dirOf(heading: number): Dir {
  const dx = Math.sin(heading)
  const dz = Math.cos(heading)
  const right = dx - dz > 1e-6
  const front = dx + dz > -1e-6
  return front ? (right ? 'FR' : 'FL') : right ? 'BR' : 'BL'
}

/** The heading a seat's sprite direction stands for (see dirOf). */
export function headingOf(dir: Dir): number {
  return { FR: Math.PI / 2, BL: -Math.PI / 2, FL: 0, BR: Math.PI }[dir]
}

/**
 * The whole-number scale of art pixels to device pixels: `zoom` steps (1, 2, 3) times the
 * whole part of the device pixel ratio, so a pixel is always a block of whole device pixels.
 */
export function deviceScale(zoom: number, dpr: number): number {
  return Math.max(1, Math.round(zoom)) * Math.max(1, Math.round(dpr))
}

/** Art pixels a floor of `size` tiles covers (x0, y0, x1, y1): the slab, the floor and the back walls. */
export function floorBounds(origin: readonly [number, number], size: readonly [number, number]): [number, number, number, number] {
  const [ox, oy] = origin
  return [ox - size[1] * TILE - 6, oy - 4 * TILE, ox + size[0] * TILE + 6, oy + ((size[0] + size[1]) * TILE) / 2 + 12]
}

/** The biggest zoom (1 to 3) at which the whole floor fits the view; 1 when nothing fits. */
export function fitZoom(bounds: readonly [number, number, number, number], view: { w: number; h: number }, dpr: number): number {
  for (let z = 3; z > 1; z--) {
    const s = deviceScale(z, dpr)
    if ((bounds[2] - bounds[0]) * s <= view.w && (bounds[3] - bounds[1]) * s <= view.h) return z
  }
  return 1
}

/**
 * Where the camera centre may go (art pixels): the floor stays on screen. On an axis
 * where the floor is smaller than the view, it stays centred.
 */
export function clampCenter(c: Px, bounds: readonly [number, number, number, number], viewArt: { w: number; h: number }): Px {
  const axis = (v: number, a: number, b: number, view: number) =>
    b - a <= view ? (a + b) / 2 : Math.min(b - view / 2, Math.max(a + view / 2, v))
  return { x: axis(c.x, bounds[0], bounds[2], viewArt.w), y: axis(c.y, bounds[1], bounds[3], viewArt.h) }
}

/** True when an art pixel falls on the west back wall (x = 0) between y0 and y1 (art units). */
export function onWestWall(origin: readonly [number, number], p: Px, y0: number, y1: number, h: number): boolean {
  const y = origin[0] - p.x
  const z = origin[1] + y / 2 - p.y
  return y >= y0 && y < y1 && z >= 0 && z <= h
}
