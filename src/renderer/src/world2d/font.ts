// Metrics of the plaque font (scripts/pixel-art/font5.py): pure, so the tests check them.

import font from '../assets/pixel/font5.json'

export type Rgb = [number, number, number]

export const GLYPHS = font as Record<string, string[]>
export const BG: Rgb = [0x2e, 0x2a, 0x33]
export const FG = '#f6eedc'
export const RING: Rgb = [0x15, 0x12, 0x1a]
const BLANK = ['..', '..', '..', '..', '..', '..', '..', '..', '..']

export const glyph = (ch: string): string[] => GLYPHS[ch] ?? GLYPHS[ch.normalize('NFD')[0]] ?? BLANK

/** Width in pixels of a line of text (one blank column between letters). */
export function textWidth(text: string): number {
  let w = -1
  for (const ch of text) w += glyph(ch)[0].length + 1
  return Math.max(0, w)
}

/** Size of the plate (without its ring): 2px padding, two more rows when a letter hangs below the line. */
export function plaqueSize(text: string): { w: number; h: number } {
  return { w: textWidth(text) + 4, h: 11 + (/[gjpqyç,]/.test(text) ? 2 : 0) }
}

const mix = (c: Rgb, d: Rgb, t: number): Rgb => [0, 1, 2].map((i) => Math.trunc(c[i] * (1 - t) + d[i] * t)) as Rgb

/** The ring colours: lit on the top and left edges, darker on the bottom and right (px.add_outline). */
export function ringColors(bg: Rgb = BG, col: Rgb = RING): { lit: Rgb; shade: Rgb } {
  return { lit: mix(mix(bg, [0, 0, 0], 0.62), col, 0.45), shade: mix(mix(bg, [0, 0, 0], 0.72), col, 0.45) }
}

/** Left edge of a plate centred on cx, the way the generator rounds it. */
export const plaqueLeft = (cx: number, text: string) => Math.trunc(cx - plaqueSize(text).w / 2)
