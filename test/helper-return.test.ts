import { describe, expect, it } from 'vitest'
import { failureMarkPlace, helperLeavesMark, SeenFailures } from '../src/renderer/src/game/failure-marks'
import { HelperReturn, type OwnerDesk, type ReturnWalker } from '../src/renderer/src/game/helper-return'

/** The avatar of a helper, without a scene: only what the way back needs of it. */
class FakeWalker implements ReturnWalker {
  floor = 1
  isWalking = false
  /** Where the helper stands. */
  at = { x: 0, z: 0 }
  /** Where the helper is walking to. */
  target: { x: number; z: number } | null = null
  private arrive: (() => void) | null = null

  stop(): void {
    // The avatar forgets where it was going, and the callback goes with it.
    this.isWalking = false
    this.target = null
    this.arrive = null
  }

  placeAt(x: number, z: number): void {
    this.at = { x, z }
  }

  walk(points: { x: number; z: number }[], onArrive?: () => void): void {
    this.target = points[0] ?? null
    this.arrive = onArrive ?? null
    this.isWalking = points.length > 0
  }

  /** The helper gets there: the callback runs. */
  arriveNow(): void {
    const cb = this.arrive
    this.arrive = null
    this.isWalking = false
    this.target = null
    cb?.()
  }
}

/** The desk of the owner of a helper, on the floor it works on. */
const desk = (floor: number): OwnerDesk => ({
  floor,
  anchor: { x: 24.5, z: 2.5 },
  seat: { x: 25, z: 2.5 },
})

describe('the way back of the helper', () => {
  it('walks to the seat of the desk of its owner and leaves the scene once', () => {
    const walker = new FakeWalker()
    let ends = 0
    const onEnd = () => ends++
    const back = new HelperReturn(walker, () => desk(1), 0, onEnd)
    back.start()
    expect(walker.isWalking).toBe(true)
    expect(walker.target).toEqual({ x: 25, z: 2.5 })
    // It arrives at the desk of its owner.
    walker.arriveNow()
    expect(ends).toBe(1)
    // The scene does not end it a second time.
    back.step()
    expect(ends).toBe(1)
  })

  it('follows the owner to the other floor when the owner changes floor on the way back', () => {
    const walker = new FakeWalker()
    let ends = 0
    let floor = 1
    const onEnd = () => ends++
    const back = new HelperReturn(walker, () => desk(floor), 0, onEnd)
    back.start()
    // The owner changed floor while the helper was walking back.
    floor = 2
    back.step()
    // The helper went to the floor of its owner and kept walking back from there.
    expect(walker.floor).toBe(2)
    expect(walker.isWalking).toBe(true)
    expect(walker.target).toEqual({ x: 25, z: 2.5 })
    // It arrives: the helper leaves the scene, once.
    walker.arriveNow()
    expect(ends).toBe(1)
  })

  it('starts the way back from the spot beside the desk of the owner, on the floor of the owner', () => {
    const walker = new FakeWalker()
    walker.floor = 1
    let ends = 0
    const onEnd = () => ends++
    const back = new HelperReturn(walker, () => desk(2), 0, onEnd)
    back.start()
    expect(walker.floor).toBe(2)
    // The spot of the helper is the one beside the desk of its owner.
    expect(walker.at.x).toBeCloseTo(24.5 + 1.2)
    expect(walker.at.z).toBeCloseTo(2.5 - 0.6)
    expect(walker.isWalking).toBe(true)
    expect(ends).toBe(0)
  })

  it('a walk that was lost does not leave the helper in the scene for ever', () => {
    const walker = new FakeWalker()
    let ends = 0
    const onEnd = () => ends++
    const back = new HelperReturn(walker, () => desk(1), 0, onEnd)
    back.start()
    // The walk was lost: the avatar stopped and the callback went with it.
    walker.stop()
    back.step()
    expect(ends).toBe(1)
  })

  it('leaves the scene when the owner has no place at all', () => {
    const walker = new FakeWalker()
    let ends = 0
    const onEnd = () => ends++
    const nowhere = () => ({ floor: 0, anchor: null, seat: null })
    const back = new HelperReturn(walker, nowhere, 0, onEnd)
    back.start()
    expect(ends).toBe(1)
    expect(walker.isWalking).toBe(false)
  })
})

describe('the red mark of a helper that failed', () => {
  it('leaves one mark, on the floor of the owner, even when the floor changed on the way back', () => {
    const walker = new FakeWalker()
    const seen = new SeenFailures()
    // The helper failed and started walking back.
    const failedAt = 1_000
    let floor = 1
    const marks: { floor: number; x: number; z: number }[] = []
    const onEnd = () => {
      // The scene: the helper arrived, it leaves the scene and the mark of the
      // failure is left by the desk of its owner, on the floor it works on now.
      if (helperLeavesMark(true, failedAt, seen, 'ada', 2_000)) {
        const place = failureMarkPlace({ floor, project: 'p1', x: 24.5, z: 2.5 })
        if (place) marks.push(place)
      }
    }
    const back = new HelperReturn(walker, () => desk(floor), 0, onEnd)
    back.start()
    // The owner changed floor while the helper was walking back.
    floor = 2
    back.step()
    walker.arriveNow()
    // One mark, on the floor of the owner.
    expect(marks).toHaveLength(1)
    expect(marks[0].floor).toBe(2)
  })

  it('a failure the conversation already showed leaves no new mark', () => {
    const seen = new SeenFailures()
    // The helper failed at 1.000 and started walking back.
    const failedAt = 1_000
    // The user opened the conversation of the owner before the helper arrived.
    seen.open('ada', 2_000)
    expect(helperLeavesMark(true, failedAt, seen, 'ada', 2_500)).toBe(false)
  })

  it('a helper that did not fail leaves no mark', () => {
    const seen = new SeenFailures()
    expect(helperLeavesMark(false, null, seen, 'ada', 2_500)).toBe(false)
  })
})
