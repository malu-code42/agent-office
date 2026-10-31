import { totemView } from '@shared/routines'
import { emiAgentId } from '@shared/emi'
import { LUNA_AGENT_ID } from '@shared/luna'
import type { State } from '../state'
import { Aura } from '../world/aura'
import type { Avatar } from '../world/avatar'
import type { UpperFloor } from '../world/upper-floor'
import { headingOf } from '../world2d/iso'
import type { FlatFloor } from '../world2d/floor'
import type { FlatView, Person2d } from '../world2d/renderer'
import { agentBubble, EMI_VARIANT, LUNA_VARIANT, variantOf } from '../world2d/sprites'
import type { StudyCycleState } from '@shared/study-cycle'
import { GameInput } from './input'
import { studyCycleView } from '../world2d/estudos'
import { LOUNGE_AFTER_MS, screenMode, TAG_LIFT, type GameHooks, type Upper } from './types'

export type { GameHooks } from './types'

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
  }

  // ---------- loop ----------

  /**
   * True while something on screen moves: an avatar on this floor walks or turns, the
   * camera eases, an effect plays, the player steers or just touched the mouse. Otherwise
   * the loop drops to a slow tick (typing hands and monitors still move, only less often).
   */
  get busy(): boolean {
    if (performance.now() < this.wakeUntil || this.keys.size || this.dragging || this.doomed.size) return true
    const flat = this.flat
    if (flat ? flat.moving || flat.dirty : this.engine.moving || this.engine.dirty || this.effects.active) return true
    const view = this.player.floor
    const moving = (av: Avatar) => av.floor === view && av.isMoving
    if (moving(this.player)) return true
    if (view === this.studyFloor && [...this.study.walkers.values()].some((w) => w.walking)) return true
    for (const a of this.actors.values()) if (moving(a.avatar)) return true
    for (const h of this.helpers.values()) if (moving(h.avatar)) return true
    for (const m of this.members.values()) if (moving(m.avatar)) return true
    return false
  }

  /** Sparks, smoke and the alarm toned down (Configurações → Vídeo, or prefers-reduced-motion). */
  setReducedEffects(on: boolean): void {
    this.effects.reduced = on
    Aura.reduced = on
    this.office.reducedMotion = on
    for (const u of this.uppers) u.scene.reducedMotion = on
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
    this.updateHelpers(dt)
    this.updateMembers(dt)
    // the 3D Casa (Luna's animation, the elevator doors) only moves while it is the one drawn
    if (this.visual !== '2d') this.office.update(dt)
    for (const u of this.uppers) u.scene.update(dt)
    this.study.update(dt)
    this.boardsIn -= dt
    if (this.boardsIn <= 0) this.syncBoards()
    this.showFloor()
    this.updateSkull()
    this.updateTotem(dt)
    this.effects.update(dt)

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
    if (this.follow) this.engine.target.set(this.player.position.x, 0, this.player.position.z)
    this.engine.step(dt)
  }

  /**
   * The totem's screen and LED. The text is worked out once a second and the canvas is
   * drawn only when it changed (the countdown moves once a minute above one minute).
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
    if (this.totem.view.show(view) && this.player.floor === 0) this.wake(100)
  }

  /** Draws the scene and moves the HTML tags along. Skipped while the window is hidden. */
  draw(dt: number): void {
    const flat = this.flat
    const up = this.upperOf(this.player.floor)
    const floor = up && (up.scene as UpperFloor & { flat?: FlatFloor }).flat
    this.flat2d.show(!!flat)
    this.engine.renderer.domElement.classList.toggle('hidden', !!flat)
    const view =
      flat &&
      (up && floor
        ? this.flatView(up, floor)
        : this.player.floor === 0
          ? this.casaView()
          : this.player.floor === this.studyFloor
            ? this.studyView()
            : null)
    if (flat && view) {
      flat.draw(view, dt)
      // tags float a little higher than in 3D: the sprite's pixel bubble sits over the head
      this.overlays.projector = (v) => flat.project(v.x, v.y + TAG_LIFT, v.z)
    } else {
      this.overlays.projector = null
      this.engine.render(dt)
    }
    this.overlays.update(dt)
  }

  /**
   * The people of the floor on screen, as the 2D renderer draws them: the player, the
   * agents, their helpers and the squad members, each in its own colours.
   */
  private flatPeople(): Person2d[] {
    const view = this.player.floor
    const people: Person2d[] = []
    const add = (key: string, av: Avatar, bubble: Person2d['bubble'] = null) => {
      if (av.floor !== view || !av.root.visible) return
      const seated = !av.isWalking && (av.pose === 'sit' || av.pose === 'type' || av.pose === 'relax')
      const look = av.worn
      people.push({
        key,
        variant: variantOf(look),
        look,
        x: av.position.x,
        z: av.position.z,
        heading: av.heading,
        stride: av.isStepping ? av.stride : null,
        seated,
        bubble,
      })
    }
    add('player', this.player)
    for (const actor of this.actors.values()) {
      const a = this.state.agents.get(actor.id)
      const items = a ? this.state.itemsFor(a.id) : null
      const result = items?.results[0] ? (items.results[0].isError ? 'error' : 'ok') : null
      add(actor.id, actor.avatar, a && items ? agentBubble(a.status, items.permissions.length > 0, result) : null)
    }
    for (const h of this.helpers.values()) if (!h.gone) add(`helper:${h.id}`, h.avatar)
    for (const m of this.members.values())
      add(`member:${m.id}`, m.avatar, m.failed ? 'bang' : m.phase === 'delivering' ? 'ok' : m.phase === 'working' ? 'dots' : null)
    return people
  }

  /** The 2D Casa this frame: its people and Luna at her chair, in her saved look. */
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
      floor: this.casa2d.flat,
      people,
      desks: new Set(),
      coordinators: [],
      emi: null,
      rooms: [],
      meeting: 0,
      hover: this.hover2d,
      target: { x: this.engine.target.x, z: this.engine.target.z },
      highlight: this.casaHot,
    }
  }

  /** The study floor this frame: whoever came up, Cora, Bonnie and the teachers. */
  private studyView(): FlatView {
    return {
      floor: this.study.scene.flat,
      people: [...this.flatPeople(), ...this.study.people()],
      desks: new Set(),
      coordinators: [],
      emi: null,
      rooms: [],
      meeting: 0,
      hover: this.hover2d,
      target: { x: this.engine.target.x, z: this.engine.target.z },
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

  /** What the 2D renderer draws this frame: the people of the floor on screen and the state of its desks. */
  private flatView(up: Upper, floor: FlatFloor): FlatView {
    const view = this.player.floor
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
      floor,
      people,
      desks,
      coordinators,
      emi: emi ? screenMode(emi) : null,
      rooms: plan.rooms.map((r) => this.roomPlate(r)),
      meeting,
      hover: this.hover2d,
      target: { x: this.engine.target.x, z: this.engine.target.z },
    }
  }

  /** People in the scene besides the player, for the dev leak test (dev/leak-test.ts). */
  get population(): { actors: number; helpers: number; members: number } {
    return { actors: this.actors.size, helpers: this.helpers.size, members: this.members.size }
  }
}
