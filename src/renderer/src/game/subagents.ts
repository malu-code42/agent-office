import * as THREE from 'three'
import type { AgentSummary, SubagentInfo } from '@shared/types'
import { helperActivity } from '@shared/describe'
import { Avatar } from '../world/avatar'
import { disposeTree } from '../world/dispose'
import { box } from '../world/kit'
import { Tag } from '../world/overlays'
import { GameDeliveries } from './deliveries'
import { failureMarkPlace, failurePad, helperLeavesMark, markOutOfPlace, type MarkOwner } from './failure-marks'
import { freeSlot, helperFailedLabel, helperLabel, helperMove, helperPlace } from './helper-slots'
import { HelperReturn, type OwnerDesk } from './helper-return'
import { clip, HELPER_MIN_S, HELPER_SCALE, type Actor, type Helper } from './types'

/**
 * Subagents: small copies of their parent standing beside the owner's desk, tied to it
 * by a cord in the shirt color of the owner (HANDOFF §3.4.1).
 */
export abstract class GameSubagents extends GameDeliveries {
  // ---------- helpers (subagents) ----------

  protected syncHelpers(): void {
    for (const a of this.state.agents.values()) {
      const parent = this.actors.get(a.id)
      if (!parent || parent.down || parent.goal === 'leave') continue
      // Only a working agent opens subagents.
      const working = a.status === 'working' || a.status === 'starting'
      for (const sub of a.subagents ?? []) {
        // A squad member has its own desk in the squad room: it is not a helper.
        if (sub.member) continue
        const helper = this.helpers.get(sub.id)
        if (helper) {
          this.helperText(helper, a, sub)
          this.helperFollow(helper, a, parent)
          continue
        }
        if (!working) continue
        // The cap: three helpers at the same desk.
        const taken = [...this.helpers.values()].filter((h) => h.parentId === a.id && !h.gone).map((h) => h.slot)
        const slot = freeSlot(taken)
        if (slot < 0) continue
        this.addHelper(a, parent, sub.id, sub.description, slot)
      }
      // A helper whose subagent ended: it walks back to the desk and leaves the scene.
      for (const h of this.helpers.values()) {
        if (h.parentId !== a.id || h.gone || h.endAt !== null) continue
        const done = (a.subagentsDone ?? []).find((x) => x.id === h.id)
        if (!done) continue
        if (done.status === 'failed') {
          h.failed = true
          // When the failure happened: the conversation of the owner may have been
          // opened before the renderer heard about it, and the user has already
          // seen the error card.
          h.failedAt = done.endedAt ?? Date.now()
          h.task = done.description || h.task
        }
        h.endAt = Math.max(this.time, h.bornAt + HELPER_MIN_S)
      }
    }
    // A helper whose owner is gone leaves too.
    for (const h of this.helpers.values()) {
      if (h.gone || h.endAt !== null) continue
      const owner = this.actors.get(h.parentId)
      if (!owner || owner.down) h.endAt = Math.max(this.time, h.bornAt + HELPER_MIN_S)
    }
  }

  protected addHelper(a: AgentSummary, parent: Actor, id: string, task: string, slot: number): Helper {
    // The same look as its owner, 62% of the size.
    const avatar = new Avatar(a.look, a.id)
    avatar.setUniform(this.uniformFor(a))
    avatar.speed = 2.4
    const tag = this.overlays.add(
      new Tag(avatar.anchor, helperLabel(a.name, clip(task, 24)), false, () => this.hooks.onAgentClick(a.id, id)),
    )
    tag.el.classList.add('tag-mini')
    tag.setDot('working')
    // The helper is on the floor its owner works on, beside the desk of its owner.
    avatar.floor = this.homeFloor(a)
    const p = parent.avatar.position
    avatar.placeAt(p.x, p.z)
    avatar.root.scale.setScalar(0.01)
    this.engine.scene.add(avatar.root)
    // The desk of the owner on the floor it is on now: the helper stands beside it.
    const desk = this.helperAnchorOn(a, avatar.floor)
    const anchor = desk ?? { x: parent.avatar.position.x, z: parent.avatar.position.z }
    const spot = helperPlace(anchor.x, anchor.z, slot)
    // The cord on the floor, in the shirt color of the owner.
    const cord = box(this.engine.scene, spot.cordLength, 0.04, 0.1, a.look.shirt, spot.cord[0], 0.02, spot.cord[1], false)
    const helper: Helper = {
      id,
      parentId: a.id,
      avatar,
      tag,
      slot,
      cord,
      task,
      anchor,
      tile: [Math.floor(spot.at[0]), Math.floor(spot.at[1])],
      bornAt: this.time,
      endAt: null,
      returning: null,
      gone: false,
      failed: false,
      failedAt: null,
    }
    this.helpers.set(id, helper)
    this.grow(helper)
    // It walks to its fixed spot beside the desk and works there.
    avatar.pose = 'stand'
    this.route(avatar, helper.tile!, null, () => {
      if (helper.gone) return
      avatar.placeAt(spot.at[0], spot.at[1])
      avatar.pose = 'type'
      avatar.face(Math.PI / 2)
    })
    return helper
  }

  protected grow(helper: Helper): void {
    const k = Math.min(1, (this.time - helper.bornAt) / 0.35)
    helper.avatar.root.scale.setScalar(Math.max(0.01, k * HELPER_SCALE))
    if (k < 1 && !helper.gone) requestAnimationFrame(() => this.grow(helper))
  }

  /**
   * The middle of the owner's desk on a given floor: the desk it works at now, so
   * the helper stands beside its owner and not beside the desk it is heading to.
   * Null when the owner has no desk of its own and no coordinator's desk: the
   * helper then stands where its owner stands.
   */
  protected helperAnchorOn(a: AgentSummary, floor: number): { x: number; z: number } | null {
    const desk = this.deskOn(floor, a)
    if (desk) return desk.center ?? { x: desk.x + 1, z: desk.z + 0.5 }
    const coordinator = this.coordinatorDeskOn(floor, a)
    if (coordinator) return { x: coordinator.at.x, z: coordinator.at.z }
    return null
  }

  /**
   * The helper stays with its owner: the same floor, the same spot beside the desk
   * and the cord where it belongs. When the owner changes floor (a new project, a
   * floor rebuilt or renumbered), the helper goes with it: it never stays behind on
   * the floor the owner left.
   *
   * The floor is the one the owner works on, not the one it happens to be on: a
   * short visit to the player does not take the helper away from the desk of its
   * owner.
   */
  protected helperFollow(helper: Helper, a: AgentSummary, parent: Actor): void {
    // A helper that is going back to the desk of its owner is not at the spot
    // beside the desk any more: the way back takes care of it, and it is the
    // way back that follows the owner when the owner changes floor.
    if (helper.returning) return
    const floor = this.homeFloor(a)
    const desk = this.helperAnchorOn(a, floor)
    // Without a desk of its own, the helper stands where its owner stands: it waits
    // for the owner to settle instead of following it step by step.
    const anchor =
      desk ?? (parent.avatar.isWalking ? helper.anchor : { x: parent.avatar.position.x, z: parent.avatar.position.z })
    const move = helperMove({ floor, x: anchor.x, z: anchor.z }, helper.slot, { floor: helper.avatar.floor, anchor: helper.anchor })
    if (!move.changedFloor && !move.movedSpot) return
    helper.anchor = { x: anchor.x, z: anchor.z }
    helper.tile = move.tile
    helper.cord.position.set(move.cord[0], 0.02, move.cord[1])
    helper.cord.scale.x = move.cordLength
    if (move.changedFloor) {
      // The owner changed floor: the helper changes floor with it, at once.
      helper.avatar.floor = move.floor
      helper.avatar.stop()
      helper.avatar.placeAt(move.at[0], move.at[1])
      helper.avatar.pose = 'type'
      helper.avatar.face(Math.PI / 2)
      return
    }
    // The desk of the owner moved on this floor: the helper takes the new spot.
    if (helper.endAt !== null) return // it is going back: it walks to the owner, not to the spot
    if (helper.avatar.isWalking) {
      this.route(helper.avatar, move.tile, null, () => {
        if (helper.gone) return
        helper.avatar.placeAt(move.at[0], move.at[1])
        helper.avatar.pose = 'type'
        helper.avatar.face(Math.PI / 2)
      })
      return
    }
    helper.avatar.placeAt(move.at[0], move.at[1])
  }

  /** The mini label of a helper: "↳ Nome · tarefa", with what it is doing now. */
  protected helperText(helper: Helper, a: AgentSummary, sub: SubagentInfo): void {
    if (helper.endAt !== null) return
    helper.task = sub.description
    helper.tag.setName(helperLabel(a.name, clip(sub.description, 24)))
    helper.tag.setBubble(clip(helperActivity(sub), 34), 'work')
  }

  /**
   * Where the helper walks back to: the seat of its owner at the desk, on the floor
   * of that desk. It leaves the scene there, next to the desk of its owner.
   */
  protected helperBack(a: AgentSummary | undefined, parent: Actor | undefined, floor: number): { x: number; z: number } | null {
    const desk = a ? this.deskOn(floor, a) : undefined
    if (desk) return desk.seat
    const coordinator = a ? this.coordinatorDeskOn(floor, a) : undefined
    if (coordinator) return coordinator.seat
    return parent ? { x: parent.avatar.position.x, z: parent.avatar.position.z } : null
  }

  protected updateHelpers(dt: number): void {
    for (const h of this.helpers.values()) {
      h.avatar.update(dt)
      // A helper that is going back is on its own: the way back follows the
      // owner, even when the owner changes floor in the middle of the walk.
      if (h.returning) {
        h.returning.step()
        continue
      }
      // The helper stays with its owner: it follows the floor and the desk of the
      // owner, even when the owner moves while it works.
      const parent = this.actors.get(h.parentId)
      const a = this.state.agents.get(h.parentId)
      if (parent && a && !parent.down && parent.goal !== 'leave') this.helperFollow(h, a, parent)
      if (h.endAt === null || this.time < h.endAt) continue
      this.helperLeave(h)
    }
  }

  /**
   * The helper says goodbye: the cord and the mini label go right away, and the
   * character walks back to the desk of its owner, where it leaves the scene.
   *
   * The way back is in charge of the helper from here on: it follows the owner
   * when the owner changes floor, and it always ends once, with the red mark of
   * a failure when the failure was not seen yet.
   */
  protected helperLeave(h: Helper): void {
    h.gone = true
    this.overlays.remove(h.tag)
    h.cord.visible = false
    h.avatar.stop()
    h.avatar.pose = 'stand'
    const onDone = () => this.helperGone(h)
    h.returning = new HelperReturn(h.avatar, () => this.ownerDesk(h), h.slot, onDone)
    h.returning.start()
  }

  /**
   * The desk of the owner of a helper, on the floor the owner works on now: the
   * floor, the middle of the desk and the seat where the helper walks back to.
   */
  protected ownerDesk(h: Helper): OwnerDesk {
    const a = this.state.agents.get(h.parentId)
    const parent = this.actors.get(h.parentId)
    const floor = a ? this.homeFloor(a) : h.avatar.floor
    return {
      floor,
      anchor: a ? this.helperAnchorOn(a, floor) : null,
      seat: this.helperBack(a, parent, floor),
    }
  }

  protected helperGone(h: Helper): void {
    if (!this.helpers.has(h.id)) return
    this.helpers.delete(h.id)
    h.returning = null
    h.avatar.dispose()
    this.engine.scene.remove(h.avatar.root)
    this.engine.scene.remove(h.cord)
    this.overlays.remove(h.tag)
    // A helper that failed leaves a red mark by the desk, unless the user already
    // saw the failure in the conversation of the owner: the error card is there,
    // and a new mark would only point at what is already on the screen.
    if (helperLeavesMark(h.failed, h.failedAt, this.seenFailures, h.parentId, Date.now())) this.failureMark(h)
  }

  /** The red mark of a failed helper: a red pad on the floor and a mini label beside it. */
  protected failureMark(h: Helper): void {
    const a = this.state.agents.get(h.parentId)
    if (!a) return
    const mark = this.failures.get(h.parentId)
    if (mark) {
      // Several helpers of the same owner failed: one mark, counting them all.
      mark.count += 1
      mark.id = h.id
      mark.tag.setName(helperFailedLabel(a.name, h.task, mark.count))
      return
    }
    const anchor = this.failureAnchor(a)
    if (!anchor) return
    const place = failureMarkPlace({ floor: this.homeFloor(a), project: a.project ?? null, x: anchor.x, z: anchor.z })
    if (!place) return
    const pad = failurePad(place.x, place.z)
    this.engine.scene.add(pad)
    const tagAnchor = new THREE.Object3D()
    tagAnchor.position.set(place.x, 0.9, place.z)
    this.engine.scene.add(tagAnchor)
    const tag = this.overlays.add(
      new Tag(tagAnchor, helperFailedLabel(a.name, h.task, 1), false, () => this.hooks.onAgentClick(h.parentId, h.id)),
    )
    tag.el.classList.add('tag-mini')
    tag.setDot('error')
    this.failures.set(h.parentId, {
      parentId: h.parentId,
      id: h.id,
      count: 1,
      floor: place.floor,
      x: place.x,
      z: place.z,
      pad,
      tag,
    })
  }

  /**
   * The red marks follow their owner: when the floors are built again, the mark
   * goes to the desk its owner works at now, on the floor its owner is on. When the
   * owner is gone (or its project was removed), the mark goes away with it: no red
   * pad is left behind at a stale place, on a floor that no longer exists.
   */
  protected reflowFailureMarks(): void {
    for (const mark of [...this.failures.values()]) {
      const owner = this.state.agents.get(mark.parentId)
      const place = failureMarkPlace(owner ? this.markOwner(owner) : null)
      if (!place) {
        this.clearFailureMarks(mark.parentId)
        continue
      }
      if (!markOutOfPlace(mark, place)) continue
      mark.floor = place.floor
      mark.x = place.x
      mark.z = place.z
      mark.pad.position.set(place.x, 0.03, place.z)
      mark.tag.anchor.position.set(place.x, 0.9, place.z)
    }
  }

  /** The owner of a mark: the floor it works on and the middle of its desk. */
  protected markOwner(a: AgentSummary): MarkOwner {
    const anchor = this.failureAnchor(a)
    return { floor: this.homeFloor(a), project: a.project ?? null, x: anchor?.x ?? null, z: anchor?.z ?? null }
  }

  /** Where the owner's desk is: the middle of its desk, or the coordinator's desk of its room. */
  protected failureAnchor(a: AgentSummary): { x: number; z: number } | null {
    const desk = this.deskOf(a)
    if (desk) return desk.center ?? { x: desk.x + 1, z: desk.z + 0.5 }
    const coordinator = this.coordinatorDesk(a)
    if (coordinator) return { x: coordinator.at.x, z: coordinator.at.z }
    const parent = this.actors.get(a.id)
    return parent ? { x: parent.avatar.position.x, z: parent.avatar.position.z } : null
  }

  /**
   * The owner's conversation was opened: the red marks go away from the scene.
   * The error card stays in the conversation, and the inbox says nothing about it.
   *
   * A helper that failed and is still walking back must not leave a new mark when
   * it arrives: the conversation was opened after that failure, so the user has
   * already seen the error card.
   */
  clearFailureMarks(agentId: string): void {
    const openedAt = Date.now()
    this.seenFailures.open(agentId, openedAt)
    // A helper that failed and is still walking back does not leave a new mark when
    // it arrives: the failure was already in the conversation that is now open.
    for (const h of this.helpers.values()) {
      if (h.parentId !== agentId || !h.failed || h.failedAt === null) continue
      h.failedAt = this.seenFailures.seen(agentId, h.failedAt)
    }
    const mark = this.failures.get(agentId)
    if (!mark) return
    // The pad takes its geometry and material with it: they are its own.
    disposeTree(mark.pad)
    this.engine.scene.remove(mark.pad)
    this.engine.scene.remove(mark.tag.anchor)
    this.overlays.remove(mark.tag)
    this.failures.delete(agentId)
  }
}
