import { describe, expect, it } from 'vitest'
import { HOME_ROOMS, HOME_TABLE_SEATS, LUNA_SEAT } from '../src/renderer/src/world/home-layout'
import { Grid } from '../src/renderer/src/world/pathfinding'
import { canContinueHomeArrival, freeHomeSeat, homeSpot, stayHomeByDefault } from '../src/renderer/src/game/home-seats'

function officeGrid(): Grid {
  const grid = new Grid(32, 24)
  grid.blockRect(4, 5, 2, 2)
  return grid
}

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

  it('seats the first seven residents on the free chairs, never on Luna’s', () => {
    const grid = officeGrid()
    const luna = HOME_TABLE_SEATS[LUNA_SEAT]
    const chairs = Array.from({ length: 7 }, (_, n) => homeSpot(grid, n)!)
    expect(chairs.every((s) => s.sit)).toBe(true)
    expect(new Set(chairs.map((s) => `${s.point.x},${s.point.z}`)).size).toBe(7)
    expect(chairs.some((s) => s.point.x === luna.x && s.point.z === luna.z)).toBe(false)
    for (const s of chairs) {
      expect(grid.walkable(...s.tile)).toBe(true)
      expect(grid.findPath(13, 1, ...s.tile)).not.toBeNull()
    }
  })

  it('stands extra residents on free office tiles next to the table, clear of the chairs', () => {
    const grid = officeGrid()
    const extra = Array.from({ length: 10 }, (_, n) => homeSpot(grid, 7 + n)!)
    const office = HOME_ROOMS.find((r) => r.id === 'office')!.rect
    expect(new Set(extra.map((s) => s.tile.join())).size).toBe(10)
    for (const s of extra) {
      expect(s.sit).toBe(false)
      expect(grid.walkable(...s.tile)).toBe(true)
      expect(s.tile[0] >= office[0] && s.tile[0] < office[2] && s.tile[1] >= office[1] && s.tile[1] < office[3]).toBe(true)
      expect(HOME_TABLE_SEATS.every((c) => Math.hypot(s.point.x - c.x, s.point.z - c.z) >= 1)).toBe(true)
    }
    expect(homeSpot(grid, 500)).toBeNull()
  })

  it('stays in the house by default when called from the Casa, not from a project floor', () => {
    expect(stayHomeByDefault(null)).toBe(true)
    expect(stayHomeByDefault(undefined)).toBe(true)
    expect(stayHomeByDefault({ id: 'p' })).toBe(false)
  })
})
