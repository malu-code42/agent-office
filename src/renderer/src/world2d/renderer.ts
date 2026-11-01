import type { Look } from '@shared/types'
import type { TotemView } from '@shared/routines'
import type { ScreenMode } from './floor'
import type { CasaAct, CasaFlat, CasaLayout } from './casa'
import { skyPeriod, skyPixels } from './window-sky'
import type { EstudosFlat, StudyAct } from './estudos'
import { sharedAtlas } from './atlas'
import { depthSort, type Footprint } from './depth'
import { crtOf, type FlatFloor } from './floor'
import { artToScreen, clampCenter, onWestWall, deviceScale, dirOf, fitZoom, floorBounds, TILE, toFloor, toScreen, type Px } from './iso'
import type { Placement, SeatArt } from './layout'
import type { Bubble2d } from './sprites'
import { actAt, topmost } from './hit'

/** Someone on the floor, as the game sees it this frame. */
export interface Person2d {
  /** What a click on it answers (agent id, `member:<id>`, `helper:<id>`, `emi`). */
  key: string
  /** Character variant of the sprite sheet (0-7). */
  variant: number
  /** The colours it wears; without one, the variant's own. */
  look?: Look
  /** Position in tiles. */
  x: number
  z: number
  /** Radians, 0 = towards +z (Avatar.face). */
  heading: number
  /** Walk phase while it walks; null when it stands still. */
  stride: number | null
  /** Sitting (or typing): drawn on the chair (or sofa) under it, if there is one. */
  seated: boolean
  bubble: Bubble2d | null
  /** Typing at a desk, on the second frame of the loop (hands up). */
  alt?: boolean
  /** Knocked out by the skull: flat on the floor. */
  down?: boolean
  /** Drawn smaller (helpers) or shrinking away; 1 by default. */
  scale?: number
}

/** Something on the floor under the furniture: a helper's cord, the red pad of a failure. */
export type Decal =
  | { key: string; kind: 'cord'; from: { x: number; z: number }; to: { x: number; z: number }; color: string }
  | { key: string; kind: 'pad'; x: number; z: number }

/** Something in the air, over everything: the skull of a strike, a puff, a ghost. */
export interface Fx2d {
  key: string
  frame: 'skull' | 'ghost' | 'puff'
  /** Tiles; y = height. */
  x: number
  z: number
  y: number
  alpha: number
}

/** One frame of a 2D floor: a project floor, the Casa or the study floor (these two have no desks, rooms or Emi). */
export interface FlatView {
  floor: FlatFloor | CasaFlat | EstudosFlat
  people: Person2d[]
  /** Desk screen indices with a desk on the floor (squad members, individual agents). */
  desks: ReadonlySet<number>
  /** The coordinator's monitor of each squad room; null when nobody sits there. */
  coordinators: (ScreenMode | null)[]
  /** Emi's monitor, null without an Emi on this floor. */
  emi: ScreenMode | null
  /** The name of each squad room (the tooltip over it). */
  rooms: string[]
  /** How many sit in the meeting room. */
  meeting: number
  /** Hovered tile and whether it can be walked to. */
  hover: { x: number; z: number; ok: boolean } | null
  /** Where the camera looks (tiles). */
  target: { x: number; z: number }
  /** The clickable thing of the Casa or the study floor under the pointer: drawn a little brighter. */
  highlight?: CasaAct | StudyAct | null
  /** The elevator doors: closed, half open or open. */
  door?: 0 | 1 | 2
  decals?: Decal[]
  fx?: Fx2d[]
  /** What the routines board of the Casa shows. */
  totem?: TotemView | null
}

export type Hit =
  | { kind: 'person'; key: string }
  | { kind: 'room'; room: number }
  | { kind: 'meeting' }
  | { kind: 'elevator' }
  | { kind: 'casa'; act: CasaAct }
  | { kind: 'study'; act: StudyAct }

type Hot = { act: string; box: [number, number, number, number] }

/** The wall boards of a floor whose furniture answers clicks (the Casa, the study floor); null on a project floor. */
const hotOf = (view: FlatView): readonly Hot[] | null => (view.floor.kind === 'project' ? null : (view.floor.layout.hot as readonly Hot[]))

interface Sprite {
  f: string
  x: number
  y: number
  look?: Look
  /** Drawn from this canvas instead of the atlas (the routines board's screen). */
  img?: HTMLCanvasElement
  /** Drawn at this size (helpers): k art pixels per sprite pixel. */
  k?: number
  alpha?: number
}

/** Something drawn besides the furniture and the people: under them (decals, doors) or over them (fx). */
interface Extra {
  key: string
  sig: string
  area: Rect
  under: boolean
  draw(c: CanvasRenderingContext2D): void
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
  /** What a click on it does (the clickable furniture of the Casa and the study floor). */
  act?: string
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
/** Native pixels the pixel bubbles rise, to clear the name tag that sits right over the head. */
const BUBBLE_RAISE = 14
const LED_COLORS: Record<TotemView['led'], string> = { ok: '#2ee86b', wait: '#ffc02e', fail: '#ff3b4a', none: '#6b6a7d' }
/** 3x5 glyphs of the routines board's screen, rows top to bottom, '1' = lit. */
const GLYPHS: Record<string, string> = {
  '0': '111101101101111',
  '1': '010110010010111',
  '2': '110001010100111',
  '3': '110001010001110',
  '4': '101101111001001',
  '5': '111100110001110',
  '6': '011100111101111',
  '7': '111001010010010',
  '8': '111101111101111',
  '9': '111101111001110',
  D: '110101101101110',
  H: '101101111101101',
  M: '101111111101101',
  S: '011100010001110',
  '!': '010010010000010',
  '>': '100110111110100',
  '+': '000010111010000',
  '-': '000000111000000',
}
/** Height of the back walls and of the meeting table top, in art units. */
const WALL_H = 56
const TABLE_H = 12

const BG = '#1f1b24'
/** How the hovered clickable thing of the Casa stands out. */
const LIT = 'brightness(1.22)'

const hits = (a: Rect, b: Rect) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]
const union = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a[0], b[0])
  const y = Math.min(a[1], b[1])
  return [x, y, Math.max(a[0] + a[2], b[0] + b[2]) - x, Math.max(a[1] + a[3], b[1] + b[3]) - y]
}

/**
 * Canvas2D renderer of a 2D floor (project floor, Casa, study floor), pixel art at whole-number scales only.
 *
 * Three layers: the cache (base image, furniture, shades) is composed only when the floor
 * changes (a desk appears, a monitor changes colour); the native-size frame keeps the last
 * picture, and each draw repaints only the rectangles of the people that moved or changed
 * (from the base up, furniture and people in depth order, then the bubbles); the
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
  private people: PersonItem[] = []
  private extras: Extra[] = []
  private shown = new Map<string, { sig: string; area: Rect }>()
  private totemCanvas = document.createElement('canvas')
  private hoverBox: Rect | null = null
  private highlight: string | null = null
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
    readonly atlas = sharedAtlas(),
  ) {
    this.canvas.className = 'world-canvas world-canvas-2d hidden'
    container.appendChild(this.canvas)
    this.ctx = this.canvas.getContext('2d')!
    this.fctx = this.frame.getContext('2d')!
    this.cctx = this.cache.getContext('2d')!
    // helpers are drawn smaller: whole art pixels, never blurred
    this.fctx.imageSmoothingEnabled = false
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

  /** The camera jumps to its target on the next frame instead of easing there. */
  snap(): void {
    this.focus = null
  }

  /** The canvases the renderer keeps (screen, frame, cache, plates, painted characters): the leak test reads them. */
  get memory(): { canvases: number; bytes: number; skins: number } {
    const all = [this.canvas, this.frame, this.cache, this.totemCanvas, ]
    const skins = this.atlas.skinBytes
    return {
      canvases: all.length + skins.count,
      bytes: all.reduce((n, c) => n + c.width * c.height * 4, 0) + skins.bytes,
      skins: skins.count,
    }
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

  /** The name of the place under a point of a project floor, for the tooltip; null elsewhere. */
  roomAt(clientX: number, clientY: number): string | null {
    const view = this.last
    const at = this.floorAt(clientX, clientY)
    if (!view || !at || view.floor.kind !== 'project') return null
    const { layout } = view.floor
    const inRect = (r: readonly number[]) => at.x >= r[0] && at.z >= r[1] && at.x < r[2] && at.z < r[3]
    const room = layout.rooms.findIndex((r) => inRect(r.rect))
    if (room >= 0) return view.rooms[room] ?? null
    if (inRect(layout.meeting.rect)) return view.meeting ? `Sala de reunião · ${view.meeting} em reunião` : 'Sala de reunião'
    if (inRect(layout.director.rect)) return view.emi === null ? 'Diretoria' : 'Diretoria · Emi'
    if (inRect(layout.lounge.rect)) return 'Descanso e lazer'
    return null
  }

  /**
   * What is under a point of the page: a person (front first), a clickable thing of the Casa or the
   * study floor, a squad room's back wall or the meeting table (project floors have no plates), or the elevator door.
   */
  pick(clientX: number, clientY: number): Hit | null {
    const view = this.last
    if (!view) return null
    const p = this.toFrame(clientX, clientY)
    const solid = (f: string, u: number, v: number) => this.atlas.solid(f, u, v)
    const person = topmost(this.people, p, solid)
    if (person) return { kind: 'person', key: person.key }
    if (view.floor.kind === 'casa') {
      const act = actAt(this.items as { sprites: Sprite[]; act?: CasaAct }[], view.floor.layout.hot, p, solid)
      if (act) return { kind: 'casa', act }
    } else if (view.floor.kind === 'estudos') {
      const act = actAt(this.items as { sprites: Sprite[]; act?: StudyAct }[], view.floor.layout.hot, p, solid)
      if (act) return { kind: 'study', act }
    } else {
      const { origin, rooms, meeting } = view.floor.layout
      // a squad room answers on its back wall (the whiteboard side), the meeting room on its table
      const room = rooms.findIndex((room) => onWestWall(origin, p, room.rect[1] * TILE, room.rect[3] * TILE, WALL_H))
      if (room >= 0) return { kind: 'room', room }
      const fl = toFloor(origin, p.x, p.y + TABLE_H)
      const [tx, tz] = meeting.table
      if (Math.abs(fl.x * TILE - tx) < 18 && Math.abs(fl.z * TILE - tz) < 46) return { kind: 'meeting' }
    }
    const { origin, elevator } = view.floor.layout
    const [x0, x1, h] = elevator.door
    const a = artToScreen(origin, x0, 0, h)
    const b = artToScreen(origin, x1, 0, 0)
    if (p.x >= a.x && p.x < b.x && p.y >= a.y && p.y < b.y) return { kind: 'elevator' }
    return null
  }

  /** What the hovered clickable thing covers: its furniture and its wall board. */
  private litBoxes(view: FlatView, act: string | null): Rect[] {
    const hot = hotOf(view)
    if (!act || !hot) return []
    return [...this.items.filter((i) => i.act === act).map((i) => i.box), ...hot.filter((h) => h.act === act).map((h) => h.box)]
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
    this.people = this.placePeople(view)
    this.extras = this.extrasOf(view)
    const hoverBox = view.hover ? this.hoverRect(view) : null
    const highlight = view.highlight ?? null

    // what changed: the old and the new area of each person that moved, came or left
    const rects: Rect[] = []
    if (!full) {
      const now = new Set<string>()
      for (const p of [...this.people, ...this.extras]) {
        now.add(p.key)
        const was = this.shown.get(p.key)
        if (was?.sig === p.sig) continue
        rects.push(was ? union(was.area, p.area) : p.area)
      }
      for (const [key, was] of this.shown) if (!now.has(key)) rects.push(was.area)
      if (JSON.stringify(hoverBox) !== JSON.stringify(this.hoverBox)) for (const b of [hoverBox, this.hoverBox]) if (b) rects.push(b)
      if (highlight !== this.highlight) rects.push(...this.litBoxes(view, highlight), ...this.litBoxes(view, this.highlight))
    }
    const screenKey = `${ox},${oy},${s},${w},${h}`
    if (!full && !rects.length && screenKey === this.screenKey) return
    this.shown = new Map([...this.people, ...this.extras].map((p) => [p.key, { sig: p.sig, area: p.area }]))
    this.hoverBox = hoverBox
    this.highlight = highlight

    const f = this.fctx
    if (full) {
      f.drawImage(this.cache, 0, 0)
      // around each person (and the lit thing), the floor again from scratch: furniture and people in depth order
      const under = this.extras.filter((e) => e.under).map((e) => e.area)
      for (const b of [...this.people.map((p) => p.box), ...under, ...this.litBoxes(view, highlight)]) this.recompose(f, b, view, false)
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
    if (view.floor.kind === 'casa') return JSON.stringify(['casa', view.totem?.screen ?? null, view.totem?.led ?? null, skyPeriod(new Date().getHours())])
    if (view.floor.kind !== 'project') return view.floor.kind
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
    const items: Item[] = []
    const place = (p: Placement): Sprite => ({ f: p.f, x: p.x, y: p.y })
    const add = (fp: Footprint, sprites: Sprite[], seat?: SeatArt, act?: string) =>
      items.push({ fp, sprites, box: this.bounds(sprites), seat, act })
    const chair = (seat: SeatArt) => add(seat.fp, [place(seat.seat), place(seat.back)], seat)
    if (view.floor.kind === 'casa') {
      const { layout } = view.floor
      for (const p of layout.static) add(p.fp, [place(p)], undefined, p.act)
      for (const seat of layout.table.seats) chair(seat)
      chair(layout.voce.seat)
    } else if (view.floor.kind === 'estudos') {
      const { layout } = view.floor
      for (const p of layout.static) add(p.fp, [place(p)], undefined, p.act)
      for (const seat of [layout.cora, layout.bonnie, ...layout.visitors, ...layout.teachers, layout.student.seat, layout.notes])
        chair(seat)
    } else this.composeProject(view.floor, view, add, chair, place)
    this.items = depthSort(items)
    this.chairs = this.items.filter((i) => i.seat)

    const [cw, ch] = view.floor.layout.canvas
    this.cache.width = cw
    this.cache.height = ch
    const c = this.cctx
    c.drawImage(this.baseOf(view), 0, 0)
    if (view.floor.kind === 'casa') {
      const glass = this.windowGlass(view.floor.layout)
      c.drawImage(glass.img, glass.x, glass.y)
      this.put(c, this.totemScreen(view))
    }
    for (const item of this.items) for (const sp of item.sprites) this.put(c, sp)
    this.shades(c, view)
    this.cacheKey = key
  }

  private baseOf(view: FlatView): HTMLImageElement {
    return this.atlas.bases[view.floor.layout.base] ?? this.atlas.bases['project-base.png']
  }

  /** The desks, chairs and monitors of a project floor. */
  private composeProject(
    floor: FlatFloor,
    view: FlatView,
    add: (fp: Footprint, sprites: Sprite[]) => void,
    chair: (seat: SeatArt) => void,
    place: (p: Placement) => Sprite,
  ): void {
    const { layout, slots, crts } = floor
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
  }

  /** Lights off over the empty rooms nobody works in; an amber outline over the rooms a proposal holds. */
  private shades(c: CanvasRenderingContext2D, view: FlatView): void {
    if (view.floor.kind !== 'project') return
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
    if (view.floor.kind !== 'project') return
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
      const f = sp.img ? [0, 0, sp.img.width, sp.img.height] : this.atlas.frames[sp.f]
      if (!f) continue
      const k = sp.k ?? 1
      x0 = Math.min(x0, sp.x)
      y0 = Math.min(y0, sp.y)
      x1 = Math.max(x1, sp.x + Math.ceil(f[2] * k))
      y1 = Math.max(y1, sp.y + Math.ceil(f[3] * k))
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
      // above the name tag, which now sits close to the head
      return { f, x: x - a[0], y: y - a[1] - BUBBLE_RAISE }
    }
    const push = (p: Person2d, fp: Footprint, sprites: Sprite[], char: Sprite, bubble: Sprite | null, seat?: SeatArt) => {
      const box = this.bounds(sprites)
      const area = bubble ? union(box, this.bounds([bubble])) : box
      out.push({ fp, sprites, box, seat, key: p.key, char, bubble, area, sig: JSON.stringify([sprites, bubble]) })
    }
    const couches = view.floor.kind === 'casa' ? view.floor.layout.couch : []
    const near = (at: readonly number[], p: Person2d) => Math.hypot(at[0] / TILE - p.x, at[1] / TILE - p.z) < 0.35
    const onCouch = new Set<unknown>()
    for (const p of view.people) {
      const k = p.scale ?? 1
      const at = toScreen(origin, p.x, p.z)
      const px = Math.round(at.x)
      const py = Math.round(at.y)
      const ax = p.x * TILE
      const az = p.z * TILE
      if (p.down) {
        // knocked out: flat on the floor, the feet where it stood
        const f = `char/${p.variant}/down`
        const [, , w, h] = this.atlas.frames[f] ?? [0, 0, 32, 24]
        const char = { f, x: px - Math.round(w / 2), y: py - h + 4, look: p.look }
        push(p, [ax - 2, az - 2, ax + 2, az + 2], [char], char, bubbleAt(p.bubble, px + 3, py - 16))
        continue
      }
      const seat = p.seated && k === 1 ? this.chairs.find((c) => c.seat && !taken.has(c.seat) && near(c.seat.at, p))?.seat : undefined
      if (seat) {
        taken.add(seat)
        // typing: the second frame of the loop has a hand up
        const pose = p.alt ? seat.pose.replace('sit', 'type') : seat.pose
        const char = { f: `char/${p.variant}/${seat.dir}/${pose}`, x: seat.sit[0], y: seat.sit[1], look: p.look }
        const under = { f: seat.seat.f, x: seat.seat.x, y: seat.seat.y }
        const back = { f: seat.back.f, x: seat.back.x, y: seat.back.y }
        push(p, seat.fp, seat.front ? [under, char, back] : [under, back, char], char, bubbleAt(p.bubble, seat.head[0], seat.head[1]), seat)
        continue
      }
      // resting on a sofa: seated, behind its backrest
      const couch = p.seated && k === 1 ? couches.find((c) => !onCouch.has(c) && near(c.at, p)) : undefined
      if (couch) {
        onCouch.add(couch)
        const char = { f: `char/${p.variant}/${couch.dir}/${couch.pose}`, x: couch.sit[0], y: couch.sit[1], look: p.look }
        push(p, couch.fp, [char], char, bubbleAt(p.bubble, couch.head[0], couch.head[1]))
        continue
      }
      const frame = p.stride === null ? 'idle' : Math.sin(p.stride) > 0 ? 'walkA' : 'walkB'
      const char: Sprite = {
        f: `char/${p.variant}/${dirOf(p.heading)}/${frame}`,
        x: px - Math.round(12 * k),
        y: py - Math.round(30 * k),
        look: p.look,
        k: k === 1 ? undefined : k,
      }
      const sa = this.atlas.anchors.shadow ?? [0, 0]
      push(
        p,
        [ax - 2, az - 2, ax + 2, az + 2],
        [{ f: 'shadow', x: px - sa[0], y: py - sa[1] }, char],
        char,
        bubbleAt(p.bubble, px + 3, py - Math.round(29 * k)),
      )
    }
    return depthSort(out)
  }

  /**
   * Paints one rectangle of the frame again from the base up: the fixed items and the people
   * that touch it, back to front, the shades, and (`top`) the bubbles and the hovered tile.
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
    const base = this.baseOf(view)
    f.drawImage(base, x, y, w, h, x, y, w, h)
    const lit = this.highlight
    if (lit)
      for (const hot of hotOf(view) ?? [])
        if (hot.act === lit && hits(hot.box, r)) {
          f.filter = LIT
          f.drawImage(base, ...hot.box, ...hot.box)
          f.filter = 'none'
        }
    for (const e of this.extras) if (e.under && hits(e.area, r)) e.draw(f)
    for (const item of depthSort(items)) {
      if (lit && item.act === lit) f.filter = LIT
      for (const sp of item.sprites) this.put(f, sp)
      f.filter = 'none'
    }
    this.shades(f, view)
    if (top) this.top(f, view, r)
    f.restore()
  }

  /** Over everything, like the generator: the bubbles and the hovered tile (only those touching `r`). */
  private top(f: CanvasRenderingContext2D, view: FlatView, r: Rect | null): void {
    for (const p of this.people) if (p.bubble && (!r || hits(this.bounds([p.bubble]), r))) this.put(f, p.bubble)
    for (const e of this.extras) if (!e.under && (!r || hits(e.area, r))) e.draw(f)
    if (view.hover && (!r || (this.hoverBox && hits(this.hoverBox, r)))) this.hoverTile(f, view)
  }

  /** Draws a sprite: from the atlas (painted in its Look, at its size) or from its own canvas. */
  private put(c: CanvasRenderingContext2D, sp: Sprite): void {
    if (sp.alpha !== undefined) c.globalAlpha = sp.alpha
    if (sp.img) c.drawImage(sp.img, sp.x, sp.y)
    else this.atlas.draw(c, sp.f, sp.x, sp.y, sp.look, sp.k)
    c.globalAlpha = 1
  }

  /** The elevator doors and the decals (under the furniture), and the fx (over everything). */
  private extrasOf(view: FlatView): Extra[] {
    const out: Extra[] = []
    const { origin, elevator } = view.floor.layout
    const sprite = (key: string, sig: string, sp: Sprite, under: boolean) =>
      out.push({ key, sig, area: this.bounds([sp]), under, draw: (c) => this.put(c, sp) })
    const doors = view.door ? elevator.open?.[view.door - 1] : undefined
    if (doors) sprite('x:door', String(view.door), { f: doors.f, x: doors.x, y: doors.y }, true)
    for (const d of view.decals ?? []) {
      if (d.kind === 'cord') {
        // the cord lies on the floor: a pixel line from the desk to the helper, darker underneath
        const a = toScreen(origin, d.from.x, d.from.z)
        const b = toScreen(origin, d.to.x, d.to.z)
        const n = Math.max(1, Math.round(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y))))
        const pts: [number, number][] = []
        for (let i = 0; i <= n; i++) pts.push([Math.round(a.x + ((b.x - a.x) * i) / n), Math.round(a.y + ((b.y - a.y) * i) / n)])
        const xs = pts.map((p) => p[0])
        const ys = pts.map((p) => p[1])
        const x0 = Math.min(...xs)
        const y0 = Math.min(...ys)
        out.push({
          key: `x:${d.key}`,
          sig: JSON.stringify([pts[0], pts[n], d.color]),
          area: [x0 - 1, y0 - 1, Math.max(...xs) - x0 + 3, Math.max(...ys) - y0 + 3],
          under: true,
          draw: (c) => {
            c.fillStyle = 'rgba(30,24,36,0.45)'
            for (const [x, y] of pts) c.fillRect(x, y + 1, 1, 1)
            c.fillStyle = d.color
            for (const [x, y] of pts) c.fillRect(x, y, 1, 1)
          },
        })
      } else {
        // the red pad of a failure: a tile-sized diamond on the floor
        const pts = [
          toScreen(origin, d.x - 0.4, d.z - 0.4),
          toScreen(origin, d.x + 0.4, d.z - 0.4),
          toScreen(origin, d.x + 0.4, d.z + 0.4),
          toScreen(origin, d.x - 0.4, d.z + 0.4),
        ]
        const x0 = Math.floor(Math.min(...pts.map((p) => p.x)))
        const y0 = Math.floor(Math.min(...pts.map((p) => p.y)))
        out.push({
          key: `x:${d.key}`,
          sig: `${d.x},${d.z}`,
          area: [
            x0 - 1,
            y0 - 1,
            Math.ceil(Math.max(...pts.map((p) => p.x))) - x0 + 2,
            Math.ceil(Math.max(...pts.map((p) => p.y))) - y0 + 2,
          ],
          under: true,
          draw: (c) => {
            c.beginPath()
            pts.forEach((p, i) => (i ? c.lineTo(Math.round(p.x), Math.round(p.y)) : c.moveTo(Math.round(p.x), Math.round(p.y))))
            c.closePath()
            c.fillStyle = 'rgba(239,91,91,0.7)'
            c.fill()
            c.strokeStyle = '#a83a3a'
            c.lineWidth = 1
            c.stroke()
          },
        })
      }
    }
    for (const e of view.fx ?? []) {
      const f = `fx/${e.frame}`
      const fr = this.atlas.frames[f]
      if (!fr) continue
      const at = toScreen(origin, e.x, e.z, e.y)
      const sp = { f, x: Math.round(at.x - fr[2] / 2), y: Math.round(at.y - fr[3]), alpha: e.alpha }
      sprite(`x:fx:${e.key}`, `${sp.x},${sp.y},${Math.round(e.alpha * 10)}`, sp, false)
    }
    return out
  }

  /**
   * The routines board, hung on the west wall (plane x=0) beside the window; each column steps
   * down half a pixel, and y grows to the lower left, so the first canvas column is the last of
   * the wall: a frame, the LED colour on top and the countdown (or a symbol) below.
   */
  private totemScreen(view: FlatView): Sprite {
    const c = this.totemCanvas
    if (view.floor.kind !== 'casa') return { f: 'totem/screen', x: 0, y: 0, img: c }
    const { origin, totem } = view.floor.layout
    const [y0, y1, z0, z1] = totem
    const w = y1 - y0
    const zh = z1 - z0
    const top = (u: number) => Math.floor(origin[1] + (y0 + u) / 2 - z1)
    const left = origin[0] - y1 + 1
    c.width = w
    c.height = zh + top(w - 1) - top(0) + 1
    const g = c.getContext('2d')!
    const row = (k: number) => top(w - 1 - k) - top(0)
    const t = view.totem
    for (let k = 0; k < w; k++) {
      const edge = k === 0 || k === w - 1
      g.fillStyle = '#7b5a44'
      g.fillRect(k, row(k), 1, zh)
      if (edge) continue
      g.fillStyle = '#0e1018'
      g.fillRect(k, row(k) + 1, 1, zh - 2)
      g.fillStyle = LED_COLORS[t?.led ?? 'none']
      g.fillRect(k, row(k) + 1, 1, 2)
    }
    const sc = t?.screen ?? { kind: 'idle' as const }
    let text = sc.kind === 'count' ? sc.text : { wait: '!', run: '>', add: '+', idle: '-' }[sc.kind]
    // "2H14" does not fit three glyphs: the biggest unit is enough
    if (text.length > 3) text = text.replace(/\d+$/, '').slice(0, 3)
    g.fillStyle = sc.kind === 'wait' ? '#ffc02e' : sc.kind === 'count' ? '#ffb347' : '#b3b1cb'
    const u0 = Math.floor((w - (text.length * 4 - 1)) / 2)
    const v0 = Math.floor((zh - 5) / 2) + 1
    ;[...text].forEach((ch, i) => {
      const glyph = GLYPHS[ch] ?? GLYPHS['-']
      for (let n = 0; n < 15; n++) {
        if (glyph[n] !== '1') continue
        // the wall runs the other way: the glyph reads left to right on screen
        const k = u0 + i * 4 + (n % 3)
        g.fillRect(k, row(k) + v0 + Math.floor(n / 3), 1, 1)
      }
    })
    return { f: 'totem/screen', x: left, y: top(0), img: c }
  }

  /**
   * The glass of the window on the west wall (plane x=0), painted for the hour: each column of the
   * wall steps down half a pixel, like the routines board's screen. One pixel inside the frame.
   */
  private windowGlass(layout: CasaLayout): { x: number; y: number; img: HTMLCanvasElement } {
    const c = document.createElement('canvas')
    const [wy0, wy1, wz0, wz1] = layout.window
    const y0 = wy0 + 1
    const y1 = wy1 - 1
    const z0 = wz0 + 1
    const z1 = wz1 - 1
    const w = y1 - y0
    const zh = z1 - z0
    const top = (u: number) => Math.floor(layout.origin[1] + (y0 + u) / 2 - z1)
    c.width = w
    c.height = zh + top(w - 1) - top(0) + 1
    const g = c.getContext('2d')!
    const sky = skyPixels(skyPeriod(new Date().getHours()), w, zh)
    for (let u = 0; u < w; u++) {
      // y grows to the lower left: the first column of the canvas is the last of the wall
      const k = w - 1 - u
      for (let v = 0; v < zh; v++) {
        g.fillStyle = sky[v]![u]!
        g.fillRect(k, top(u) - top(0) + v, 1, 1)
      }
    }
    return { x: layout.origin[0] - y1 + 1, y: top(0), img: c }
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

}
