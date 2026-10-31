// The dark name plates of the pixel-art floors (scripts/pixel-art/font5.py plaque): a
// proportional 9-row bitmap font on a dark plate with a 1px tinted ring.

import { BG, FG, glyph, plaqueSize, ringColors, type Rgb } from './font'

/** How many plate canvases the renderer keeps: a floor shows about a dozen plates, so all fit with room to spare. */
export const PLAQUE_CACHE_CAP = 32

const css = (c: Rgb, a = 255) => `rgba(${c[0]},${c[1]},${c[2]},${a / 255})`

/** A plate drawn once at native size, its ring included (one pixel around the plate). */
export function makePlaque(text: string): HTMLCanvasElement {
  const { w, h } = plaqueSize(text)
  const c = document.createElement('canvas')
  c.width = w + 2
  c.height = h + 2
  const ctx = c.getContext('2d')!
  const { lit, shade } = ringColors()
  ctx.fillStyle = css(BG)
  ctx.fillRect(1, 1, w, h)
  ctx.fillStyle = css(lit)
  ctx.fillRect(1, 0, w, 1)
  ctx.fillRect(0, 1, 1, h)
  ctx.fillStyle = css(shade)
  ctx.fillRect(1, h + 1, w, 1)
  ctx.fillRect(w + 1, 1, 1, h)
  // half-tone corners so the plate reads rounded
  ctx.fillStyle = css(lit, 110)
  ctx.fillRect(0, 0, 1, 1)
  ctx.fillRect(w + 1, 0, 1, 1)
  ctx.fillStyle = css(shade, 110)
  ctx.fillRect(0, h + 1, 1, 1)
  ctx.fillRect(w + 1, h + 1, 1, 1)
  ctx.fillStyle = FG
  let x = 3
  for (const ch of text) {
    const g = glyph(ch)
    g.forEach((row, r) => {
      for (let k = 0; k < row.length; k++) if (row[k] === '#') ctx.fillRect(x + k, 3 + r, 1, 1)
    })
    x += g[0].length + 1
  }
  return c
}
