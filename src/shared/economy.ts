import type { AgentSummary, ContextUsage } from './types'
import { priceOf, type ModelPrice } from './pricing'

/**
 * Token economy: what keeping a long conversation costs, and when to clear it.
 * Every call re-reads the whole conversation from the prompt cache; once the cache
 * expires, the next call writes all of it again at twice the input price.
 * (Ported from upstream 70ae59f, adapted to the fork's pricing table.)
 */

/** Claude Code writes the prompt cache for up to 1 hour; after this it is certainly cold. */
export const CACHE_COLD_MS = 60 * 60_000
/** Below this, waking a cold agent costs cents: not worth asking. */
export const COLD_MIN_TOKENS = 50_000
/** Configurações default: a conversation this big is worth a warning on any model, even a 1M window. */
export const DEFAULT_CONTEXT_WARN_TOKENS = 200_000

/** Unknown models are priced as Opus 5.5, the office's usual model. */
const FALLBACK: ModelPrice = priceOf('claude-opus-5-5')!

function price(model?: string): ModelPrice {
  return (model && priceOf(model)) || FALLBACK
}

/** USD to re-read `tokens` of cached conversation once: what every call of a warm agent pays. */
export function readCost(model: string | undefined, tokens: number): number {
  return (tokens * price(model).cacheRead) / 1_000_000
}

/** USD to write `tokens` back into the 1-hour cache: what the first call of a cold agent pays. */
export function wakeCost(model: string | undefined, tokens: number): number {
  return (tokens * price(model).input * 2) / 1_000_000
}

const BUSY = new Set(['working', 'starting', 'waiting'])

export function isCold(a: Pick<AgentSummary, 'lastTurnAt'>, now = Date.now()): boolean {
  return a.lastTurnAt !== undefined && now - a.lastTurnAt >= CACHE_COLD_MS
}

/**
 * The best move for an office agent's memory right now, or null when it is fine.
 * cold: idle past the cache, so the next message rewrites the whole conversation.
 * big: every call re-reads more than `warnTokens` (0 = no such warning).
 */
export type Advice = { kind: 'cold'; tokens: number; usd: number; idleMs: number } | { kind: 'big'; tokens: number; usd: number }

export function adviseAgent(a: AgentSummary, warnTokens: number, now = Date.now()): Advice | null {
  if (a.source !== 'office' || a.engine === 'opencode' || a.departed || !a.context || BUSY.has(a.status)) return null
  const used = a.context.used
  if (used >= COLD_MIN_TOKENS && isCold(a, now))
    return { kind: 'cold', tokens: used, usd: wakeCost(a.model, used), idleMs: now - a.lastTurnAt! }
  if (warnTokens > 0 && used >= warnTokens) return { kind: 'big', tokens: used, usd: readCost(a.model, used) }
  return null
}

/** The memory gauge: by percent of the window, and by size, so a 1M window still warns at 300k. */
export function memoryLevel(c: ContextUsage, warnTokens: number): 'ok' | 'warn' | 'full' {
  if (c.percent >= 85) return 'full'
  if (c.percent >= 60 || (warnTokens > 0 && c.used >= warnTokens)) return 'warn'
  return 'ok'
}

/** Where a model's spend went, in USD. Cache writes are what is left once the rest is priced. */
export interface SpendSplit {
  read: number
  write: number
  output: number
  input: number
}

export function spendSplit(
  model: string,
  m: { costUsd: number; inputTokens: number; outputTokens: number; cacheReadTokens: number },
): SpendSplit {
  const p = priceOf(model)
  if (!p) return { read: 0, write: 0, output: 0, input: m.costUsd }
  const read = (m.cacheReadTokens * p.cacheRead) / 1_000_000
  const output = (m.outputTokens * p.output) / 1_000_000
  const input = (m.inputTokens * p.input) / 1_000_000
  return { read, output, input, write: Math.max(0, m.costUsd - read - output - input) }
}

/**
 * The daily cap of the whole office: true once `spentToday` reached it (a cent of slack,
 * since the SDK stops just past its budget). 0 or less = no cap.
 */
export function dailyCapHit(dailyBudgetUsd: number, spentToday: number): boolean {
  return dailyBudgetUsd > 0 && spentToday >= dailyBudgetUsd - 0.01
}

/**
 * What one query may still spend: what is left of the tighter of the two caps (per agent and
 * per day), never below a cent so the SDK accepts it; undefined when neither cap is set.
 */
export function queryBudget(
  caps: { agentBudgetUsd: number; dailyBudgetUsd: number },
  agentSpent: number,
  spentToday: number,
): number | undefined {
  const left = Math.min(
    caps.agentBudgetUsd > 0 ? caps.agentBudgetUsd - agentSpent : Infinity,
    caps.dailyBudgetUsd > 0 ? caps.dailyBudgetUsd - spentToday : Infinity,
  )
  return left < Infinity ? Math.max(0.01, left) : undefined
}
