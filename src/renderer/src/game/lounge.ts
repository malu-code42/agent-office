import type { AgentSummary } from '@shared/types'
import { GameActors } from './actors'
import type { Actor } from './types'

/** The lounge: idle agents wander off to a free seat, game or mug spot. */
export abstract class GameLounge extends GameActors {
  /** Nothing to do and nothing to deliver. */
  protected resting(a: AgentSummary): boolean {
    const items = this.state.itemsFor(a.id)
    if (items.permissions.length || items.results.length) return false
    return a.status === 'done' || a.status === 'error' || a.status === 'idle'
  }

  protected goHang(actor: Actor, instant: boolean): void {
    const taken = new Set([...this.actors.values()].map((x) => x.hang))
    const spots = this.home.hang
    let idx = spots.findIndex((_, i) => !taken.has(i))
    if (idx < 0) idx = Math.floor(Math.random() * spots.length)
    actor.hang = idx
    const spot = spots[idx]
    const done = () => {
      actor.arrived = true
      const now = this.state.agents.get(actor.id)
      if (now) this.pose(actor, now)
    }
    if (instant) {
      actor.avatar.placeAt(spot.x, spot.z)
      done()
    } else this.route(actor.avatar, spot.approach, { x: spot.x, z: spot.z }, done)
  }
}
