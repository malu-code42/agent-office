// Paints the pixel-art characters with the colours of a Look: skin, hair, shirt, pants and
// shoes. Each variant of the sheet carries the colour of every role it uses (atlas.json
// `palettes`, from scripts/pixel-art/chars.py); a role takes the Look's colour scaled the
// way it was scaled from its base colour, so the shading ramps survive. The outline ring
// of the generator (px.add_outline) follows the colour it touches, so it is mapped too.

import type { Look } from '@shared/types'

/** Role -> hex colour (no #) of one variant. */
export type Palette = Record<string, string>

/** The base each role is a shade of. */
const BASE: Record<string, string> = {
  S: 'S',
  s: 'S',
  q: 'S',
  H: 'H',
  h: 'H',
  L: 'H',
  k: 'H',
  z: 'H',
  C: 'C',
  c: 'C',
  r: 'C',
  x: 'C',
  P: 'P',
  p: 'P',
  t: 'P',
  y: 'P',
  B: 'B',
  B2: 'B',
}
const LOOK: Record<string, keyof Look> = { S: 'skin', H: 'hair', C: 'shirt', P: 'pants', B: 'shoes' }
const OUT = [0x2b, 0x23, 0x20]

type Rgb = [number, number, number]

const parse = (hex: string): Rgb | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [n >> 16, (n >> 8) & 255, n & 255]
}
const key = (c: readonly number[]) => (c[0] << 16) | (c[1] << 8) | c[2]
/** px.py _mix: truncates like Python's int(). */
const mix = (c: readonly number[], d: readonly number[], t: number): Rgb =>
  [0, 1, 2].map((i) => Math.trunc(c[i] * (1 - t) + d[i] * t)) as Rgb
/** The outline pixel next to a colour (px.add_outline): darker, towards the outline colour. */
const ring = (c: readonly number[], lit: boolean): Rgb => mix(mix(c, [0, 0, 0], lit ? 0.62 : 0.72), OUT, 0.45)

/**
 * Old colour -> new colour (as 0xRRGGBB) to dress a variant in a Look. A role keeps the
 * ratio to its base it had in the sheet; an unreadable Look colour leaves its roles alone.
 */
export function recolourMap(src: Palette, look: Look): Map<number, number> {
  const out = new Map<number, number>()
  const put = (from: Rgb, to: Rgb) => {
    if (!out.has(key(from))) out.set(key(from), key(to))
  }
  for (const [role, base] of Object.entries(BASE)) {
    const s = src[role] && parse(src[role])
    const b = src[base] && parse(src[base])
    const t = parse(String(look[LOOK[base]] ?? ''))
    if (!s || !b || !t) continue
    const to = [0, 1, 2].map((i) => Math.max(0, Math.min(255, Math.round(b[i] ? (t[i] * s[i]) / b[i] : t[i] + s[i])))) as Rgb
    put(s, to)
    put(ring(s, true), ring(to, true))
    put(ring(s, false), ring(to, false))
  }
  return out
}

/** Repaints RGBA pixels in place with a colour map (alpha kept, so the half-tone corners follow too). */
export function recolour(px: Uint8ClampedArray, map: Map<number, number>): void {
  for (let i = 0; i < px.length; i += 4) {
    if (!px[i + 3]) continue
    const to = map.get((px[i] << 16) | (px[i + 1] << 8) | px[i + 2])
    if (to === undefined) continue
    px[i] = to >> 16
    px[i + 1] = (to >> 8) & 255
    px[i + 2] = to & 255
  }
}

/** The key of a variant in a Look: the same key reuses the same painted sheet. */
export const skinKey = (variant: number, look: Look) => `${variant}|${look.skin}|${look.hair}|${look.shirt}|${look.pants}|${look.shoes}`
