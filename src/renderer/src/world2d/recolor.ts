// An agent's look on the pixel-art characters: the generator exports each sprite as palette
// letters (assets/pixel/chars.json); here they get the look's colours and the generator's
// tinted outline (scripts/pixel-art/px.py add_outline). Pure, so the tests compare it with
// what the generator paints.

import type { Look } from '@shared/types'

export type Rgb = [number, number, number]
/** Palette letter -> colour. */
export type Palette = Record<string, Rgb>

const OUT: Rgb = [0x2b, 0x23, 0x20]
const BLACK: Rgb = [0, 0, 0]
const DARK: Rgb = [30, 22, 28]
const LIGHT: Rgb = [255, 250, 240]

export const rgb = (hex: string): Rgb => {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h
  const n = parseInt(full.slice(0, 6), 16) || 0
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** The generator's mix: each channel truncated to an integer. */
export const mix = (c: Rgb, d: Rgb, t: number): Rgb => [0, 1, 2].map((i) => Math.trunc(c[i] * (1 - t) + d[i] * t)) as Rgb

/** Corte 1..6 of the look editor -> the hair style the sprites are drawn with. */
export const CUTS = ['short', 'spiky', 'long', 'bun', 'twin', 'pony'] as const

export function cutOf(look: Look): (typeof CUTS)[number] {
  const i = Math.trunc(look.hairStyle) || 0
  return CUTS[((i % CUTS.length) + CUTS.length) % CUTS.length]
}

/** The palette of a look: its skin, hair, shirt, pants and shoes with their shades; the face and outline stay fixed. */
export function paletteOf(look: Look): Palette {
  const base: Palette = {
    S: rgb(look.skin),
    s: mix(rgb(look.skin), DARK, 0.14),
    H: rgb(look.hair),
    h: mix(rgb(look.hair), DARK, 0.28),
    L: mix(rgb(look.hair), LIGHT, 0.3),
    C: rgb(look.shirt),
    c: mix(rgb(look.shirt), DARK, 0.22),
    P: rgb(look.pants),
    p: mix(rgb(look.pants), DARK, 0.22),
    B: rgb(look.shoes || '#3f3a40'),
    E: rgb('#2e2635'),
    M: rgb('#a8525a'),
    b: rgb('#f4b0aa'),
    O: OUT,
    G: rgb('#6b5560'),
    W: rgb('#ffffff'),
    w: rgb('#fbf6ea'),
    A: rgb('#d95f5f'),
    a: rgb('#a84444'),
  }
  return {
    ...base,
    q: mix(base.S, base.s, 0.5),
    r: mix(base.C, base.c, 0.5),
    t: mix(base.P, base.p, 0.5),
    k: mix(base.H, base.h, 0.5),
    x: mix(base.c, OUT, 0.35),
    y: mix(base.p, OUT, 0.35),
    z: mix(base.h, OUT, 0.3),
    '2': mix(base.B, [255, 255, 255], 0.2),
  }
}

/** A palette from the generator's export (letter -> 'rrggbb'). */
export const paletteFromHex = (hex: Record<string, string>): Palette => Object.fromEntries(Object.entries(hex).map(([k, v]) => [k, rgb(v)]))

/**
 * Paints a letter grid (rows of letters, '.' empty) as RGBA: the palette colours, then a
 * 1px ring tinted from the colour it touches (lighter below and right of it, as lit
 * from the top-left) and half-tone pixels in the concave corners of the ring.
 */
export function recolor(grid: readonly string[], pal: Palette): Uint8ClampedArray<ArrayBuffer> {
  const h = grid.length
  const w = grid[0]?.length ?? 0
  const out = new Uint8ClampedArray(w * h * 4)
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && grid[y][x] !== '.' && !!pal[grid[y][x]]
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue
      const c = pal[grid[y][x]]
      out.set([c[0], c[1], c[2], 255], (y * w + x) * 4)
    }
  // the ring: empty pixels next to the sprite, coloured from the first neighbour inside it
  const ring = new Map<number, Rgb>()
  const order: [number, number, boolean][] = [
    [0, 1, true],
    [1, 0, true],
    [0, -1, false],
    [-1, 0, false],
  ]
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (inside(x, y)) continue
      for (const [dx, dy, lit] of order) {
        if (!inside(x + dx, y + dy)) continue
        const i = ((y + dy) * w + x + dx) * 4
        const base: Rgb = [out[i], out[i + 1], out[i + 2]]
        ring.set(y * w + x, mix(mix(base, BLACK, lit ? 0.62 : 0.72), OUT, 0.45))
        break
      }
    }
  for (const [k, c] of ring) out.set([c[0], c[1], c[2], 255], k * 4)
  // half-tone corners: an empty pixel with ring both beside and above or below it
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < w && y < h ? ring.get(y * w + x) : undefined)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (inside(x, y) || ring.has(y * w + x)) continue
      const hz = at(x - 1, y) ?? at(x + 1, y)
      if (hz && (at(x, y - 1) || at(x, y + 1))) out.set([hz[0], hz[1], hz[2], 110], (y * w + x) * 4)
    }
  return out
}
