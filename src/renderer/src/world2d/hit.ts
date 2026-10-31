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

/**
 * What a click at p does on a floor with clickable furniture: the front-most piece painted
 * there decides (a plain one in front hides what is behind it); past the furniture, the
 * boxes of what is drawn in the base image (the wall boards). `items` is back to front.
 */
export function actAt<A>(
  items: readonly { sprites: readonly Placed[]; act?: A }[],
  hot: readonly { act: A; box: readonly [number, number, number, number] }[],
  p: { x: number; y: number },
  solid: (frame: string, u: number, v: number) => boolean,
): A | null {
  const front = topmost(
    items.map((item) => ({ item, char: item.sprites[0] })).filter((i) => i.char),
    p,
    solid,
  )
  if (front) return front.item.act ?? null
  const inside = (b: readonly number[]) => p.x >= b[0] && p.y >= b[1] && p.x < b[0] + b[2] && p.y < b[1] + b[3]
  return hot.find((h) => inside(h.box))?.act ?? null
}
