import * as THREE from 'three'
import { heldRooms, type ProjectFloor, type SquadInfo, type SquadProposal } from '@shared/types'
import { brandOf, releaseLogos } from '../world/brand'
import { disposeTree } from '../world/dispose'
import * as L from '../world/layout'
import { buildUpperFloor } from '../world/upper-floor'
import { PROJECT_LAYOUT } from '../world2d/atlas'
import { buildFloor2d } from '../world2d/floor'
import { projectPlan2d } from '../world2d/layout'
import type { Visual } from '@shared/video'
import { Tag } from '../world/overlays'
import { GameBase } from './base'
import { floorsKey, issuesToken } from './floor-key'
import { RIDE_S, type Actor } from './types'

/** Elevator and floors: rides between floors, the project floors and which one is drawn. */
export abstract class GameFloors extends GameBase {
  /** Projects whose mismatch was already announced, so the toast comes once. */
  private announced = new Set<string>()

  /**
   * Takes an avatar to another floor: it walks to the elevator of the floor it is on,
   * rides, and steps out of the elevator of the floor it is going to. `then` runs on
   * arrival if the goal is still the same.
   */
  protected travel(actor: Actor, floor: number, instant: boolean, then: () => void): void {
    const av = actor.avatar
    if (av.floor === floor) return then()
    if (instant) {
      av.floor = floor
      const spawn = this.elevatorOf(floor).point
      av.placeAt(spawn.x, spawn.z)
      return then()
    }
    const trip = actor.trip
    // The walk to the elevator happens on the floor the agent is on now; the ride
    // ends at the elevator of the floor it is going to.
    const from = av.floor
    const ride = { from: this.elevatorOf(from).tile, at: this.elevatorOf(from).point, to: this.elevatorOf(floor).point }
    this.route(av, ride.from, ride.at, () => {
      if (actor.trip !== trip || actor.goal === 'leave') return
      this.ding(from)
      actor.riding = true
      setTimeout(
        () => {
          av.floor = floor
          av.placeAt(ride.to.x, ride.to.z)
          av.face(0)
          this.ding(floor)
          actor.riding = false
          if (!this.actors.has(actor.id) || actor.goal === 'leave') return
          if (actor.trip === trip) then()
          else {
            actor.goal = null
            this.reconcile(actor)
          }
        },
        RIDE_S * 1000 + 600,
      )
    })
  }

  // ---------- floors ----------

  /** Builds the project floors again when the floors or their squads change. */
  setProjects(projects: ProjectFloor[], squads: SquadInfo[], proposals: SquadProposal[] = [], notify = true): void {
    const squadsOf = (p: ProjectFloor) => squads.filter((q) => q.cwd === p.cwd)
    // A room with a proposal waiting keeps it: it is not free for a squad. A proposal
    // whose composition is being redone holds the room too (the amber outline stays).
    const proposedOf = (p: ProjectFloor) => heldRooms(p.id, proposals)
    const flat = this.visual === '2d'
    const plans = projects.map((p) =>
      flat ? projectPlan2d(PROJECT_LAYOUT, squadsOf(p), proposedOf(p)) : L.projectPlan(squadsOf(p), proposedOf(p)),
    )
    const key = `${this.visual}:${floorsKey(projects, squads, plans, this.state.squadQueues)}`
    if (key === this.uppersKey) return
    this.uppersKey = key
    const playerOn = this.upperOf(this.player.floor)?.project.id

    for (const m of this.members.values()) this.memberGone(m)
    this.uppers.forEach((u, i) => {
      // the whole floor leaves the GPU: walls, furniture, screens, signs and their textures
      disposeTree(u.scene.group)
      this.engine.scene.remove(u.scene.group)
      this.overlays.clearLabels(i + 1)
      if (u.issueTag) this.overlays.remove(u.issueTag)
      this.overlays.remove(u.alarmTag)
      this.overlays.remove(u.moneyTag)
      if (u.proposalTag) this.overlays.remove(u.proposalTag)
      for (const t of u.stepTags) this.overlays.remove(t)
    })
    this.uppers = projects.map((project, i) => {
      const n = i + 1
      const plan = plans[i]
      // a 2D floor draws its own plates (and answers their clicks); the 3D one has HTML labels
      const scene = flat ? buildFloor2d(plan) : buildUpperFloor(plan, brandOf(project))
      scene.reducedMotion = this.reducedEffects
      this.engine.scene.add(scene.group)
      if (!flat) {
        this.overlays.label('Diretoria', 12.8, 20, n)
        this.overlays.label('Sala de reunião', L.MEETING_TABLE_AT.x, L.MEETING_TABLE_AT.z, n, () =>
          this.hooks.onMeetingRoomClick?.(project),
        )
        this.overlays.label('Descanso e lazer', 15.5, 7.6, n)
        this.overlays.label('Agentes individuais', (L.AGENT_ROOM_RECT[0] + L.AGENT_ROOM_RECT[2]) / 2, 22.9, n)
        for (const r of plan.rooms)
          this.overlays.label(this.roomPlate(r), (r.rect[0] + r.rect[2]) / 2, r.rect[1] + 0.6, n, () =>
            this.hooks.onRoomClick?.(project, r),
          )
      }
      // one "Passo 3/6 · Texto" line over the coordinator's desk of each squad room
      const stepTags = plan.rooms.map((room) => {
        const anchor = new THREE.Object3D()
        anchor.position.set(room.coordinator.at.x, 1.9, room.coordinator.at.z)
        scene.group.add(anchor)
        const tag = this.overlays.add(new Tag(anchor, ''))
        tag.el.classList.add('tag-step')
        return tag
      })
      // What does not fit on this floor (more squads than rooms): the user has to know.
      let issueTag: Tag | null = null
      if (plan.issues.length) {
        const anchor = new THREE.Object3D()
        anchor.position.set(5, 2.7, 4)
        scene.group.add(anchor)
        issueTag = this.overlays.add(new Tag(anchor, '', false))
        issueTag.el.classList.add('tag-issue')
        issueTag.setDot('error')
      }
      // A team waiting for the approval: an amber point by the elevator, and the room
      // itself shows the outline.
      let proposalTag: Tag | null = null
      const waiting = plan.rooms.find((r) => r.state === 'proposed')
      if (waiting) {
        const anchor = new THREE.Object3D()
        anchor.position.set(plan.elevator.point.x, 2.5, 0.5)
        scene.group.add(anchor)
        proposalTag = this.overlays.add(new Tag(anchor, 'Equipe proposta', false, () => this.hooks.onRoomClick?.(project, waiting)))
        proposalTag.setDot('waiting')
      }
      return {
        project,
        scene,
        stepTags,
        issueTag,
        proposalTag,
        alarmTag: this.alarmTagFor(scene.alarm),
        moneyTag: this.moneyTagFor(scene.money),
      }
    })
    this.office.setFloors(projects.length + 1)
    for (const u of this.uppers) u.scene.setFloors(projects.length + 1)

    // The player stays with the same project, wherever its floor is now; a floor that is gone sends them down.
    // On the study floor (the top one) they stay there; in 3D there is none, so they go down too.
    const at = playerOn ? this.uppers.findIndex((u) => u.project.id === playerOn) + 1 : 0
    if (this.onStudy && flat) this.player.floor = this.studyFloor
    else if (this.player.floor > 0 && at === 0) this.goFloor(0)
    else this.player.floor = at
    // Everyone upstairs starts over on the new plans, on their project's floor (or downstairs if it is gone).
    for (const actor of this.actors.values()) {
      const a = this.state.agents.get(actor.id)
      if (!a || actor.goal === 'leave' || (actor.avatar.floor === 0 && (a.homeResident || this.homeFloor(a) === 0))) continue
      actor.goal = null
      actor.avatar.floor = this.homeFloor(a)
      this.reconcile(actor, true)
    }
    // Uniforms follow the floor settings, even for agents that did not move.
    for (const actor of this.actors.values()) {
      const a = this.state.agents.get(actor.id)
      if (a) this.dress(actor.avatar, a)
    }
    for (const h of this.helpers.values()) {
      const a = this.state.agents.get(h.parentId)
      if (a) h.avatar.setUniform(this.uniformFor(a))
    }
    // everyone wears the current logos now: patches of replaced or removed ones go
    releaseLogos(new Set(projects.flatMap((p) => (p.logo ? [p.logo] : []))))
    // The helpers go with their owner: the new plan may have moved its desk, and
    // the floor of the owner may have been renumbered. Each helper goes back to
    // the floor of its owner, beside its desk, with its cord.
    this.syncHelpers()
    // The red marks of the failed helpers follow their owner too: the floor number
    // of a mark is the floor its owner is on now, not the one it had before.
    this.reflowFailureMarks()
    // The squad members take their place in the new plan: a desk, or a tile of their own.
    this.syncMembers()
    this.syncBoards()
    // The notice of the floor: what does not fit, and who has no place in the scene.
    this.refreshIssues()
    if (notify) this.hooks.onFloor(this.player.floor)
  }

  /**
   * The world in 2D or 3D (Configurações → Vídeo): the project floors are built again in the
   * other one, and the Casa switches to the other plan.
   */
  setVisual(visual: Visual): void {
    if (visual === this.visual) return
    this.visual = visual
    this.hover2d = null
    this.casaHot = null
    this.studyHot = null
    this.setProjects(this.state.settings.projects, this.state.squads, this.state.squadProposals, false)
    this.placeCasa()
    // the other floor plan has other walls: the player steps out of the elevator again
    // (in the Casa, back to the chair)
    this.player.stop()
    if (this.player.floor > 0) {
      const door = this.elevatorOf(this.player.floor)
      this.player.pose = 'stand'
      this.player.placeAt(door.point.x, door.point.z + 0.6)
      this.engine.jumpTo(door.point.x, door.point.z)
    } else {
      this.sitPlayer()
      this.engine.jumpTo(this.player.position.x, this.player.position.z)
    }
    // everyone in the Casa takes their place in the other plan (setProjects left them there)
    for (const actor of this.actors.values()) {
      if (actor.avatar.floor !== 0 || actor.goal === 'leave' || actor.down || actor.riding) continue
      actor.avatar.stop()
      actor.goal = null
      actor.chatUntil = 0
      this.reconcile(actor, true)
    }
    this.syncHelpers()
    this.wake(400)
  }

  /**
   * The plate of a room: the name of the squad and the ticket it works on (or
   * "Disponível"), what the room is waiting for, or the name of an empty room.
   */
  protected roomPlate(room: L.SquadRoom): string {
    if (room.state !== 'live') return L.roomLabel(room)
    const queue = this.state.squadQueues.find((q) => q.code === room.squad)
    const ticket = queue?.active ? this.state.tickets.get(queue.active) : undefined
    return `${room.name} · ${ticket ? ticket.key : 'Disponível'}`
  }

  /**
   * The notice of every floor: what does not fit there, and the members that have no
   * place in the scene. Their names are in the notice, so the data never looks lost.
   */
  protected refreshIssues(): void {
    for (const u of this.uppers) {
      const tag = u.issueTag
      if (!tag) continue
      const issues = u.scene.plan.issues.map((issue) => ({ ...issue, unplaced: this.unplacedMembers.get(issue.code) ?? [] }))
      const unplaced = issues.reduce((n, issue) => n + issue.unplaced.length, 0)
      tag.setName(
        issues.length === 1
          ? unplaced
            ? 'Squad sem sala · 1 sem lugar'
            : 'Squad sem sala'
          : `${issues.length} squads sem sala${unplaced ? ` · ${unplaced} sem lugar` : ''}`,
      )
      tag.el.title = issues
        .map((issue) => `${issue.name}: ${issue.reason}${issue.unplaced.length ? ` Sem lugar na cena: ${issue.unplaced.join(', ')}.` : ''}`)
        .join('\n')
      // The notice is announced once per what it says: the squad, its text and the
      // members with no place. A squad renamed announces itself again.
      const token = `${u.project.id}:${issuesToken(issues)}`
      if (!this.announced.has(token)) {
        this.announced.add(token)
        this.hooks.onIncompatible?.(u.project, issues)
      }
    }
  }

  /** The elevator's floors: the Casa, the project floors and, in 2D, the study floor on top. */
  get floors(): string[] {
    return ['Casa', ...this.uppers.map((u) => u.project.name), ...(this.studyFloor > 0 ? ['Estudos'] : [])]
  }

  get currentFloor(): number {
    return this.player.floor
  }

  /** The project of the floor the player is on; null on the ground floor. */
  get currentProject(): ProjectFloor | null {
    return this.upperOf(this.player.floor)?.project ?? null
  }

  /** The player takes the elevator: out on the other floor, with the camera. */
  goFloor(n: number): void {
    if (n === this.player.floor || n < 0 || n > Math.max(this.uppers.length, this.studyFloor)) return
    const p = this.player
    this.onStudy = n === this.studyFloor
    p.stop()
    p.pose = 'stand'
    p.seatY = 0
    this.ding(p.floor)
    p.floor = n
    const door = this.elevatorOf(n)
    p.placeAt(door.point.x, door.point.z)
    p.face(0)
    this.ding(n)
    this.engine.jumpTo(p.position.x, p.position.z)
    this.follow = true
    this.route(p, [door.tile[0], door.tile[1] + 1], null, () => undefined)
    this.hooks.onFloor(n)
  }

  /** Only the floor the player is on is drawn. */
  protected showFloor(): void {
    const view = this.player.floor
    this.office.group.visible = view === 0
    this.overlays.floor = view
    for (const tag of this.homeSceneTags) tag.hidden = view !== 0
    for (const a of this.actors.values()) {
      const here = a.avatar.floor === view
      a.avatar.root.visible = here
      a.tag.hidden = !here
    }
    for (const h of this.helpers.values()) {
      h.avatar.root.visible = h.avatar.floor === view
      h.cord.visible = h.avatar.floor === view && !h.gone
      h.tag.hidden = h.avatar.floor !== view
    }
    for (const m of this.members.values()) {
      m.avatar.root.visible = m.avatar.floor === view
      m.tag.hidden = m.avatar.floor !== view
    }
    for (const mark of this.failures.values()) {
      mark.pad.visible = mark.floor === view
      mark.tag.hidden = mark.floor !== view
    }
    this.uppers.forEach((u, i) => {
      const here = view === i + 1
      u.scene.group.visible = here
      if (u.issueTag) u.issueTag.hidden = !here
      if (u.proposalTag) u.proposalTag.hidden = !here
      const seated = here ? this.orchestratorsOn(i + 1) : null
      u.stepTags.forEach((t, room) => (t.hidden = !seated?.has(room)))
    })
    this.study.show(view === this.studyFloor)
    this.skull.tag.hidden = view !== 0
    this.totem.tag.hidden = view !== 0
    this.pcTag.hidden = view !== 0
    this.alarmTag.hidden = view !== 0 || !this.office.alarm.on
    this.moneyTag.hidden = view !== 0
    this.uppers.forEach((u, i) => {
      u.alarmTag.hidden = view !== i + 1 || !u.scene.alarm.on
      u.moneyTag.hidden = view !== i + 1
    })
  }
}
