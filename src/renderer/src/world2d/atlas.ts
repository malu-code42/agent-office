import type { Look } from '@shared/types'
import atlasUrl from '../assets/pixel/atlas.png'
import atlasData from '../assets/pixel/atlas.json'
import projectBaseUrl from '../assets/pixel/project-base.png'
import projectData from '../assets/pixel/project.json'
import casaBaseUrl from '../assets/pixel/casa-base.png'
import casaData from '../assets/pixel/casa.json'
import estudosBaseUrl from '../assets/pixel/estudos-base.png'
import estudosData from '../assets/pixel/estudos.json'
import type { CasaLayout } from './casa'
import type { EstudosLayout } from './estudos'
import type { ProjectLayout } from './layout'
import { recolour, recolourMap, skinKey, type Palette } from './skins'

/** The project floor exported by scripts/pixel-art/export_app.py. */
export const PROJECT_LAYOUT = projectData as unknown as ProjectLayout
/** The Casa (ground floor) exported by scripts/pixel-art/export_app.py. */
export const CASA_LAYOUT = casaData as unknown as CasaLayout
/** The study floor exported by scripts/pixel-art/export_app.py. */
export const ESTUDOS_LAYOUT = estudosData as unknown as EstudosLayout

const DATA = atlasData as unknown as {
  frames: Record<string, [number, number, number, number]>
  anchors: Record<string, [number, number]>
  palettes: Palette[]
}

/** Painted sheets kept at once (one per variant and Look on screen). */
const SKINS_MAX = 96

let shared: Atlas | null = null

/** The one sprite sheet of the app: the floors and the portraits paint from it, so it loads once. */
export function sharedAtlas(): Atlas {
  shared ??= new Atlas()
  return shared
}

/** The sprite sheet of the 2D world: frames by name, their anchors, and the pixels for hit-tests. */
export class Atlas {
  readonly image = new Image()
  /** The base image of each floor, by the name its layout gives. */
  readonly bases: Record<string, HTMLImageElement> = {
    'project-base.png': new Image(),
    'casa-base.png': new Image(),
    'estudos-base.png': new Image(),
  }
  readonly frames = DATA.frames
  /** Where a bubble's tail tip or the shadow's centre is, inside its frame. */
  readonly anchors = DATA.anchors
  private pixels: Uint8ClampedArray | null = null
  private width = 0
  /** Characters painted in a Look: a strip of the variant's frames and where each one is. */
  private skins = new Map<string, { canvas: HTMLCanvasElement; at: Map<string, number> }>()
  readonly ready: Promise<void>

  constructor() {
    const load = (img: HTMLImageElement, url: string) =>
      new Promise<void>((resolve) => {
        img.onload = () => resolve()
        // a missing sprite sheet leaves the floor empty instead of breaking the app
        img.onerror = () => resolve()
        img.src = url
      })
    this.ready = Promise.all([
      load(this.image, atlasUrl),
      load(this.bases['project-base.png'], projectBaseUrl),
      load(this.bases['casa-base.png'], casaBaseUrl),
      load(this.bases['estudos-base.png'], estudosBaseUrl),
    ]).then(() => this.readPixels())
  }

  get loaded(): boolean {
    return this.image.naturalWidth > 0
  }

  private readPixels(): void {
    if (!this.loaded) return
    const c = document.createElement('canvas')
    c.width = this.image.naturalWidth
    c.height = this.image.naturalHeight
    const ctx = c.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(this.image, 0, 0)
    this.width = c.width
    this.pixels = ctx.getImageData(0, 0, c.width, c.height).data
  }

  /** Draws a frame with its top-left corner at (x, y) on a native-size canvas; `look` paints a character, `k` scales it. */
  draw(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, look?: Look, k = 1): void {
    const f = this.frames[name]
    if (!f) return
    const skin = look ? this.skin(name, look) : null
    const w = Math.round(f[2] * k)
    const h = Math.round(f[3] * k)
    if (skin) ctx.drawImage(skin.canvas, skin.x, 0, f[2], f[3], x, y, w, h)
    else ctx.drawImage(this.image, f[0], f[1], f[2], f[3], x, y, w, h)
  }

  /** The painted character sheets kept now and their pixels (bytes): the leak test reads them. */
  get skinBytes(): { count: number; bytes: number } {
    let bytes = 0
    for (const s of this.skins.values()) bytes += s.canvas.width * s.canvas.height * 4
    return { count: this.skins.size, bytes }
  }

  /** The frame of a character (`char/<variant>/...`) painted in a Look, built once per variant and Look. */
  private skin(name: string, look: Look): { canvas: HTMLCanvasElement; x: number } | null {
    const m = /^char\/(\d+)\//.exec(name)
    const palette = m ? DATA.palettes?.[Number(m[1])] : undefined
    if (!m || !palette || !this.pixels) return null
    const variant = Number(m[1])
    const k = skinKey(variant, look)
    let sheet = this.skins.get(k)
    if (!sheet) {
      if (this.skins.size >= SKINS_MAX) this.skins.clear()
      const names = Object.keys(this.frames).filter((n) => n.startsWith(`char/${variant}/`))
      const at = new Map<string, number>()
      let w = 0
      let h = 0
      for (const n of names) {
        at.set(n, w)
        w += this.frames[n][2] + 1
        h = Math.max(h, this.frames[n][3])
      }
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, w)
      canvas.height = Math.max(1, h)
      const img = new ImageData(canvas.width, canvas.height)
      for (const n of names) {
        const [fx, fy, fw, fh] = this.frames[n]
        const ox = at.get(n)!
        for (let v = 0; v < fh; v++) {
          const from = ((fy + v) * this.width + fx) * 4
          img.data.set(this.pixels.subarray(from, from + fw * 4), (v * canvas.width + ox) * 4)
        }
      }
      recolour(img.data, recolourMap(palette, look))
      canvas.getContext('2d')!.putImageData(img, 0, 0)
      sheet = { canvas, at }
      this.skins.set(k, sheet)
    }
    const x = sheet.at.get(name)
    return x === undefined ? null : { canvas: sheet.canvas, x }
  }

  /** True when the pixel (u, v) of a frame is painted (hit-tests ignore the transparent corners). */
  solid(name: string, u: number, v: number): boolean {
    const f = this.frames[name]
    if (!f || u < 0 || v < 0 || u >= f[2] || v >= f[3]) return false
    if (!this.pixels) return true
    return this.pixels[((f[1] + Math.floor(v)) * this.width + f[0] + Math.floor(u)) * 4 + 3] > 0
  }
}
