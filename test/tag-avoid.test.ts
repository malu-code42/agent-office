import { describe, expect, it } from 'vitest'
import { resolveTagOverlaps, type TagRect } from '../src/renderer/src/world/tag-avoid'

const rect = (x: number, y: number, w: number, h: number): TagRect => ({ x, y, w, h })
const zero = { dx: 0, dy: 0 }

describe('the drift that uncovers the pills', () => {
  it('leaves alone the pills with room to breathe', () => {
    const out = resolveTagOverlaps([rect(0, 0, 40, 40), rect(90, 0, 40, 40), rect(0, 90, 40, 40)])
    expect(out).toEqual([zero, zero, zero])
  })

  it('keeps the nearer pill in place and steps the farther one aside', () => {
    // The closer tag sits lower on the screen (bigger y); the farther one is pushed
    // along the shorter of the two crowds — here the vertical one, just the 10px of
    // overlap plus the 4px of kept room, so the pill stops one breath short.
    const out = resolveTagOverlaps([rect(0, 100, 40, 40), rect(10, 70, 40, 40)])
    expect(out).toEqual([zero, { dx: 0, dy: -14 }])
  })

  it('steps the farther one sideways when the pills meet side by side', () => {
    const out = resolveTagOverlaps([rect(0, 20, 40, 40), rect(20, 0, 40, 40)])
    expect(out).toEqual([zero, { dx: 24, dy: 0 }])
  })

  it('pushes in one chosen direction, so the result does not wobble', () => {
    // Two identical boxes overcrowd both ways the same: nearer first, farther pushed.
    const out = resolveTagOverlaps([rect(10, 10, 40, 40), rect(10, 10, 40, 40)])
    expect(out).toEqual([zero, { dx: 44, dy: 0 }])
  })

  it('unfolds a whole stack, one pill pushing the next', () => {
    // The nearer pill (lowest on the screen) keeps its place; the middle one steps
    // up by the 8px it was covered by, and the top one, uncovered again by the
    // middle's drift, follows up another 16 — one nudge feeds the next.
    const out = resolveTagOverlaps([rect(0, 0, 40, 40), rect(0, 36, 40, 40), rect(0, 72, 40, 40)])
    expect(out).toEqual([{ dx: 0, dy: -16 }, { dx: 0, dy: -8 }, zero])
  })

  it('gives no room to pills with no size, and drifts nothing because of them', () => {
    const out = resolveTagOverlaps([rect(0, 0, 0, 0), rect(0, 0, 40, 40)])
    expect(out).toEqual([zero, zero])
  })

  it('caps the drift so a crowded spill never throws a pill far away', () => {
    const out = resolveTagOverlaps([rect(0, 0, 40, 40), rect(0, 0, 40, 40)], { maxOffset: 10 })
    expect(out).toEqual([zero, { dx: 10, dy: 0 }])
  })

  it('opens up again: the drift is over once the pills part', () => {
    const apart = [rect(0, 0, 40, 40), rect(90, 0, 40, 40)]
    expect(resolveTagOverlaps(apart)).toEqual([zero, zero])
    // The same boxes with a drift already in place are not resolved twice by callers:
    // the helper works on the anchor boxes, so an empty ask is all it returns.
    const crowded = [rect(0, 100, 40, 40), rect(10, 70, 40, 40)]
    expect(resolveTagOverlaps(crowded)[1].dy).toBeLessThan(0)
    expect(resolveTagOverlaps(crowded, { gap: 0 })[1].dy).not.toBe(0)
  })
})
