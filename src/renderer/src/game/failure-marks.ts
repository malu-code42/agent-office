// The red mark left by the helpers of an agent that failed: a pad on the floor
// beside the owner's desk, until the owner's conversation is opened. Plain numbers,
// so the rule can be checked without a scene.

/** How far from the middle of the owner's desk the red pad stands. */
export const MARK_OFFSET = 1.55

/** The owner of a red mark: where its desk is now. */
export interface MarkOwner {
  /** The floor the owner works on; 0 is the ground floor. */
  floor: number
  /** The project of the owner; null when it has none (it works downstairs). */
  project: string | null
  /** The middle of the owner's desk; null when it has no desk. */
  x: number | null
  z: number | null
}

/** Where a red mark stands. */
export interface MarkPlace {
  /** The floor the mark stands on. */
  floor: number
  /** The x of the pad. */
  x: number
  /** The z of the pad. */
  z: number
}

/**
 * Where the red mark of a failed helper stands: beside the owner's desk, on the
 * owner's floor. Null when the mark has no place any more: the owner is gone, or
 * its project was removed and the desk the mark pointed at went with it.
 */
export function failureMarkPlace(owner: MarkOwner | null): MarkPlace | null {
  if (!owner) return null
  // The project is gone: the desk of the owner went with it, and so does the mark.
  if (owner.project && owner.floor <= 0) return null
  if (owner.x === null || owner.z === null) return null
  return { floor: owner.floor, x: owner.x + MARK_OFFSET, z: owner.z }
}

/** True when the mark is not where its owner is any more. */
export function markOutOfPlace(mark: MarkPlace, place: MarkPlace): boolean {
  return mark.floor !== place.floor || mark.x !== place.x || mark.z !== place.z
}

/**
 * The failures the user has already seen.
 *
 * The conversation of the owner is what shows a failure: the error card stays in
 * the history (HANDOFF §3.4.1). So a helper that comes back after the user opened
 * that conversation must not leave a new red mark: the failure is already on the
 * screen. A failure that happens after the conversation was opened is a new one,
 * and it gets its mark.
 */
export class SeenFailures {
  /** When the conversation of each owner was opened. */
  private openedAt = new Map<string, number>()

  /** The conversation of the owner was opened at this moment. */
  open(agentId: string, at: number): void {
    this.openedAt.set(agentId, at)
  }

  /**
   * True when the failure still deserves a red mark: nobody showed it to the user
   * yet. `failedAt` is when the failure happened; the conversation was opened
   * after it when the user already saw the error card.
   */
  unseen(agentId: string, failedAt: number): boolean {
    const opened = this.openedAt.get(agentId)
    return opened === undefined || failedAt > opened
  }

  /**
   * The failure of a helper that is still walking back: it is in the conversation
   * now, so it does not need a mark when the helper arrives. The time of the
   * failure moves back to the opening of the conversation.
   */
  seen(agentId: string, failedAt: number): number {
    const opened = this.openedAt.get(agentId)
    return opened === undefined ? failedAt : Math.min(failedAt, opened)
  }
}

/**
 * A helper that failed leaves a red mark by the desk of its owner, when it
 * leaves the scene. The mark is skipped when the user already saw the failure
 * in the conversation of the owner: the error card is there, and a new mark
 * would only point at what is already on the screen.
 */
export function helperLeavesMark(failed: boolean, failedAt: number | null, seen: SeenFailures, ownerId: string, now: number): boolean {
  if (!failed) return false
  return seen.unseen(ownerId, failedAt ?? now)
}
