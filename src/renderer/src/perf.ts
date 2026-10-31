/**
 * Performance panel (F3 or ?perf in the URL) and the numbers behind `npm run bench`.
 *
 * Kept apart from the render loop on purpose: whoever draws a frame calls
 * `perf.begin()` before the work and `perf.frame(dt)` after it. The panel
 * never touches the scene, so the loop can change (render on demand, quality levels)
 * without this file knowing.
 */

/** One frame as the panel and the bench see it. */
interface Sample {
  /** Time since the previous frame, in ms (what the screen shows). */
  frameMs: number
  /** Time spent inside the frame (update + draw), in ms. */
  workMs: number
}

export interface Stats {
  mean: number
  p95: number
  max: number
}

export interface BenchReport {
  seconds: number
  frames: number
  fps: number
  frameMs: Stats
  workMs: Stats
  overlays: number
  heapMB: number | null
  counters: Record<string, number>
}

const PANEL_EVERY_MS = 250

let startedAt = 0
let lastAt = 0
let last: Sample = { frameMs: 0, workMs: 0 }
/** Frames of the last second, for the fps and averages on the panel. */
let recent: Sample[] = []
let recording: Sample[] | null = null
/** The bench records the loop's own pacing (idle tick, fps limit) instead of every frame. */
let live = false
let el: HTMLDivElement | null = null
let drawnAt = 0
const sources = new Map<string, () => number>()

function stats(values: number[]): Stats {
  if (!values.length) return { mean: 0, p95: 0, max: 0 }
  const sorted = [...values].sort((a, b) => a - b)
  const mean = values.reduce((s, v) => s + v, 0) / values.length
  const round = (v: number) => Math.round(v * 100) / 100
  return {
    mean: round(mean),
    p95: round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]),
    max: round(sorted.at(-1)!),
  }
}

function heapMB(): number | null {
  // Chromium only; Electron always has it.
  const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
  return mem ? Math.round((mem.usedJSHeapSize / 1048576) * 10) / 10 : null
}

function counters(): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [name, read] of sources) out[name] = read()
  return out
}

function draw(now: number): void {
  if (!el || now - drawnAt < PANEL_EVERY_MS) return
  drawnAt = now
  const span = recent.length > 1 ? recent.reduce((s, f) => s + f.frameMs, 0) : 0
  const fps = span ? Math.round((recent.length * 1000) / span) : 0
  const work = stats(recent.map((f) => f.workMs))
  const frame = stats(recent.map((f) => f.frameMs))
  const heap = heapMB()
  const rows: [string, string][] = [
    ['fps', String(fps)],
    ['ms/frame', `${frame.mean.toFixed(1)} · p95 ${frame.p95.toFixed(1)}`],
    ['ms de CPU', `${work.mean.toFixed(1)} · p95 ${work.p95.toFixed(1)}`],
    ...[...sources].map(([name, read]): [string, string] => [name, String(read())]),
    ['heap JS', heap === null ? '—' : `${heap} MB`],
  ]
  el.replaceChildren(
    ...rows.map(([k, v]) => {
      const row = document.createElement('div')
      const key = document.createElement('span')
      key.textContent = k
      const val = document.createElement('b')
      val.textContent = v
      row.append(key, val)
      return row
    }),
  )
}

export const perf = {
  /** True while the bench records every frame: the loop should not throttle itself. */
  get recording(): boolean {
    return recording !== null && !live
  },

  get visible(): boolean {
    return el !== null
  },

  /** An extra number on the panel and in the bench report (e.g. HTML overlays). */
  source(name: string, read: () => number): void {
    sources.set(name, read)
  },

  /** Call right before the frame's work. */
  begin(): void {
    startedAt = performance.now()
  },

  /** Call once per drawn frame, after the draw. */
  frame(_dt: number): void {
    const now = performance.now()
    if (!lastAt) {
      lastAt = now
      return
    }
    last = { frameMs: now - lastAt, workMs: startedAt ? now - startedAt : 0 }
    lastAt = now
    startedAt = 0
    recording?.push(last)
    if (el) {
      recent.push(last)
      let total = 0
      for (let i = recent.length - 1; i >= 0; i--) {
        total += recent[i].frameMs
        if (total > 1000) {
          recent = recent.slice(i)
          break
        }
      }
      draw(now)
    }
  },

  toggle(on = !el): void {
    if (on === !!el) return
    if (!on) {
      el?.remove()
      el = null
      recent = []
      return
    }
    el = document.createElement('div')
    el.className = 'perf-panel'
    document.body.appendChild(el)
    drawnAt = 0
  },

  /**
   * Records `ms` of frames and sums them up; used by the bench. `paced` keeps the loop's
   * own pacing, so `fps` says how many frames a still office really draws per second.
   */
  async record(ms: number, paced = false): Promise<BenchReport> {
    live = paced
    recording = []
    const t0 = performance.now()
    await new Promise((r) => setTimeout(r, ms))
    const frames = recording
    recording = null
    live = false
    const seconds = (performance.now() - t0) / 1000
    const extra = counters()
    return {
      seconds: Math.round(seconds * 10) / 10,
      frames: frames.length,
      fps: Math.round((frames.length / seconds) * 10) / 10,
      frameMs: stats(frames.map((f) => f.frameMs)),
      workMs: stats(frames.map((f) => f.workMs)),
      overlays: extra.overlays ?? 0,
      heapMB: heapMB(),
      counters: extra,
    }
  },

  /** The extra sources now (overlays, canvas memory...). */
  memory(): Record<string, number> {
    return counters()
  },
}

/** F3 toggles the panel; ?perf in the URL opens it at startup. */
export function bindPerfKeys(): void {
  if (new URLSearchParams(location.search).has('perf')) perf.toggle(true)
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'F3') return
    e.preventDefault()
    perf.toggle()
  })
}
