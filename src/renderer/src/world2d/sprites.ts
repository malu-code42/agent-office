// Which sprite of the pixel-art sheet stands for whom. Pure, so the tests check it.

import type { Look } from '@shared/types'

/** The pixel speech bubbles of the art: working, a problem, a question, done. */
export type Bubble2d = 'dots' | 'bang' | 'ask' | 'ok'

/** Variants of the sheet (scripts/pixel-art/chars.py): 6 is Luna (headset), 7 is Emi. */
export const LUNA_VARIANT = 6
export const EMI_VARIANT = 7

/**
 * The sprite of each hair style of the 3D avatar (world/avatar.ts buildHair, by
 * hairStyle % 6): short, spiky, long, bun, pigtails, curly. The colours come from the Look.
 */
const BY_HAIR = [0, 4, 1, 3, 7, 5]

/** The variant of the sheet with the hair style of a look (the colours are painted on it). */
export function variantOf(look: Look): number {
  const n = BY_HAIR.length
  return BY_HAIR[(((look.hairStyle | 0) % n) + n) % n]
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
