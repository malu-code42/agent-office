import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BAR_INTERVALS,
  BAR_MODES,
  barClockText,
  barInterrupt,
  barMs,
  barPause,
  barRemaining,
  barResume,
  barSettle,
  barStart,
  parseBarTimer,
} from '../src/shared/barTimer'

const MIN = 60_000
const now = 1_800_000_000_000 // an hour with no fat logic: any wall clock

afterEach(() => {
  vi.useRealTimers()
})

describe('Timer da barra (núcleo puro)', () => {
  it('has the three fixed intervals, in minutes and in ms', () => {
    expect([...BAR_MODES]).toEqual([25, 5, 15])
    expect(barMs(25)).toBe(25 * MIN)
    expect(BAR_INTERVALS.map((i) => i.mode)).toEqual([25, 5, 15])
  })

  it('starts with an absolute deadline: end time = now + interval', () => {
    const t = barStart(25, undefined, now)
    expect(t.state).toBe('em andamento')
    expect(t.endsAt).toBe(now + 25 * MIN)
  })

  it('keeps the optional task link (label only)', () => {
    const withTask = barStart(25, { id: 'tabc123', text: 'Lavar a máquina' }, now)
    expect(withTask.taskId).toBe('tabc123')
    expect(withTask.taskText).toBe('Lavar a máquina')
    const withoutTask = barStart(5, undefined, now)
    expect('taskId' in withoutTask).toBe(false)
  })

  it('counts down: the time left is computed from the clock now', () => {
    const t = barStart(25, undefined, now)
    expect(barRemaining(t, now + 6 * MIN + 30_000)).toBe(18 * MIN + 30_000)
    expect(barRemaining(t, now + 25 * MIN)).toBe(0)
    expect(barRemaining(t, now + 26 * MIN)).toBe(0) // never negative
  })

  it('a paused session keeps the time left', () => {
    const t0 = barStart(25, undefined, now)
    const t1 = barPause(t0, now + 6 * MIN + 30_000)
    expect(t1.state).toBe('pausada')
    expect(t1.endsAt).toBeUndefined()
    expect(t1.remainingMs).toBe(18 * MIN + 30_000)
    expect(barRemaining(t1, now + 30 * MIN)).toBe(18 * MIN + 30_000) // a pause does not drain
  })

  it('a resumed session gets back the deadline from what was left', () => {
    const t0 = barStart(25, undefined, now)
    const t1 = barPause(t0, now + 6 * MIN + 30_000)
    const t2 = barResume(t1, now + 9 * MIN)
    expect(t2.endsAt).toBe(now + 9 * MIN + 18 * MIN + 30_000)
    expect(t2.taskId).toBe(t1.taskId)
  })

  it('a session whose deadline passed is interrupted, never completed', () => {
    const t0 = barStart(25, undefined, now)
    const interrupted = barSettle(t0, now + 25 * MIN + 4_000)
    expect(interrupted.state).toBe('interrompida')
    expect(interrupted.remainingMs).toBe(0)
    expect(interrupted.endsAt).toBeUndefined()
    // a session with time to spare stays as it is
    expect(barSettle(t0, now + 5 * MIN)).toBe(t0)
  })

  it('only "em andamento" is shifted at zero: a paused one waits', () => {
    const t = barSettle({ ...barStart(5, undefined, now), state: 'pausada', remainingMs: 0 }, now)
    expect(t.state).toBe('pausada')
    expect(barInterrupt({ ...barStart(25, undefined, now) }, now + 3 * MIN).remainingMs).toBe(22 * MIN)
  })

  it('parses a session it can use and drops what it cannot', () => {
    expect(parseBarTimer({ mode: 25, state: 'em andamento', startedAt: now, endsAt: now + MIN })).toMatchObject({ mode: 25 })
    expect(parseBarTimer({ mode: 5, state: 'pausada', startedAt: now, remainingMs: 3 * MIN })).toMatchObject({ mode: 5 })
    expect(parseBarTimer({ mode: 30, state: 'em andamento', startedAt: now, endsAt: now })).toBeUndefined() // outside the intervals
    expect(parseBarTimer({ mode: 25, state: 'em andamento', startedAt: now })).toBeUndefined() // running needs a deadline
    expect(parseBarTimer({ mode: 25, state: 'confirmada', startedAt: now })).toBeUndefined() // state of the old AO-08
    expect(parseBarTimer(null)).toBeUndefined()
    expect(parseBarTimer('x')).toBeUndefined()
  })

  it('formats mm:ss, rounding up (00:01 for anything past zero)', () => {
    expect(barClockText(0)).toBe('00:00')
    expect(barClockText(1)).toBe('00:01')
    expect(barClockText(18 * MIN)).toBe('18:00')
    expect(barClockText(18 * MIN + 30_000)).toBe('18:30')
  })
})
