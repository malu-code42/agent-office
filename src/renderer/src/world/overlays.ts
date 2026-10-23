import * as THREE from 'three'
import type { Engine } from './engine'
import { resolveTagOverlaps, type TagRect } from './tag-avoid'

export type BubbleKind = 'work' | 'wait' | 'done' | 'error' | 'idle' | 'talk'

/** HTML name tag + speech bubble that follows a 3D anchor. */
export class Tag {
  readonly el: HTMLDivElement
  private nameEl: HTMLSpanElement
  private roleEl: HTMLSpanElement
  private dotEl: HTMLSpanElement
  private bubbleEl: HTMLDivElement
  private helpersEl: HTMLSpanElement
  private accountEl: HTMLSpanElement
  private name = ''
  private bubbleText = ''
  private bubbleKind: BubbleKind | null = null
  /** The pill changed on screen: the overlay has to measure it again. */
  changed = true
  hidden = false

  constructor(
    readonly anchor: THREE.Object3D,
    name: string,
    you = false,
    onClick?: () => void,
  ) {
    this.el = document.createElement('div')
    this.el.className = 'tag' + (you ? ' tag-you' : '')
    this.bubbleEl = document.createElement('div')
    this.bubbleEl.className = 'bubble hidden'
    const pill = document.createElement('div')
    pill.className = 'tag-pill'
    // The pill stacks what it says: the name on top, what it does below.
    const heading = document.createElement('span')
    heading.className = 'tag-heading'
    this.dotEl = document.createElement('span')
    this.dotEl.className = 'dot'
    this.nameEl = document.createElement('span')
    this.nameEl.className = 'tag-title'
    this.nameEl.textContent = name
    this.roleEl = document.createElement('span')
    this.roleEl.className = 'tag-role hidden'
    this.accountEl = document.createElement('span')
    this.accountEl.className = 'tag-account hidden'
    this.helpersEl = document.createElement('span')
    this.helpersEl.className = 'helpers hidden'
    heading.append(this.dotEl, this.nameEl, this.accountEl)
    pill.append(heading, this.roleEl, this.helpersEl)
    this.el.append(this.bubbleEl, pill)
    this.setName(name)
    if (onClick) {
      pill.addEventListener('click', onClick)
      this.bubbleEl.addEventListener('click', onClick)
    }
  }

  setName(name: string): void {
    if (this.name === name) return
    this.name = name
    // "Nome · papel" breaks into lines: the name on top, the paper below.
    const parts = name.split(' · ')
    const title = parts[0] ?? ''
    const role = parts.slice(1).join(' · ')
    this.nameEl.textContent = title
    if (this.roleEl.textContent !== role) this.roleEl.textContent = role
    this.roleEl.className = role ? 'tag-role' : 'tag-role hidden'
    this.changed = true
  }

  /** Subagents working for this agent; 0 hides the counter. */
  setHelpers(n: number): void {
    const text = n ? `+${n}` : ''
    if (this.helpersEl.textContent === text) return
    this.helpersEl.textContent = text
    this.helpersEl.className = n ? 'helpers' : 'helpers hidden'
    this.helpersEl.title = n === 1 ? '1 subagente trabalhando' : `${n} subagentes trabalhando`
    this.changed = true
  }

  /** The account the agent runs on, as a tinted chip; null hides it. */
  setAccount(name: string | null, color = ''): void {
    const key = name ? `${name}|${color}` : ''
    if (this.accountEl.dataset.key === key) return
    this.accountEl.dataset.key = key
    this.accountEl.textContent = name ?? ''
    this.accountEl.className = name ? 'tag-account' : 'tag-account hidden'
    this.accountEl.style.setProperty('--acct', color)
    this.accountEl.title = name ? `Conta ${name}` : ''
    this.changed = true
  }

  setDot(status: string): void {
    const cls = `dot dot-${status}`
    if (this.dotEl.className !== cls) this.dotEl.className = cls
  }

  setBubble(text: string | null, kind: BubbleKind = 'work'): void {
    if (text === this.bubbleText && kind === this.bubbleKind) return
    this.bubbleText = text ?? ''
    this.bubbleKind = kind
    if (!text) {
      this.bubbleEl.className = 'bubble hidden'
      return
    }
    this.bubbleEl.className = `bubble bubble-${kind}`
    this.bubbleEl.textContent = text
    this.changed = true
  }
}

export class Overlays {
  private tags = new Set<Tag>()
  private labels: { el: HTMLDivElement; pos: THREE.Vector3; floor: number }[] = []
  private tmp = new THREE.Vector3()
  /** The drift of each tag: its measured size and the offset it sits at now. */
  private drift = new WeakMap<Tag, { w: number; h: number; shown: boolean; dx: number; dy: number }>()
  /** Floor on screen: labels of other floors hide. */
  floor = 0

  constructor(
    private root: HTMLElement,
    private engine: Engine,
  ) {}

  /** HTML elements following the world: name tags plus zone labels. */
  get count(): number {
    return this.tags.size + this.labels.length
  }

  add(tag: Tag): Tag {
    this.tags.add(tag)
    this.root.appendChild(tag.el)
    return tag
  }

  remove(tag: Tag): void {
    this.tags.delete(tag)
    this.drift.delete(tag)
    tag.el.remove()
  }

  label(text: string, x: number, z: number, floor = 0, onClick?: () => void): void {
    const el = document.createElement('div')
    el.className = 'zone-label'
    el.textContent = text
    if (onClick) {
      el.classList.add('zone-label-click')
      el.setAttribute('role', 'button')
      el.tabIndex = 0
      el.addEventListener('click', onClick)
      el.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        e.stopPropagation()
        onClick()
      })
    }
    this.root.prepend(el)
    this.labels.push({ el, pos: new THREE.Vector3(x, 0, z), floor })
  }

  /** Drops the labels of a floor that is being rebuilt. */
  clearLabels(floor: number): void {
    for (const l of this.labels) if (l.floor === floor) l.el.remove()
    this.labels = this.labels.filter((l) => l.floor !== floor)
  }

  update(dt = 0): void {
    for (const l of this.labels) {
      l.el.style.display = l.floor === this.floor ? '' : 'none'
      if (l.floor !== this.floor) continue
      const p = this.engine.project(l.pos)
      l.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`
    }

    // Where each tag is anchored now, measuring only the ones with new content:
    // the browser size is read once per change, not once per frame.
    const live: { t: Tag; m: TagDrift; x: number; y: number }[] = []
    for (const t of this.tags) {
      const m = this.drift.get(t) ?? this.adrift(t, !t.hidden)
      const shown = !t.hidden
      if (m.shown !== shown) {
        // The floor turned: a tag coming back to the screen is laid out again.
        m.shown = shown
        m.w = 0
        m.dx = 0
        m.dy = 0
      }
      if (!shown) {
        m.w = 0
        t.el.style.display = 'none'
        t.el.style.transform = ''
        continue
      }
      t.el.style.display = ''
      if (t.changed) {
        t.changed = false
        m.w = t.el.offsetWidth
        m.h = t.el.offsetHeight
      }
      t.anchor.getWorldPosition(this.tmp)
      const p = this.engine.project(this.tmp)
      live.push({ t, m, x: p.x, y: p.y })
    }

    // The crowding of the pills: the drift each one should take so nothing is
    // covered, and the place it slides to (a jump would look broken). When the
    // room comes back, the drift falls back to zero the same gentle way.
    const boxes: TagRect[] = live.map(({ m, x, y }) => ({ x: x - m.w / 2, y: y - m.h, w: m.w, h: m.h }))
    const wanted = resolveTagOverlaps(boxes)
    const ease = Math.min(1, dt * 7) // about a tenth of the way per frame at 60fps
    const onto = (cur: number, to: number): number => (Math.abs(to - cur) < 0.5 ? to : cur + (to - cur) * ease)
    for (let i = 0; i < live.length; i++) {
      const { t, m, x, y } = live[i]
      const d = wanted[i]
      m.dx = onto(m.dx, d.dx)
      m.dy = onto(m.dy, d.dy)
      t.el.style.transform = `translate(${x + m.dx}px, ${y + m.dy}px) translate(-50%, -100%)`
      // The depth stays anchored: the drift is sideways, not further from the camera.
      t.el.style.zIndex = String(1000 + y)
    }
  }

  /** The drift of a tag, kept per tag so a removed tag leaves no work behind. */
  private adrift(t: Tag, shown: boolean): TagDrift {
    const m: TagDrift = { w: 0, h: 0, shown, dx: 0, dy: 0 }
    this.drift.set(t, m)
    return m
  }
}

/** How a tag drifts: its measured size on screen and the offset it sits at now. */
interface TagDrift {
  /** Measured width and height; 0 while it is off screen (not laid out). */
  w: number
  h: number
  /** Whether the tag was visible on the last update. */
  shown: boolean
  /** The offset the tag sits at now, easing towards what the overlap asks. */
  dx: number
  dy: number
}
