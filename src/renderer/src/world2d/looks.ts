import type { Look } from '@shared/types'
import charsData from '../assets/pixel/chars.json'
import { cutOf, paletteOf, recolor } from './recolor'

const CHARS = charsData as unknown as { w: number; h: number; frames: string[]; grids: Record<string, string[][]> }
export const CHAR_W = CHARS.w
export const CHAR_H = CHARS.h

/** All frames of one look, side by side, painted once. */
export interface LookSheet {
  /** Prefix of its frame names: `${id}/FL/idle`. */
  id: string
  canvas: HTMLCanvasElement
  alpha: Uint8ClampedArray
}

const sheets = new Map<string, LookSheet>()
const byId = new Map<string, LookSheet>()

const keyOf = (look: Look) => [look.skin, look.hair, cutOf(look), look.shirt, look.pants, look.shoes].join('|')

/** The character sheet of a look, recoloured on first use and kept (no recolouring per frame). */
export function lookSheet(look: Look): LookSheet {
  const key = keyOf(look)
  let sheet = sheets.get(key)
  if (sheet) return sheet
  const pal = paletteOf(look)
  const grids = CHARS.grids[cutOf(look)]
  const canvas = document.createElement('canvas')
  canvas.width = CHAR_W * CHARS.frames.length
  canvas.height = CHAR_H
  const alpha = new Uint8ClampedArray(canvas.width * CHAR_H)
  const ctx = canvas.getContext('2d')!
  grids.forEach((grid, i) => {
    const px = recolor(grid, pal)
    ctx.putImageData(new ImageData(px, CHAR_W, CHAR_H), i * CHAR_W, 0)
    for (let y = 0; y < CHAR_H; y++)
      for (let x = 0; x < CHAR_W; x++) alpha[y * canvas.width + i * CHAR_W + x] = px[(y * CHAR_W + x) * 4 + 3]
  })
  sheet = { id: `look${sheets.size}`, canvas, alpha }
  sheets.set(key, sheet)
  byId.set(sheet.id, sheet)
  return sheet
}

/** Where a frame ('FL/idle', 'BL/sitB'...) is in a look's sheet; -1 when the sheet has no such frame. */
export const frameIndex = (frame: string) => CHARS.frames.indexOf(frame)

/** The sheet and column of a frame name made by lookFrame, or null. */
export function lookFrameAt(name: string): { sheet: LookSheet; x: number } | null {
  const slash = name.indexOf('/')
  const sheet = byId.get(name.slice(0, slash))
  const i = frameIndex(name.slice(slash + 1))
  return sheet && i >= 0 ? { sheet, x: i * CHAR_W } : null
}

/** Draws one frame of a look at (x, y) scaled by a whole number. */
export function drawLook(
  ctx: CanvasRenderingContext2D,
  look: Look,
  frame: string,
  x: number,
  y: number,
  scale = 1,
  crop?: [number, number, number, number],
): void {
  const sheet = lookSheet(look)
  const [cx, cy, cw, ch] = crop ?? [0, 0, CHAR_W, CHAR_H]
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(sheet.canvas, frameIndex(frame) * CHAR_W + cx, cy, cw, ch, x, y, cw * scale, ch * scale)
}
