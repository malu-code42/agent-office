// Emi's own tools: the plan and the squads of her floor, through the same stores and writers
// the "Fluxo do projeto" and "Criar squad" windows use. Reads run straight away; approving the
// plan and creating a squad go through the office's permission card, which shows the exact input.

import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { SQUAD_NAME_MAX, SQUAD_ROOM_COUNT, type SquadInfo } from '@shared/types'
import { squadMemberSchema } from './validate'

export const EMI_SERVER = 'emi'
/** Tools the user confirms on the permission card before they run: they approve or write something. */
export const EMI_CONFIRM_TOOLS = new Set([`mcp__${EMI_SERVER}__plan_approve`, `mcp__${EMI_SERVER}__squad_create`])

const ticketKeys = z.array(z.string().min(1).max(40)).min(1).max(30)

export const emiPlanShape = {
  goal: z.string().trim().min(1).max(2000),
  grill: z.string().trim().min(1).max(20_000).describe('Summary of the grill: decisions, scope, constraints, open questions'),
  spec: z.string().trim().min(1).max(20_000).describe('The PRD/spec in Markdown'),
  criteria: z.array(z.string().trim().min(1).max(500)).min(1).max(15),
  tickets: ticketKeys.describe('Keys of open tickets of this floor, e.g. AO-12, in the order they should be worked'),
}
export type EmiPlan = { [K in keyof typeof emiPlanShape]: z.infer<(typeof emiPlanShape)[K]> }

export const emiSquadShape = {
  name: z.string().trim().min(1).max(SQUAD_NAME_MAX),
  brief: z.string().trim().min(1).max(4000).describe('What this squad is for, in pt-BR'),
  tickets: ticketKeys.describe('Keys of tickets of the approved plan this squad takes, in order'),
  members: z.array(squadMemberSchema).min(2).max(6),
  room: z.number().int().min(1).max(SQUAD_ROOM_COUNT).optional().describe('Squad room of the floor (1-based); default: the first free one'),
}
export type EmiSquad = { [K in keyof typeof emiSquadShape]: z.infer<(typeof emiSquadShape)[K]> }

export interface EmiToolDeps {
  /** Squads of the floor, as the office reads them. */
  squads(): SquadInfo[]
  /** The floor's plan (goal, grill, spec, tickets, assignments) as text. */
  plan(): string
  /** Records and approves the whole plan; returns a pt-BR summary. */
  approvePlan(plan: EmiPlan): string
  /** Proposes and approves the squad through the "Criar squad" path; returns the created squad. */
  createSquad(squad: EmiSquad): Promise<SquadInfo>
}

function squadLine(q: SquadInfo): string {
  const members = q.members.map((m) => `${m.name} (${m.title || m.role || 'membro'})`).join(', ')
  const state = q.availability === 'unavailable' ? ` · indisponível: ${q.unavailableReason ?? 'definição inválida'}` : ''
  return `- ${q.icon} ${q.name} (squads/${q.code})${members ? ` · ${members}` : ''}${state}`
}

export function emiTools(deps: EmiToolDeps): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: EMI_SERVER,
    version: '1.0.0',
    instructions:
      'Plano e squads deste andar. plan_get e squads_list leem o estado atual; plan_approve e squad_create ' +
      'mostram um cartão à usuária e só valem depois que ela aprovar.',
    tools: emiToolDefs(deps),
  })
}

/** The tool definitions, apart from the server so tests can call each handler. */
export function emiToolDefs(deps: EmiToolDeps) {
  const run = (fn: () => string | Promise<string>) => async () => {
    try {
      return { content: [{ type: 'text' as const, text: await fn() }] }
    } catch (err) {
      return { content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }], isError: true }
    }
  }
  return [
    tool(
      'squads_list',
      'Lista os squads deste andar (squads/<code>/squad.yaml), com membros e estado.',
      {},
      () =>
        run(() => {
          const squads = deps.squads()
          return squads.length ? squads.map(squadLine).join('\n') : 'Este andar ainda não tem squads.'
        })(),
      { annotations: { readOnlyHint: true } },
    ),
    tool(
      'plan_get',
      'Mostra o plano do andar: objetivo, grill, spec, critérios, tickets aprovados e atribuições.',
      {},
      () => run(deps.plan)(),
      {
        annotations: { readOnlyHint: true },
      },
    ),
    tool(
      'plan_approve',
      'Registra e aprova o plano do andar (grill, spec, critérios e tickets). A usuária confirma no cartão antes de valer; substitui o plano anterior.',
      emiPlanShape,
      (args) => run(() => deps.approvePlan(args))(),
    ),
    tool(
      'squad_create',
      'Cria um squad para tickets do plano aprovado, com a mesma validação do "Criar squad". A usuária confirma no cartão antes de valer.',
      emiSquadShape,
      (args) =>
        run(async () => {
          const squad = await deps.createSquad(args)
          return `Squad ${squad.icon} ${squad.name} criado em squads/${squad.code}, com os tickets atribuídos.`
        })(),
    ),
  ]
}
