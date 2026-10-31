import { describe, expect, it } from 'vitest'
import { canContinueHomeArrival, freeHomeSeat, stayHomeByDefault } from '../src/renderer/src/game/home-seats'

describe('agentes da Casa à mesa da Luna', () => {
  it('rejects a stale arrival callback after the user ends house presence', () => {
    expect(canContinueHomeArrival('home', true)).toBe(true)
    expect(canContinueHomeArrival('home', false)).toBe(false)
    expect(canContinueHomeArrival('desk', true)).toBe(false)
  })

  it('hands out the lowest free seat and keeps the others where they are', () => {
    expect(freeHomeSeat([])).toBe(0)
    expect(freeHomeSeat([0, 1, 2])).toBe(3)
    // seat 1 left: the next resident takes it, seats 0 and 2 stay with their agents
    expect(freeHomeSeat([0, 2, null])).toBe(1)
  })

  it('stays in the house by default when called from the Casa, not from a project floor', () => {
    expect(stayHomeByDefault(null)).toBe(true)
    expect(stayHomeByDefault(undefined)).toBe(true)
    expect(stayHomeByDefault({ id: 'p' })).toBe(false)
  })
})
