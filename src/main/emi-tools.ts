// Emi's own tools: the plan and the squads of her floor, through the same stores and writers
// the "Fluxo do projeto" and "Criar squad" windows use. Reads run straight away; approving the
// plan and creating a squad go through the office's permission card, which shows the exact input.

import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { SQUAD_MAX_MEMBERS, SQUAD_MIN_MEMBERS, SQUAD_NAME_MAX, SQUAD_ROOM_COUNT, type SquadInfo } from '@shared/types'
import { squadMemberSchema } from './validate'

export const EMI_SERVER = 'emi'
/**
 * Tools the user confirms on the permission card before they run: they approve, write something,
 * or delete a squad or an agent (AO-60). Pause, resume, disable and hiring an agent run without a card.
 */
export const EMI_CONFIRM_TOOLS = new Set(
  ['plan_approve', 'squad_create', 'squad_run', 'squad_delete', 'agent_delete'].map((t) => `mcp__${EMI_SERVER}__${t}`),
)

const ticketKeys = z.array(z.string().min(1).max(40)).min(1).max(30)

export const emiPlanShape = {
  goal: z.string().trim().min(1).max(2000),
  bootstrap: z
    .enum(['done', 'skipped'])
    .optional()
    .describe('EGM bootstrap of this project (READMEs + docs/designs/SITEMAP.md): done, or skipped by the user'),
  brainstorm: z
    .string()
    .trim()
    .min(1)
    .max(20_000)
    .describe('Summary of the EGM brainstorm (concepts_brief.md): problem, decisions, scope, risks, open questions'),
  design: z.string().trim().min(1).max(20_000).describe('The design doc in Markdown (or its summary, with the implementation plan)'),
  designPath: z
    .string()
    .trim()
    .max(300)
    .optional()
    .describe('Relative path of the design doc in the project, under docs/designs/ (e.g. docs/designs/busca.md)'),
  criteria: z.array(z.string().trim().min(1).max(500)).min(1).max(15),
  review: z
    .string()
    .trim()
    .min(1)
    .max(20_000)
    .describe('Outcome of the Goldfish review: the findings the user chose to act on and how each was resolved'),
  tickets: ticketKeys.describe('Keys of open tickets of this floor, e.g. AO-12, in the order they should be worked'),
}
export type EmiPlan = { [K in keyof typeof emiPlanShape]: z.infer<(typeof emiPlanShape)[K]> }

export const emiSquadShape = {
  name: z.string().trim().min(1).max(SQUAD_NAME_MAX),
  brief: z.string().trim().min(1).max(4000).describe('What this squad is for, in pt-BR'),
  tickets: ticketKeys.describe('Keys of tickets of the approved plan this squad takes, in order'),
  members: z.array(squadMemberSchema).min(SQUAD_MIN_MEMBERS).max(SQUAD_MAX_MEMBERS),
  room: z.number().int().min(1).max(SQUAD_ROOM_COUNT).optional().describe('Squad room of the floor (1-based); default: the first free one'),
}
export type EmiSquad = { [K in keyof typeof emiSquadShape]: z.infer<(typeof emiSquadShape)[K]> }

export interface EmiToolDeps {
  /** Squads of the floor, as the office reads them. */
  squads(): SquadInfo[]
  /** The floor's plan (goal, EGM stages, design doc, tickets, assignments) as text. */
  plan(): string
  /** Records and approves the whole plan; returns a pt-BR summary. */
  approvePlan(plan: EmiPlan): string
  /** Records the latest drift report (design docs vs code); changes no stage. */
  saveDrift(summary: string): string
  /** Proposes and approves the squad through the "Criar squad" path; returns the created squad. */
  createSquad(squad: EmiSquad): Promise<SquadInfo>
  /** Starts a cycle of the squad through the app's squad-cycle path, in the floor's permission mode. */
  runSquad(code: string, note: string): Promise<string>
  /** Sends a note to the squad's running orchestrator, who relays it to the members. */
  messageSquad(code: string, text: string): string
  /** Pauses (or disables) a squad of the floor, or resumes it (`null`). Changes nothing in squads/. */
  setSquadState(code: string, state: 'paused' | 'disabled' | null): string
  /** Deletes a squad folder of the floor. Runs only after the user's card. */
  deleteSquad(code: string): string
  /** Hires a new agent on the floor, in the floor's permission mode. */
  createAgent(name: string, task: string): Promise<string>
  /** Dismisses an agent of the floor, by id or name. Runs only after the user's card. */
  deleteAgent(ref: string): string
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
      'Plano EGM e squads deste andar. plan_get e squads_list leem o estado atual; drift_report_save registra o relatório de drift; ' +
      'plan_approve, squad_create, squad_run, squad_delete e agent_delete mostram um cartão à usuária e só valem depois que ela aprovar; ' +
      'squad_message manda recado a um squad em execução; squad_pause, squad_resume e squad_disable mudam o estado de um squad do andar; agent_create contrata um agente do andar.',
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
      'Mostra o plano EGM do andar: objetivo, bootstrap, brainstorm, design doc, Revisão Goldfish, critérios, tickets aprovados, atribuições e o último relatório de drift.',
      {},
      () => run(deps.plan)(),
      {
        annotations: { readOnlyHint: true },
      },
    ),
    tool(
      'plan_approve',
      'Registra e aprova o plano EGM do andar (brainstorm, design doc, Revisão Goldfish, critérios e tickets). A usuária confirma no cartão antes de valer; substitui o plano anterior.',
      emiPlanShape,
      (args) => run(() => deps.approvePlan(args))(),
    ),
    tool(
      'drift_report_save',
      'Registra no fluxo do andar o resumo do relatório de drift (design docs × código). Não muda etapas nem arquivos: a usuária decide se atualiza o doc ou o código.',
      { summary: z.string().trim().min(1).max(20_000).describe('The drift report summary: each divergence, its files, and the suggested fix (doc or code)') },
      (args) => run(() => deps.saveDrift(args.summary))(),
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
    tool(
      'squad_run',
      'Inicia um ciclo de um squad deste andar (mesmo caminho do ciclo de squad do app), no modo de permissões do andar. A usuária confirma no cartão antes de rodar.',
      {
        code: z.string().trim().min(1).max(64).describe('Squad code, e.g. sala-1 (see squads_list)'),
        note: z.string().trim().max(2000).optional().describe('Optional note to the squad, in pt-BR'),
      },
      (args) => run(() => deps.runSquad(args.code, args.note ?? ''))(),
    ),
    tool(
      'squad_message',
      'Manda um recado ao orquestrador de um squad que está rodando; ele o repassa aos membros. Os membros não recebem mensagens diretas.',
      {
        code: z.string().trim().min(1).max(64).describe('Squad code, e.g. sala-1'),
        text: z.string().trim().min(1).max(2000).describe('The note, in pt-BR'),
      },
      (args) => run(() => deps.messageSquad(args.code, args.text))(),
    ),
    tool(
      'squad_pause',
      'Pausa um squad do andar: ele não inicia novos ciclos até ser retomado. Não mexe em arquivos.',
      { code: z.string().trim().min(1).max(64).describe('Squad code, e.g. sala-1') },
      (args) => run(() => deps.setSquadState(args.code, 'paused'))(),
    ),
    tool(
      'squad_resume',
      'Retoma um squad pausado ou desativado do andar, para ele voltar a rodar.',
      { code: z.string().trim().min(1).max(64).describe('Squad code, e.g. sala-1') },
      (args) => run(() => deps.setSquadState(args.code, null))(),
    ),
    tool(
      'squad_disable',
      'Desativa um squad do andar: ele fica fora da lista de squads rodáveis até ser retomado. Não mexe em arquivos.',
      { code: z.string().trim().min(1).max(64).describe('Squad code, e.g. sala-1') },
      (args) => run(() => deps.setSquadState(args.code, 'disabled'))(),
    ),
    tool(
      'squad_delete',
      'Exclui a pasta squads/<code> de um squad do andar. A usuária confirma no cartão antes de valer. Recusado se o squad estiver rodando.',
      { code: z.string().trim().min(1).max(64).describe('Squad code, e.g. sala-1') },
      (args) => run(() => deps.deleteSquad(args.code))(),
    ),
    tool(
      'agent_create',
      'Contrata um agente novo para este andar, na pasta do projeto e no modo de permissões padrão (pergunta antes de agir), nunca no modo do andar.',
      {
        name: z.string().trim().min(1).max(40).describe('Nome do agente, em pt-BR'),
        task: z.string().trim().min(1).max(4000).describe('O que o agente deve fazer, em pt-BR; a tarefa completa vai num ticket'),
      },
      (args) => run(() => deps.createAgent(args.name, args.task))(),
    ),
    tool(
      'agent_delete',
      'Dispensa um agente do andar, pelo id ou pelo nome. Só agentes parados; a usuária confirma no cartão antes de valer.',
      { agent: z.string().trim().min(1).max(80).describe('Id ou nome do agente no andar') },
      (args) => run(() => deps.deleteAgent(args.agent))(),
    ),
  ]
}
