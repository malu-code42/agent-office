import type { Look } from '@shared/types'
import { CHAR_H, CHAR_W, drawLook } from '../world2d/looks'

/** The head of the 2D sprite (front, standing): x, y, w, h inside its frame. */
const BUST: [number, number, number, number] = [4, 3, 16, 16]

/**
 * Bust of an avatar: the same recoloured pixel-art sprite the 2D floors draw, at the
 * biggest whole-number scale that fits `size` CSS pixels (crisp at any device ratio).
 */
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
  drawLook(c.getContext('2d')!, look, 'FL/idle', Math.floor((px - BUST[2] * k) / 2), px - BUST[3] * k, k, BUST)
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
    c.width = CHAR_W * scale
    c.height = CHAR_H * scale
    c.className = 'look-sprite-frame'
    drawLook(c.getContext('2d')!, look, frame, 0, 0, scale)
    box.append(c)
  }
  return box
}
