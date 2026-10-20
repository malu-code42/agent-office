// The places a squad member can work: a desk of its squad room, or a tile to stand on
// when every desk is taken (HANDOFF §3.4). Plain numbers, so the rule can be checked
// without a scene: two members never stand on the same tile.

/** A spot of the floor, as a tile. */
export type Spot = [number, number]

/** The key of a tile, so two spots can be compared. */
export function spotKey(x: number, z: number): string {
  return `${x},${z}`
}

/**
 * The first spot nobody stands on yet, or null when there is no room for another:
 * the caller says so instead of stacking one character on top of another.
 */
export function freeSpot(
  spots: readonly (readonly [number, number])[],
  taken: ReadonlySet<string>,
  walkable: (x: number, z: number) => boolean,
): Spot | null {
  for (const [x, z] of spots) {
    if (taken.has(spotKey(x, z))) continue
    if (!walkable(x, z)) continue
    return [x, z]
  }
  return null
}

/**
 * Where a squad member works: a free desk of its room, or a free tile to stand on
 * when every desk is taken. Two members never get the same desk or the same tile,
 * and there is no place at all when the room and the floor are full.
 */
export function memberPlace<T extends { index: number }>(
  desks: readonly T[],
  spots: readonly (readonly [number, number])[],
  takenDesks: ReadonlySet<number>,
  takenTiles: ReadonlySet<string>,
  walkable: (x: number, z: number) => boolean,
): { desk: T | null; tile: Spot | null } {
  const desk = desks.find((d) => !takenDesks.has(d.index))
  if (desk) return { desk, tile: null }
  return { desk: null, tile: freeSpot(spots, takenTiles, walkable) }
}

/** A member that holds a place in the scene. */
export interface HeldPlace {
  /** The floor the member is on. */
  floor: number
  /** The desk it holds, or null when it stands on a tile. */
  desk: { index: number } | null
  /** The tile it stands on, or null. */
  tile: readonly [number, number] | null
  /** True while it is leaving: it does not hold a place any more. */
  leaving: boolean
}

/**
 * The desks and the tiles taken on one floor.
 *
 * Only the members of that floor count: every project floor numbers its desks
 * the same way, so a member of another floor must not compete for a desk or a
 * tile that is free here.
 */
export function floorReservations(holders: readonly HeldPlace[], floor: number): { desks: Set<number>; tiles: Set<string> } {
  const desks = new Set<number>()
  const tiles = new Set<string>()
  for (const h of holders) {
    if (h.leaving || h.floor !== floor) continue
    if (h.desk) desks.add(h.desk.index)
    if (h.tile) tiles.add(spotKey(h.tile[0], h.tile[1]))
  }
  return { desks, tiles }
}

/**
 * The free tile where a member hands its delivery over to the coordinator, or
 * null when every tile is taken: nobody stands on top of another one.
 */
export function deliverySpot(
  spots: readonly (readonly [number, number])[],
  taken: ReadonlySet<string>,
  walkable: (x: number, z: number) => boolean,
): Spot | null {
  return freeSpot(spots, taken, walkable)
}
