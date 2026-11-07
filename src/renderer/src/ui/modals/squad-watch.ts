import {
  activityLog,
  buildWatch,
  countRequests,
  filterRequests,
  formatSpan,
  formatTokens,
  nextRequest,
  overviewGroups,
  REQUEST_KIND_LABELS,
  SQUAD_STATE_LABELS,
  squadDetail,
  type LogFilter,
  type MemberRow,
  type RequestFilter,
  type SquadRequest,
  type SquadRunState,
  type SquadSummary,
  type WatchSource,
} from '@shared/squad-watch'
import { SQUAD_MODEL_LABELS, type ProjectFloor } from '@shared/types'
import type { State } from '../../state'
import { keepFocus } from '../a11y'
import { formatCost, h, icon, timeAgo } from '../dom'
import { cleanError, confirmDialog, modal } from './common'

// AO-108: popup de acompanhamento dos squads do andar. Visão geral e uma aba por squad. Não há chat nem
// campo de mensagem: o que o squad fez é um registro somente leitura, e cada solicitação dos agentes é um
// cartão clicável que abre a mesma interação de sempre (cartão de pergunta/permissão, recebimento do
// resultado, PR no navegador, janela de recuperação). A montagem dos dados está em @shared/squad-watch.

export interface SquadWatchActions {
  toast(text: string, kind?: 'info' | 'ok' | 'err'): void
  /** A mesma interação que o clique no agente abre (Dialog.open do app). */
  openItem(agentId: string, itemId: string): void
}

const KIND_FILTERS: { value: RequestFilter; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'question', label: 'Perguntas' },
  { value: 'permission', label: 'Permissões' },
  { value: 'result', label: 'Resultados' },
  { value: 'pr', label: 'PRs' },
  { value: 'error', label: 'Erros' },
]

const LOG_FILTERS: { value: LogFilter; label: string }[] = [
  { value: 'all', label: 'tudo' },
  { value: 'tickets', label: 'tickets' },
  { value: 'agents', label: 'agentes' },
  { value: 'errors', label: 'erros' },
]

const MEMBER_STATE: Record<MemberRow['state'], string> = {
  working: 'trabalhando',
  waiting: 'espera você',
  idle: 'ocioso',
  error: 'com erro',
  stopped: 'parado',
}

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function modelLabel(m: string | undefined): string {
  return m ? (SQUAD_MODEL_LABELS[m] ?? m) : 'padrão'
}

/**
 * Janela de recuperação de um erro de início ou de publicação: o que aconteceu, "Tentar novamente"
 * e "Abrir pasta". Os canais são os mesmos da Emi e do cron de tickets.
 */
export function openSquadRecovery(
  root: HTMLElement,
  req: { code: string; problem: 'start' | 'publication'; message: string; folder?: string },
  toast: SquadWatchActions['toast'],
): void {
  const close = () => el.remove()
  const retryLabel = req.problem === 'start' ? 'Tentar iniciar novamente' : 'Tentar publicar novamente'
  const retry = h('button', { class: 'btn btn-primary' }, retryLabel)
  retry.addEventListener('click', async () => {
    retry.setAttribute('disabled', '')
    try {
      if (req.problem === 'start') await window.office.retrySquadStart(req.code)
      else await window.office.retrySquadPublication(req.code)
      toast(req.problem === 'start' ? 'Início do ciclo tentado de novo.' : 'Publicação tentada de novo.', 'ok')
      close()
    } catch (err) {
      toast(cleanError(err), 'err')
      retry.removeAttribute('disabled')
    }
  })
  const buttons: HTMLElement[] = []
  if (req.folder) {
    const folder = req.folder
    buttons.push(h('button', { class: 'btn', onclick: () => void window.office.revealPath(folder) }, icon('folder', 15), 'Abrir pasta'))
  }
  buttons.push(h('button', { class: 'btn', onclick: close }, 'Fechar'), retry)
  const el = modal(
    req.problem === 'start' ? 'O ciclo do squad não começou' : 'O PR do squad não foi publicado',
    [h('p', { class: 'sw-recovery-text' }, req.message)],
    buttons,
    close,
  )
  el.classList.add('backdrop-confirm')
  root.append(el)
  retry.focus()
}

/** Abre a popup. Devolve a função que a fecha. */
export function openSquadWatch(root: HTMLElement, state: State, project: ProjectFloor, actions: SquadWatchActions): () => void {
  let selected = 'overview'
  let kindFilter: RequestFilter = 'all'
  let logFilter: LogFilter = 'all'
  const expanded = new Set<string>()
  /** "Responder em sequência": a última solicitação aberta; quando ela some, a próxima abre sozinha. */
  let sequence: { current: string; scope: () => SquadRequest[] } | null = null
  let sequenceTimer: ReturnType<typeof setTimeout> | undefined
  let frame = 0

  const content = h('div', { class: 'sw-frame' })
  const source = (): WatchSource => ({
    now: Date.now(),
    cwd: project.cwd,
    squads: state.squads,
    agents: state.agents,
    permissions: state.permissions,
    results: state.results,
    tickets: state.tickets,
    queues: state.squadQueues,
    logs: state.logs,
  })

  const close = () => {
    if (!el.isConnected) return
    cancelAnimationFrame(frame)
    clearTimeout(sequenceTimer)
    off()
    offLog()
    document.body.classList.remove('sw-open')
    el.remove()
  }
  const el = modal(`Squads do andar ${project.name}`, [content], [], close, true)
  el.querySelector('.modal')?.classList.add('sw-modal')

  // ---------- peças ----------

  const dot = (state: SquadRunState | MemberRow['state']) => h('span', { class: `sw-dot sw-dot-${state}`, 'aria-hidden': 'true' })

  const stateTag = (s: SquadRunState) => h('span', { class: 'sw-state' }, dot(s), SQUAD_STATE_LABELS[s])

  const pend = (n: number) =>
    n ? h('span', { class: 'sw-pend', 'aria-label': `${n} ${n === 1 ? 'solicitação' : 'solicitações'}` }, String(n)) : null

  const open = (r: SquadRequest) => {
    if (r.action.type === 'item') actions.openItem(r.action.agentId, r.action.itemId)
    else if (r.action.type === 'pr') void window.office.openExternal(r.action.url).catch((err) => actions.toast(cleanError(err), 'err'))
    else openSquadRecovery(root, r.action, actions.toast)
  }

  const requestCard = (r: SquadRequest, squadName?: string) => {
    const label = `${REQUEST_KIND_LABELS[r.kind]} de ${r.who}${squadName ? `, ${squadName}` : ''}, há ${timeAgo(r.createdAt)}`
    return h(
      'button',
      { type: 'button', class: 'sw-req', 'data-focus-key': r.id, 'aria-label': label, onclick: () => open(r) },
      h(
        'span',
        { class: 'sw-req-txt' },
        h(
          'span',
          { class: 'sw-req-top' },
          h('span', { class: 'sw-new', 'aria-hidden': 'true' }),
          h('span', { class: 'sw-tag' }, REQUEST_KIND_LABELS[r.kind]),
          h('span', {}, `${r.who} · há ${timeAgo(r.createdAt)}`),
        ),
        h('span', { class: 'sw-req-body' }, r.title),
      ),
      h('span', { class: 'sw-req-go', 'aria-hidden': 'true' }, icon('chevron', 18)),
    )
  }

  const kindChips = (list: readonly SquadRequest[]) => {
    const n = countRequests(list)
    return h(
      'div',
      { class: 'sw-filters', role: 'group', 'aria-label': 'Filtrar por tipo' },
      ...KIND_FILTERS.filter((f) => f.value === 'all' || n[f.value] > 0 || kindFilter === f.value).map((f) =>
        h(
          'button',
          {
            type: 'button',
            class: 'sw-chipf',
            'aria-pressed': String(kindFilter === f.value),
            onclick: () => {
              kindFilter = f.value
              render()
            },
          },
          f.label,
          h('i', {}, String(n[f.value])),
        ),
      ),
    )
  }

  /** Só as solicitações que abrem um cartão entram na sequência: PR e recuperação não saem da lista ao abrir. */
  const startSequence = (scope: () => SquadRequest[]) => {
    const first = nextRequest(scope().filter((r) => r.action.type === 'item'))
    if (!first) {
      actions.toast('Nenhuma solicitação com cartão para responder agora.', 'info')
      return
    }
    sequence = { current: first.id, scope: () => scope().filter((r) => r.action.type === 'item') }
    open(first)
  }

  /** Quando a atual some (foi respondida), abre a mais antiga que sobrou; se continua lá, a sequência acaba. */
  const advanceSequence = () => {
    if (!sequence) return
    const seq = sequence
    const list = seq.scope()
    if (list.some((r) => r.id === seq.current)) {
      // Ainda pendente: a pessoa fechou o cartão sem responder.
      if (!document.querySelector('.dialog:not(.hidden)')) sequence = null
      return
    }
    const next = nextRequest(list)
    if (!next) {
      sequence = null
      return
    }
    seq.current = next.id
    clearTimeout(sequenceTimer)
    // Deixa o cartão anterior terminar de fechar.
    sequenceTimer = setTimeout(() => {
      if (sequence === seq && el.isConnected) open(next)
    }, 250)
  }

  const togglePause = async (s: SquadSummary) => {
    try {
      await window.office.setSquadPaused(project.cwd, s.code, s.state !== 'paused')
      actions.toast(s.state === 'paused' ? `${s.name} retomado.` : `${s.name} pausado: não inicia novos ciclos.`, 'ok')
    } catch (err) {
      actions.toast(cleanError(err), 'err')
    }
  }

  const pauseButton = (s: SquadSummary, accent = false) =>
    h(
      'button',
      {
        type: 'button',
        class: `btn${s.state === 'paused' && accent ? ' btn-primary' : ''}`,
        disabled: s.state === 'stopped',
        title: s.state === 'stopped' ? 'Squad desativado: peça à Emi para reativá-lo' : undefined,
        onclick: () => void togglePause(s),
      },
      s.state === 'paused' ? 'Retomar' : 'Pausar',
    )

  const deleteAgent = async (m: MemberRow) => {
    if (!m.agentId) return
    try {
      const asked = await window.office.prepareFire(m.agentId)
      if (asked === 'cancelled') return
      if (
        asked === 'plain' &&
        !(await confirmDialog(root, {
          title: `Excluir ${m.name}?`,
          text: 'A sessão para e o agente vai embora pelo elevador. O squad fica sem orquestrador até a Emi iniciar outro ciclo.',
          confirm: 'Excluir agente',
          cancel: 'Cancelar',
          danger: true,
        }))
      )
        return
      const note = await window.office.fire(m.agentId)
      actions.toast(note || `${m.name} foi dispensado.`, 'info')
    } catch (err) {
      actions.toast(cleanError(err), 'err')
    }
  }

  // ---------- visão geral ----------

  const overview = (src: WatchSource): HTMLElement[] => {
    const watch = buildWatch(src)
    const all = watch.summaries.flatMap((s) => watch.requestsByCode.get(s.code) ?? [])
    const groups = overviewGroups(watch, kindFilter, expanded)
    const hours = watch.summaries.reduce((n, s) => n + (s.state === 'running' ? (s.activeForMs ?? 0) : 0), 0)
    const kpi = (value: string, label: string) => h('div', { class: 'sw-kpi' }, h('b', {}, value), h('span', {}, label))
    const list: HTMLElement[] = []
    for (const g of groups) {
      list.push(
        h(
          'div',
          { class: 'sw-gh' },
          dot(g.state),
          g.name,
          h('i', {}, g.hidden ? `${g.total} · mostrando ${g.shown.length}` : String(g.total)),
        ),
        ...g.shown.map((r) => requestCard(r)),
      )
      if (g.hidden)
        list.push(
          h(
            'button',
            {
              type: 'button',
              class: 'sw-gh sw-gh-more',
              onclick: () => {
                expanded.add(g.code)
                render()
              },
            },
            `Ver as outras ${g.hidden} de ${g.name}`,
            h('i', {}, '›'),
          ),
        )
    }
    if (!list.length)
      list.push(
        h(
          'div',
          { class: 'sw-empty' },
          all.length ? 'Nenhuma solicitação deste tipo.' : 'Nada esperando você. Os squads estão trabalhando.',
        ),
      )

    const summaryCard = (s: SquadSummary) =>
      h(
        'div',
        { class: 'sw-card' },
        h('div', { class: 'sw-card-line' }, h('b', {}, s.name), stateTag(s.state)),
        s.activeTicket
          ? h(
              'div',
              { class: 'sw-card-line' },
              h('span', {}, h('span', { class: 'sw-key' }, s.activeTicket.key), ` ${s.activeTicket.title}`),
            )
          : h('div', { class: 'sw-muted' }, 'Sem ticket ativo'),
        s.progress && s.progress.total
          ? h(
              'div',
              {
                class: 'sw-bar-track',
                role: 'progressbar',
                'aria-valuemin': 0,
                'aria-valuemax': s.progress.total,
                'aria-valuenow': s.progress.done,
              },
              h('div', { class: 'sw-bar-fill', style: `width:${Math.round((s.progress.done / s.progress.total) * 100)}%` }),
            )
          : null,
        h(
          'div',
          { class: 'sw-muted' },
          [
            `fila ${s.queueLength}`,
            s.prCount ? `${s.prCount} PR` : '',
            s.requestCount ? `${s.requestCount} solicitações` : '',
            s.costUsd ? formatCost(s.costUsd) : '',
            s.activeForMs !== undefined ? formatSpan(s.activeForMs) : '',
          ]
            .filter(Boolean)
            .join(' · '),
        ),
        s.alerts.length ? h('div', { class: 'sw-muted' }, s.alerts.slice(0, 2).join(' · ')) : null,
        h(
          'div',
          { class: 'sw-actions' },
          pauseButton(s, true),
          h('button', { type: 'button', class: 'btn', onclick: () => select(s.code) }, 'Abrir squad'),
        ),
      )

    return [
      h(
        'div',
        { class: 'sw-kpis' },
        kpi(String(watch.totals.requests), 'solicitações esperando'),
        kpi(String(watch.totals.queued), 'tickets na fila'),
        kpi(String(watch.totals.prs), 'PRs aguardando'),
        kpi(formatCost(watch.totals.costUsd) || '$0,00', 'gasto das sessões'),
        kpi(formatSpan(hours), 'de squads rodando'),
      ),
      h(
        'div',
        { class: 'sw-over' },
        h(
          'div',
          { class: 'sw-col' },
          h(
            'div',
            { class: 'sw-sec' },
            h('span', {}, `TODAS AS SOLICITAÇÕES (${all.length})`),
            h('span', {}, 'por squad · mais antigas primeiro'),
          ),
          kindChips(all),
          h('div', { class: 'sw-list', 'data-scroll': 'list' }, ...list),
        ),
        h(
          'div',
          { class: 'sw-col' },
          h('div', { class: 'sw-sec' }, h('span', {}, 'OS SQUADS')),
          h(
            'div',
            { class: 'sw-list', 'data-scroll': 'squads' },
            ...(watch.summaries.length
              ? watch.summaries.map(summaryCard)
              : [h('div', { class: 'sw-empty' }, 'Este andar ainda não tem squads. Converse com a Emi para montar um.')]),
          ),
        ),
      ),
      h(
        'div',
        { class: 'sw-bar' },
        h(
          'span',
          {},
          'Cada squad mostra as 3 mais antigas; "Ver as outras" abre o resto. Clique num cartão para responder do mesmo jeito que com o agente.',
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-primary',
            disabled: !filterRequests(all, kindFilter).some((r) => r.action.type === 'item'),
            onclick: () =>
              startSequence(() => {
                const w = buildWatch(source())
                return w.summaries.flatMap((s) => filterRequests(w.requestsByCode.get(s.code) ?? [], kindFilter))
              }),
          },
          'Responder em sequência',
        ),
      ),
    ]
  }

  // ---------- aba de um squad ----------

  const detail = (src: WatchSource, code: string): HTMLElement[] => {
    const d = squadDetail(src, code)
    if (!d) return [h('div', { class: 'sw-empty' }, 'Esse squad não está mais neste andar.')]
    const s = d.summary
    // O registro vem do log do orquestrador: busca uma vez e redesenha quando chegar.
    if (s.orchestratorId && !state.logs.has(s.orchestratorId)) void state.log(s.orchestratorId).then(() => render())
    const list = filterRequests(d.requests, kindFilter)
    const folder = d.ticket?.worktree ?? project.cwd
    const subtitle = [
      s.orchestratorName,
      s.phase ? `fase: ${s.phase}` : '',
      s.costUsd ? formatCost(s.costUsd) : '',
      s.contextTokens ? `${formatTokens(s.contextTokens)} tokens na conversa` : '',
      s.activeForMs !== undefined ? formatSpan(s.activeForMs) : '',
    ]
      .filter(Boolean)
      .join(' · ')

    const ticketBox = d.ticket
      ? h(
          'div',
          { class: 'sw-box', style: 'flex:none' },
          h('div', { class: 'sw-box-title' }, h('span', { class: 'sw-key' }, d.ticket.key), ` · ${d.ticket.title}`),
          d.ticket.what ? h('div', { class: 'sw-muted', style: 'font-size:12px;margin-top:4px' }, `O que faz: ${d.ticket.what}`) : null,
          s.progress && s.progress.total
            ? h(
                'div',
                { style: 'margin-top:6px' },
                h(
                  'div',
                  { class: 'sw-card-line sw-muted' },
                  h('span', {}, 'Critérios'),
                  h('span', {}, `${s.progress.done} de ${s.progress.total}`),
                ),
                h(
                  'div',
                  {
                    class: 'sw-bar-track',
                    role: 'progressbar',
                    'aria-valuemin': 0,
                    'aria-valuemax': s.progress.total,
                    'aria-valuenow': s.progress.done,
                  },
                  h('div', { class: 'sw-bar-fill', style: `width:${Math.round((s.progress.done / s.progress.total) * 100)}%` }),
                ),
                h('ul', { class: 'sw-crit' }, ...d.ticket.criteria.map((c) => h('li', { class: c.done ? 'done' : '' }, c.text))),
              )
            : null,
          h(
            'div',
            { class: 'sw-mono sw-muted', style: 'margin-top:6px;line-height:1.5;word-break:break-all' },
            [
              d.ticket.branch ?? 'sem branch',
              d.ticket.worktree ? `worktree ${d.ticket.worktree}` : '',
              d.ticket.prUrl ? `PR ${d.ticket.prUrl}` : 'PR: ainda não aberto',
            ].join(' · '),
          ),
        )
      : h('div', { class: 'sw-box', style: 'flex:none' }, h('div', { class: 'sw-muted' }, 'Sem ticket ativo'))

    const queueBox = h(
      'div',
      { class: 'sw-col', style: 'flex:1' },
      h('div', { class: 'sw-sec' }, h('span', {}, `FILA (${d.queue.length})`)),
      h(
        'div',
        { class: 'sw-queue' },
        ...(d.queue.length
          ? d.queue.map((q) =>
              h(
                'div',
                { class: 'sw-row', title: q.what || undefined },
                h('span', { class: 'sw-key' }, q.key),
                h(
                  'div',
                  { class: 'sw-row-txt' },
                  h('div', { class: 'sw-ellip' }, q.title),
                  q.what ? h('div', { class: 'sw-muted sw-ellip' }, q.what) : null,
                ),
                h('span', { class: 'sw-muted' }, `${q.criteria} crit.`),
              ),
            )
          : [h('div', { class: 'sw-empty' }, 'Fila vazia.')]),
      ),
    )

    const log = activityLog(src, code, logFilter)
    const logBox = h(
      'div',
      { class: 'sw-logbox', tabindex: 0, role: 'log', 'aria-label': 'O que o squad fez, somente leitura' },
      ...(log.length
        ? log.map((e) => h('div', {}, h('span', {}, clock(e.t)), ' ', h('b', {}, e.actor), ` ${e.text}`))
        : [h('div', {}, h('span', {}, 'Nada registrado ainda para este filtro.'))]),
    )

    const memberRow = (m: MemberRow) =>
      h(
        'div',
        { class: 'sw-row' },
        dot(m.state),
        h(
          'div',
          { class: 'sw-row-txt' },
          h('div', { class: 'sw-ellip' }, h('b', {}, m.name), ' ', h('span', { class: 'sw-muted' }, m.roleLabel)),
          h(
            'div',
            { class: 'sw-mono sw-muted sw-ellip', title: m.activity || undefined },
            [
              modelLabel(m.model),
              m.effort ?? '',
              m.account ? `conta ${state.account(m.account)?.name ?? m.account}` : '',
              MEMBER_STATE[m.state],
              m.activity,
            ]
              .filter(Boolean)
              .join(' · '),
          ),
        ),
        m.canDelete
          ? h('button', { type: 'button', class: 'btn', 'aria-label': `Excluir ${m.name}`, onclick: () => void deleteAgent(m) }, 'Excluir')
          : null,
      )

    return [
      h(
        'div',
        { class: 'sw-head' },
        h(
          'div',
          {},
          h('div', { class: 'sw-title' }, s.name, stateTag(s.state)),
          h('div', { class: 'sw-sub' }, subtitle || 'Sem orquestrador em execução'),
          s.alerts.length ? h('div', { class: 'sw-sub' }, s.alerts.join(' · ')) : null,
        ),
        h(
          'div',
          { class: 'sw-actions' },
          pauseButton(s, true),
          h(
            'button',
            { type: 'button', class: 'btn', onclick: () => void window.office.revealPath(folder) },
            icon('folder', 15),
            'Abrir pasta',
          ),
        ),
      ),
      h(
        'div',
        { class: 'sw-top' },
        h(
          'div',
          { class: 'sw-col' },
          h(
            'div',
            { class: 'sw-sec' },
            h('span', {}, `SOLICITAÇÕES DOS AGENTES (${d.requests.length})`),
            h('span', {}, 'mais antigas primeiro'),
          ),
          kindChips(d.requests),
          h(
            'div',
            { class: 'sw-list', 'data-scroll': 'requests' },
            ...(list.length
              ? list.map((r) => requestCard(r))
              : [
                  h(
                    'div',
                    { class: 'sw-empty' },
                    d.requests.length ? 'Nenhuma solicitação deste tipo.' : 'Nada esperando você neste squad.',
                  ),
                ]),
          ),
        ),
        h('div', { class: 'sw-col', style: 'gap:10px' }, h('div', { class: 'sw-sec' }, h('span', {}, 'TICKET ATIVO')), ticketBox, queueBox),
      ),
      h(
        'div',
        { class: 'sw-bar' },
        h(
          'span',
          {},
          `Mostrando ${list.length} de ${d.requests.length}. Role a lista ou filtre por tipo. Ao responder uma, a próxima sobe sozinha.`,
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-primary',
            disabled: !list.some((r) => r.action.type === 'item'),
            onclick: () => startSequence(() => filterRequests(squadDetail(source(), code)?.requests ?? [], kindFilter)),
          },
          'Responder em sequência',
        ),
      ),
      h(
        'div',
        { class: 'sw-bottom' },
        h(
          'div',
          { class: 'sw-col' },
          h(
            'div',
            { class: 'sw-sec' },
            h('span', {}, 'O QUE O SQUAD FEZ · SOMENTE LEITURA'),
            h(
              'span',
              { role: 'group', 'aria-label': 'Filtrar o registro', style: 'display:flex;gap:6px' },
              ...LOG_FILTERS.map((f) =>
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'sw-chipf',
                    style: 'min-height:28px;padding:0 6px;font-size:12px',
                    'aria-pressed': String(logFilter === f.value),
                    onclick: () => {
                      logFilter = f.value
                      render()
                    },
                  },
                  f.label,
                ),
              ),
            ),
          ),
          logBox,
        ),
        h(
          'div',
          { class: 'sw-col' },
          h('div', { class: 'sw-sec' }, h('span', {}, `ORQUESTRADOR E MEMBROS (${d.members.length})`)),
          h(
            'div',
            { class: 'sw-members' },
            ...(d.members.length ? d.members.map(memberRow) : [h('div', { class: 'sw-empty' }, 'Sem membros definidos.')]),
          ),
          h(
            'div',
            { class: 'sw-mono sw-muted', style: 'margin-top:8px;line-height:1.5' },
            `${s.prCount} PR aguardando · fila ${s.queueLength}`,
          ),
        ),
      ),
    ]
  }

  // ---------- armação ----------

  const select = (key: string) => {
    selected = key
    kindFilter = 'all'
    logFilter = 'all'
    render()
  }

  const render = () => {
    const src = source()
    const watch = buildWatch(src)
    if (selected !== 'overview' && !watch.summaries.some((s) => s.code === selected)) selected = 'overview'
    const nav = h(
      'nav',
      { class: 'sw-nav', 'aria-label': 'Squads' },
      h(
        'button',
        {
          type: 'button',
          class: 'sw-side',
          'data-focus-key': 'overview',
          'aria-current': selected === 'overview' ? 'page' : undefined,
          onclick: () => select('overview'),
        },
        h('b', {}, 'Visão geral'),
        pend(watch.totals.requests),
      ),
      h('div', { class: 'sw-sec', style: 'margin-top:6px' }, 'SQUADS'),
      ...watch.summaries.map((s) =>
        h(
          'button',
          {
            type: 'button',
            class: 'sw-side',
            'data-focus-key': s.code,
            'aria-current': selected === s.code ? 'page' : undefined,
            onclick: () => select(s.code),
          },
          dot(s.state),
          h('span', { class: 'sw-side-name' }, s.name),
          pend(s.requestCount),
        ),
      ),
      h('div', { class: 'sw-note' }, 'O número laranja mostra as solicitações esperando você.'),
    )
    const main = h('div', { class: 'sw-main' }, ...(selected === 'overview' ? overview(src) : detail(src, selected)))
    // A rolagem das listas sobrevive ao redesenho que cada evento ao vivo provoca.
    const scrolls = new Map<string, number>()
    for (const n of content.querySelectorAll<HTMLElement>('[data-scroll]')) scrolls.set(n.dataset.scroll!, n.scrollTop)
    const mainTop = content.querySelector<HTMLElement>('.sw-main')?.scrollTop ?? 0
    keepFocus(content, () => content.replaceChildren(nav, main))
    main.scrollTop = mainTop
    for (const n of content.querySelectorAll<HTMLElement>('[data-scroll]')) n.scrollTop = scrolls.get(n.dataset.scroll!) ?? 0
    advanceSequence()
  }

  // Ao vivo: cada evento do estado redesenha uma vez por quadro.
  const schedule = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(render)
  }
  const off = state.onChange(schedule)
  const offLog = state.onLog((agentId) => {
    const boss = [...state.agents.values()].find((a) => a.id === agentId && a.role === 'orchestrator')
    if (boss) schedule()
  })

  document.body.classList.add('sw-open')
  render()
  root.append(el)
  content.querySelector<HTMLElement>('.sw-side')?.focus()
  return close
}
