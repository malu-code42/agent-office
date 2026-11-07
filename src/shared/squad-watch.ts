import type { AgentResult, AgentSummary, LogEntry, PermissionRequest, SquadInfo, SquadQueue, Ticket } from './types'

// AO-108: a montagem dos dados da popup de acompanhamento dos squads do andar. Tudo aqui é puro
// (sem DOM, sem IPC): a tela só desenha o que estas funções devolvem e chama as ações que já existem.
// Nada é guardado: cada chamada deriva tudo do estado atual, então uma solicitação resolvida some sozinha.

/** Estado de um squad como a popup o mostra. */
export type SquadRunState = 'running' | 'paused' | 'stopped' | 'disabled' | 'error' | 'idle'

export const SQUAD_STATE_LABELS: Record<SquadRunState, string> = {
  running: 'Rodando',
  paused: 'Pausado',
  stopped: 'Parado',
  disabled: 'Desativada',
  error: 'Com erro',
  idle: 'Ocioso',
}

export type RequestKind = 'question' | 'permission' | 'result' | 'pr' | 'error'
export type RequestFilter = 'all' | RequestKind

export const REQUEST_KIND_LABELS: Record<RequestKind, string> = {
  question: 'Pergunta',
  permission: 'Permissão',
  result: 'Resultado',
  pr: 'PR para revisar',
  error: 'Erro',
}

/** O que o clique no cartão faz: sempre a mesma interação que existe fora da popup. */
export type RequestAction =
  /** O cartão de pergunta, permissão ou plano; o recebimento do resultado (Dialog.open). */
  | { type: 'item'; agentId: string; itemId: string }
  /** Um PR aguardando revisão humana: abre no navegador, como a caixa de entrada. */
  | { type: 'pr'; url: string }
  /** Erro de início ou de publicação: Tentar novamente e Abrir pasta. */
  | { type: 'recovery'; code: string; problem: 'start' | 'publication'; message: string; folder?: string }

export interface SquadRequest {
  /** Estável enquanto a solicitação existe (serve de chave de foco). */
  id: string
  squad: string
  kind: RequestKind
  /** Quem pede: o nome do agente (ou do ajudante). */
  who: string
  title: string
  createdAt: number
  action: RequestAction
}

/** O que a popup lê do estado do app. */
export interface WatchSource {
  now: number
  /** Pasta do andar de projeto: só os squads dela entram. */
  cwd: string
  squads: readonly SquadInfo[]
  agents: ReadonlyMap<string, AgentSummary>
  permissions: ReadonlyMap<string, PermissionRequest>
  results: ReadonlyMap<string, AgentResult>
  tickets: ReadonlyMap<string, Ticket>
  queues: readonly SquadQueue[]
  /** Logs dos agentes já carregados (state.logs); o que falta não aparece no registro. */
  logs: ReadonlyMap<string, readonly LogEntry[]>
}

export interface SquadSummary {
  code: string
  name: string
  state: SquadRunState
  orchestratorId?: string
  orchestratorName?: string
  /** Passo do ciclo ("Spec"), quando o runner o escreveu. */
  phase?: string
  activeTicket: { id: string; key: string; title: string } | null
  /** Critérios feitos do ticket ativo. */
  progress: { done: number; total: number } | null
  queueLength: number
  prCount: number
  requestCount: number
  /** Gasto da sessão do orquestrador (a que o SDK informa); 0 sem agente. */
  costUsd: number
  /** Tamanho da conversa do orquestrador em tokens (o app não soma tokens por squad). */
  contextTokens?: number
  /** Há quanto tempo o ticket ativo está sendo trabalhado (da primeira atividade do ticket). */
  activeForMs?: number
  alerts: string[]
}

export interface WatchModel {
  summaries: SquadSummary[]
  requestsByCode: Map<string, SquadRequest[]>
  totals: { requests: number; queued: number; prs: number; costUsd: number; running: number }
}

const BUSY = ['starting', 'working', 'waiting']

function squadsOfFloor(src: WatchSource): SquadInfo[] {
  return src.squads.filter((s) => s.cwd === src.cwd)
}

/** Os agentes que rodam o squad neste andar (normalmente um orquestrador). */
function orchestrators(src: WatchSource, s: SquadInfo): AgentSummary[] {
  return [...src.agents.values()].filter((a) => a.role === 'orchestrator' && a.squad === s.code && a.cwd === s.cwd)
}

function queueOf(src: WatchSource, s: SquadInfo): SquadQueue | undefined {
  return src.queues.find((q) => q.code === s.code && q.cwd === s.cwd)
}

function clip(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max)}…` : line
}

function ticketKeyOf(src: WatchSource, id: string): string {
  return src.tickets.get(id)?.key ?? '?'
}

function cycleError(q: SquadQueue | undefined): { problem: 'start' | 'publication'; message: string } | undefined {
  if (q?.cycle?.startupError) return { problem: 'start', message: q.cycle.startupError }
  if (q?.cycle?.publicationError) return { problem: 'publication', message: q.cycle.publicationError }
  return undefined
}

function requestsOf(src: WatchSource, s: SquadInfo): SquadRequest[] {
  const bosses = orchestrators(src, s)
  const ids = new Set(bosses.map((a) => a.id))
  const out: SquadRequest[] = []
  for (const p of src.permissions.values()) {
    if (!ids.has(p.agentId)) continue
    const a = src.agents.get(p.agentId)!
    const kind: RequestKind = p.kind === 'question' ? 'question' : 'permission'
    const title = p.kind === 'question' ? (p.questions?.[0]?.question ?? p.title) : p.kind === 'plan' ? `Plano: ${p.title}` : p.title
    out.push({
      id: p.id,
      squad: s.code,
      kind,
      who: p.subagent ? `${a.name} · ${p.subagent}` : a.name,
      title: clip(title, 160),
      createdAt: p.createdAt,
      action: { type: 'item', agentId: p.agentId, itemId: p.id },
    })
  }
  for (const r of src.results.values()) {
    if (!ids.has(r.agentId)) continue
    out.push({
      id: r.id,
      squad: s.code,
      kind: r.isError ? 'error' : 'result',
      who: src.agents.get(r.agentId)!.name,
      title: clip(r.text || '(sem texto)', 160),
      createdAt: r.createdAt,
      action: { type: 'item', agentId: r.agentId, itemId: r.id },
    })
  }
  const q = queueOf(src, s)
  for (const pr of q?.pendingPRs ?? []) {
    out.push({
      id: `pr:${s.code}:${pr.ticketId}`,
      squad: s.code,
      kind: 'pr',
      who: pr.ticketKey,
      title: clip(pr.title, 160),
      createdAt: pr.createdAt,
      action: { type: 'pr', url: pr.url },
    })
  }
  const err = cycleError(q)
  if (q && err) {
    const key = ticketKeyOf(src, q.cycle?.ticketId ?? q.active ?? '')
    out.push({
      id: `${err.problem}:${s.code}`,
      squad: s.code,
      kind: 'error',
      who: bosses[0]?.name ?? s.name,
      title: err.problem === 'start' ? `O início do ciclo de ${key} não terminou.` : `A publicação do PR de ${key} não terminou.`,
      createdAt: q.updatedAt,
      action: { type: 'recovery', code: s.code, problem: err.problem, message: err.message, folder: q.cycle?.worktree.root },
    })
  }
  return out.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
}

function stateOf(s: SquadInfo, bosses: AgentSummary[], q: SquadQueue | undefined): SquadRunState {
  if (bosses.some((a) => a.status === 'error') || cycleError(q)) return 'error'
  if (s.state === 'paused') return 'paused'
  if (s.state === 'disabled') return 'disabled'
  if ((bosses.length > 0 && bosses.every((a) => a.status === 'stopped'))) return 'stopped'
  if (bosses.some((a) => BUSY.includes(a.status))) return 'running'
  return 'idle'
}

function criteria(t: Ticket | undefined): { done: number; total: number } | null {
  return t ? { done: t.acceptance.filter((c) => c.done).length, total: t.acceptance.length } : null
}

/** A primeira linha de texto da descrição: o "o que faz" do ticket. */
function whatItDoes(t: Ticket): string {
  const line = t.description
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('#'))
  return line ? clip(line, 200) : ''
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

function summarize(src: WatchSource, s: SquadInfo, requests: SquadRequest[]): SquadSummary {
  const bosses = orchestrators(src, s)
  const boss = bosses[0]
  const q = queueOf(src, s)
  const active = q?.active ? src.tickets.get(q.active) : undefined
  const err = cycleError(q)
  const state = stateOf(s, bosses, q)
  const alerts: string[] = []
  if (err) alerts.push(`Erro ${err.problem === 'start' ? 'ao iniciar' : 'ao publicar'}: ${clip(err.message, 120)}`)
  else if (bosses.some((a) => a.status === 'error')) alerts.push('O orquestrador terminou com erro')
  if (state === 'paused') alerts.push('Pausado: não inicia novos ciclos')
  if (state === 'stopped') alerts.push('Parado')
  if (state === 'disabled') alerts.push('Sala desativada: luz apagada, não aceita squad_run')
  if (requests.length) alerts.push(`${plural(requests.length, 'solicitação esperando', 'solicitações esperando')} você`)
  const prs = q?.pendingPRs?.length ?? 0
  if (prs) alerts.push(`${plural(prs, 'PR aguardando', 'PRs aguardando')} revisão`)
  const since = active?.activity.length ? Math.min(...active.activity.map((a) => a.t)) : undefined
  return {
    code: s.code,
    name: s.name,
    state,
    orchestratorId: boss?.id,
    orchestratorName: boss?.name,
    phase: boss?.squadStep?.label,
    activeTicket: active ? { id: active.id, key: active.key, title: active.title } : null,
    progress: criteria(active),
    queueLength: q?.queue.length ?? 0,
    prCount: prs,
    requestCount: requests.length,
    costUsd: boss ? (boss.spentUsd ?? boss.costUsd) : 0,
    contextTokens: boss?.context?.used,
    activeForMs: since === undefined ? undefined : Math.max(0, src.now - since),
    alerts,
  }
}

/** Visão geral: um resumo por squad do andar, as solicitações de cada um e os totais. */
export function buildWatch(src: WatchSource): WatchModel {
  const requestsByCode = new Map<string, SquadRequest[]>()
  const summaries = squadsOfFloor(src).map((s) => {
    const requests = requestsOf(src, s)
    requestsByCode.set(s.code, requests)
    return summarize(src, s, requests)
  })
  return {
    summaries,
    requestsByCode,
    totals: {
      requests: summaries.reduce((n, s) => n + s.requestCount, 0),
      queued: summaries.reduce((n, s) => n + s.queueLength, 0),
      prs: summaries.reduce((n, s) => n + s.prCount, 0),
      costUsd: summaries.reduce((n, s) => n + s.costUsd, 0),
      running: summaries.filter((s) => s.state === 'running').length,
    },
  }
}

// ---------- solicitações: contagem, filtro, sequência e grupos ----------

export function countRequests(list: readonly SquadRequest[]): Record<RequestFilter, number> {
  const n: Record<RequestFilter, number> = { all: list.length, question: 0, permission: 0, result: 0, pr: 0, error: 0 }
  for (const r of list) n[r.kind]++
  return n
}

export function filterRequests(list: readonly SquadRequest[], filter: RequestFilter): SquadRequest[] {
  return filter === 'all' ? [...list] : list.filter((r) => r.kind === filter)
}

/** "Responder em sequência": a mais antiga, ou a que vem depois de `afterId`. */
export function nextRequest(list: readonly SquadRequest[], afterId?: string): SquadRequest | undefined {
  if (!afterId) return list[0]
  const i = list.findIndex((r) => r.id === afterId)
  return list[i + 1]
}

/** O que "Responder em sequência" faz depois que a pessoa mexeu no cartão atual. */
export type SequenceStep =
  /** A atual continua pendente: espera (ou a pessoa fechou o cartão sem responder). */
  | { type: 'wait' }
  /** A atual foi respondida: abre a mais antiga que sobrou na lista do filtro/grupo. */
  | { type: 'open'; next: SquadRequest }
  /** Respondida e não sobrou nada: a sequência acaba. */
  | { type: 'done' }

export function sequenceStep(list: readonly SquadRequest[], currentId: string): SequenceStep {
  if (list.some((r) => r.id === currentId)) return { type: 'wait' }
  const next = nextRequest(list)
  return next ? { type: 'open', next } : { type: 'done' }
}

/** Quantos cartões cabem na lista que rola do detalhe do squad antes de precisar rolar. */
export const DETAIL_VISIBLE = 6

/** "Mostrando 6 de 9": o que aparece sem rolar (já com o filtro) sobre o total do squad. */
export function requestCounter(filtered: number, total: number, visible = DETAIL_VISIBLE): string {
  return `Mostrando ${Math.min(filtered, visible)} de ${total}`
}

export interface OverviewGroup {
  code: string
  name: string
  state: SquadRunState
  total: number
  shown: SquadRequest[]
  hidden: number
}

/** Quantas solicitações cada squad mostra na Visão geral antes de "Ver as outras". */
export const OVERVIEW_LIMIT = 3

/** A caixa única da Visão geral: um grupo por squad com solicitações, as mais antigas primeiro. */
export function overviewGroups(
  watch: WatchModel,
  filter: RequestFilter,
  expanded: ReadonlySet<string>,
  limit = OVERVIEW_LIMIT,
): OverviewGroup[] {
  const groups: OverviewGroup[] = []
  for (const s of watch.summaries) {
    const list = filterRequests(watch.requestsByCode.get(s.code) ?? [], filter)
    if (!list.length) continue
    const shown = expanded.has(s.code) ? list : list.slice(0, limit)
    groups.push({ code: s.code, name: s.name, state: s.state, total: list.length, shown, hidden: list.length - shown.length })
  }
  return groups
}

// ---------- detalhe do squad ----------

export interface MemberRow {
  id: string
  name: string
  orchestrator: boolean
  roleLabel: string
  model?: string
  effort?: string
  account?: string
  state: 'working' | 'waiting' | 'idle' | 'error' | 'stopped'
  activity: string
  /** Só o orquestrador é um agente do escritório. */
  agentId?: string
  /** Excluir = dispensar o agente; só parado (como o deleteAgent da Emi). */
  canDelete: boolean
}

export interface QueueRow {
  id: string
  key: string
  title: string
  what: string
  criteria: number
}

export interface ActiveTicketDetail {
  id: string
  key: string
  title: string
  what: string
  criteria: { text: string; done: boolean }[]
  branch?: string
  worktree?: string
  prUrl?: string
}

export interface SquadDetail {
  summary: SquadSummary
  requests: SquadRequest[]
  ticket: ActiveTicketDetail | null
  queue: QueueRow[]
  members: MemberRow[]
}

function members(src: WatchSource, s: SquadInfo): MemberRow[] {
  const boss = orchestrators(src, s)[0]
  const rows: MemberRow[] = []
  if (boss) {
    const memberState: MemberRow['state'] =
      boss.status === 'working' || boss.status === 'starting'
        ? 'working'
        : boss.status === 'waiting'
          ? 'waiting'
          : boss.status === 'error'
            ? 'error'
            : boss.status === 'stopped'
              ? 'stopped'
              : 'idle'
    rows.push({
      id: boss.id,
      name: boss.name,
      orchestrator: true,
      roleLabel: 'Orquestrador',
      model: boss.model,
      effort: boss.effort,
      account: boss.account,
      state: memberState,
      activity: boss.activity,
      agentId: boss.id,
      canDelete: !BUSY.includes(boss.status) && boss.source === 'office',
    })
  }
  for (const m of s.members) {
    const running = boss?.subagents?.find((x) => x.member === m.id)
    const last = [...(boss?.subagentsDone ?? [])].reverse().find((x) => x.member === m.id)
    const state: MemberRow['state'] = running ? 'working' : last?.status === 'failed' ? 'error' : 'idle'
    rows.push({
      id: m.id,
      name: m.name,
      orchestrator: false,
      roleLabel: m.title,
      model: m.model ?? boss?.model,
      effort: m.effort ?? boss?.effort,
      account: boss?.account,
      state,
      activity: running ? (running.activity ?? running.description) : state === 'error' ? (last?.error ?? 'falhou') : '',
      canDelete: false,
    })
  }
  return rows
}

/** Tudo da aba de um squad; indefinido quando o código não é do andar. */
export function squadDetail(src: WatchSource, code: string): SquadDetail | undefined {
  const s = squadsOfFloor(src).find((x) => x.code === code)
  if (!s) return undefined
  const requests = requestsOf(src, s)
  const summary = summarize(src, s, requests)
  const q = queueOf(src, s)
  const active = q?.active ? src.tickets.get(q.active) : undefined
  const ticket: ActiveTicketDetail | null = active
    ? {
        id: active.id,
        key: active.key,
        title: active.title,
        what: whatItDoes(active),
        criteria: active.acceptance.map((c) => ({ text: c.text, done: c.done })),
        branch: q?.cycle?.worktree.branch,
        worktree: q?.cycle?.worktree.root,
        prUrl: active.pullRequestUrl ?? q?.pendingPRs?.find((p) => p.ticketId === active.id)?.url,
      }
    : null
  const queue: QueueRow[] = (q?.queue ?? []).map((id) => {
    const t = src.tickets.get(id)
    return {
      id,
      key: t?.key ?? '?',
      title: t?.title ?? '(ticket removido)',
      what: t ? whatItDoes(t) : '',
      criteria: t?.acceptance.length ?? 0,
    }
  })
  return { summary, requests, ticket, queue, members: members(src, s) }
}

// ---------- registro somente leitura ----------

export type LogFilter = 'all' | 'tickets' | 'agents' | 'errors'

export interface ActivityEvent {
  id: string
  t: number
  source: 'ticket' | 'agent' | 'error'
  actor: string
  text: string
}

/** Quantos eventos o registro mostra. */
export const LOG_LIMIT = 40
const LOG_TEXT = 160

/**
 * O que o squad fez, do mais novo ao mais antigo. Não existe um registro próprio: ele vem da atividade
 * dos tickets do squad (ativo, fila, PRs e os entregues ao orquestrador), das respostas e resultados do
 * log do orquestrador e dos PRs abertos. O ruído (pensamento, ferramentas, texto corrido) fica de fora.
 */
export function activityLog(src: WatchSource, code: string, filter: LogFilter): ActivityEvent[] {
  const s = squadsOfFloor(src).find((x) => x.code === code)
  if (!s) return []
  const q = queueOf(src, s)
  const bosses = orchestrators(src, s)
  const events: ActivityEvent[] = []
  const ticketIds = new Set<string>([
    ...(q?.active ? [q.active] : []),
    ...(q?.queue ?? []),
    ...(q?.pendingPRs ?? []).map((p) => p.ticketId),
  ])
  for (const t of src.tickets.values()) if (t.assignee?.id && bosses.some((b) => b.id === t.assignee?.id)) ticketIds.add(t.id)
  for (const id of ticketIds) {
    const t = src.tickets.get(id)
    if (!t) continue
    for (const a of t.activity)
      events.push({ id: `ta:${a.id}`, t: a.t, source: 'ticket', actor: a.actor.name, text: `${t.key}: ${a.text}` })
  }
  for (const pr of q?.pendingPRs ?? []) {
    events.push({
      id: `pr:${pr.ticketId}`,
      t: pr.createdAt,
      source: 'ticket',
      actor: 'PR',
      text: `${pr.ticketKey}: PR aberto para revisão`,
    })
  }
  for (const b of bosses) {
    for (const e of src.logs.get(b.id) ?? []) {
      if (e.kind === 'error' || (e.isError && e.kind !== 'user')) {
        events.push({ id: `lg:${b.id}:${e.id}`, t: e.t, source: 'error', actor: b.name, text: e.text })
      } else if (e.kind === 'user') {
        events.push({ id: `lg:${b.id}:${e.id}`, t: e.t, source: 'agent', actor: 'você', text: e.text })
      } else if (e.kind === 'result' || e.kind === 'decision') {
        events.push({ id: `lg:${b.id}:${e.id}`, t: e.t, source: 'agent', actor: b.name, text: e.text })
      }
    }
  }
  const wanted = filter === 'all' ? null : filter === 'tickets' ? 'ticket' : filter === 'agents' ? 'agent' : 'error'
  return events
    .filter((e) => !wanted || e.source === wanted)
    .sort((a, b) => b.t - a.t || a.id.localeCompare(b.id))
    .slice(0, LOG_LIMIT)
    .map((e) => ({ ...e, text: clip(e.text, LOG_TEXT) }))
}

// ---------- texto curto dos números ----------

/** 12min, 1h12; "agora" abaixo de um minuto. */
export function formatSpan(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / 60_000)
  if (min < 1) return 'agora'
  if (min < 60) return `${min}min`
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`
}

/** 950, 120k, 1,2M. */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.', ',')}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}
