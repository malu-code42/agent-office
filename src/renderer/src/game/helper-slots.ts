// The subagents that work for an agent (HANDOFF §3.4.1): a small copy of the owner
// standing beside its desk, a cord on the floor in the shirt color of the owner and
// a mini label. Plain numbers, so the rules can be checked without a scene.
import { HELPER_MAX } from '@shared/subagents'

/** The three fixed spots beside a desk, in the order they are taken. */
export const HELPER_SLOTS: readonly (readonly [number, number])[] = [
  [1.2, -0.6],
  [1.2, 0.6],
  [1.9, 0],
]

/** How many helpers may work for the same agent at the same desk. */
export { HELPER_MAX }

/** How far the cord reaches from the middle of the desk to the helper. */
const CORD_GAP = 0.45

/** The mini label of a helper: "↳ Nome · tarefa". */
export function helperLabel(name: string, task: string): string {
  return `↳ ${name} · ${task}`
}

/** The mini label left behind by a helper that failed. */
export function helperFailedLabel(name: string, task: string, failures: number): string {
  return failures > 1 ? `↳ ${name} · ${failures} subagentes falharam` : `↳ ${name} · ${task} · falhou`
}

/** The free spot beside the desk, or -1 when the desk is full (the cap is three). */
export function freeSlot(taken: readonly number[]): number {
  for (let i = 0; i < HELPER_MAX; i++) if (!taken.includes(i)) return i
  return -1
}

/** Where a helper stands and where its cord lies, given the middle of the owner's desk. */
export function helperPlace(
  deskX: number,
  deskZ: number,
  slot: number,
): { at: [number, number]; cord: [number, number]; cordLength: number } {
  const [dx, dz] = HELPER_SLOTS[slot]
  return {
    at: [deskX + dx, deskZ + dz],
    cord: [deskX + (dx + CORD_GAP) / 2, deskZ + dz],
    cordLength: dx - CORD_GAP,
  }
}

/** The seat of a helper: the floor it is on and where it stands there. */
export interface HelperSeat {
  /** The floor of its owner: a helper never stays on the floor the owner left. */
  floor: number
  /** Where the helper stands. */
  at: [number, number]
  /** Where the cord lies on the floor. */
  cord: [number, number]
  /** How long the cord is. */
  cordLength: number
  /** The tile the helper stands on. */
  tile: [number, number]
}

/**
 * The seat of a helper: beside the desk of its owner, on the floor of its owner.
 * The floor travels with the seat, so a helper whose owner changed floor has a
 * seat on the new floor and not on the one the owner left.
 */
export function helperSeat(owner: { floor: number; x: number; z: number }, slot: number): HelperSeat {
  const spot = helperPlace(owner.x, owner.z, slot)
  return {
    floor: owner.floor,
    at: spot.at,
    cord: spot.cord,
    cordLength: spot.cordLength,
    tile: [Math.floor(spot.at[0]), Math.floor(spot.at[1])],
  }
}

/** What a helper has to do to stay with its owner. */
export interface HelperMove extends HelperSeat {
  /** The helper is on another floor: it goes with its owner, at once. */
  changedFloor: boolean
  /** The desk of the owner moved: the helper takes the new spot beside it. */
  movedSpot: boolean
}

/**
 * What a helper has to do to stay with its owner: change floor, change spot, or
 * nothing at all. `helper` says where the helper is now: the floor it is on and
 * the desk it was placed against.
 */
export function helperMove(
  owner: { floor: number; x: number; z: number },
  slot: number,
  helper: { floor: number; anchor: { x: number; z: number } },
): HelperMove {
  const seat = helperSeat(owner, slot)
  return {
    ...seat,
    changedFloor: helper.floor !== seat.floor,
    movedSpot: helper.anchor.x !== owner.x || helper.anchor.z !== owner.z,
  }
}
