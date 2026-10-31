import type { AgentSummary } from '@shared/types'
import type { TotemView } from '@shared/routines'
import type { State } from '../state'
import { Avatar, type Uniform } from '../world2d/avatar'
import type * as L from '../world2d/plan'
import type { HomeAction, HomePlan } from '../world2d/home-layout'
import { Overlays, Point3, Tag } from '../world2d/overlays'
import { Renderer2d } from '../world2d/renderer'
import { CASA_LAYOUT } from '../world2d/atlas'
import { casaPlan, type CasaAct, type CasaFlat } from '../world2d/casa'
import { buildCasa2d, type Floor2d } from '../world2d/floor'
import type { StudyAct } from '../world2d/estudos'
import { StudyFloor } from './study'
import { SeenFailures } from './failure-marks'
import { center, TAG_LIFT, tileOf, type Actor, type FailureMark, type GameHooks, type Helper, type Member, type Upper } from './types'

/** Something drawn in the air for a moment: the skull of a strike, its puff, the ghost. */
export interface Fx {
  key: string
  frame: 'skull' | 'ghost' | 'puff'
  floor: number
  x: number
  z: number
  /** Height (tiles). */
  y: number
  alpha: number
}

/** The Casa's tags by the name casa.json gives their spot, with what a click on them opens. */
const CASA_TAGS: [string, HomeAction][] = [
  ['Agenda', 'agenda'],
  ['Objetivos', 'goals'],
  ['Rotinas pessoais', 'personal-routines'],
  ['Claude FM', 'radio'],
  ['Livros', 'books'],
  ['Filmes', 'films'],
  ['Jogos', 'games'],
  ['Escrita', 'writing'],
]

/**
 * State shared by every part of the office (game/*.ts), the floor lookups and the
 * walking primitives. Each part extends the previous one; Game (index.ts) is the last.
 */
export abstract class GameBase {
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
  /** An account is at its limit (the Casa's alarm counts every account). */
  protected alarm = false
  /** Over the Casa's alarm. */
  protected alarmTag: Tag
  /** Over the Casa's spending board. */
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
  /** Where the camera looks (tiles); the renderer eases towards it. */
  readonly target = new Point3()
  /** Agent the camera tracks until it settles (sits or stops); `until` drops it if it never shows up. */
  protected watch: { id: string; until: number } | null = null
  protected time = 0
  protected nearId: string | null = null
  protected recheck = 0
  protected dragging: { x: number; y: number; moved: boolean; button: number } | null = null
  protected wheelAcc = 0
  /** The skull strikes, puffs and ghosts playing now. */
  protected fx: Fx[] = []
  protected skullTag: Tag
  /** The agent-routine scheduler's board in the Casa: its tag, and what its little screen shows. */
  protected totem: { tag: Tag; view: TotemView | null }
  /** Luna's name tag in the house: shows the review-of-the-day bubble when due. */
  protected lunaTag: Tag
  /** Tags of the Casa: they show only there. */
  protected homeSceneTags: Tag[] = []
  /** Seconds until the totem's text is worked out again (at most once a second). */
  protected totemIn = 0
  /** Agents picked at the skull, waiting for the camera (or the elevator) before the strike. */
  protected doomed = new Map<string, { at: number; done: () => void }>()
  /** When the elevator doors of each floor last opened (game time). */
  protected doors = new Map<number, number>()
  /** performance.now() until which the scene draws at full rate even if nothing walks (input, events). */
  protected wakeUntil = 0
  protected reducedEffects = false
  /** The renderer of the floor on screen. */
  readonly flat2d: Renderer2d
  /** Tile under the pointer. */
  protected hover2d: { x: number; z: number; ok: boolean } | null = null
  /** The clickable thing of the Casa under the pointer (drawn brighter). */
  protected casaHot: CasaAct | null = null
  /** The clickable thing of the study floor under the pointer (drawn brighter). */
  protected studyHot: StudyAct | null = null
  /** The study floor (the top floor): Cora, Bonnie, the teachers and the classroom. */
  protected readonly study: StudyFloor
  /** The player is on the study floor (its number moves when project floors come and go). */
  protected onStudy = false
  /** The Casa (ground floor): its grid. */
  protected readonly casa2d: Floor2d<CasaFlat> = buildCasa2d(CASA_LAYOUT)
  /** The spots of the Casa: the user's chair, Luna's table, the elevator... */
  protected readonly home: HomePlan = casaPlan(CASA_LAYOUT, this.casa2d.grid)

  constructor(
    container: HTMLElement,
    overlayRoot: HTMLElement,
    protected state: State,
    protected hooks: GameHooks,
  ) {
    this.flat2d = new Renderer2d(container)
    // tags float a little higher than their anchors: the sprite's pixel bubble sits over the head
    this.overlays = new Overlays(overlayRoot, (v) => this.flat2d.project(v.x, v.y + TAG_LIFT, v.z))
    this.study = new StudyFloor(this.overlays, (act, teacher) => this.hooks.onStudy?.(act, teacher))

    this.player = new Avatar(state.settings.playerLook, 'player')
    this.player.speed = 3.6
    this.sitPlayer()
    this.playerTag = this.overlays.add(new Tag(this.player.anchor, state.settings.playerName, true))
    this.playerTag.setDot('you')
    this.jumpTo(this.player.position.x, this.player.position.z)

    this.skullTag = this.casaTag('Caveira', () => hooks.onSkull())
    this.skullTag.setDot('skull')
    const totemTag = this.casaTag('Rotinas de agentes', () => hooks.onRoutines())
    totemTag.el.classList.add('tag-totem')
    totemTag.setDot('routine-none')
    this.totem = { tag: totemTag, view: null }
    this.pcTag = this.casaTag('Novo agente', () => hooks.onComputer())
    this.pcTag.setDot('term')
    this.alarmTag = this.alarmTagFor(this.casaAnchor('Alarme'))
    this.moneyTag = this.moneyTagFor(this.casaAnchor('Gastos'))
    for (const [name, action] of CASA_TAGS) this.casaTag(name, () => hooks.onHomeAction(action)).el.title = `Abrir ${name}`
    // Luna sits at her chair: her tag as low as a sitter's
    const luna = CASA_LAYOUT.table.seats[0]
    this.lunaTag = this.overlays.add(new Tag(new Point3(luna.at[0] / 16, 0.35, luna.at[1] / 16), 'Luna', false, () => hooks.onLunaReview()))
    this.homeSceneTags.push(this.lunaTag)
    this.updateLunaReviewBubble()
    state.onChange(() => this.updateLunaReviewBubble())
  }

  /** The spot casa.json names for a tag (art units), lowered by TAG_LIFT (the projection lifts every tag). */
  private casaAnchor(name: string): Point3 {
    const at = CASA_LAYOUT.tags[name] ?? [0, 0, 0]
    return new Point3(at[0] / 16, at[2] / 16 - TAG_LIFT, at[1] / 16)
  }

  /** A small tag over a thing of the Casa, shown only there. */
  private casaTag(name: string, onClick: () => void): Tag {
    const tag = this.overlays.add(new Tag(this.casaAnchor(name), name, false, onClick))
    tag.el.classList.add('tag-mini')
    this.homeSceneTags.push(tag)
    return tag
  }

  private updateLunaReviewBubble(): void {
    this.lunaTag.setBubble(this.state.reviewDue ? '! Revisão do dia' : null, 'wait')
  }

  /** Points the camera at a spot at once. */
  protected jumpTo(x: number, z: number): void {
    this.target.set(x, 0, z)
    this.flat2d.snap()
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

  /** The desk of an agent on a given floor (the Casa has none): the one it works at now, not the one it is heading to. */
  protected deskOn(floor: number, a: AgentSummary): L.DeskSlot | undefined {
    if (a.role === 'orchestrator') return undefined
    return this.upperOf(floor)?.scene.plan.agentDesks[a.desk]
  }

  /** Tiles of a floor (x, z). */
  protected floorSize(n: number): [number, number] {
    if (n === this.studyFloor) return this.study.plan.size
    return this.upperOf(n)?.scene.plan.size ?? this.home.size
  }

  /** The number of the study floor: the one over the project floors. */
  get studyFloor(): number {
    return this.uppers.length + 1
  }

  /** Floor an agent works on: its project's floor, or the ground floor. */
  protected homeFloor(a: AgentSummary): number {
    return a.project ? this.uppers.findIndex((u) => u.project.id === a.project) + 1 : 0
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

  floorOf(n: number): Floor2d {
    if (n === this.studyFloor) return this.study.scene
    return this.upperOf(n)?.scene ?? this.casa2d
  }

  /** The elevator of a floor: the tile its door opens on and where it drops people. */
  protected elevatorOf(floor: number): { tile: [number, number]; point: { x: number; z: number } } {
    if (floor === this.studyFloor) return this.study.plan.elevator
    return this.upperOf(floor)?.scene.plan.elevator ?? this.home.elevator
  }

  /** Where an agent stands when every desk of its floor is taken. */
  protected overflowTile(a: AgentSummary, floor: number): [number, number] {
    const plan = this.upperOf(floor)?.scene.plan
    if (!plan) return this.home.overflow[a.desk % this.home.overflow.length]
    if (a.role === 'orchestrator') return plan.overflow[a.desk % plan.overflow.length]
    return plan.agentStand[(a.desk - plan.agentDesks.length) % plan.agentStand.length] ?? plan.elevator.tile
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

  /** The elevator rings on a floor: its doors open for a moment, so the scene wakes up. */
  protected ding(floor: number): void {
    this.doors.set(floor, this.time)
    if (floor === this.player.floor) this.wake(1800)
  }

  protected alarmTagFor(anchor: Point3): Tag {
    const tag = this.overlays.add(new Tag(anchor, ''))
    tag.el.classList.add('tag-alarm')
    tag.setDot('error')
    tag.hidden = true
    return tag
  }

  protected moneyTagFor(anchor: Point3): Tag {
    const tag = this.overlays.add(new Tag(anchor, ''))
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
