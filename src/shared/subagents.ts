// The cap of subagents at one desk (HANDOFF §3.4.1). The number lives here because
// the room and Claude Agent SDK have to
// agree on it: what the scene shows is what the agent is really allowed to run.

/** How many subagents may work for the same agent at the same desk. */
export const HELPER_MAX = 3

/**
 * The effective cap of one desk: the cap of the room, lowered by a smaller limit the
 * player configured. Zero means "no configured limit": the cap of the room applies.
 */
export function helperLimit(configured?: number): number {
  if (typeof configured !== 'number' || !Number.isFinite(configured) || configured <= 0) return HELPER_MAX
  return Math.max(1, Math.min(HELPER_MAX, Math.floor(configured)))
}

/**
 * Why a subagent call was refused, in pt-BR. The player reads the explanation in
 * the parent agent's conversation and the Claude Agent SDK receives it with the denial.
 */
export function helperLimitReason(limit: number, active: number): string {
  const plural = active === 1 ? 'subagente ativo' : 'subagentes ativos'
  return `Bloqueado pelo Agent Office: esta mesa já tem ${active} ${plural} (limite de ${limit}). Termine um antes de chamar outro.`
}
