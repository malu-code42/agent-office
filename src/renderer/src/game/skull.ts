import { sfx } from './sfx'
import { GameSquads } from './squads'
import { STRIKE_AFTER_S, type Actor } from './types'
import type { Fx } from './base'

/** Strike timing, in seconds: drop in, cackle in the air, dive; and the height it hovers at (tiles). */
const DROP_S = 0.8
const CACKLE_S = 0.45
const DIVE_S = 0.15
const HOVER_Y = 1.35

/** The skull by the boss office: dismissing an agent. */
export abstract class GameSkull extends GameSquads {
  // ---------- the skull ----------

  /**
   * Sends the camera to an agent (on any floor, waiting out an elevator ride) and
   * strikes it with the skull. `done` runs once the animation ends, or right away when
   * the agent is not in the office to strike; the caller ends the session then.
   * False when the agent is already on its way out.
   */
  dismiss(agentId: string, done: () => void): boolean {
    const actor = this.actors.get(agentId)
    if (!actor) {
      done()
      return true
    }
    if (actor.goal === 'leave' || actor.down || this.doomed.has(agentId)) return false
    this.focusAgent(agentId)
    this.doomed.set(agentId, { at: this.time + STRIKE_AFTER_S, done })
    return true
  }

  protected updateSkull(dt: number): void {
    this.updateFx(dt)
    for (const [id, d] of this.doomed) {
      const actor = this.actors.get(id)
      // left on its own before the strike: nothing to animate
      if (!actor || actor.goal === 'leave') {
        this.doomed.delete(id)
        d.done()
        continue
      }
      // in the elevator: the camera gets its time again once the doors open
      if (actor.riding) d.at = this.time + STRIKE_AFTER_S
      if (this.time < d.at) continue
      this.doomed.delete(id)
      // again, in case the player took the camera back meanwhile
      this.focusAgent(id)
      this.strike(actor, d.done)
    }
    for (const actor of this.actors.values()) {
      if (actor.shoutUntil && this.time >= actor.shoutUntil) {
        actor.shoutUntil = 0
        const a = this.state.agents.get(actor.id)
        if (a && !actor.down) this.bubble(actor, a)
      }
    }
  }

  /**
   * The skull drops over the agent, cackles and dives at it; a puff, the agent falls flat,
   * then a ghost rises out of it and `done` runs (as the old 3D strike did).
   */
  protected strike(actor: Actor, done: () => void): void {
    actor.down = true
    actor.spot = null
    actor.hang = null
    actor.chatUntil = 0
    const av = actor.avatar
    av.stop()
    av.pose = 'stand'
    av.setProp('none')
    actor.tag.setBubble('!?', 'error')
    setTimeout(() => av.hitReact(), 800)
    const skull: Fx = { key: `skull:${actor.id}`, frame: 'skull', floor: av.floor, x: av.x, z: av.z, y: HOVER_Y + 1.6, alpha: 1 }
    this.fx.push(skull)
    sfx.whoosh()
    setTimeout(() => sfx.cackle(), DROP_S * 1000)
    let t = 0
    this.fxSteps.set(skull, (dt) => {
      t += dt
      // follows the agent, wherever it is
      skull.floor = av.floor
      skull.x = av.x
      skull.z = av.z
      if (t < DROP_S) skull.y = HOVER_Y + 1.6 * (1 - t / DROP_S) ** 3
      else if (t < DROP_S + CACKLE_S) skull.y = HOVER_Y + (this.reducedEffects ? 0 : Math.sin(t * 34) * 0.06)
      else skull.y = HOVER_Y - 0.8 * Math.min(1, (t - DROP_S - CACKLE_S) / DIVE_S)
      if (t < DROP_S + CACKLE_S + DIVE_S) return true
      // the hit: a puff where the skull lands, the agent falls flat
      this.puff(av.floor, av.x, av.z)
      av.knockDown()
      actor.tag.setBubble('x_x', 'error')
      sfx.ko()
      setTimeout(() => this.ghost(av.floor, av.x, av.z), 600)
      setTimeout(done, 1700)
      return false
    })
  }

  /** What moves each fx: false once it is over (it leaves the list). */
  private fxSteps = new Map<Fx, (dt: number) => boolean>()

  private updateFx(dt: number): void {
    for (const [f, step] of this.fxSteps)
      if (!step(dt)) {
        this.fxSteps.delete(f)
        this.fx = this.fx.filter((o) => o !== f)
      }
  }

  /** A purple puff that swells, rises and fades. */
  private puff(floor: number, x: number, z: number): void {
    const f: Fx = { key: `puff:${this.time}`, frame: 'puff', floor, x, z, y: 0.55, alpha: 1 }
    this.fx.push(f)
    let life = 0.9
    this.fxSteps.set(f, (dt) => {
      life -= dt
      f.y += dt * 0.6
      f.alpha = Math.max(0, life / 0.9)
      return life > 0
    })
  }

  /** A little ghost that floats up out of an agent and fades. */
  private ghost(floor: number, x: number, z: number): void {
    const f: Fx = { key: `ghost:${this.time}:${x}`, frame: 'ghost', floor, x, z, y: 0.5, alpha: 0.85 }
    this.fx.push(f)
    let life = 1.8
    this.fxSteps.set(f, (dt) => {
      life -= dt
      f.y += dt * 0.9
      f.alpha = 0.85 * Math.max(0, life / 1.8)
      if (!this.reducedEffects) f.x = x + Math.sin(life * 6) * 0.08
      return life > 0
    })
  }

  /** A strike, a puff or a ghost still plays: the scene draws at full rate meanwhile. */
  protected get fxActive(): boolean {
    return this.fx.length > 0
  }

  /** A struck agent whose session did not close gets back up. */
  revive(agentId: string): void {
    const actor = this.actors.get(agentId)
    if (!actor || !actor.down) return
    actor.avatar.getUp()
    actor.down = false
    actor.goal = null
    actor.shout = 'Ufa! Escapei.'
    actor.shoutKind = 'error'
    actor.shoutUntil = this.time + 2.5
    this.reconcile(actor)
  }

  /** Ghost rises out of an agent whose session is being closed; removal follows from state. */
  ghostOut(agentId: string): void {
    const actor = this.actors.get(agentId)
    if (actor) this.ghost(actor.avatar.floor, actor.avatar.x, actor.avatar.z)
  }
}
