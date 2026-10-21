// A helper that is going back to the desk of its owner (HANDOFF §3.4.1): it walks
// to the seat of that desk and leaves the scene there. The way back can be
// interrupted — the owner changes floor, the desk moves, the walk is lost — and
// the helper must not get stuck on the way: it follows its owner and keeps
// walking back, so it always arrives and leaves the scene exactly once, with
// its red mark.
//
// Plain numbers, so the rules can be checked without a scene.
import { helperPlace } from './helper-slots'

/** The avatar of a helper: the little that the way back needs of it. */
export interface ReturnWalker {
  /** The floor the helper is on. */
  floor: number
  /** True while the helper walks. */
  isWalking: boolean
  /** Stops the walk, and forgets where it was going. */
  stop(): void
  /** Puts the helper at a place, on the floor it is on. */
  placeAt(x: number, z: number): void
  /** Starts the walk; `onArrive` runs when the helper gets there. */
  walk(points: { x: number; z: number }[], onArrive?: () => void): void
}

/** The desk of the owner of a helper, on the floor the owner works on now. */
export interface OwnerDesk {
  /** The floor the owner works on now. */
  floor: number
  /** The middle of the desk of the owner; null when it has no desk of its own. */
  anchor: { x: number; z: number } | null
  /** The seat of the desk of the owner; null when the owner has no place at all. */
  seat: { x: number; z: number } | null
}

/** How far a place can move before the walk back is aimed at it again. */
const PLACE_EPS = 0.1

/** True when the place the walk back goes to changed. */
function moved(a: { x: number; z: number } | null, b: { x: number; z: number } | null): boolean {
  if (!a || !b) return a !== b
  return Math.abs(a.x - b.x) > PLACE_EPS || Math.abs(a.z - b.z) > PLACE_EPS
}

/**
 * The way back of a helper: it walks to the seat of the desk of its owner and
 * leaves the scene there.
 *
 * The controller keeps the walk alive. Every frame it asks where the desk of the
 * owner is now: when the owner changed floor or desk, the helper goes to that
 * floor, starts from the spot beside the desk and walks back from there, so the
 * way back is never lost. A walk that was lost anyway (the avatar stopped
 * without arriving) ends the way back too: the helper leaves the scene, and it
 * leaves it once.
 */
export class HelperReturn {
  /** The desk of the owner, as it was on the last frame. */
  private owner: OwnerDesk
  /** True when the helper left the scene: it does not come back. */
  private finished = false

  constructor(
    private walker: ReturnWalker,
    /** Where the desk of the owner is now. */
    private deskOf: () => OwnerDesk,
    /** The fixed spot beside the desk of the owner. */
    private slot: number,
    /** The helper leaves the scene: the avatar, the cord and the label go. */
    private onDone: () => void,
  ) {
    this.owner = deskOf()
  }

  /** Starts the way back: the helper walks to the seat of the desk of its owner. */
  start(): void {
    this.walk()
  }

  /**
   * The frame of the way back. When the owner changed floor or desk, the helper
   * goes there and walks back from there; when the walk was lost, the helper
   * leaves the scene anyway.
   */
  step(): void {
    if (this.finished) return
    const owner = this.deskOf()
    if (owner.floor !== this.owner.floor || moved(owner.seat, this.owner.seat)) {
      this.owner = owner
      this.walk()
      return
    }
    if (!this.walker.isWalking) this.finish()
  }

  /** True when the helper already left the scene. */
  get done(): boolean {
    return this.finished
  }

  /** Sends the helper to the seat of the desk of its owner and walks there. */
  private walk(): void {
    const seat = this.owner.seat
    if (!seat) {
      this.finish()
      return
    }
    if (this.walker.floor !== this.owner.floor) {
      // The helper goes to the floor of its owner: the walk back starts from the
      // spot beside the desk, on that floor.
      this.walker.floor = this.owner.floor
      this.walker.stop()
      const anchor = this.owner.anchor
      if (anchor) {
        const spot = helperPlace(anchor.x, anchor.z, this.slot)
        this.walker.placeAt(spot.at[0], spot.at[1])
      }
    }
    this.walker.walk([seat], () => this.finish())
  }

  /** The helper leaves the scene. It happens once. */
  private finish(): void {
    if (this.finished) return
    this.finished = true
    this.onDone()
  }
}
