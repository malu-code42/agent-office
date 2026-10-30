// Hit-tests of the 2D world: pure, so the tests check them.

/** A sprite drawn at (x, y) on the native canvas. */
export interface Placed {
  f: string
  x: number
  y: number
}

/**
 * The front-most thing whose sprite has a painted pixel under p. `list` is in drawing
 * order (back to front); `solid` says whether a frame's pixel (u, v) is painted.
 */
export function topmost<T extends { char: Placed }>(
  list: readonly T[],
  p: { x: number; y: number },
  solid: (frame: string, u: number, v: number) => boolean,
): T | null {
  for (let i = list.length - 1; i >= 0; i--) {
    const { char } = list[i]
    if (solid(char.f, p.x - char.x, p.y - char.y)) return list[i]
  }
  return null
}
