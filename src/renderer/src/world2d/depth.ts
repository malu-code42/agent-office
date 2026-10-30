// Back-to-front order of the things on an isometric floor, the same rule the pixel-art
// generator uses (scripts/pixel-art/room.py draw_sorted), so the app stacks furniture
// exactly like the approved scenes.

/** Floor footprint in art units: x0, y0, x1, y1 (exclusive). */
export type Footprint = readonly [number, number, number, number]

/** True when footprint a is drawn before b: it lies entirely behind b on one axis and overlaps it on the other. */
export function behind(a: Footprint, b: Footprint): boolean {
  return (a[2] <= b[0] && a[1] < b[3]) || (a[3] <= b[1] && a[0] < b[2])
}

/**
 * Topological back-to-front order: first by x0 + y0 (then x0), then each item waits
 * for everything behind it. Stable, so equal items keep their order.
 */
export function depthSort<T extends { fp: Footprint }>(items: readonly T[]): T[] {
  const sorted = items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => a.it.fp[0] + a.it.fp[1] - (b.it.fp[0] + b.it.fp[1]) || a.it.fp[0] - b.it.fp[0] || a.i - b.i)
  const state = new Uint8Array(sorted.length)
  const out: T[] = []
  const visit = (i: number): void => {
    if (state[i]) return
    state[i] = 1
    for (let j = 0; j < sorted.length; j++) if (j !== i && !state[j] && behind(sorted[j].it.fp, sorted[i].it.fp)) visit(j)
    state[i] = 2
    out.push(sorted[i].it)
  }
  for (let i = 0; i < sorted.length; i++) visit(i)
  return out
}
