import type { AgentSummary } from '@shared/types'
import { DEFAULT_BRAND } from '@shared/brand'
import { Avatar, type Uniform } from '../world2d/avatar'
import { Tag } from '../world2d/overlays'
import { GameBoards } from './boards'
import { canContinueHomeArrival, freeHomeSeat, homeSpot } from './home-seats'
import { LOUNGE_AFTER_MS, screenMode, seatKey, SQUAD_SPEED, type Actor, type Goal } from './types'
import { resultDestination } from './result-destination'

/** The agents: arriving, choosing where to be (desk, boss, lounge), posing and leaving. */
export abstract class GameActors extends GameBoards {
  // ---------- agents ----------

  protected sync(): void {
    for (const a of this.state.agents.values()) {
      if (a.builtIn && a.builtIn !== 'luna') continue
      // Luna starts at her chair; she only walks when she has something for the player.
      if (!this.actors.has(a.id)) this.addActor(a, a.builtIn !== 'luna')
    }
    for (const actor of this.actors.values()) {
      if (!this.state.agents.has(actor.id) && actor.goal !== 'leave') this.leave(actor)
      else if (this.state.agents.has(actor.id)) this.reconcile(actor)
    }
    this.syncHelpers()
    this.syncMembers()
    // The red marks of the failed helpers follow their owner: an owner that left
    // takes its mark with it.
    this.reflowFailureMarks()
    this.syncBoards()
    this.playerTag.setName(this.state.settings.playerName)
    if (this.player.look !== this.state.settings.playerLook) this.player.setLook(this.state.settings.playerLook)
  }

  protected addActor(a: AgentSummary, animate: boolean): void {
    const avatar = new Avatar(a.look, a.id)
    const tag = this.overlays.add(new Tag(avatar.anchor, a.name, false, () => (a.builtIn === 'luna' ? this.hooks.onLunaReview() : this.hooks.onAgentClick(a.id))))
    const actor: Actor = {
      id: a.id,
      avatar,
      tag,
      goal: null,
      arrived: false,
      spot: null,
      hang: null,
      waveUntil: 0,
      down: false,
      shoutUntil: 0,
      shout: '',
      shoutKind: 'error',
      chatUntil: 0,
      restSince: null,
      homeSeat: null,
      trip: 0,
      riding: false,
      seat: seatKey(a),
    }
    // agents already idle when the office opens (restored sessions) start in the lounge
    if (!animate && this.resting(a)) actor.restSince = 0
    // project agents and orchestrators arrive on their project's floor
    avatar.floor = this.homeFloor(a)
    if (a.role === 'orchestrator') avatar.speed = SQUAD_SPEED
    this.actors.set(a.id, actor)
    if (animate) {
      // The agent comes out of the elevator of its own floor.
      const spawn = this.elevatorOf(avatar.floor).point
      avatar.placeAt(spawn.x, spawn.z)
      avatar.face(0)
      this.ding(avatar.floor)
    }
    this.reconcile(actor, !animate)
  }

  protected leave(actor: Actor): void {
    actor.goal = 'leave'
    actor.spot = null
    actor.hang = null
    if (actor.down) {
      actor.tag.setBubble(null)
      this.vanish(actor, 0)
      return
    }
    actor.tag.setBubble('Tchau!', 'idle')
    if (actor.riding) return this.vanish(actor, 0)
    // It leaves by the elevator of the floor it is on.
    const door = this.elevatorOf(actor.avatar.floor)
    this.route(actor.avatar, door.tile, door.point, () => {
      this.ding(actor.avatar.floor)
      this.vanish(actor, 500)
    })
  }

  /** Shrinks the avatar away (after `delayMs`) and forgets the actor; the update loop does it (see shrink). */
  protected vanish(actor: Actor, delayMs: number): void {
    this.vanishing.set(actor, this.time + delayMs / 1000)
  }

  /** The actors shrinking away, with when they started (game time). */
  private vanishing = new Map<Actor, number>()

  /** One step of the actors shrinking away: gone after 0.6 s. */
  protected shrink(): void {
    for (const [actor, start] of this.vanishing) {
      const k = 1 - (this.time - start) / 0.6
      actor.avatar.scale = Math.max(0, Math.min(1, k))
      if (k > 0) continue
      this.vanishing.delete(actor)
      this.overlays.remove(actor.tag)
      this.actors.delete(actor.id)
    }
  }

  protected desired(actor: Actor, a: AgentSummary): Goal {
    const items = this.state.itemsFor(a.id)
    // Luna comes to the player with a question, a permission or a result, and goes back to her chair after.
    if (a.builtIn === 'luna') return items.permissions.length || items.results.length ? 'boss' : 'seat'
    if (a.homeResident) return 'home'
    if (items.permissions.length || a.status === 'waiting') return 'boss'
    if (items.results.length) return resultDestination(a, !!this.upperOf(this.homeFloor(a))) === 'meeting' ? 'meeting' : 'boss'
    if (a.role === 'orchestrator') {
      // The squad room is home: no lounge between cycles.
      return 'desk'
    }
    if (this.resting(a)) {
      actor.restSince ??= Date.now()
      // The lounge is on the ground floor: project agents rest at their desks.
      return this.homeFloor(a) === 0 && Date.now() - actor.restSince >= LOUNGE_AFTER_MS ? 'hang' : 'desk'
    }
    actor.restSince = null
    return 'desk'
  }

  protected reconcile(actor: Actor, instant = false): void {
    const a = this.state.agents.get(actor.id)
    if (!a || actor.goal === 'leave' || actor.down || actor.riding) return
    // mid-conversation: keep talking; the update loop hands the agent back when it ends
    if (this.time < actor.chatUntil) return
    actor.tag.setName(a.name)
    actor.tag.setDot(a.status)
    // The chip counts the subagents working for it, not the squad members (they have their own desks).
    actor.tag.setHelpers((a.subagents ?? []).filter((s) => !s.member).length)
    if (actor.avatar.look !== a.look && JSON.stringify(actor.avatar.look) !== JSON.stringify(a.look)) actor.avatar.setLook(a.look)
    this.dress(actor.avatar, a)
    this.showAccount(actor, a)
    const items = this.state.itemsFor(a.id)
    // a permission or result for you turns the desk amber too
    this.screenFor(a)?.setMode(items.permissions.length || items.results.length ? 'waiting' : screenMode(a))

    // Moved to another floor or desk: head there even if the goal stays the same.
    if (seatKey(a) !== actor.seat) {
      actor.seat = seatKey(a)
      actor.goal = null
    }
    const goal = this.desired(actor, a)
    if (goal !== actor.goal) {
      actor.goal = goal
      actor.trip++
      actor.arrived = false
      actor.spot = null
      actor.hang = null
      actor.avatar.setProp('none')
      if (goal !== 'home') actor.homeSeat = null
      if (goal === 'desk') this.goDesk(actor, a, instant)
      else if (goal === 'boss') this.goBoss(actor, instant)
      else if (goal === 'meeting') this.goMeeting(actor, instant)
      else if (goal === 'home') this.goHomeResident(actor, instant)
      else if (goal === 'seat') this.goLunaSeat(actor, instant)
      else this.goHang(actor, instant)
    } else if (actor.arrived) {
      this.pose(actor, a)
    }
    this.bubble(actor, a)
  }

  /** A resident sits at Luna's table whatever its task floor and status, and stays there when done. */
  protected goHomeResident(actor: Actor, instant: boolean): void {
    actor.homeSeat ??= freeHomeSeat([...this.actors.values()].filter((o) => o !== actor && o.goal === 'home').map((o) => o.homeSeat))
    const stillHome = () => {
      if (canContinueHomeArrival(actor.goal, this.state.agents.get(actor.id)?.homeResident === true)) return true
      actor.goal = null
      this.reconcile(actor)
      return false
    }
    const arrive = () => {
      if (!stillHome()) return
      actor.arrived = true
      const a = this.state.agents.get(actor.id)
      if (a) this.pose(actor, a)
    }
    this.travel(actor, 0, instant || this.reducedEffects, () => {
      if (!stillHome()) return
      // no room left around the table: wait by the elevator
      const spot = homeSpot(this.floorOf(0).grid, actor.homeSeat!, this.home) ?? this.home.elevator
      if (instant) {
        actor.avatar.placeAt(spot.point.x, spot.point.z)
        arrive()
      } else this.route(actor.avatar, spot.tile, spot.point, arrive)
    })
  }

  /** Luna's own chair at her table, where she works and waits between visits to the player. */
  protected goLunaSeat(actor: Actor, instant: boolean): void {
    const chair = this.home.luna
    const arrive = () => {
      if (actor.goal !== 'seat') return
      actor.arrived = true
      const a = this.state.agents.get(actor.id)
      if (a) this.pose(actor, a)
    }
    this.travel(actor, 0, instant || this.reducedEffects, () => {
      if (actor.goal !== 'seat') return
      if (instant || this.reducedEffects) {
        actor.avatar.placeAt(chair.x, chair.z)
        arrive()
      } else this.route(actor.avatar, [Math.floor(chair.x), Math.floor(chair.z)], { x: chair.x, z: chair.z }, arrive)
    })
  }

  /** The uniform of the agent's company: its project floor, when that floor asks for one. */
  protected uniformFor(a: AgentSummary): Uniform | null {
    const p = this.upperOf(this.homeFloor(a))?.project
    return p?.uniform ? { color: p.brandColor ?? DEFAULT_BRAND } : null
  }

  /** Uniform on (or off). */
  protected dress(avatar: Avatar, a: AgentSummary): void {
    avatar.setUniform(this.uniformFor(a))
  }

  /** The account chip on the name tag, only while there is more than one account. */
  protected showAccount(actor: Actor, a: AgentSummary): void {
    const acc = this.state.settings.accounts.length > 1 && a.source === 'office' && a.account ? this.state.account(a.account) : undefined
    actor.tag.setAccount(acc?.name ?? null, acc?.color)
  }

  protected goDesk(actor: Actor, a: AgentSummary, instant: boolean): void {
    if (a.role === 'orchestrator') return this.goDirector(actor, a, instant)
    const floor = this.homeFloor(a)
    const desk = this.deskOf(a)
    const done = () => {
      actor.arrived = true
      const now = this.state.agents.get(actor.id)
      if (now) this.pose(actor, now)
    }
    this.travel(actor, floor, instant, () => {
      if (!desk) {
        const tile = this.overflowTile(a, floor)
        if (instant) {
          actor.avatar.placeAt(tile[0] + 0.5, tile[1] + 0.5)
          done()
        } else this.route(actor.avatar, tile, null, done)
        return
      }
      if (instant) {
        actor.avatar.placeAt(desk.seat.x, desk.seat.z)
        done()
      } else this.route(actor.avatar, desk.approach, desk.seat, done)
    })
  }

  /** The orchestrator's chair: the coordinator's desk of its squad room. */
  protected goDirector(actor: Actor, a: AgentSummary, instant: boolean): void {
    const desk = this.coordinatorDesk(a)
    const done = () => {
      actor.arrived = true
      const now = this.state.agents.get(actor.id)
      if (now) this.pose(actor, now)
    }
    const floor = this.homeFloor(a)
    if (!desk) {
      // the squad has no room on this floor: the orchestrator waits by the elevator
      const tile = this.overflowTile(a, floor)
      return this.travel(actor, floor, instant, () => {
        if (instant) {
          actor.avatar.placeAt(tile[0] + 0.5, tile[1] + 0.5)
          done()
        } else this.route(actor.avatar, tile, null, done)
      })
    }
    this.travel(actor, floor, instant, () => {
      if (instant) {
        actor.avatar.placeAt(desk.seat.x, desk.seat.z)
        done()
      } else this.route(actor.avatar, desk.approach, desk.seat, done)
    })
  }

  /** Applies the resting pose for the actor's current goal and status. */
  protected pose(actor: Actor, a: AgentSummary): void {
    const av = actor.avatar
    if (av.isWalking) return
    if (actor.goal === 'desk' && a.role === 'orchestrator') {
      const desk = this.coordinatorDesk(a)
      if (!desk) {
        av.pose = 'stand'
        av.face(Math.PI)
        return
      }
      av.face(desk.rot)
      av.pose = a.status === 'working' || a.status === 'starting' ? 'type' : 'sit'
    } else if (actor.goal === 'desk') {
      const desk = this.deskOf(a)
      if (!desk) {
        av.pose = 'stand'
        av.face(Math.PI)
        return
      }
      av.face(desk.face ?? Math.PI)
      av.pose = a.status === 'working' ? 'type' : 'sit'
    } else if (actor.goal === 'boss' || actor.goal === 'meeting') {
      const items = this.state.itemsFor(a.id)
      const result = items.results[0]
      av.setProp(items.permissions.length ? 'none' : result ? (result.isError ? 'redPaper' : 'paper') : 'none')
      const meeting = actor.goal === 'meeting' ? this.upperOf(av.floor)?.scene.plan.meeting : undefined
      const chair = meeting?.seats.find((s) => actor.spot && s.approach[0] === actor.spot[0] && s.approach[1] === actor.spot[1])
      if (chair) {
        // a meeting chair: sit at the table, looking at it
        av.face(chair.face)
        av.pose = 'sit'
        return
      }
      if (meeting) av.faceTowards(meeting.table.x, meeting.table.z)
      else if (av.floor === this.player.floor && this.playerInBossRoom()) av.faceTowards(this.player.position.x, this.player.position.z)
      else av.faceTowards(this.home.boss.x, this.home.boss.z)
      av.pose = this.time < actor.waveUntil ? 'wave' : actor.id === this.nearId ? 'talk' : 'stand'
    } else if (actor.goal === 'seat') {
      av.setProp('none')
      av.face(this.home.luna.face)
      av.pose = a.status === 'working' || a.status === 'starting' ? 'type' : 'sit'
    } else if (actor.goal === 'home') {
      av.setProp('none')
      const spot = actor.homeSeat !== null ? homeSpot(this.floorOf(0).grid, actor.homeSeat, this.home) : null
      // a chair: look the way it faces (the 2D sprite sits by it); standing: at the table
      if (spot?.sit) av.face(this.home.chairs[actor.homeSeat!].face)
      else av.faceTowards(this.home.table.x, this.home.table.z)
      const seated = spot?.sit === true
      av.pose = !seated ? 'stand' : a.status === 'working' ? 'type' : 'sit'
    } else if (actor.goal === 'hang' && actor.hang !== null && this.home.hang[actor.hang]) {
      const spot = this.home.hang[actor.hang]
      av.faceTowards(spot.look[0], spot.look[1])
      av.pose = spot.kind === 'sit' ? 'relax' : spot.kind === 'play' ? 'play' : 'stand'
      av.setProp(spot.kind === 'stand' ? 'mug' : 'none')
    }
  }
}
