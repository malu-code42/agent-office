import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { failureMarkPlace, failurePad, markOutOfPlace, SeenFailures, MARK_OFFSET } from '../src/renderer/src/game/failure-marks'
import { disposeTree } from '../src/renderer/src/world/dispose'

describe('the red mark of a failed helper', () => {
  it('stands beside the desk of its owner, on the floor of its owner', () => {
    const place = failureMarkPlace({ floor: 2, project: 'p1', x: 24.5, z: 2.5 })
    expect(place).toEqual({ floor: 2, x: 24.5 + MARK_OFFSET, z: 2.5 })
  })

  it('goes away when its owner is gone', () => {
    expect(failureMarkPlace(null)).toBeNull()
  })

  it('goes away when the project of its owner is gone: the desk went with it', () => {
    // The owner has a project, but its floor does not exist any more.
    expect(failureMarkPlace({ floor: 0, project: 'p1', x: 24.5, z: 2.5 })).toBeNull()
  })

  it('stays on the ground floor when its owner works there', () => {
    const place = failureMarkPlace({ floor: 0, project: null, x: 13, z: 2.5 })
    expect(place).toEqual({ floor: 0, x: 13 + MARK_OFFSET, z: 2.5 })
  })

  it('goes away when its owner has no desk', () => {
    expect(failureMarkPlace({ floor: 1, project: 'p1', x: null, z: null })).toBeNull()
  })

  it('moves when its owner changes floor or desk', () => {
    const mark = { floor: 1, x: 10, z: 10 }
    expect(markOutOfPlace(mark, { floor: 1, x: 10, z: 10 })).toBe(false)
    expect(markOutOfPlace(mark, { floor: 2, x: 10, z: 10 })).toBe(true)
    expect(markOutOfPlace(mark, { floor: 1, x: 11, z: 10 })).toBe(true)
    expect(markOutOfPlace(mark, { floor: 1, x: 10, z: 11 })).toBe(true)
  })
})

describe('the pad of the red mark', () => {
  it('frees its geometry and its material when the mark goes away', () => {
    const pad = failurePad(3, 4)
    let geometry = 0
    let material = 0
    pad.geometry.addEventListener('dispose', () => geometry++)
    ;(pad.material as THREE.Material).addEventListener('dispose', () => material++)
    disposeTree(pad)
    expect(geometry).toBe(1)
    expect(material).toBe(1)
  })

  it('stands where the mark says', () => {
    const pad = failurePad(3, 4)
    expect(pad.position.x).toBe(3)
    expect(pad.position.z).toBe(4)
  })
})

describe('the failure the conversation already showed', () => {
  it('a failure nobody saw yet deserves a red mark', () => {
    const seen = new SeenFailures()
    expect(seen.unseen('ada', 1_000)).toBe(true)
  })

  it('the conversation opened after the failure: the helper comes back with no new mark', () => {
    const seen = new SeenFailures()
    // The helper failed at 1.000 and started walking back.
    const failedAt = 1_000
    // The user opened the conversation of the owner before the helper arrived.
    seen.open('ada', 2_000)
    // The helper arrives after that: the error card is already on the screen.
    expect(seen.unseen('ada', failedAt)).toBe(false)
  })

  it('a failure after the conversation was opened is a new one: it gets its mark', () => {
    const seen = new SeenFailures()
    seen.open('ada', 2_000)
    expect(seen.unseen('ada', 3_000)).toBe(true)
  })

  it('the conversation of one agent does not hide the failures of another', () => {
    const seen = new SeenFailures()
    seen.open('ada', 2_000)
    expect(seen.unseen('duda', 1_000)).toBe(true)
    expect(seen.unseen('ada', 1_000)).toBe(false)
  })

  it('a helper that is still walking back counts as seen when the conversation opens', () => {
    const seen = new SeenFailures()
    // The renderer heard about the failure only now, after the conversation opened.
    seen.open('ada', 2_000)
    const failedAt = seen.seen('ada', 3_000)
    // The helper arrives: the error card is on the screen, so there is no new mark.
    expect(seen.unseen('ada', failedAt)).toBe(false)
  })

  it('a failure nobody opened the conversation for keeps its mark', () => {
    const seen = new SeenFailures()
    expect(seen.seen('ada', 1_000)).toBe(1_000)
    expect(seen.unseen('ada', 1_000)).toBe(true)
  })
})
