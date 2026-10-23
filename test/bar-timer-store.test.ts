import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DATA_FILES } from '../src/main/backups'
import { BarTimerStore } from '../src/main/bar-timer-store'

const MIN = 60_000
const NOW = 1_900_000_000_000

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ao-bar-timer-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('BarTimerStore', () => {
  it('starts, counts and saves a session in timer.json', () => {
    const store = new BarTimerStore(dir, () => NOW)
    const view = store.start(25, { id: 'tabc123', text: 'Lavar a máquina' })
    expect(view.state).toBe('em andamento')
    expect(view.endsAt).toBe(NOW + 25 * MIN)
    expect(view.taskId).toBe('tabc123')

    const file = JSON.parse(readFileSync(join(dir, 'timer.json'), 'utf8'))
    expect(file.timer.endsAt).toBe(NOW + 25 * MIN)
    expect(readdirSync(dir).filter((n) => n.endsWith('.tmp'))).toEqual([])
  })

  it('pauses and resumes: the deadline returns from what was left', () => {
    let clock = NOW
    const store = new BarTimerStore(dir, () => clock)
    store.start(5, undefined)
    clock = NOW + 2 * MIN
    const paused = store.pause()
    expect(paused.state).toBe('pausada')
    expect(paused.remainingMs).toBe(3 * MIN)

    clock = NOW + 4 * MIN
    const returned = store.resume()
    expect(returned.state).toBe('em andamento')
    expect(returned.endsAt).toBe(NOW + 4 * MIN + 3 * MIN)
  })

  it('refuses to pause what is not running, and to resume what is not paused', () => {
    let clock = NOW
    const store = new BarTimerStore(dir, () => clock)
    expect(() => store.pause()).toThrow(/pausado/)
    store.start(5, undefined)
    clock = NOW
    store.pause()
    expect(() => store.pause()).toThrow()
    expect(() => store.start(25, undefined)).toThrow(/Zero|zere|Zere/) // a paused one blocks another interval
  })

  it('zeroing keeps nothing back: a second interval may begin', () => {
    const store = new BarTimerStore(dir, () => NOW)
    store.start(5, { id: 'tabc123', text: 'Lavar a máquina' })
    store.reset()
    expect(store.view()).toBeUndefined()
    expect(store.start(25, undefined).state).toBe('em andamento')
  })

  it('a deadline that passed while the app was closed is interrupted, never completed', () => {
    const before = new BarTimerStore(dir, () => NOW)
    before.start(5, undefined) // ends at NOW + 5 min

    const after = new BarTimerStore(dir, () => NOW + 9 * MIN)
    expect(after.view()).toMatchObject({ state: 'interrompida', remainingMs: 0 })
    // and the interrupted state is what is saved (the file says so, at once)
    expect(JSON.parse(readFileSync(join(dir, 'timer.json'), 'utf8')).timer.state).toBe('interrompida')
  })

  it('a deadline that has not passed survives the restart and keeps counting', () => {
    const before = new BarTimerStore(dir, () => NOW)
    before.start(25, undefined)

    const after = new BarTimerStore(dir, () => NOW + 6 * MIN + 30_000)
    expect(after.view()).toMatchObject({ state: 'em andamento', remainingMs: 18 * MIN + 30_000 })
  })

  it('a broken timer.json is set aside and the Timer starts over', () => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'timer.json'), '{ isto não é json', 'utf8')
    expect(new BarTimerStore(dir, () => NOW).view()).toBeUndefined()
    expect(readdirSync(dir).some((n) => n.startsWith('timer.corrupt-'))).toBe(true)
  })

  it('a timer.json in a shape it cannot use is dropped, never guessed at', () => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'timer.json'), JSON.stringify({ timer: { mode: 25, state: 'em andamento', startedAt: NOW } }), 'utf8')
    expect(new BarTimerStore(dir, () => NOW).view()).toBeUndefined()
  })

  it('changes (or clears) the task label of the session that may be running', () => {
    const store = new BarTimerStore(dir, () => NOW)
    store.start(25, undefined)
    const linked = store.setTask({ id: 'tabc123', text: 'Lavar a máquina' })
    expect(linked?.taskText).toBe('Lavar a máquina')
    expect(store.setTask(undefined)?.taskId).toBeUndefined()
    expect(store.view()?.taskText).toBeUndefined()
  })

  it('timer.json is among the data files that are backed up', () => {
    expect(DATA_FILES).toContain('timer.json')
  })
})
