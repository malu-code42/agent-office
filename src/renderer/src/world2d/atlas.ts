import atlasUrl from '../assets/pixel/atlas.png'
import atlasData from '../assets/pixel/atlas.json'
import projectBaseUrl from '../assets/pixel/project-base.png'
import projectData from '../assets/pixel/project.json'
import type { ProjectLayout } from './layout'
import { CHAR_H, CHAR_W, lookFrameAt } from './looks'

/** The project floor exported by scripts/pixel-art/export_app.py. */
export const PROJECT_LAYOUT = projectData as unknown as ProjectLayout

const DATA = atlasData as unknown as { frames: Record<string, [number, number, number, number]>; anchors: Record<string, [number, number]> }

/** The sprite sheet of the 2D world: frames by name, their anchors, and the pixels for hit-tests. */
export class Atlas {
  readonly image = new Image()
  readonly base = new Image()
  readonly frames = DATA.frames
  /** Where a bubble's tail tip or the shadow's centre is, inside its frame. */
  readonly anchors = DATA.anchors
  private alpha: Uint8ClampedArray | null = null
  private width = 0
  readonly ready: Promise<void>

  constructor() {
    const load = (img: HTMLImageElement, url: string) =>
      new Promise<void>((resolve) => {
        img.onload = () => resolve()
        // a missing sprite sheet leaves the floor empty instead of breaking the app
        img.onerror = () => resolve()
        img.src = url
      })
    this.ready = Promise.all([load(this.image, atlasUrl), load(this.base, projectBaseUrl)]).then(() => this.readAlpha())
  }

  get loaded(): boolean {
    return this.image.naturalWidth > 0
  }

  private readAlpha(): void {
    if (!this.loaded) return
    const c = document.createElement('canvas')
    c.width = this.image.naturalWidth
    c.height = this.image.naturalHeight
    const ctx = c.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(this.image, 0, 0)
    this.width = c.width
    this.alpha = ctx.getImageData(0, 0, c.width, c.height).data
  }

  /** Width and height of a frame (atlas frames, or `lookN/<dir>/<frame>` of a recoloured look). */
  size(name: string): [number, number] | null {
    const f = this.frames[name]
    if (f) return [f[2], f[3]]
    return lookFrameAt(name) ? [CHAR_W, CHAR_H] : null
  }

  /** Draws a frame with its top-left corner at (x, y) on a native-size canvas. */
  draw(ctx: CanvasRenderingContext2D, name: string, x: number, y: number): void {
    const f = this.frames[name]
    if (f) return ctx.drawImage(this.image, f[0], f[1], f[2], f[3], x, y, f[2], f[3])
    const look = lookFrameAt(name)
    if (look) ctx.drawImage(look.sheet.canvas, look.x, 0, CHAR_W, CHAR_H, x, y, CHAR_W, CHAR_H)
  }

  /** True when the pixel (u, v) of a frame is painted (hit-tests ignore the transparent corners). */
  solid(name: string, u: number, v: number): boolean {
    const look = this.frames[name] ? null : lookFrameAt(name)
    if (look) {
      if (u < 0 || v < 0 || u >= CHAR_W || v >= CHAR_H) return false
      return look.sheet.alpha[Math.floor(v) * look.sheet.canvas.width + look.x + Math.floor(u)] > 0
    }
    const f = this.frames[name]
    if (!f || u < 0 || v < 0 || u >= f[2] || v >= f[3]) return false
    if (!this.alpha) return true
    return this.alpha[((f[1] + Math.floor(v)) * this.width + f[0] + Math.floor(u)) * 4 + 3] > 0
  }
}
