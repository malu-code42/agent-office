import type { AgentSummary } from '@shared/types'
import type { BubbleKind } from '../world2d/overlays'
import { GameLounge } from './lounge'
import type { Actor } from './types'

/** The speech bubble of an agent: what it is doing, or the permission or result waiting at its desk (AO-105). */
export abstract class GameDeliveries extends GameLounge {
  protected bubble(actor: Actor, a: AgentSummary): void {
    if (this.time < actor.shoutUntil) {
      actor.tag.setBubble(actor.shout, actor.shoutKind)
      return
    }
    const items = this.state.itemsFor(a.id)
    let text: string | null = null
    let kind: BubbleKind = 'work'
    if (a.builtIn === 'luna' && !items.permissions.length && !items.results.length) {
      // Her tag only speaks for the review of the day; what she is doing shows on the pixel bubble.
      actor.tag.setBubble(this.state.reviewDue ? '! Revisão do dia' : null, 'wait')
      return
    }
    if (items.permissions.length) {
      const p = items.permissions[0]
      text = p.kind === 'question' ? '? Tenho uma pergunta' : p.kind === 'plan' ? '! Tenho um plano' : '! Preciso da sua permissão'
      kind = 'wait'
    } else if (items.results.length) {
      text = items.results[0].isError ? '✗ Deu problema' : '✓ Terminei!'
      kind = items.results[0].isError ? 'error' : 'done'
    } else if (a.status === 'working' || a.status === 'starting') {
      text = a.activity
    } else if (a.status === 'waiting') {
      text = '! Esperando você'
      kind = 'wait'
    }
    actor.tag.setBubble(text, kind)
  }
}
