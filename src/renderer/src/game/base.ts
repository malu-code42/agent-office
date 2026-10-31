import * as THREE from 'three'
import type { AgentSummary } from '@shared/types'
import { LUNA_AGENT_ID } from '@shared/luna'
import type { State } from '../state'
import { Avatar, type Uniform } from '../world/avatar'
import { Engine } from '../world/engine'
import * as L from '../world/layout'
import { buildHome, type HomeFloor } from '../world/home'
import { HOME_PLAN_3D, type HomePlan } from '../world/home-layout'
import type { Office } from '../world/office'
import { Overlays, Tag } from '../world/overlays'
import { Effects } from '../world/effects'
import { FACE_CAMERA, skeleton } from '../world/skull'
import { totem, type Totem } from '../world/totem'
import { Renderer2d } from '../world2d/renderer'
import { CASA_LAYOUT } from '../world2d/atlas'
import { casaPlan, type CasaAct, type CasaFlat } from '../world2d/casa'
import { buildCasa2d } from '../world2d/floor'
import type { Visual } from '@shared/video'
import { SeenFailures } from './failure-marks'
import {
  center,
  OVERFLOW_TILES,
  SKULL_HOME,
  TAG_LIFT,
  TOTEM_TILE,
  tileOf,
  type Actor,
  type FailureMark,
  type GameHooks,
  type Helper,
  type Member,
  type Upper,
} from './types'

/**
 * State shared by every part of the office (game/*.ts), the floor lookups and the
 * walking primitives. Each part extends the previous one; Game (index.ts) is the last.
 */
export abstract class GameBase {
  readonly engine: Engine
  /** Ground floor. */
  readonly office: HomeFloor
  /** Project floors, 1º andar first. */
  protected uppers: Upper[] = []
  protected uppersKey = ''
  protected members = new Map<string, Member>()
  /**
   * Members of a squad with no place in the scene (their squad has no room and every
   * spot is taken): squad code -> names. The notice of the floor names them, so the
   * data never looks lost.
   */
  protected unplacedMembers = new Map<string, string[]>()
  protected pcTag: Tag
  /** Over the ground floor alarm. */
  protected alarmTag: Tag
  /** Over the ground floor spending board. */
  protected moneyTag: Tag
  /** Seconds until the boards and alarms are checked again (limits expire on their own). */
  protected boardsIn = 0
  readonly overlays: Overlays
  readonly player: Avatar
  protected playerTag: Tag
  protected actors = new Map<string, Actor>()
  protected helpers = new Map<string, Helper>()
  /** The red marks left by the helpers that failed, until the owner's conversation is opened. */
  protected failures = new Map<string, FailureMark>()
  /** The failures the user already saw in the conversation of their owner. */
  protected seenFailures = new SeenFailures()
  protected keys = new Set<string>()
  protected follow = true
  /** Agent the camera tracks until it settles (sits or stops); `until` drops it if it never shows up. */
  protected watch: { id: string; until: number } | null = null
  protected hover: THREE.LineSegments
  protected time = 0
  protected nearId: string | null = null
  protected recheck = 0
  protected dragging: { x: number; y: number; moved: boolean; button: number } | null = null
  protected wheelAcc = 0
  protected effects: Effects
  protected skull: { root: THREE.Group; tag: Tag; eyes: THREE.MeshBasicMaterial }
  /** Existing agent-routine scheduler totem, kept separate from the personal home board. */
  protected totem: { view: Totem; tag: Tag }
  /** Luna's name tag in the house: shows the review-of-the-day bubble when due. */
  protected lunaTag: Tag | null = null
  private lunaLookKey = ''
  /** Tags anchored to the Casa scene are separate from the three.js floor group. */
  protected homeSceneTags: Tag[] = []
  /** Seconds until the totem's text is worked out again (at most once a second). */
  protected totemIn = 0
  /** Agents picked at the skull, waiting for the camera (or the elevator) before the strike. */
  protected doomed = new Map<string, { at: number; done: () => void }>()
  /** performance.now() until which the scene draws at full rate even if nothing walks (input, events). */
  protected wakeUntil = 0
  protected reducedEffects = false
  /** How the project floors are drawn (Configurações → Vídeo → Visual). */
  protected visual: Visual
  /** The 2D renderer of the project floors; its canvas hides while the 3D world shows. */
  readonly flat2d: Renderer2d
  /** Tile under the pointer on a 2D floor. */
  protected hover2d: { x: number; z: number; ok: boolean } | null = null
  /** The clickable thing of the 2D Casa under the pointer (drawn brighter). */
  protected casaHot: CasaAct | null = null
  /** The Casa of the 2D world: its grid and spots (the 3D Casa is `office`). */
  protected readonly casa2d: Office & { flat: CasaFlat } = buildCasa2d(CASA_LAYOUT)
  protected readonly casaPlan2d: HomePlan = casaPlan(CASA_LAYOUT, this.casa2d.grid)
  /**
   * The Casa's tags (Caveira, totem, boards, Luna...) float over the 3D objects or over their
   * 2D spots: each one keeps both anchors and takes the one of the Casa on screen.
   */
  protected casaAnchors: { tag: Tag; d3: THREE.Object3D; d2: THREE.Object3D; subtle: boolean }[] = []

  constructor(
    container: HTMLElement,
    overlayRoot: HTMLElement,
    protected state: State,
    protected hooks: GameHooks,
  ) {
    this.engine = new Engine(container, state.settings.pixelSize)
    this.flat2d = new Renderer2d(container)
    this.visual = state.settings.video?.visual ?? '2d'
    this.office = buildHome()
    this.engine.scene.add(this.office.group)
    this.overlays = new Overlays(overlayRoot, this.engine)

    this.office.setFloors(1)
    // player
    this.player = new Avatar(state.settings.playerLook, 'player')
    this.player.speed = 3.6
    this.engine.scene.add(this.player.root)
    this.sitPlayer()
    this.playerTag = this.overlays.add(new Tag(this.player.anchor, state.settings.playerName, true))
    this.playerTag.setDot('you')
    this.engine.jumpTo(this.player.position.x, this.player.position.z)

    // hovered tile outline, Habbo style
    const g = new THREE.BufferGeometry().setFromPoints(
      [
        [0, 0],
        [1, 0],
        [1, 0],
        [1, 1],
        [1, 1],
        [0, 1],
        [0, 1],
        [0, 0],
      ].map(([x, z]) => new THREE.Vector3(x, 0.03, z)),
    )
    this.hover = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85 }))
    this.hover.visible = false
    this.engine.scene.add(this.hover)

    // the skeleton by the boss office: click it to dismiss an agent
    this.effects = new Effects(this.engine.scene)
    const sk = skeleton()
    sk.group.position.set(SKULL_HOME.x, SKULL_HOME.y, SKULL_HOME.z)
    sk.group.rotation.y = FACE_CAMERA
    sk.group.scale.setScalar(1.05)
    const skullAnchor = new THREE.Object3D()
    skullAnchor.position.set(SKULL_HOME.x, SKULL_HOME.y + 1.85, SKULL_HOME.z)
    // on the ground floor's group, so they hide with it
    this.office.group.add(sk.group, skullAnchor)
    const skullTag = this.overlays.add(new Tag(skullAnchor, 'Caveira', false, () => hooks.onSkull()))
    skullTag.setDot('skull')
    this.skull = { root: sk.group, tag: skullTag, eyes: sk.eyes }

    // the routines totem outside the boss office: next routine, countdown and a status LED
    const tt = totem()
    tt.group.position.set(TOTEM_TILE[0] + 0.8, 0, TOTEM_TILE[1] + 0.5)
    tt.group.rotation.y = FACE_CAMERA
    this.office.group.add(tt.group)
    const totemTag = this.overlays.add(new Tag(tt.anchor, 'Rotinas de agentes', false, () => hooks.onRoutines()))
    totemTag.el.classList.add('tag-totem')
    totemTag.setDot('routine-none')
    this.totem = { view: tt, tag: totemTag }

    // the player's own computer calls a new agent
    const pc = new THREE.Object3D()
    pc.position.set(5.31, 0.85, 4.85)
    this.engine.scene.add(pc)
    this.pcTag = this.overlays.add(new Tag(pc, 'Novo agente', false, () => hooks.onComputer()))
    this.pcTag.setDot('term')

    this.alarmTag = this.alarmTagFor(this.office.alarm)
    this.moneyTag = this.moneyTagFor(this.office.money)
    this.pairCasaTag(this.skull.tag, 'Caveira')
    this.pairCasaTag(this.totem.tag, 'Rotinas de agentes')
    this.pairCasaTag(this.pcTag, 'Novo agente')
    this.pairCasaTag(this.alarmTag, 'Alarme')
    this.pairCasaTag(this.moneyTag, 'Gastos')

    for (const item of this.office.homeTags) {
      const anchor = new THREE.Object3D()
      anchor.position.set(item.x, item.y, item.z)
      this.office.group.add(anchor)
      const onClick = item.label === 'Luna' ? () => hooks.onLunaReview() : item.action ? () => hooks.onHomeAction(item.action!) : undefined
      const tag = this.overlays.add(new Tag(anchor, item.label, false, onClick))
      this.homeSceneTags.push(tag)
      if (item.action) tag.el.title = `Abrir ${item.label}`
      if (item.label === 'Luna') this.lunaTag = tag
      this.pairCasaTag(tag, item.label)
    }
    this.placeCasa()
    this.updateLunaReviewBubble()
    state.onChange(() => this.updateLunaReviewBubble())
  }

  /**
   * Gives a Casa tag its 2D spot: the one casa.json names (art units), or Luna's chair. The
   * 2D projection lifts every tag by TAG_LIFT (over the sprites' heads), so the spot is lowered by it.
   */
  private pairCasaTag(tag: Tag, name: string): void {
    const at = CASA_LAYOUT.tags[name]
    const luna = CASA_LAYOUT.table.seats[0]
    const d2 = new THREE.Object3D()
    if (at) d2.position.set(at[0] / 16, at[2] / 16 - TAG_LIFT, at[1] / 16)
    else if (name === 'Luna') d2.position.set(luna.at[0] / 16, 0.35, luna.at[1] / 16)
    else return
    // the furniture's tags stay small over the pixel art; Luna and the alarms keep their size
    this.casaAnchors.push({ tag, d3: tag.anchor, d2, subtle: !['Luna', 'Alarme', 'Gastos'].includes(name) })
  }

  /**
   * The Casa of the Visual on screen: its tags take their 2D or 3D spots, and the room names
   * of the 3D Casa float only there (the 2D one shows them on hover).
   */
  protected placeCasa(): void {
    const flat = this.visual === '2d'
    for (const a of this.casaAnchors) {
      a.tag.anchor = flat ? a.d2 : a.d3
      a.tag.el.classList.toggle('tag-mini', flat && a.subtle)
      a.tag.changed = true
    }
    this.overlays.clearLabels(0)
    if (!flat) for (const room of this.office.roomLabels ?? []) this.overlays.label(room.label, room.x, room.z)
  }

  private updateLunaReviewBubble(): void {
    const luna = this.state.agents.get(LUNA_AGENT_ID)
    if (luna) {
      const key = JSON.stringify(luna.look)
      if (key !== this.lunaLookKey) {
        this.office.luna.setLook(luna.look)
        this.lunaLookKey = key
      }
    }
    if (!this.lunaTag) return
    if (this.state.reviewDue) this.lunaTag.setBubble('! Revisão do dia', 'wait')
    else this.lunaTag.setBubble(null, 'wait')
  }

  /** Orchestrators of a floor by squad room. */
  protected orchestratorsOn(floor: number): Map<number, AgentSummary> {
    const out = new Map<number, AgentSummary>()
    for (const a of this.state.agents.values()) {
      if (a.role !== 'orchestrator' || this.homeFloor(a) !== floor) continue
      const room = this.upperOf(floor)?.scene.plan.rooms.findIndex((r) => r.squad === a.squad) ?? -1
      if (room >= 0) out.set(room, a)
    }
    return out
  }

  protected screenFor(a: AgentSummary) {
    return this.deskOf(a) ? this.floorOf(this.homeFloor(a)).deskScreens[a.desk] : undefined
  }

  protected deskOf(a: AgentSummary): L.DeskSlot | undefined {
    return this.deskOn(this.homeFloor(a), a)
  }

  /** The desk of an agent on a given floor: the one it works at now, not the one it is heading to. */
  protected deskOn(floor: number, a: AgentSummary): L.DeskSlot | undefined {
    if (a.role === 'orchestrator') return undefined
    const up = this.upperOf(floor)
    return up ? up.scene.plan.agentDesks[a.desk] : this.home.desks[a.desk]
  }

  /** The spots of the Casa on screen (2D or 3D): the user's chair, Luna's table, the elevator... */
  protected get home(): HomePlan {
    return this.visual === '2d' ? this.casaPlan2d : HOME_PLAN_3D
  }

  /** Tiles of a floor (x, z). */
  protected floorSize(n: number): [number, number] {
    return this.upperOf(n)?.scene.plan.size ?? this.home.size
  }

  /** Floor an agent works on: its project's floor, or the ground floor. */
  protected homeFloor(a: AgentSummary): number {
    return a.project ? this.uppers.findIndex((u) => u.project.id === a.project) + 1 : 0
  }

  /** The 2D renderer while it draws the floor on screen (Visual 2D: the Casa and the project floors); null for the 3D world. */
  protected get flat(): Renderer2d | null {
    return this.visual === '2d' ? this.flat2d : null
  }

  protected upperOf(n: number): Upper | undefined {
    return n > 0 ? this.uppers[n - 1] : undefined
  }

  /** The desk of the coordinator of the agent's squad, in its squad room. */
  protected coordinatorDesk(a: AgentSummary): L.CoordinatorDesk | undefined {
    return this.coordinatorDeskOn(this.homeFloor(a), a)
  }

  /** The coordinator's desk of the agent's squad on a given floor. */
  protected coordinatorDeskOn(floor: number, a: AgentSummary): L.CoordinatorDesk | undefined {
    if (a.role !== 'orchestrator') return undefined
    return this.upperOf(floor)?.scene.plan.rooms.find((r) => r.squad === a.squad)?.coordinator
  }

  floorOf(n: number): Office {
    return this.upperOf(n)?.scene ?? (this.visual === '2d' ? this.casa2d : this.office)
  }

  /** The elevator of a floor: the tile its door opens on and where it drops people. */
  protected elevatorOf(floor: number): { tile: [number, number]; point: { x: number; z: number } } {
    return this.upperOf(floor)?.scene.plan.elevator ?? (floor > 0 ? L.elevatorOf(floor) : this.home.elevator)
  }

  /** Where an agent stands when every desk of its floor is taken. */
  protected overflowTile(a: AgentSummary, floor: number): [number, number] {
    const plan = this.upperOf(floor)?.scene.plan
    if (!plan) {
      const tiles = floor === 0 ? this.home.overflow : OVERFLOW_TILES
      return tiles[a.desk % tiles.length]
    }
    if (a.role === 'orchestrator') return plan.overflow[a.desk % plan.overflow.length]
    return plan.agentStand[(a.desk - plan.agentDesks.length) % plan.agentStand.length] ?? L.SPAWN_TILE
  }

  protected playerInBossRoom(): boolean {
    return this.player.floor === 0 && this.home.inBossRoom(this.player.position.x, this.player.position.z)
  }

  protected route(av: Avatar, tile: [number, number], final: { x: number; z: number } | null, onArrive: () => void): void {
    const [sx, sz] = tileOf(av.position)
    const path = this.floorOf(av.floor).grid.findPath(sx, sz, tile[0], tile[1])
    const points = (path ?? []).map(center)
    if (!path) points.push(center(tile)) // unreachable: walk straight there rather than freeze
    if (final) points.push(final)
    av.walk(points, onArrive)
  }

  /** Player is sitting in the boss chair; visitors line up in front of the desk. */
  protected playerSeated(): boolean {
    const p = this.player.position
    const seat = this.home.boss
    return this.player.floor === 0 && this.player.pose === 'sit' && Math.hypot(p.x - seat.x, p.z - seat.z) < 0.3
  }

  protected sitPlayer(): void {
    const seat = this.home.boss
    this.player.placeAt(seat.x, seat.z)
    this.player.face(seat.face)
    this.player.pose = 'sit'
  }

  /** Draw at full rate for the next `ms` (AO-29): input, a state change, a ding. */
  wake(ms = 400): void {
    this.wakeUntil = Math.max(this.wakeUntil, performance.now() + ms)
  }

  /** The elevator rings on a floor; its doors animate, so the scene wakes up. */
  protected ding(floor: number): void {
    this.floorOf(floor).ding()
    if (floor === this.player.floor) this.wake(1500)
  }

  protected alarmTagFor(alarm: { anchor: THREE.Object3D }): Tag {
    const tag = this.overlays.add(new Tag(alarm.anchor, ''))
    tag.el.classList.add('tag-alarm')
    tag.setDot('error')
    tag.hidden = true
    return tag
  }

  protected moneyTagFor(board: { anchor: THREE.Object3D }): Tag {
    const tag = this.overlays.add(new Tag(board.anchor, ''))
    tag.el.classList.add('tag-money')
    tag.setDot('money')
    tag.hidden = true
    return tag
  }

  // ---------- implemented by the later parts ----------
  protected abstract syncHelpers(): void
  protected abstract syncMembers(): void
  /** The red marks of the failed helpers follow their owner when the floors change. */
  protected abstract reflowFailureMarks(): void
  protected abstract syncBoards(): void
  protected abstract reconcile(actor: Actor, instant?: boolean): void
  protected abstract resting(a: AgentSummary): boolean
  protected abstract uniformFor(a: AgentSummary): Uniform | null
  protected abstract dress(avatar: Avatar, a: AgentSummary): void
  protected abstract goBoss(actor: Actor, instant: boolean): void
  protected abstract goMeeting(actor: Actor, instant: boolean): void
  protected abstract goHang(actor: Actor, instant: boolean): void
  protected abstract bubble(actor: Actor, a: AgentSummary): void
  protected abstract memberGone(m: Member): void
  abstract focusAgent(agentId: string): void
}
