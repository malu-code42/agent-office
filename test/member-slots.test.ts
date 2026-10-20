import { describe, expect, it } from 'vitest'
import { deliverySpot, floorReservations, freeSpot, memberPlace, spotKey } from '../src/renderer/src/game/member-slots'

const SPOTS: [number, number][] = [
  [26, 3],
  [27, 3],
  [26, 9],
]

const always = () => true

describe('spots of squad members', () => {
  it('gives each member a spot of its own', () => {
    const taken = new Set<string>()
    const first = freeSpot(SPOTS, taken, always)!
    taken.add(spotKey(first[0], first[1]))
    const second = freeSpot(SPOTS, taken, always)!
    expect(second).not.toEqual(first)
    taken.add(spotKey(second[0], second[1]))
    const third = freeSpot(SPOTS, taken, always)!
    expect(new Set([first, second, third]).size).toBe(3)
  })

  it('never puts a member on a tile that is not walkable', () => {
    const blocked = (x: number, z: number) => !(x === 26 && z === 3)
    expect(freeSpot(SPOTS, new Set(), blocked)).toEqual([27, 3])
  })

  it('says there is no place when every spot is taken', () => {
    const taken = new Set(SPOTS.map(([x, z]) => spotKey(x, z)))
    expect(freeSpot(SPOTS, taken, always)).toBeNull()
  })

  it('says there is no place when every spot is blocked', () => {
    expect(freeSpot(SPOTS, new Set(), () => false)).toBeNull()
  })
})

describe('the place of a squad member', () => {
  const desks = [{ index: 10 }, { index: 11 }]

  it('takes a desk of the room first', () => {
    const place = memberPlace(desks, SPOTS, new Set(), new Set(), always)
    expect(place.desk).toEqual({ index: 10 })
    expect(place.tile).toBeNull()
  })

  it('gives a free desk to each member', () => {
    const taken = new Set<number>()
    const first = memberPlace(desks, SPOTS, taken, new Set(), always)
    taken.add(first.desk!.index)
    const second = memberPlace(desks, SPOTS, taken, new Set(), always)
    expect(second.desk).toEqual({ index: 11 })
    expect(second.desk!.index).not.toBe(first.desk!.index)
  })

  it('stands on a tile of its own when every desk is taken', () => {
    const takenDesks = new Set([10, 11])
    const takenTiles = new Set<string>()
    const first = memberPlace(desks, SPOTS, takenDesks, takenTiles, always)
    expect(first.desk).toBeNull()
    expect(first.tile).toEqual([26, 3])
    takenTiles.add(spotKey(first.tile![0], first.tile![1]))
    const second = memberPlace(desks, SPOTS, takenDesks, takenTiles, always)
    expect(second.tile).toEqual([27, 3])
    expect(second.tile).not.toEqual(first.tile)
  })

  it('says there is no place when the room and the floor are full', () => {
    const place = memberPlace(desks, SPOTS, new Set([10, 11]), new Set(SPOTS.map(([x, z]) => spotKey(x, z))), always)
    expect(place.desk).toBeNull()
    expect(place.tile).toBeNull()
  })
})

describe('the places taken on a floor', () => {
  it('ignores the members of the other floors: every floor numbers its desks the same way', () => {
    const holders = [
      { floor: 1, desk: { index: 10 }, tile: null, leaving: false },
      { floor: 2, desk: { index: 10 }, tile: [26, 3] as [number, number], leaving: false },
    ]
    // The desk 10 of the first floor does not take the desk 10 of the second one.
    expect(floorReservations(holders, 2).desks.has(10)).toBe(true)
    // The tile of the first floor does not take the tile of the second one.
    expect(floorReservations(holders, 1).tiles.has('26,3')).toBe(false)
    expect(floorReservations(holders, 2).tiles.has('26,3')).toBe(true)
  })

  it('does not count the members that are leaving', () => {
    const holders = [{ floor: 1, desk: { index: 10 }, tile: [26, 3] as [number, number], leaving: true }]
    const taken = floorReservations(holders, 1)
    expect(taken.desks.has(10)).toBe(false)
    expect(taken.tiles.has('26,3')).toBe(false)
  })

  it('gives the desk of the floor to the member of that floor', () => {
    const holders = [{ floor: 1, desk: { index: 10 }, tile: null, leaving: false }]
    const desks = [{ index: 10 }, { index: 11 }]
    const place = memberPlace(desks, SPOTS, floorReservations(holders, 2).desks, new Set(), always)
    expect(place.desk).toEqual({ index: 10 })
  })
})

describe('the delivery at the coordinator', () => {
  /** The six tiles in front of the coordinator's desk. */
  const SPOTS_DELIVER: [number, number][] = [
    [7, 6],
    [6, 6],
    [7, 7],
    [6, 7],
    [7, 5],
    [6, 5],
  ]

  it('gives a tile of its own to each member of a full room', () => {
    const taken = new Set<string>()
    const used: string[] = []
    for (let i = 0; i < 6; i++) {
      const spot = deliverySpot(SPOTS_DELIVER, taken, always)
      expect(spot).not.toBeNull()
      taken.add(spotKey(spot![0], spot![1]))
      used.push(spotKey(spot![0], spot![1]))
    }
    expect(new Set(used).size).toBe(6)
  })

  it('says there is no place when the six tiles are taken: nobody stands on top of another', () => {
    const taken = new Set(SPOTS_DELIVER.map(([x, z]) => spotKey(x, z)))
    expect(deliverySpot(SPOTS_DELIVER, taken, always)).toBeNull()
  })

  it('never hands the same tile to two members', () => {
    const taken = new Set<string>()
    const first = deliverySpot(SPOTS_DELIVER, taken, always)!
    taken.add(spotKey(first[0], first[1]))
    const second = deliverySpot(SPOTS_DELIVER, taken, always)!
    expect(second).not.toEqual(first)
  })
})
