/**
 * Tela de leitura de um resultado de ticket: a parte pura (sem DOM), para testar sem o
 * Electron. Quais resultados ganham "Ler", o que a tela mostra de cada um (só o que o
 * resultado tem de verdade), a navegação ▲▼ entre os pendentes e quais ações da carta
 * aparecem. A tela (result-reader.ts) só desenha isto e chama as ações da carta.
 */
import type { AgentResult, AgentSummary, ChangedFile, ProjectFloor, SquadInfo, Ticket } from '@shared/types'
import { isSquadTicketResultAgent } from '@shared/squad-ticket-result'
import { formatCost, formatDuration } from './format'
import { changeButtons } from './result-rules'

/** O que a tela lê do estado do app. */
export interface ReaderSource {
  agents: ReadonlyMap<string, AgentSummary>
  results: ReadonlyMap<string, AgentResult>
  tickets: ReadonlyMap<string, Ticket>
  squads: readonly SquadInfo[]
  projects: readonly ProjectFloor[]
}

/**
 * Resultado de ticket: entregue para um ticket do quadro (delegado ou de squad), ou de um
 * agente de projeto, que leva o resultado para a sala de reunião do andar (#57).
 */
export function isTicketResult(agent: AgentSummary | undefined, r: AgentResult, projects: readonly ProjectFloor[]): boolean {
  if (!agent || agent.id !== r.agentId) return false
  if (r.ticketId || agent.ticketId) return true
  return !!agent.project && projects.some((p) => p.id === agent.project)
}

/** Os resultados pendentes que a tela lê, do mais antigo ao mais novo: a ordem do ▲▼. */
export function readableResults(src: ReaderSource): AgentResult[] {
  return [...src.results.values()]
    .filter((r) => isTicketResult(src.agents.get(r.agentId), r, src.projects))
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
}

/** ▲ (-1) ou ▼ (+1) a partir do resultado aberto, dando a volta. Null sem outro para ir. */
export function stepResult(list: readonly AgentResult[], currentId: string, dir: -1 | 1): string | null {
  if (list.length < 2) return list.length === 1 && list[0].id !== currentId ? list[0].id : null
  const i = list.findIndex((r) => r.id === currentId)
  if (i < 0) return list[dir > 0 ? 0 : list.length - 1].id
  return list[(i + dir + list.length) % list.length].id
}

export interface ReaderFact {
  label: string
  value: string
}

export interface ReaderView {
  name: string
  /** Andar e squad, quando o agente tem: "Loja · Squad Front". */
  where: string | null
  ticket: { key: string; title: string } | null
  facts: ReaderFact[]
  text: string
  isError: boolean
  /** Arquivos alterados que o resultado trouxe; null quando não trouxe (a caixa some). */
  files: ChangedFile[] | null
  /** Total real quando a lista veio cortada. */
  filesTotal: number
  branch: string | null
  /** Só agentes do escritório recebem mensagem daqui; sessões do terminal respondem por lá. */
  canReply: boolean
}

/** O que a tela mostra de um resultado. Campos sem dado ficam de fora, nada é inventado. */
export function readerView(src: Pick<ReaderSource, 'tickets' | 'squads' | 'projects'>, agent: AgentSummary, r: AgentResult): ReaderView {
  const ticketId = r.ticketId ?? agent.ticketId
  const t = ticketId ? src.tickets.get(ticketId) : undefined
  const floor = agent.project ? src.projects.find((p) => p.id === agent.project)?.name : undefined
  const squad = agent.squad ? (src.squads.find((s) => s.code === agent.squad)?.name ?? agent.squad) : undefined
  const where = [floor, squad].filter(Boolean).join(' · ') || null
  const c = r.changes
  const files = c && c.files.length ? c.files : null
  const facts: ReaderFact[] = []
  const add = (label: string, value: string) => value && facts.push({ label, value })
  add('Duração', formatDuration(r.durationMs))
  add('Turnos', r.turns ? String(r.turns) : '')
  add('Custo', r.costUnknown ? 's/ preço' : formatCost(r.costUsd))
  if (files) add('Arquivos', String(c?.total ?? files.length))
  return {
    name: agent.name,
    where,
    ticket: t ? { key: t.key, title: t.title } : null,
    facts,
    text: r.text,
    isError: r.isError,
    files,
    filesTotal: files ? (c?.total ?? files.length) : 0,
    branch: c?.branch ?? null,
    canReply: agent.source === 'office',
  }
}

/** Um botão da carta no rodapé: escondido (null), desligado ou ligado — as mesmas regras da carta. */
export type ActionState = 'on' | 'off' | null

/**
 * "Abrir PR" e "Descartar" da carta (result-rules.ts), com as mesmas travas: só com git e
 * arquivos, nunca para o trabalho de ticket de squad (a fila do squad publica e recupera).
 */
export function readerActions(agent: AgentSummary, r: AgentResult): { discard: ActionState; pr: ActionState } {
  const c = r.changes
  if (!c || !c.git || !c.files.length || isSquadTicketResultAgent(agent)) return { discard: null, pr: null }
  const rules = changeButtons(c)
  return { discard: rules.discard ? 'on' : 'off', pr: c.branch ? (rules.pr ? 'on' : 'off') : null }
}

/** O que a carta já faz; a tela só chama. */
export interface ReaderHandlers {
  ack(r: AgentResult): Promise<void> | void
  discard(r: AgentResult): Promise<void> | void
  openPR(r: AgentResult): Promise<void> | void
}

/** Rodapé: as ações da carta que valem para este resultado, cada uma chamando o handler dela. */
export function footerActions(
  agent: AgentSummary,
  r: AgentResult,
  handlers: ReaderHandlers,
): { id: 'discard' | 'pr' | 'ack'; label: string; enabled: boolean; run: () => Promise<void> | void }[] {
  const a = readerActions(agent, r)
  const out: ReturnType<typeof footerActions> = []
  if (a.discard) out.push({ id: 'discard', label: 'Descartar', enabled: a.discard === 'on', run: () => handlers.discard(r) })
  if (a.pr) out.push({ id: 'pr', label: 'Abrir PR', enabled: a.pr === 'on', run: () => handlers.openPR(r) })
  out.push({ id: 'ack', label: 'Recebido', enabled: true, run: () => handlers.ack(r) })
  return out
}

/** Uma tecla que, fora do campo de resposta, começa a resposta: letra, número ou sinal, sem atalho. */
export function startsReply(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; isComposing?: boolean }): boolean {
  return e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.isComposing
}
