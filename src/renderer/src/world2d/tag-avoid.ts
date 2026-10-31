// The floating labels of the world cover each other when their anchors stand
// close together. The crowding is found on the projected screen boxes, not on world
// geometry, and it is solved by drifting the pills aside — plain numbers, so the
// rules can be checked without a scene (the renderer applies them with smoothing).

/** The screen box of a projected tag, in pixels. */
export interface TagRect {
  /** Left edge. */
  x: number
  /** Top edge (a tag hangs below its anchor: the top is `anchor - height`). */
  y: number
  /** Width. */
  w: number
  /** Height. */
  h: number
}

/** How far a tag drifts from its anchor to make room for a closer one. */
export interface TagOffset {
  dx: number
  dy: number
}

export interface AvoidOptions {
  /** Room kept between two pills. */
  gap?: number
  /** How far one tag may drift from its anchor, each axis. */
  maxOffset?: number
}

const GAP = 4
const MAX_OFFSET = 200
/** How many rounds the drift of a tag may push another one along (cascades). */
const PASSES = 8

/**
 * Who covers whom and how each tag steps aside: the tags nearer to the camera
 * keep their place (bigger `y`, a lower pill on the screen) and the farther ones
 * drift away along the shorter of the two crowding sides. A farther tag that is
 * pushed over another one is pushed along in the next pass, so a whole row
 * unfolds step by step; empty boxes take no room and stay where they are.
 */
export function resolveTagOverlaps(rects: readonly TagRect[], options: AvoidOptions = {}): TagOffset[] {
  const gap = options.gap ?? GAP
  const max = options.maxOffset ?? MAX_OFFSET
  const offsets: TagOffset[] = rects.map(() => ({ dx: 0, dy: 0 }))
  /** The box a tag occupies with the drift it already got. */
  const place = (i: number): TagRect => {
    const r = rects[i]
    const o = offsets[i]
    return { x: r.x + o.dx, y: r.y + o.dy, w: r.w, h: r.h }
  }
  /** How much the two boxes crowd each other, boxes inflated by the kept room. */
  const crowd = (a: TagRect, b: TagRect): { x: number; y: number } => ({
    x: Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x - gap, b.x - gap),
    y: Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y - gap, b.y - gap),
  })
  const clamped = (v: number): number => Math.max(-max, Math.min(max, v))
  // Only boxes with an area take room: a tag with no size could not be pushed anywhere.
  const order = rects
    .map((_, i) => i)
    .filter((i) => rects[i].w > 0 && rects[i].h > 0)
    // Nearer tags are placed first: bigger y sits closer to the camera, and the
    // sort stays stable for tags on the same depth.
    .sort((a, b) => rects[b].y - rects[a].y)

  for (let pass = 0; pass < PASSES; pass++) {
    let moved = false
    for (let k = 0; k < order.length; k++) {
      const a = order[k]
      const ra = place(a)
      for (let l = k + 1; l < order.length; l++) {
        const b = order[l]
        const rb = place(b)
        const c = crowd(ra, rb)
        if (c.x <= 0 || c.y <= 0) continue
        // Step along the shorter push, always away: sideways when the pills meet
        // side by side, then up or down when they are stacked.
        if (c.x <= c.y) {
          const dir = rb.x + rb.w / 2 >= ra.x + ra.w / 2 ? 1 : -1
          offsets[b].dx = clamped(offsets[b].dx + dir * c.x)
        } else {
          const dir = rb.y + rb.h / 2 >= ra.y + ra.h / 2 ? 1 : -1
          offsets[b].dy = clamped(offsets[b].dy + dir * c.y)
        }
        moved = true
      }
    }
    if (!moved) break
  }
  return offsets
}
