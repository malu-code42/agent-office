import { heldRooms, type ProjectFloor, type SquadInfo, type SquadProposal } from '@shared/types'
import * as L from '../world2d/plan'
import { PROJECT_LAYOUT } from '../world2d/atlas'
import { buildFloor2d } from '../world2d/floor'
import { projectPlan2d } from '../world2d/layout'
import { emiAgentId } from '@shared/emi'
import { Point3, Tag } from '../world2d/overlays'
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
    const plans = projects.map((p) => projectPlan2d(PROJECT_LAYOUT, squadsOf(p), heldRooms(p.id, proposals)))
    const key = floorsKey(projects, squads, plans, this.state.squadQueues)
    if (key === this.uppersKey) return
    this.uppersKey = key
    const playerOn = this.upperOf(this.player.floor)?.project.id

    for (const m of this.members.values()) this.memberGone(m)
    for (const u of this.uppers)
      for (const t of [u.issueTag, u.proposalTag, u.emiTag, ...u.stepTags]) if (t) this.overlays.remove(t)
    this.uppers = projects.map((project, i) => {
      const plan = plans[i]
      // the floor draws its own plates (and answers their clicks)
      const scene = buildFloor2d(plan)
      // one "Passo 3/6 · Texto" line over the coordinator's desk of each squad room
      const stepTags = plan.rooms.map((room) => {
        const tag = this.overlays.add(new Tag(new Point3(room.coordinator.at.x, 1.9, room.coordinator.at.z), ''))
        tag.el.classList.add('tag-step')
        return tag
      })
      // What does not fit on this floor (more squads than rooms): the user has to know.
      let issueTag: Tag | null = null
      if (plan.issues.length) {
        issueTag = this.overlays.add(new Tag(new Point3(5, 2.7, 4), '', false))
        issueTag.el.classList.add('tag-issue')
        issueTag.setDot('error')
      }
      // A team waiting for the approval: an amber point by the elevator, and the room
      // itself shows the outline.
      let proposalTag: Tag | null = null
      const waiting = plan.rooms.find((r) => r.state === 'proposed')
      if (waiting) {
        const anchor = new Point3(plan.elevator.point.x, 2.5, 0.5)
        proposalTag = this.overlays.add(new Tag(anchor, 'Equipe proposta', false, () => this.hooks.onRoomClick?.(project, waiting)))
        proposalTag.setDot('waiting')
      }
      // Emi sits at her desk: her name and status tag opens her conversation, like any agent's
      const seat = PROJECT_LAYOUT.emi.seat
      const emiTag = this.overlays.add(
        new Tag(new Point3(seat.at[0] / 16, 1.55, seat.at[1] / 16), 'Emi', false, () => this.hooks.onAgentClick(emiAgentId(project.id))),
      )
      return {
        project,
        scene,
        emiTag,
        stepTags,
        issueTag,
        proposalTag,
      }
    })

    // The player stays with the same project, wherever its floor is now; a floor that is gone sends them down.
    // On the study floor (the top one) they stay there.
    const at = playerOn ? this.uppers.findIndex((u) => u.project.id === playerOn) + 1 : 0
    if (this.onStudy) this.player.floor = this.studyFloor
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

  /** The elevator's floors: the Casa, the project floors and the study floor on top. */
  get floors(): string[] {
    return ['Casa', ...this.uppers.map((u) => u.project.name), 'Estudos']
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
    if (n === this.player.floor || n < 0 || n > this.studyFloor) return
    const p = this.player
    this.onStudy = n === this.studyFloor
    p.stop()
    p.pose = 'stand'
    this.ding(p.floor)
    p.floor = n
    const door = this.elevatorOf(n)
    p.placeAt(door.point.x, door.point.z)
    p.face(0)
    this.ding(n)
    this.jumpTo(p.position.x, p.position.z)
    this.follow = true
    this.route(p, [door.tile[0], door.tile[1] + 1], null, () => undefined)
    this.hooks.onFloor(n)
  }

  /** Only the floor the player is on is drawn, with its tags. */
  protected showFloor(): void {
    const view = this.player.floor
    for (const tag of this.homeSceneTags) tag.hidden = view !== 0
    for (const a of this.actors.values()) {
      const here = a.avatar.floor === view
      a.avatar.visible = here
      a.tag.hidden = !here
    }
    for (const h of this.helpers.values()) {
      h.avatar.visible = h.avatar.floor === view
      h.tag.hidden = h.avatar.floor !== view
    }
    for (const m of this.members.values()) {
      m.avatar.visible = m.avatar.floor === view
      m.tag.hidden = m.avatar.floor !== view
    }
    for (const mark of this.failures.values()) mark.tag.hidden = mark.floor !== view
    this.uppers.forEach((u, i) => {
      const here = view === i + 1
      if (u.issueTag) u.issueTag.hidden = !here
      if (u.proposalTag) u.proposalTag.hidden = !here
      if (u.emiTag) u.emiTag.hidden = !here || !this.state.agents.has(emiAgentId(u.project.id))
      const seated = here ? this.orchestratorsOn(i + 1) : null
      u.stepTags.forEach((t, room) => (t.hidden = !seated?.has(room)))
    })
    this.study.show(view === this.studyFloor)
    this.moneyTag.hidden = view !== 0
  }
}
