import { app } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parentGone, quitWithParent } from '../src/main/dev-hooks'

describe('quitWithParent (dev)', () => {
  afterEach(() => vi.useRealTimers())

  it('fecha o app quando o processo pai morre', () => {
    vi.useFakeTimers()
    const quit = vi.fn()
    ;(app as unknown as { quit: () => void }).quit = quit
    let alive = true
    const timer = quitWithParent(() => alive)
    vi.advanceTimersByTime(2000)
    expect(quit).not.toHaveBeenCalled()
    expect(parentGone()).toBe(false)
    alive = false
    vi.advanceTimersByTime(2000)
    expect(quit).toHaveBeenCalled()
    // the quit dialog is skipped: nobody is left to answer it
    expect(parentGone()).toBe(true)
    clearInterval(timer!)
  })
})
