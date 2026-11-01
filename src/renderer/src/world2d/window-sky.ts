// What the Casa's window shows: the sky for the hour of the day. Pure (no DOM), so a test checks it.

export type SkyPeriod = 'morning' | 'day' | 'evening' | 'night'

/** Morning 5-10, day 10-17, evening 17-19, night otherwise. */
export function skyPeriod(hour: number): SkyPeriod {
  if (hour >= 5 && hour < 10) return 'morning'
  if (hour >= 10 && hour < 17) return 'day'
  if (hour >= 17 && hour < 19) return 'evening'
  return 'night'
}

const SKY: Record<SkyPeriod, [string, string]> = {
  morning: ['#8fc6f0', '#ffd9a8'],
  day: ['#5fa8ee', '#bfe3ff'],
  evening: ['#5b4a8a', '#ff9a62'],
  night: ['#0d1230', '#27305c'],
}
const STARS: [number, number][] = [
  [0.1, 0.12],
  [0.28, 0.4],
  [0.45, 0.1],
  [0.62, 0.3],
  [0.8, 0.5],
  [0.2, 0.7],
  [0.55, 0.6],
  [0.9, 0.15],
]
const FRAME = '#8a6448'

const mix = (a: string, b: string, t: number): string => {
  const p = (c: string, i: number) => parseInt(c.slice(1 + i * 2, 3 + i * 2), 16)
  const ch = (i: number) => Math.round(p(a, i) + (p(b, i) - p(a, i)) * t)
  return `#${[0, 1, 2].map((i) => ch(i).toString(16).padStart(2, '0')).join('')}`
}

/** The colour of each pixel of a w×h window (row 0 on top), with its sun or moon, stars and cross bars. */
export function skyPixels(period: SkyPeriod, w: number, h: number): string[][] {
  const [top, bottom] = SKY[period]
  const disc = (cx: number, cy: number, r: number, u: number, v: number) => Math.hypot(u - cx * w, v - cy * h) <= r
  return Array.from({ length: h }, (_, v) =>
    Array.from({ length: w }, (_, u) => {
      if (Math.abs(u - (w - 1) / 2) < 1 || Math.abs(v - (h - 1) / 2) < 1) return FRAME
      if (period === 'morning' && disc(0.2, 0.7, 4, u, v)) return '#ffe27a'
      if (period === 'day' && disc(0.72, 0.22, 4, u, v)) return '#fff3a8'
      if (period === 'evening' && disc(0.8, 0.72, 5, u, v)) return '#ffb347'
      if (period === 'night') {
        if (disc(0.72, 0.3, 4, u, v) && !disc(0.72 + 0.06, 0.3 - 0.04, 4, u, v)) return '#f4f1d0'
        if (STARS.some(([sx, sy]) => Math.round(sx * w) === u && Math.round(sy * h) === v)) return '#ffffff'
      }
      return mix(top, bottom, h > 1 ? v / (h - 1) : 0)
    }),
  )
}
