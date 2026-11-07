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

/**
 * AO-86: os padrões com que o ciclo de um ticket de squad inicia o orquestrador. Se já existe um
 * orquestrador deste ticket, o novo herda dele (modelo, esforço, contas); senão vale o par do ticket,
 * completado pelo padrão das configurações. O modo de permissão chega pronto e passa sem mudança.
 */
export function cycleDefaults<M>(
  prior: { model?: string; effort?: EffortLevel; accounts?: string[] } | undefined,
  ticket: { model?: string; effort?: EffortLevel },
  base: AgentBrain,
  permissionMode: M,
): AgentBrain & { permissionMode: M } {
  return prior
    ? { model: prior.model, effort: prior.effort, accounts: prior.accounts, permissionMode }
    : { ...base, ...brainForTicket(ticket, base), permissionMode }
}
