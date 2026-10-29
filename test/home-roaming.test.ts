import { describe, expect, it } from 'vitest'
import { HOME_ROOMS, HOME_SPAWN_TILE } from '../src/renderer/src/world/home-layout'
import { Grid } from '../src/renderer/src/world/pathfinding'
import { canContinueHomeArrival, homeRoamTarget } from '../src/renderer/src/game/home-roaming'

describe('AO-94 home roaming', () => {
  it('rejects a stale arrival callback after the user ends house presence', () => {
    expect(canContinueHomeArrival('home', true)).toBe(true)
    expect(canContinueHomeArrival('home', false)).toBe(false)
    expect(canContinueHomeArrival('desk', true)).toBe(false)
  })

  it('chooses only reachable public tiles and avoids residents and the elevator', () => {
    const grid = new Grid(32, 24)
    const from: [number, number] = [13, 3]
    const occupied: [number, number][] = [[13, 8]]

    for (let i = 0; i < 100; i++) {
      const target = homeRoamTarget(grid, from, occupied, () => i / 100)
      expect(target).not.toBeNull()
      const [x, z] = target!
      expect(HOME_ROOMS.some(({ id, rect: [x0, z0, x1, z1] }) => id !== 'bedroom' && x >= x0 && x < x1 && z >= z0 && z < z1)).toBe(true)
      expect(Math.abs(x - HOME_SPAWN_TILE[0]) <= 2 && z <= HOME_SPAWN_TILE[1] + 1).toBe(false)
      expect(Math.hypot(x - occupied[0][0], z - occupied[0][1])).toBeGreaterThanOrEqual(1.5)
      expect(grid.findPath(from[0], from[1], x, z)).not.toBeNull()
    }
  })

  it('waits instead of sending an agent into a blocked or unreachable tile', () => {
    const grid = new Grid(32, 24)
    grid.blockRect(0, 0, 32, 24)
    expect(homeRoamTarget(grid, [13, 3], [], () => 0)).toBeNull()
  })
})
