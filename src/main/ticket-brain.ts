import type { AgentBrain, EffortLevel } from '@shared/types'

/**
 * AO-86: o par modelo/esforço de um ciclo de ticket. O que Luna ou Emi julgaram ao abrir o
 * ticket vale; o que faltar vem do padrão das configurações. Nunca um modelo fixo no código.
 */
export function brainForTicket(
  ticket: { model?: string; effort?: EffortLevel },
  base: Pick<AgentBrain, 'model' | 'effort'>,
): { model: string | undefined; effort: EffortLevel | undefined } {
  return { model: ticket.model || base.model || undefined, effort: ticket.effort || base.effort || undefined }
}
