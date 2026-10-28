import type { AgentSummary } from '@shared/types'
import { Avatar, type Uniform } from '../world/avatar'
import { DEFAULT_BRAND } from '../world/brand'
import * as L from '../world/layout'
import { Tag } from '../world/overlays'
import { HOME_SPAWN_POINT, HOME_SPAWN_TILE } from '../world/home-layout'
import { GameBoards } from './boards'
import { homeRoamTarget } from './home-roaming'
import { LOUNGE_AFTER_MS, screenMode, seatKey, spawnPoint, spawnTile, SQUAD_SPEED, type Actor, type Goal } from './types'

/** The agents: arriving, choosing where to be (desk, boss, lounge), posing and leaving. */
export abstract class GameActors extends GameBoards {
  // ---------- agents ----------

  protected sync(): void {
    for (const a of this.state.agents.values()) {
      if (a.builtIn) continue
      if (!this.actors.has(a.id)) this.addActor(a, true)
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
    const tag = this.overlays.add(new Tag(avatar.anchor, a.name, false, () => this.hooks.onAgentClick(a.id)))
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
      homeNextAt: 0,
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
    this.engine.scene.add(avatar.root)
    if (animate) {
      // The agent comes out of the elevator of its own floor.
      const spawn = spawnPoint(avatar.floor)
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
    this.route(actor.avatar, spawnTile(actor.avatar.floor), spawnPoint(actor.avatar.floor), () => {
      this.ding(actor.avatar.floor)
      this.vanish(actor, 500)
    })
  }

  /** Shrinks the avatar away and forgets the actor. */
  protected vanish(actor: Actor, delayMs: number): void {
    const shrink = (start: number) => {
      const k = 1 - (this.time - start) / 0.6
      if (k <= 0) {
        actor.avatar.dispose()
        this.engine.scene.remove(actor.avatar.root)
        this.overlays.remove(actor.tag)
        this.actors.delete(actor.id)
        return
      }
      actor.avatar.root.scale.setScalar(Math.min(1, k))
      requestAnimationFrame(() => shrink(start))
    }
    setTimeout(() => shrink(this.time), delayMs)
  }

  protected desired(actor: Actor, a: AgentSummary): Goal {
    if (a.homeResident) return 'home'
    if (a.role === 'orchestrator') {
      // The squad room is home: no lounge between cycles.
      const items = this.state.itemsFor(a.id)
      return items.permissions.length || items.results.length || a.status === 'waiting' ? 'boss' : 'desk'
    }
    if (this.resting(a)) {
      actor.restSince ??= Date.now()
      // The lounge is on the ground floor: project agents rest at their desks.
      return this.homeFloor(a) === 0 && Date.now() - actor.restSince >= LOUNGE_AFTER_MS ? 'hang' : 'desk'
    }
    actor.restSince = null
    const items = this.state.itemsFor(a.id)
    if (items.permissions.length || items.results.length || a.status === 'waiting') return 'boss'
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
      if (goal === 'desk') this.goDesk(actor, a, instant)
      else if (goal === 'boss') this.goBoss(actor, instant)
      else if (goal === 'home') this.goHomeResident(actor, instant)
      else this.goHang(actor, instant)
    } else if (actor.arrived) {
      this.pose(actor, a)
    }
    this.bubble(actor, a)
  }

  /** A resident's location is independent of their task floor and status. */
  protected goHomeResident(actor: Actor, instant: boolean): void {
    const arrive = () => {
      actor.avatar.placeAt(HOME_SPAWN_POINT.x, HOME_SPAWN_POINT.z)
      this.wanderHome(actor)
    }
    this.travel(actor, 0, instant || this.reducedEffects, () => {
      if (instant) arrive()
      else this.route(actor.avatar, HOME_SPAWN_TILE, HOME_SPAWN_POINT, arrive)
    })
  }

  protected wanderHome(actor: Actor): void {
    if (actor.goal !== 'home' || actor.avatar.floor !== 0) return
    const from: [number, number] = [Math.floor(actor.avatar.position.x), Math.floor(actor.avatar.position.z)]
    const occupied = [...this.actors.values()]
      .filter((other) => other.id !== actor.id && other.goal !== 'leave' && other.avatar.floor === 0)
      .map((other) => [Math.floor(other.avatar.position.x), Math.floor(other.avatar.position.z)] as [number, number])
    const target = homeRoamTarget(this.office.grid, from, occupied)
    if (!target) {
      actor.arrived = true
      actor.homeNextAt = this.time + 3
      return
    }
    if (this.reducedEffects) {
      actor.avatar.placeAt(target[0] + 0.5, target[1] + 0.5)
      actor.arrived = true
      actor.homeNextAt = Number.POSITIVE_INFINITY
      return
    }
    actor.arrived = false
    actor.avatar.setProp('none')
    this.route(actor.avatar, target, null, () => {
      if (actor.goal !== 'home') return
      actor.arrived = true
      actor.homeNextAt = this.time + 4 + Math.random() * 4
      const a = this.state.agents.get(actor.id)
      if (a) this.pose(actor, a)
    })
  }

  /** The uniform of the agent's company: its project floor, when that floor asks for one. */
  protected uniformFor(a: AgentSummary): Uniform | null {
    const p = this.upperOf(this.homeFloor(a))?.project
    return p?.uniform ? { color: p.brandColor ?? DEFAULT_BRAND, logo: p.logo } : null
  }

  /** Uniform on (or off), the account diamond over the head and the effort aura. */
  protected dress(avatar: Avatar, a: AgentSummary): void {
    avatar.setUniform(this.uniformFor(a))
    const acc = a.source === 'office' && a.account ? this.state.account(a.account) : undefined
    avatar.setGem(acc?.color ?? null)
    avatar.setAura(a.effort, a.status === 'working' || a.status === 'starting')
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
      av.seatY = 0
    } else if (actor.goal === 'desk') {
      const desk = this.deskOf(a)
      if (!desk) {
        av.pose = 'stand'
        av.face(Math.PI)
        return
      }
      av.face(desk.face ?? Math.PI)
      av.pose = a.status === 'working' ? 'type' : 'sit'
      av.seatY = 0
    } else if (actor.goal === 'boss') {
      const items = this.state.itemsFor(a.id)
      const result = items.results[0]
      av.setProp(items.permissions.length ? 'none' : result ? (result.isError ? 'redPaper' : 'paper') : 'none')
      if (av.floor === this.player.floor && (av.floor > 0 || this.playerInBossRoom()))
        av.faceTowards(this.player.position.x, this.player.position.z)
      else av.faceTowards(L.BOSS_SEAT.x, L.BOSS_SEAT.z)
      av.pose = this.time < actor.waveUntil ? 'wave' : actor.id === this.nearId ? 'talk' : 'stand'
    } else if (actor.goal === 'home') {
      av.setProp('none')
      av.pose = 'stand'
    } else if (actor.goal === 'hang' && actor.hang !== null) {
      const spot = L.LOUNGE_SEATS[actor.hang]
      av.faceTowards(spot.look[0], spot.look[1])
      av.pose = spot.kind === 'sit' ? 'relax' : spot.kind === 'play' ? 'play' : 'stand'
      av.setProp(spot.kind === 'stand' ? 'mug' : 'none')
    }
  }
}
