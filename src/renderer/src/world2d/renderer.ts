import type { Look } from '@shared/types'
import type { ScreenMode } from '../world/screens'
import { lookSheet } from './looks'
import { Atlas } from './atlas'
import { depthSort, type Footprint } from './depth'
import { crtOf, type FlatFloor } from './floor'
import { artToScreen, clampCenter, deviceScale, dirOf, fitZoom, floorBounds, TILE, toFloor, toScreen, type Px } from './iso'
import type { Placement, SeatArt } from './layout'
import { plaqueLeft } from './font'
import { makePlaque } from './plaque'
import type { Bubble2d } from './sprites'
import { topmost } from './hit'

/** Someone on the floor, as the game sees it this frame. */
export interface Person2d {
  /** What a click on it answers (agent id, `member:<id>`, `helper:<id>`, `emi`). */
  key: string
  /** Character variant of the sprite sheet (0-7), used when there is no look. */
  variant: number
  /** The agent's look: the sprite wears its colours and hair cut. */
  look?: Look
  /** Position in tiles. */
  x: number
  z: number
  /** Radians, 0 = towards +z (Avatar.face). */
  heading: number
  /** Walk phase while it walks; null when it stands still. */
  stride: number | null
  /** Sitting (or typing): drawn on the chair under it, if there is one. */
  seated: boolean
  bubble: Bubble2d | null
}

/** One frame of the 2D project floor. */
export interface FlatView {
  floor: FlatFloor
  people: Person2d[]
  /** Desk screen indices with a desk on the floor (squad members, individual agents). */
  desks: ReadonlySet<number>
  /** The coordinator's monitor of each squad room; null when nobody sits there. */
  coordinators: (ScreenMode | null)[]
  /** Emi's monitor, null without an Emi on this floor. */
  emi: ScreenMode | null
  /** The plate of each squad room. */
  rooms: string[]
  /** How many sit in the meeting room. */
  meeting: number
  /** Hovered tile and whether it can be walked to. */
  hover: { x: number; z: number; ok: boolean } | null
  /** Where the camera looks (tiles). */
  target: { x: number; z: number }
}

export type Hit = { kind: 'person'; key: string } | { kind: 'room'; room: number } | { kind: 'meeting' } | { kind: 'elevator' }

interface Sprite {
  f: string
  x: number
  y: number
}

type Rect = [number, number, number, number]

/** Something that sorts by its footprint: a piece of furniture, a chair (with its sitter) or a person. */
interface Item {
  fp: Footprint
  sprites: Sprite[]
  /** Bounds on the native canvas: x, y, w, h. */
  box: Rect
  /** A chair: the person sitting on it replaces it. */
  seat?: SeatArt
}

/** A person as drawn this frame. */
interface PersonItem extends Item {
  key: string
  char: Sprite
  bubble: Sprite | null
  /** What it looks like: a change redraws its area. */
  sig: string
  /** Its box and its bubble's. */
  area: Rect
}

const ZOOM_MAX = 3
const BG = '#1f1b24'

const hits = (a: Rect, b: Rect) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]
const union = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a[0], b[0])
  const y = Math.min(a[1], b[1])
  return [x, y, Math.max(a[0] + a[2], b[0] + b[2]) - x, Math.max(a[1] + a[3], b[1] + b[3]) - y]
}

/**
 * Canvas2D renderer of a 2D project floor, pixel art at whole-number scales only.
 *
 * Three layers: the cache (base image, furniture, shades) is composed only when the floor
 * changes (a desk appears, a monitor changes colour); the native-size frame keeps the last
 * picture, and each draw repaints only the rectangles of the people that moved or changed
 * (from the base up, furniture and people in depth order, then bubbles and plates); the
 * screen gets only those rectangles, scaled. A frame where nothing changed draws nothing.
 */
export class Renderer2d {
  readonly canvas = document.createElement('canvas')
  private ctx: CanvasRenderingContext2D
  private frame = document.createElement('canvas')
  private fctx: CanvasRenderingContext2D
  private cache = document.createElement('canvas')
  private cctx: CanvasRenderingContext2D
  private cacheKey = ''
  /** Fixed items in depth order, and the chairs among them. */
  private items: Item[] = []
  private chairs: Item[] = []
  private plaques = new Map<string, HTMLCanvasElement>()
  private plates: { canvas: HTMLCanvasElement; box: Rect; hit?: Hit }[] = []
  private platesKey = ''
  private people: PersonItem[] = []
  private shown = new Map<string, { sig: string; area: Rect }>()
  private hoverBox: Rect | null = null
  private screenKey = ''
  /** 0 = fit the floor to the window. */
  private zoom = 0
  private focus: Px | null = null
  private view = { ox: 0, oy: 0, s: 1 }
  private last: FlatView | null = null
  /** Camera still easing towards its target. */
  moving = false
  /** The whole picture has to be drawn again (resize, zoom, sprites loaded). */
  dirty = true

  constructor(
    container: HTMLElement,
    readonly atlas = new Atlas(),
  ) {
    this.canvas.className = 'world-canvas world-canvas-2d hidden'
    container.appendChild(this.canvas)
    this.ctx = this.canvas.getContext('2d')!
    this.fctx = this.frame.getContext('2d')!
    this.cctx = this.cache.getContext('2d')!
    new ResizeObserver(() => (this.dirty = true)).observe(container)
    void atlas.ready.then(() => {
      this.cacheKey = ''
      this.dirty = true
    })
  }

  show(on: boolean): void {
    if (this.canvas.classList.contains('hidden') !== on) return
    this.canvas.classList.toggle('hidden', !on)
    this.dirty = true
    if (!on) this.focus = null
  }

  zoomStep(delta: number): void {
    const now = this.zoom || this.fit()
    this.zoom = Math.max(1, Math.min(ZOOM_MAX, now + delta))
    this.dirty = true
  }

  private fit(): number {
    const layout = this.last?.floor.layout
    return layout ? fitZoom(floorBounds(layout.origin, layout.size), { w: this.canvas.width, h: this.canvas.height }, devicePixelRatio) : 1
  }

  /** Native canvas pixel under a point of the page. */
  private toFrame(clientX: number, clientY: number): Px {
    const r = this.canvas.getBoundingClientRect()
    const k = r.width ? this.canvas.width / r.width : 1
    return { x: ((clientX - r.left) * k - this.view.ox) / this.view.s, y: ((clientY - r.top) * k - this.view.oy) / this.view.s }
  }

  /** Page position (CSS pixels in the container) of a world point: tiles, y = height. */
  project(x: number, y: number, z: number): Px {
    const layout = this.last?.floor.layout
    if (!layout) return { x: -9999, y: -9999 }
    const p = toScreen(layout.origin, x, z, y)
    const k = this.canvas.clientWidth ? this.canvas.width / this.canvas.clientWidth : 1
    return { x: Math.round((p.x * this.view.s + this.view.ox) / k), y: Math.round((p.y * this.view.s + this.view.oy) / k) }
  }

  /** The tile coordinates under a point of the page. */
  floorAt(clientX: number, clientY: number): { x: number; z: number } | null {
    const layout = this.last?.floor.layout
    if (!layout) return null
    const p = this.toFrame(clientX, clientY)
    return toFloor(layout.origin, p.x, p.y)
  }

  /** The camera target moved by a drag of (dx, dy) page pixels, in tiles. */
  panBy(dx: number, dy: number): { x: number; z: number } {
    const r = this.canvas.getBoundingClientRect()
    const k = (r.width ? this.canvas.width / r.width : 1) / this.view.s
    return toFloor([0, 0], -dx * k, -dy * k)
  }

  /** What is under a point of the page: a plate, a person (front first) or the elevator door. */
  pick(clientX: number, clientY: number): Hit | null {
    const view = this.last
    if (!view) return null
    const p = this.toFrame(clientX, clientY)
    const inside = (b: Rect) => p.x >= b[0] && p.y >= b[1] && p.x < b[0] + b[2] && p.y < b[1] + b[3]
    for (const plate of this.plates) if (plate.hit && inside(plate.box)) return plate.hit
    const person = topmost(this.people, p, (f, u, v) => this.atlas.solid(f, u, v))
    if (person) return { kind: 'person', key: person.key }
    const { origin, elevator } = view.floor.layout
    const [x0, x1, h] = elevator.door
    const a = artToScreen(origin, x0, 0, h)
    const b = artToScreen(origin, x1, 0, 0)
    if (p.x >= a.x && p.x < b.x && p.y >= a.y && p.y < b.y) return { kind: 'elevator' }
    return null
  }

  /** Draws what changed on the floor since the last frame (nothing, most of the time). */
  draw(view: FlatView, dt: number): void {
    this.last = view
    const layout = view.floor.layout
    if (!this.atlas.loaded) return
    const w = Math.max(1, Math.round(this.canvas.clientWidth * devicePixelRatio))
    const h = Math.max(1, Math.round(this.canvas.clientHeight * devicePixelRatio))
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
      this.dirty = true
    }
    const s = deviceScale(this.zoom || this.fit(), devicePixelRatio)
    // the camera: the target a little above the feet, kept on the floor, eased, whole pixels
    const want = clampCenter(toScreen(layout.origin, view.target.x, view.target.z, 1), floorBounds(layout.origin, layout.size), {
      w: w / s,
      h: h / s,
    })
    this.focus ??= want
    const k = 1 - Math.exp(-dt * 8)
    this.focus = { x: this.focus.x + (want.x - this.focus.x) * k, y: this.focus.y + (want.y - this.focus.y) * k }
    this.moving = Math.hypot(want.x - this.focus.x, want.y - this.focus.y) > 0.5
    if (!this.moving) this.focus = want
    const ox = Math.round(w / 2 - Math.round(this.focus.x) * s)
    const oy = Math.round(h / 2 - Math.round(this.focus.y) * s)
    this.view = { ox, oy, s }

    const [cw, ch] = layout.canvas
    if (this.frame.width !== cw || this.frame.height !== ch) {
      this.frame.width = cw
      this.frame.height = ch
      this.dirty = true
    }
    const key = this.staticKey(view)
    let full = this.dirty
    if (key !== this.cacheKey) {
      this.compose(view, key)
      full = true
    }
    const platesKey = JSON.stringify([view.rooms, view.coordinators.map((c) => c !== null), view.meeting, view.emi !== null])
    if (platesKey !== this.platesKey) {
      this.platesKey = platesKey
      this.plates = this.plateList(view)
      full = true
    }
    this.people = this.placePeople(view)
    const hoverBox = view.hover ? this.hoverRect(view) : null

    // what changed: the old and the new area of each person that moved, came or left
    const rects: Rect[] = []
    if (!full) {
      const now = new Set<string>()
      for (const p of this.people) {
        now.add(p.key)
        const was = this.shown.get(p.key)
        if (was?.sig === p.sig) continue
        rects.push(was ? union(was.area, p.area) : p.area)
      }
      for (const [key, was] of this.shown) if (!now.has(key)) rects.push(was.area)
      if (JSON.stringify(hoverBox) !== JSON.stringify(this.hoverBox)) for (const b of [hoverBox, this.hoverBox]) if (b) rects.push(b)
    }
    const screenKey = `${ox},${oy},${s},${w},${h}`
    if (!full && !rects.length && screenKey === this.screenKey) return
    this.shown = new Map(this.people.map((p) => [p.key, { sig: p.sig, area: p.area }]))
    this.hoverBox = hoverBox

    const f = this.fctx
    if (full) {
      f.drawImage(this.cache, 0, 0)
      // around each person, the floor again from scratch: furniture and people in depth order
      for (const p of this.people) this.recompose(f, p.box, view, false)
      this.top(f, view, null)
    } else for (const r of rects) this.recompose(f, r, view, true)

    const c = this.ctx
    c.imageSmoothingEnabled = false
    if (full || screenKey !== this.screenKey) {
      c.fillStyle = BG
      c.fillRect(0, 0, w, h)
      c.drawImage(this.frame, ox, oy, cw * s, ch * s)
    } else
      for (const [x, y, rw, rh] of rects) {
        const x0 = Math.max(0, Math.floor(x))
        const y0 = Math.max(0, Math.floor(y))
        const x1 = Math.min(cw, Math.ceil(x + rw))
        const y1 = Math.min(ch, Math.ceil(y + rh))
        if (x1 > x0 && y1 > y0) c.drawImage(this.frame, x0, y0, x1 - x0, y1 - y0, ox + x0 * s, oy + y0 * s, (x1 - x0) * s, (y1 - y0) * s)
      }
    this.screenKey = screenKey
    this.dirty = false
  }

  /** What the cache shows: the desks, their monitors, the rooms' lights. */
  private staticKey(view: FlatView): string {
    const { plan, crts } = view.floor
    return JSON.stringify([
      [...view.desks].sort((a, b) => a - b).map((i) => [i, crtOf(crts[i]?.mode)]),
      view.coordinators.map(crtOf),
      view.emi === null ? null : crtOf(view.emi),
      plan.rooms.map((r) => r.state),
    ])
  }

  /** Builds the cache: base image, every fixed item in depth order, the shade over empty rooms. */
  private compose(view: FlatView, key: string): void {
    const { layout, slots, crts } = view.floor
    const items: Item[] = []
    const place = (p: Placement): Sprite => ({ f: p.f, x: p.x, y: p.y })
    const add = (fp: Footprint, sprites: Sprite[], seat?: SeatArt) => items.push({ fp, sprites, box: this.bounds(sprites), seat })
    const chair = (seat: SeatArt) => add(seat.fp, [place(seat.seat), place(seat.back)], seat)
    for (const p of layout.static) add(p.fp, [place(p)])
    layout.rooms.forEach((room, r) => {
      const coord = room.coordinator.desk[crtOf(view.coordinators[r])]
      add(coord.fp, [place(coord)])
      chair(room.coordinator.seat)
    })
    for (const [index, at] of slots) {
      if (!view.desks.has(index)) continue
      const slot = layout.rooms[at.room].slots[at.slot]
      const desk = slot.desk[crtOf(crts[index]?.mode)]
      add(desk.fp, [place(desk)])
      chair(slot.seat)
    }
    const emi = layout.emi.desk[crtOf(view.emi)]
    add(emi.fp, [place(emi)])
    chair(layout.emi.seat)
    for (const seat of layout.meeting.seats) chair(seat)
    this.items = depthSort(items)
    this.chairs = this.items.filter((i) => i.seat)

    const [cw, ch] = layout.canvas
    this.cache.width = cw
    this.cache.height = ch
    const c = this.cctx
    c.drawImage(this.atlas.base, 0, 0)
    for (const item of this.items) for (const sp of item.sprites) this.atlas.draw(c, sp.f, sp.x, sp.y)
    this.shades(c, view)
    this.cacheKey = key
  }

  /** Lights off over the empty rooms nobody works in; an amber outline over the rooms a proposal holds. */
  private shades(c: CanvasRenderingContext2D, view: FlatView): void {
    const { plan, layout, slots } = view.floor
    plan.rooms.forEach((room, r) => {
      if (room.state === 'proposed') this.outline(c, view, r)
      else if (room.state === 'empty' && ![...view.desks].some((d) => slots.get(d)?.room === r)) this.shade(c, layout.rooms[r].dark)
    })
  }

  /** Lights off: the room's volume darkened, as the generator's Scene.darken does. */
  private shade(c: CanvasRenderingContext2D, pts: [number, number][]): void {
    c.save()
    c.globalCompositeOperation = 'multiply'
    c.fillStyle = 'rgb(128,133,158)'
    c.beginPath()
    pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)))
    c.closePath()
    c.fill()
    c.restore()
  }

  /** A team waiting for approval: an amber outline on the room's floor. */
  private outline(c: CanvasRenderingContext2D, view: FlatView, r: number): void {
    const [x0, z0, x1, z1] = view.floor.layout.rooms[r].rect
    const o = view.floor.layout.origin
    const pts = [toScreen(o, x0, z0), toScreen(o, x1, z0), toScreen(o, x1, z1), toScreen(o, x0, z1)]
    c.save()
    c.beginPath()
    pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)))
    c.closePath()
    c.fillStyle = 'rgba(255,215,106,0.22)'
    c.fill()
    c.strokeStyle = '#ffd76a'
    c.lineWidth = 2
    c.stroke()
    c.restore()
  }

  private bounds(sprites: Sprite[]): Rect {
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const sp of sprites) {
      const f = this.atlas.size(sp.f)
      if (!f) continue
      x0 = Math.min(x0, sp.x)
      y0 = Math.min(y0, sp.y)
      x1 = Math.max(x1, sp.x + f[0])
      y1 = Math.max(y1, sp.y + f[1])
    }
    return x0 === Infinity ? [0, 0, 0, 0] : [x0, y0, x1 - x0, y1 - y0]
  }

  /** The people as items in depth order: a sitter takes the place of its chair, the others stand on a shadow. */
  private placePeople(view: FlatView): PersonItem[] {
    const { origin } = view.floor.layout
    const taken = new Set<SeatArt>()
    const out: PersonItem[] = []
    const bubbleAt = (kind: Bubble2d | null, x: number, y: number): Sprite | null => {
      if (!kind) return null
      const f = `bubble/${kind}`
      const a = this.atlas.anchors[f] ?? [0, 0]
      return { f, x: x - a[0], y: y - a[1] }
    }
    const push = (p: Person2d, fp: Footprint, sprites: Sprite[], char: Sprite, bubble: Sprite | null, seat?: SeatArt) => {
      const box = this.bounds(sprites)
      const area = bubble ? union(box, this.bounds([bubble])) : box
      out.push({ fp, sprites, box, seat, key: p.key, char, bubble, area, sig: JSON.stringify([sprites, bubble]) })
    }
    for (const p of view.people) {
      const seat = p.seated
        ? this.chairs.find((c) => c.seat && !taken.has(c.seat) && Math.hypot(c.seat.at[0] / TILE - p.x, c.seat.at[1] / TILE - p.z) < 0.35)
            ?.seat
        : undefined
      if (seat) {
        taken.add(seat)
        const char = { f: `${this.charOf(p)}/${seat.dir}/${seat.pose}`, x: seat.sit[0], y: seat.sit[1] }
        const under = { f: seat.seat.f, x: seat.seat.x, y: seat.seat.y }
        const back = { f: seat.back.f, x: seat.back.x, y: seat.back.y }
        push(p, seat.fp, seat.front ? [under, char, back] : [under, back, char], char, bubbleAt(p.bubble, seat.head[0], seat.head[1]), seat)
        continue
      }
      const at = toScreen(origin, p.x, p.z)
      const px = Math.round(at.x)
      const py = Math.round(at.y)
      const frame = p.stride === null ? 'idle' : Math.sin(p.stride) > 0 ? 'walkA' : 'walkB'
      const char = { f: `${this.charOf(p)}/${dirOf(p.heading)}/${frame}`, x: px - 12, y: py - 30 }
      const sa = this.atlas.anchors.shadow ?? [0, 0]
      const ax = p.x * TILE
      const az = p.z * TILE
      push(
        p,
        [ax - 2, az - 2, ax + 2, az + 2],
        [{ f: 'shadow', x: px - sa[0], y: py - sa[1] }, char],
        char,
        bubbleAt(p.bubble, px + 3, py - 29),
      )
    }
    return depthSort(out)
  }

  /** Frame prefix of a person: its look's recoloured sheet, or a variant of the atlas. */
  private charOf(p: Person2d): string {
    return p.look ? lookSheet(p.look).id : `char/${p.variant}`
  }

  /**
   * Paints one rectangle of the frame again from the base up: the fixed items and the people
   * that touch it, back to front, the shades, and (`top`) the bubbles, hover and plates.
   */
  private recompose(f: CanvasRenderingContext2D, r: Rect, view: FlatView, top: boolean): void {
    const [x, y, w, h] = r
    const taken = new Set(this.people.map((p) => p.seat).filter((s) => s))
    const items: Item[] = [
      ...this.items.filter((i) => !(i.seat && taken.has(i.seat)) && hits(i.box, r)),
      ...this.people.filter((i) => hits(i.box, r)),
    ]
    f.save()
    f.beginPath()
    f.rect(x, y, w, h)
    f.clip()
    f.drawImage(this.atlas.base, x, y, w, h, x, y, w, h)
    for (const item of depthSort(items)) for (const sp of item.sprites) this.atlas.draw(f, sp.f, sp.x, sp.y)
    this.shades(f, view)
    if (top) this.top(f, view, r)
    f.restore()
  }

  /** Over everything, like the generator: the bubbles, the hovered tile and the plates (only those touching `r`). */
  private top(f: CanvasRenderingContext2D, view: FlatView, r: Rect | null): void {
    for (const p of this.people)
      if (p.bubble && (!r || hits(this.bounds([p.bubble]), r))) this.atlas.draw(f, p.bubble.f, p.bubble.x, p.bubble.y)
    if (view.hover && (!r || (this.hoverBox && hits(this.hoverBox, r)))) this.hoverTile(f, view)
    for (const plate of this.plates) if (!r || hits(plate.box, r)) f.drawImage(plate.canvas, plate.box[0], plate.box[1])
  }

  private hoverRect(view: FlatView): Rect {
    const { x, z } = view.hover!
    const a = toScreen(view.floor.layout.origin, x, z)
    return [Math.floor(a.x - TILE) - 1, Math.floor(a.y) - 1, 2 * TILE + 2, TILE + 2]
  }

  private hoverTile(f: CanvasRenderingContext2D, view: FlatView): void {
    const { x, z, ok } = view.hover!
    const o = view.floor.layout.origin
    const pts = [toScreen(o, x, z), toScreen(o, x + 1, z), toScreen(o, x + 1, z + 1), toScreen(o, x, z + 1)]
    f.save()
    f.beginPath()
    pts.forEach((p, i) => (i ? f.lineTo(p.x, p.y + 0.5) : f.moveTo(p.x, p.y + 0.5)))
    f.closePath()
    f.strokeStyle = ok ? 'rgba(255,255,255,0.85)' : 'rgba(255,138,128,0.9)'
    f.lineWidth = 1
    f.stroke()
    f.restore()
  }

  /** The name plates: room names, coordinators, meeting room, diretoria, lounge; the clickable ones answer pick(). */
  private plateList(view: FlatView): { canvas: HTMLCanvasElement; box: Rect; hit?: Hit }[] {
    const { layout } = view.floor
    const out: { canvas: HTMLCanvasElement; box: Rect; hit?: Hit }[] = []
    const plate = (text: string, at: [number, number], hit?: Hit) => {
      let c = this.plaques.get(text)
      if (!c) {
        c = makePlaque(text)
        this.plaques.set(text, c)
      }
      out.push({ canvas: c, box: [plaqueLeft(at[0], text) - 1, at[1] - 1, c.width, c.height], hit })
    }
    layout.rooms.forEach((room, r) => {
      plate(view.rooms[r] ?? '', room.plate, { kind: 'room', room: r })
      if (view.coordinators[r] !== null) plate('Coordenação', room.coordinator.plate)
    })
    plate(view.meeting ? `Sala de reunião · ${view.meeting} em reunião` : 'Sala de reunião', layout.meeting.plate, { kind: 'meeting' })
    plate(view.emi === null ? 'Diretoria' : 'Diretoria · Emi', layout.director.plate)
    plate('Descanso e lazer', layout.lounge.plate)
    return out
  }
}
