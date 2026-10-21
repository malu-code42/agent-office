import { describe, expect, it } from 'vitest'
import { HELPER_MAX, helperLimit, helperLimitReason } from '../src/shared/subagents'
import { HELPER_SLOTS, freeSlot, helperFailedLabel, helperLabel, helperMove, helperPlace, helperSeat } from '../src/renderer/src/game/helper-slots'

describe('helpers', () => {
  it('has three fixed spots beside the desk', () => {
    expect(HELPER_SLOTS).toHaveLength(3)
    expect(HELPER_MAX).toBe(3)
    expect(new Set(HELPER_SLOTS.map(([x, z]) => `${x},${z}`)).size).toBe(3)
  })

  it('takes the free spots in order and refuses the fourth', () => {
    expect(freeSlot([])).toBe(0)
    expect(freeSlot([0])).toBe(1)
    expect(freeSlot([1, 0])).toBe(2)
    expect(freeSlot([0, 1, 2])).toBe(-1)
    expect(freeSlot([0, 1, 2, 3])).toBe(-1)
  })

  it('shows the name of the owner and the task in the mini label', () => {
    expect(helperLabel('Ada', 'Editando app.ts')).toBe('↳ Ada · Editando app.ts')
    expect(helperFailedLabel('Ada', 'Editando app.ts', 1)).toBe('↳ Ada · Editando app.ts · falhou')
    expect(helperFailedLabel('Ada', 'Editando app.ts', 3)).toBe('↳ Ada · 3 subagentes falharam')
  })

  it('puts the helper beside the desk and the cord between them', () => {
    const deskX = 24.8
    const deskZ = 2.6
    const spot = helperPlace(deskX, deskZ, 0)
    // The helper stands next to the desk, in the aisle.
    expect(spot.at[0]).toBeCloseTo(deskX + 1.2)
    expect(spot.at[1]).toBeCloseTo(deskZ - 0.6)
    // The cord starts at the edge of the desk and reaches the helper.
    expect(spot.cord[0] - spot.cordLength / 2).toBeCloseTo(deskX + 0.45)
    expect(spot.cord[0] + spot.cordLength / 2).toBeCloseTo(deskX + 1.2)
    expect(spot.cord[1]).toBeCloseTo(deskZ - 0.6)
  })

  it('keeps every spot on the same side of the desk', () => {
    for (let slot = 0; slot < HELPER_MAX; slot++) {
      const spot = helperPlace(10, 5, slot)
      expect(spot.at[0]).toBeGreaterThan(10)
      expect(spot.cordLength).toBeGreaterThan(0)
    }
  })
})

describe('the helper stays with its owner', () => {
  /** The owner: the floor it is on and the middle of its desk. */
  const owner = { floor: 2, x: 24.5, z: 2.5 }

  it('the seat of a helper is on the floor of its owner', () => {
    const seat = helperSeat(owner, 0)
    expect(seat.floor).toBe(2)
    expect(seat.at[0]).toBeCloseTo(owner.x + 1.2)
    expect(seat.at[1]).toBeCloseTo(owner.z - 0.6)
    expect(seat.tile).toEqual([Math.floor(owner.x + 1.2), Math.floor(owner.z - 0.6)])
  })

  it('a helper left behind on the old floor has to change floor', () => {
    // The owner went up a floor: the helper was on the floor it left.
    const move = helperMove({ ...owner, floor: 3 }, 0, { floor: 2, anchor: { x: owner.x, z: owner.z } })
    expect(move.changedFloor).toBe(true)
    expect(move.floor).toBe(3)
    // The seat it has to take is on the new floor, not on the old one.
    expect(move.at[0]).toBeCloseTo(owner.x + 1.2)
  })

  it('a helper that is already with its owner does not move', () => {
    const move = helperMove(owner, 0, { floor: owner.floor, anchor: { x: owner.x, z: owner.z } })
    expect(move.changedFloor).toBe(false)
    expect(move.movedSpot).toBe(false)
  })

  it('when the floors are renumbered, the helper goes to the new number', () => {
    // The same desk, on a floor that is now number 1 instead of 2.
    const move = helperMove({ ...owner, floor: 1 }, 1, { floor: 2, anchor: { x: owner.x, z: owner.z } })
    expect(move.changedFloor).toBe(true)
    expect(move.floor).toBe(1)
  })

  it('when the desk of the owner moves, the helper takes the new spot and cord', () => {
    const move = helperMove({ floor: owner.floor, x: 29.5, z: 7.5 }, 2, { floor: owner.floor, anchor: { x: owner.x, z: owner.z } })
    expect(move.changedFloor).toBe(false)
    expect(move.movedSpot).toBe(true)
    expect(move.at[0]).toBeCloseTo(29.5 + 1.9)
    expect(move.at[1]).toBeCloseTo(7.5)
    // The cord lies between the desk and the helper, on the new spot.
    expect(move.cord[0]).toBeCloseTo(29.5 + (1.9 + 0.45) / 2)
    expect(move.cordLength).toBeCloseTo(1.9 - 0.45)
  })
})

describe('the cap of the desk', () => {
  it('is three helpers, whatever the scene', () => {
    expect(HELPER_MAX).toBe(3)
  })

  it('a lower configured limit wins over the cap of the room', () => {
    expect(helperLimit(0)).toBe(3)
    expect(helperLimit(undefined)).toBe(3)
    expect(helperLimit(10)).toBe(3)
    expect(helperLimit(2)).toBe(2)
    expect(helperLimit(1)).toBe(1)
  })

  it('says, in pt-BR, why the call was refused', () => {
    const reason = helperLimitReason(3, 3)
    expect(reason).toContain('3')
    expect(reason).toContain('Bloqueado pelo Agent Office')
    expect(helperLimitReason(3, 1)).toContain('1 subagente ativo')
  })
})
