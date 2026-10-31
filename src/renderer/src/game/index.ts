import { totemView } from '@shared/routines'
import { emiAgentId } from '@shared/emi'
import { LUNA_AGENT_ID } from '@shared/luna'
import type { StudyCycleState } from '@shared/study-cycle'
import type { State } from '../state'
import type { Avatar } from '../world2d/avatar'
import { headingOf } from '../world2d/iso'
import type { Decal, FlatView, Person2d } from '../world2d/renderer'
import { agentBubble, EMI_VARIANT, LUNA_VARIANT, variantOf } from '../world2d/sprites'
import { studyCycleView } from '../world2d/estudos'
import { GameInput } from './input'
import { LOUNGE_AFTER_MS, screenMode, type GameHooks, type Upper } from './types'

export type { GameHooks } from './types'

/** Frames per second of the typing loop of the agents at work (render on demand: only their rectangles redraw). */
const TYPE_FPS = 4
/** Seconds the elevator doors take to slide, and how long they stay open after a ding. */
const DOOR_SLIDE_S = 0.12
const DOOR_OPEN_S = 1.5

/**
 * The office world: the floors, the player, the agents and their helpers. Split by
 * responsibility in game/*.ts, each part extending the previous one (base.ts first).
 */
export class Game extends GameInput {
  constructor(container: HTMLElement, overlayRoot: HTMLElement, state: State, hooks: GameHooks) {
    super(container, overlayRoot, state, hooks)
    this.setProjects(state.settings.projects, state.squads, state.squadProposals, false)
    for (const a of state.agents.values()) if (!a.builtIn) this.addActor(a, false)
    state.onChange(() => {
      this.sync()
      this.wake()
    })
    this.bindInput(container)
    this.flat2d.show(true)
  }

  // ---------- loop ----------

  /**
   * True while something on screen moves: someone on this floor walks, the camera eases,
   * a strike plays, the doors slide, the player steers or just touched the mouse. Otherwise
   * the loop drops to a slow tick (the typing loop and the totem still change, only rarely).
   */
  get busy(): boolean {
    if (performance.now() < this.wakeUntil || this.keys.size || this.dragging || this.doomed.size || this.fxActive) return true
    if (this.flat2d.moving || this.flat2d.dirty) return true
    const view = this.player.floor
    const door = this.doors.get(view)
    if (door !== undefined && this.time - door < DOOR_OPEN_S + DOOR_SLIDE_S) return true
    const moving = (av: Avatar) => av.floor === view && av.isMoving
    if (moving(this.player)) return true
    if (view === this.studyFloor && [...this.study.walkers.values()].some((w) => w.walking)) return true
    for (const a of this.actors.values()) if (moving(a.avatar)) return true
    for (const h of this.helpers.values()) if (moving(h.avatar)) return true
    for (const m of this.members.values()) if (moving(m.avatar)) return true
    return false
  }

  /** Movement toned down (Economia on battery, or prefers-reduced-motion): no typing loop, the skull holds still. */
  setReducedEffects(on: boolean): void {
    this.reducedEffects = on
  }

  /** Moves everything by dt seconds; draws nothing (see draw). */
  update(dt: number): void {
    this.time += dt
    this.moveWithKeys(dt)
    this.player.update(dt)
    for (const actor of this.actors.values()) {
      actor.avatar.update(dt)
      if (actor.arrived && actor.goal === 'boss' && actor.avatar.pose === 'wave' && this.time > actor.waveUntil) {
        const a = this.state.agents.get(actor.id)
        if (a) this.pose(actor, a)
      }
    }
    this.shrink()
    this.updateHelpers(dt)
    this.updateMembers(dt)
    this.study.update(dt)
    this.boardsIn -= dt
    if (this.boardsIn <= 0) this.syncBoards()
    this.showFloor()
    this.updateSkull(dt)
    this.updateTotem(dt)

    this.recheck -= dt
    if (this.recheck <= 0) {
      this.recheck = 0.4
      this.checkVisitors()
      for (const actor of this.actors.values()) {
        if (actor.chatUntil && this.time >= actor.chatUntil) {
          actor.chatUntil = 0
          actor.goal = null
          this.reconcile(actor)
          continue
        }
        if (actor.goal === 'desk' && actor.restSince !== null && Date.now() - actor.restSince >= LOUNGE_AFTER_MS) this.reconcile(actor)
      }
    }

    this.updateWatch()
    if (this.follow) this.target.set(this.player.position.x, 0, this.player.position.z)
  }

  /**
   * The routines board's screen and its tag. The text is worked out once a second; the
   * renderer draws the screen again only when what it shows changed.
   */
  private updateTotem(dt: number): void {
    this.totemIn -= dt
    if (this.totemIn > 0) return
    this.totemIn = 1
    const view = totemView(this.state.routines, Date.now(), this.state.macJobs)
    // the tag is HTML: it only touches the DOM when its text changes
    this.totem.tag.setDot(`routine-${view.led}`)
    // the screen is pixel art: the balloon carries the line in letters people can read
    this.totem.tag.setBubble(view.line, view.led === 'wait' ? 'wait' : 'idle')
    if (this.totem.tag.el.title !== view.line) this.totem.tag.el.title = view.line
    const was = this.totem.view
    this.totem.view = view
    if (this.player.floor === 0 && JSON.stringify([was?.screen, was?.led]) !== JSON.stringify([view.screen, view.led])) this.wake(100)
  }

  /** Draws the floor on screen and moves the HTML tags along. Skipped while the window is hidden. */
  draw(dt: number): void {
    const n = this.player.floor
    const up = this.upperOf(n)
    const view = up ? this.flatView(up) : n === 0 ? this.casaView() : this.studyView()
    this.flat2d.draw(view, dt)
    this.overlays.update(dt)
  }

  /** The elevator doors of a floor: closed, sliding (half open) or open, after its last ding. */
  private doorOf(floor: number): 0 | 1 | 2 {
    const at = this.doors.get(floor)
    if (at === undefined) return 0
    const t = this.time - at
    if (t < DOOR_SLIDE_S) return 1
    if (t < DOOR_OPEN_S) return 2
    return t < DOOR_OPEN_S + DOOR_SLIDE_S ? 1 : 0
  }

  /** What every floor's view shares: the hovered tile, the camera, the doors, the cords and marks, the fx. */
  private common(): Pick<FlatView, 'hover' | 'target' | 'door' | 'decals' | 'fx'> {
    const view = this.player.floor
    const decals: Decal[] = []
    for (const h of this.helpers.values()) {
      if (h.gone || h.avatar.floor !== view || h.returning) continue
      const color = this.state.agents.get(h.parentId)?.look.shirt ?? h.avatar.look.shirt
      decals.push({ key: `cord:${h.id}`, kind: 'cord', from: h.anchor, to: { x: h.avatar.x, z: h.avatar.z }, color })
    }
    for (const mark of this.failures.values())
      if (mark.floor === view) decals.push({ key: `pad:${mark.parentId}`, kind: 'pad', x: mark.x, z: mark.z })
    return {
      hover: this.hover2d,
      target: { x: this.target.x, z: this.target.z },
      door: this.doorOf(view),
      decals,
      fx: this.fx.filter((f) => f.floor === view),
    }
  }

  /**
   * The people of the floor on screen, as the renderer draws them: the player, the
   * agents, their helpers and the squad members, each in its own colours.
   */
  private flatPeople(): Person2d[] {
    const view = this.player.floor
    const people: Person2d[] = []
    // the second frame of the typing loop, for everyone typing at once
    const alt = !this.reducedEffects && Math.floor(this.time * TYPE_FPS) % 2 === 1
    const add = (key: string, av: Avatar, bubble: Person2d['bubble'] = null) => {
      if (av.floor !== view || !av.visible) return
      const seated = !av.isWalking && (av.pose === 'sit' || av.pose === 'type' || av.pose === 'relax')
      const look = av.worn
      people.push({
        key,
        variant: variantOf(look),
        look,
        x: av.x + av.shake,
        z: av.z,
        heading: av.heading,
        stride: av.isStepping ? av.stride : null,
        seated,
        bubble,
        alt: seated && av.pose === 'type' && alt,
        down: av.isDown,
        scale: av.scale,
      })
    }
    add('player', this.player)
    for (const actor of this.actors.values()) {
      const a = this.state.agents.get(actor.id)
      const items = a ? this.state.itemsFor(a.id) : null
      const result = items?.results[0] ? (items.results[0].isError ? 'error' : 'ok') : null
      add(actor.id, actor.avatar, a && items && !actor.down ? agentBubble(a.status, items.permissions.length > 0, result) : null)
    }
    for (const h of this.helpers.values()) if (!h.gone || h.returning) add(`helper:${h.id}`, h.avatar)
    for (const m of this.members.values())
      add(`member:${m.id}`, m.avatar, m.failed ? 'bang' : m.phase === 'delivering' ? 'ok' : m.phase === 'working' ? 'dots' : null)
    return people
  }

  /** The Casa this frame: its people, Luna at her chair in her saved look, and the routines board. */
  private casaView(): FlatView {
    const people = this.flatPeople()
    const luna = this.state.agents.get(LUNA_AGENT_ID)
    const seat = this.casa2d.flat.layout.table.seats[0]
    people.push({
      key: 'luna',
      variant: LUNA_VARIANT,
      look: luna?.look,
      x: seat.at[0] / 16,
      z: seat.at[1] / 16,
      heading: headingOf(seat.dir),
      stride: null,
      seated: true,
      bubble: luna ? agentBubble(luna.status, this.state.itemsFor(luna.id).permissions.length > 0, null) : null,
    })
    return {
      ...this.common(),
      floor: this.casa2d.flat,
      people,
      desks: new Set(),
      coordinators: [],
      emi: null,
      rooms: [],
      meeting: 0,
      highlight: this.casaHot,
      totem: this.totem.view,
    }
  }

  /** The study floor this frame: whoever came up, Cora, Bonnie and the teachers. */
  private studyView(): FlatView {
    return {
      ...this.common(),
      floor: this.study.scene.flat,
      people: [...this.flatPeople(), ...this.study.people()],
      desks: new Set(),
      coordinators: [],
      emi: null,
      rooms: [],
      meeting: 0,
      highlight: this.studyHot,
    }
  }

  /**
   * The study cycle changed (or was read again): the topic on the blackboard and the teacher
   * of the turn. Off the study floor the teachers just take their places.
   */
  setStudyCycle(state: StudyCycleState): void {
    const here = this.player.floor === this.studyFloor
    const before = this.study.inClass
    this.study.setCycle(studyCycleView(state), !here || this.reducedEffects)
    if (here && this.study.inClass !== before) this.wake(400)
  }

  /** A project floor this frame: the people on it and the state of its desks. */
  private flatView(up: Upper): FlatView {
    const view = this.player.floor
    const floor = up.scene.flat
    const plan = floor.plan
    const people = this.flatPeople()
    const desks = new Set<number>()
    for (const r of plan.rooms) for (const d of r.desks) desks.add(d.index)
    for (const actor of this.actors.values()) {
      const a = this.state.agents.get(actor.id)
      if (a && a.role !== 'orchestrator' && this.homeFloor(a) === view && a.desk < plan.agentDesks.length)
        desks.add(plan.agentDesks[a.desk].index)
    }
    const orchestrators = this.orchestratorsOn(view)
    const coordinators = plan.rooms.map((_, i) => {
      const a = orchestrators.get(i)
      if (!a) return null
      const items = this.state.itemsFor(a.id)
      return items.permissions.length || items.results.length ? ('waiting' as const) : screenMode(a)
    })
    const emi = this.state.agents.get(emiAgentId(up.project.id))
    if (emi) {
      const seat = floor.layout.emi.seat
      const items = this.state.itemsFor(emi.id)
      up.emiTag?.setDot(emi.status)
      up.emiTag?.setBubble(
        items.permissions.length ? '? Tenho uma pergunta' : emi.status === 'working' || emi.status === 'starting' ? emi.activity : null,
        items.permissions.length ? 'wait' : 'work',
      )
      people.push({
        key: 'emi',
        variant: EMI_VARIANT,
        look: emi.look,
        x: seat.at[0] / 16,
        z: seat.at[1] / 16,
        heading: 0,
        stride: null,
        seated: true,
        bubble: agentBubble(emi.status, this.state.itemsFor(emi.id).permissions.length > 0, null),
      })
    }
    let meeting = 0
    for (const actor of this.actors.values())
      if (actor.goal === 'meeting' && actor.arrived && actor.avatar.floor === view && actor.avatar.pose === 'sit') meeting++
    return {
      ...this.common(),
      floor,
      people,
      desks,
      coordinators,
      emi: emi ? screenMode(emi) : null,
      rooms: plan.rooms.map((r) => this.roomPlate(r)),
      meeting,
    }
  }

  /** People in the scene besides the player, for the dev leak test (dev/leak-test.ts). */
  get population(): { actors: number; helpers: number; members: number } {
    return { actors: this.actors.size, helpers: this.helpers.size, members: this.members.size }
  }
}
