import type { Look } from '@shared/types'
import { sharedAtlas } from '../world2d/atlas'
import { variantOf } from '../world2d/sprites'

/** The head of the 2D sprite (front, standing): x, y, w, h inside its 24x32 frame. */
const BUST: [number, number, number, number] = [4, 3, 16, 16]

/**
 * Paints a frame of the look's 2D sprite on a canvas, scaled by a whole number: the same recoloured
 * pixel art the floors draw (one recolour path, world2d/skins.ts). The sheet loads once; a canvas made
 * before that is painted when it arrives.
 */
function paint(c: HTMLCanvasElement, look: Look, frame: string, k: number, at: [number, number], crop?: typeof BUST): void {
  const atlas = sharedAtlas()
  const draw = () => {
    const name = `char/${variantOf(look)}/${frame}`
    const f = atlas.frames[name]
    if (!f) return
    const [cx, cy, cw, ch] = crop ?? [0, 0, f[2], f[3]]
    // the whole sprite at scale k off-screen, then the crop copied
    const tmp = document.createElement('canvas')
    tmp.width = f[2] * k
    tmp.height = f[3] * k
    const t = tmp.getContext('2d')!
    t.imageSmoothingEnabled = false
    atlas.draw(t, name, 0, 0, look, k)
    const ctx = c.getContext('2d')!
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(tmp, cx * k, cy * k, cw * k, ch * k, at[0], at[1], cw * k, ch * k)
  }
  if (atlas.loaded) draw()
  else void atlas.ready.then(draw)
}

/** Bust of an avatar: the head of its 2D sprite, at the biggest whole-number scale that fits `size` CSS pixels. */
export function portrait(look: Look, size = 32): HTMLCanvasElement {
  const dpr = Math.max(1, window.devicePixelRatio || 1)
  const px = Math.max(1, Math.round(size * dpr))
  const c = document.createElement('canvas')
  c.width = px
  c.height = px
  c.className = 'portrait'
  c.style.width = `${size}px`
  c.style.height = `${size}px`
  c.style.background = look.shirt + '55'
  const k = Math.max(1, Math.floor(px / BUST[2]))
  paint(c, look, 'FL/idle', k, [Math.floor((px - BUST[2] * k) / 2), px - BUST[3] * k], BUST)
  return c
}

/** The look editor's preview: the whole sprite from the front and from the back, at a whole-number scale. */
export function lookPreview(look: Look, scale = 4): HTMLElement {
  const box = document.createElement('div')
  box.className = 'look-sprite'
  box.setAttribute('role', 'img')
  box.setAttribute('aria-label', 'Prévia do personagem, de frente e de costas')
  for (const frame of ['FL/idle', 'BR/idle']) {
    const c = document.createElement('canvas')
    c.width = 24 * scale
    c.height = 32 * scale
    c.className = 'look-sprite-frame'
    paint(c, look, frame, scale, [0, 0])
    box.append(c)
  }
  return box
}
