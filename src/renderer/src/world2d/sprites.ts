// Which sprite of the pixel-art sheet stands for whom. Pure, so the tests check it.

import type { Look } from '@shared/types'

/** The pixel speech bubbles of the art: working, a problem, a question, done. */
export type Bubble2d = 'dots' | 'bang' | 'ask' | 'ok'

/** Variants of the sheet anyone can wear; 6 is Luna, 7 is Emi (scripts/pixel-art/chars.py). */
export const AGENT_VARIANTS = 6
export const EMI_VARIANT = 7

/** The same look always gets the same variant: hair style first, then the colours. */
export function variantOf(look: Look): number {
  let h = look.hairStyle | 0
  for (const ch of `${look.hair}|${look.shirt}|${look.skin}`) h = (h * 31 + ch.charCodeAt(0)) | 0
  return ((h % AGENT_VARIANTS) + AGENT_VARIANTS) % AGENT_VARIANTS
}

/** The pixel bubble over an agent: a question or permission, a result, work, an error. */
export function agentBubble(status: string, waitingOnYou: boolean, result: 'ok' | 'error' | null): Bubble2d | null {
  if (waitingOnYou) return 'ask'
  if (result) return result === 'error' ? 'bang' : 'ok'
  if (status === 'working' || status === 'starting') return 'dots'
  if (status === 'error') return 'bang'
  if (status === 'waiting') return 'ask'
  return null
}
