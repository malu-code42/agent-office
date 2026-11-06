import { describe, expect, it } from 'vitest'
import type { AgentResult, AgentSummary, LogEntry, PermissionRequest, SquadInfo, SquadQueue, Ticket } from '@shared/types'
import {
  activityLog,
  buildWatch,
  countRequests,
  filterRequests,
  nextRequest,
  overviewGroups,
  squadDetail,
  type WatchSource,
} from '@shared/squad-watch'

const CWD = 'C:/sintetico/loja'
const NOW = 1_000_000
const MIN = 60_000
const look = { skin: '', hair: '', hairStyle: 0, shirt: '', pants: '', shoes: '' }

function agent(id: string, extra: Partial<AgentSummary> = {}): AgentSummary {
  return {
    id,
    name: `Agente ${id}`,
    source: 'office',
    cwd: CWD,
    permissionMode: 'default',
    status: 'idle',
    activity: '',
    desk: 0,
    look,
    costUsd: 0,
    createdAt: 1,
    ...extra,
  }
}

function boss(code: string, extra: Partial<AgentSummary> = {}): AgentSummary {
  return agent(`o-${code}`, { role: 'orchestrator', squad: code, name: `Chefe ${code}`, ...extra })
}

function squad(code: string, extra: Partial<SquadInfo> = {}): SquadInfo {
  return {
    code,
    name: `Squad ${code}`,
    icon: 'x',
    description: '',
    cwd: CWD,
    members: [
      {
        id: 'maya',
        name: 'Maya',
        icon: 'x',
        title: 'Implementadora',
        execution: 'subagent',
        role: 'implementer',
        model: 'opus',
        effort: 'high',
        sector: 'Equipe',
      },
      { id: 'caio', name: 'Caio', icon: 'x', title: 'Revisor', execution: 'subagent', role: 'reviewer', sector: 'Equipe' },
    ],
    steps: [],
    ...extra,
  }
}

function ticket(id: string, extra: Partial<Ticket> = {}): Ticket {
  return {
    id,
    key: id.toUpperCase(),
    title: `Ticket ${id}`,
    type: 'task',
    priority: 'medium',
    status: 'todo',
    description: '',
    acceptance: [],
    tags: [],
    reporter: { kind: 'player', name: 'Você' },
    order: 0,
    createdAt: 1,
    updatedAt: 1,
    comments: [],
    activity: [],
    ...extra,
  }
}

function perm(id: string, agentId: string, createdAt: number, extra: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    id,
    agentId,
    kind: 'tool',
    toolName: 'Bash',
    title: `Pedido ${id}`,
    detail: '',
    input: {},
    canAlwaysAllow: false,
    createdAt,
    ...extra,
  }
}

function result(id: string, agentId: string, createdAt: number, extra: Partial<AgentResult> = {}): AgentResult {
  return { id, agentId, text: `Resultado ${id}`, isError: false, costUsd: 0, durationMs: 0, turns: 0, createdAt, ...extra }
}

function queue(code: string, extra: Partial<SquadQueue> = {}): SquadQueue {
  return { code, cwd: CWD, active: null, queue: [], updatedAt: 1, ...extra }
}

function source(over: {
  squads?: SquadInfo[]
  agents?: AgentSummary[]
  permissions?: PermissionRequest[]
  results?: AgentResult[]
  tickets?: Ticket[]
  queues?: SquadQueue[]
  logs?: Record<string, LogEntry[]>
}): WatchSource {
  return {
    now: NOW,
    cwd: CWD,
    squads: over.squads ?? [],
    agents: new Map((over.agents ?? []).map((a) => [a.id, a])),
    permissions: new Map((over.permissions ?? []).map((p) => [p.id, p])),
    results: new Map((over.results ?? []).map((r) => [r.id, r])),
    tickets: new Map((over.tickets ?? []).map((t) => [t.id, t])),
    queues: over.queues ?? [],
    logs: new Map(Object.entries(over.logs ?? {})),
  }
}

describe('estado do squad', () => {
  const state = (src: WatchSource, code = 'a') => buildWatch(src).summaries.find((s) => s.code === code)!.state

  it('sem orquestrador nem ticket o squad está ocioso', () => {
    expect(state(source({ squads: [squad('a')] }))).toBe('idle')
  })
  it('orquestrador trabalhando ou esperando a usuária = rodando', () => {
    expect(state(source({ squads: [squad('a')], agents: [boss('a', { status: 'working' })] }))).toBe('running')
    expect(state(source({ squads: [squad('a')], agents: [boss('a', { status: 'waiting' })] }))).toBe('running')
  })
  it('pausado e desativado vêm do estado guardado', () => {
    expect(state(source({ squads: [squad('a', { state: 'paused' })], agents: [boss('a', { status: 'working' })] }))).toBe('paused')
    expect(state(source({ squads: [squad('a', { state: 'disabled' })] }))).toBe('stopped')
  })
  it('processo parado = parado', () => {
    expect(state(source({ squads: [squad('a')], agents: [boss('a', { status: 'stopped' })] }))).toBe('stopped')
  })
  it('erro do orquestrador, de início ou de publicação = com erro', () => {
    expect(state(source({ squads: [squad('a')], agents: [boss('a', { status: 'error' })] }))).toBe('error')
    const cycle = (extra: object) => ({
      ticketId: 't1',
      worktree: { path: 'w', root: 'w', repo: 'r', branch: 'b', base: 'x' },
      ...extra,
    })
    expect(state(source({ squads: [squad('a')], queues: [queue('a', { active: 't1', cycle: cycle({ startupError: 'falhou' }) })] }))).toBe(
      'error',
    )
    expect(
      state(source({ squads: [squad('a')], queues: [queue('a', { active: 't1', cycle: cycle({ publicationError: 'falhou' }) })] })),
    ).toBe('error')
  })
  it('ignora squads de outro andar', () => {
    const src = source({ squads: [squad('a'), squad('z', { cwd: 'C:/outro' })] })
    expect(buildWatch(src).summaries.map((s) => s.code)).toEqual(['a'])
  })
})

describe('solicitações', () => {
  const base = () =>
    source({
      squads: [squad('a'), squad('b'), squad('livre')],
      agents: [boss('a', { status: 'waiting' }), boss('b', { status: 'waiting' })],
      tickets: [ticket('t1'), ticket('t2')],
      permissions: [
        perm('p3', 'o-a', 30),
        perm('p1', 'o-a', 10, {
          kind: 'question',
          questions: [{ question: 'Posso trocar a biblioteca?', header: '', multiSelect: false, options: [] }],
        }),
        perm('p9', 'o-b', 20, { kind: 'plan', title: 'Plano de ajuste' }),
        perm('px', 'ninguem', 5),
      ],
      results: [result('r1', 'o-a', 15), result('r2', 'o-b', 25, { isError: true, text: 'Deu ruim' })],
      queues: [
        queue('a', {
          active: 't1',
          pendingPRs: [{ ticketId: 't2', ticketKey: 'T2', title: 'Ajuste', url: 'https://exemplo.test/pr/1', branch: 'b', createdAt: 12 }],
        }),
      ],
    })

  it('ordena das mais antigas para as mais novas e separa por squad', () => {
    const w = buildWatch(base())
    expect(w.requestsByCode.get('a')!.map((r) => r.createdAt)).toEqual([10, 12, 15, 30])
    expect(w.requestsByCode.get('b')!.map((r) => r.createdAt)).toEqual([20, 25])
    expect(w.requestsByCode.get('livre')).toEqual([])
  })
  it('classifica pergunta, permissão, plano, resultado, erro e PR; a ação reaproveita o item do agente', () => {
    const list = buildWatch(base()).requestsByCode
    const a = list.get('a')!
    expect(a[0]).toMatchObject({
      kind: 'question',
      title: 'Posso trocar a biblioteca?',
      action: { type: 'item', agentId: 'o-a', itemId: 'p1' },
    })
    expect(a[1]).toMatchObject({ kind: 'pr', action: { type: 'pr', url: 'https://exemplo.test/pr/1' } })
    expect(a[2]).toMatchObject({ kind: 'result', action: { type: 'item', agentId: 'o-a', itemId: 'r1' } })
    expect(a[3]).toMatchObject({ kind: 'permission', title: 'Pedido p3' })
    const b = list.get('b')!
    expect(b[0].kind).toBe('permission')
    expect(b[1]).toMatchObject({ kind: 'error', action: { type: 'item', itemId: 'r2' } })
  })
  it('erro de início e de publicação viram cartões de recuperação', () => {
    const cycle = (extra: object) => ({
      ticketId: 't1',
      worktree: { path: 'w', root: 'W:/raiz', repo: 'r', branch: 'b', base: 'x' },
      ...extra,
    })
    const src = source({
      squads: [squad('a'), squad('b')],
      agents: [boss('a'), boss('b')],
      tickets: [ticket('t1')],
      queues: [
        queue('a', { active: 't1', updatedAt: 40, cycle: cycle({ startupError: 'sem git' }) }),
        queue('b', { active: 't1', updatedAt: 50, cycle: cycle({ publicationError: 'sem rede' }) }),
      ],
    })
    const w = buildWatch(src).requestsByCode
    expect(w.get('a')![0]).toMatchObject({
      kind: 'error',
      createdAt: 40,
      action: { type: 'recovery', code: 'a', problem: 'start', message: 'sem git', folder: 'W:/raiz' },
    })
    expect(w.get('b')![0].action).toMatchObject({ type: 'recovery', code: 'b', problem: 'publication', message: 'sem rede' })
  })
  it('a solicitação resolvida some', () => {
    const src = base()
    src.permissions = new Map([...src.permissions].filter(([id]) => id !== 'p1'))
    src.results = new Map([...src.results].filter(([id]) => id !== 'r1'))
    expect(
      buildWatch(src)
        .requestsByCode.get('a')!
        .map((r) => r.createdAt),
    ).toEqual([12, 30])
  })
  it('conta por tipo e filtra', () => {
    const a = buildWatch(base()).requestsByCode.get('a')!
    expect(countRequests(a)).toEqual({ all: 4, question: 1, permission: 1, result: 1, pr: 1, error: 0 })
    expect(filterRequests(a, 'all')).toHaveLength(4)
    expect(filterRequests(a, 'pr').map((r) => r.kind)).toEqual(['pr'])
    expect(filterRequests(a, 'error')).toEqual([])
  })
  it('o total e os contadores por squad batem', () => {
    const w = buildWatch(base())
    expect(w.summaries.map((s) => [s.code, s.requestCount])).toEqual([
      ['a', 4],
      ['b', 2],
      ['livre', 0],
    ])
    expect(w.totals.requests).toBe(6)
    expect(w.totals.prs).toBe(1)
  })
  it('"responder em sequência" vai à mais antiga e depois à seguinte', () => {
    const a = buildWatch(base()).requestsByCode.get('a')!
    expect(nextRequest(a)!.createdAt).toBe(10)
    expect(nextRequest(a, a[0].id)!.createdAt).toBe(12)
    expect(nextRequest(a, a[3].id)).toBeUndefined()
    expect(nextRequest([])).toBeUndefined()
  })
})

describe('visão geral agrupada', () => {
  const many = () => {
    const perms = Array.from({ length: 6 }, (_, i) => perm(`m${i}`, 'o-a', 100 + i))
    return buildWatch(
      source({
        squads: [squad('a'), squad('b'), squad('c')],
        agents: [boss('a'), boss('b')],
        permissions: [...perms, perm('q', 'o-b', 50)],
      }),
    )
  }
  it('mostra as 3 mais antigas de cada squad e diz quantas ficam escondidas', () => {
    const w = many()
    const groups = overviewGroups(w, 'all', new Set())
    expect(groups.map((g) => [g.code, g.total, g.shown.length, g.hidden])).toEqual([
      ['a', 6, 3, 3],
      ['b', 1, 1, 0],
    ])
    expect(groups[0].shown.map((r) => r.createdAt)).toEqual([100, 101, 102])
  })
  it('"Ver as outras" abre o grupo inteiro; squad sem solicitações não aparece', () => {
    const groups = overviewGroups(many(), 'all', new Set(['a']))
    expect(groups[0].shown).toHaveLength(6)
    expect(groups[0].hidden).toBe(0)
    expect(groups.some((g) => g.code === 'c')).toBe(false)
  })
  it('o filtro por tipo vale para os grupos', () => {
    const w = buildWatch(
      source({
        squads: [squad('a')],
        agents: [boss('a')],
        permissions: [perm('p', 'o-a', 1)],
        results: [result('r', 'o-a', 2)],
      }),
    )
    expect(overviewGroups(w, 'result', new Set()).map((g) => g.shown.map((r) => r.kind))).toEqual([['result']])
    expect(overviewGroups(w, 'error', new Set())).toEqual([])
  })
})

describe('resumo do squad', () => {
  it('traz ticket ativo, progresso, fila, PRs, custo e tempo', () => {
    const t1 = ticket('t1', {
      description: '# Título\n\nTroca a busca por texto por uma busca com filtros.\nMais detalhes.',
      acceptance: [
        { text: 'a', done: true },
        { text: 'b', done: false },
        { text: 'c', done: false },
        { text: 'd', done: true },
      ],
      activity: [{ id: 'x', t: NOW - 72 * MIN, actor: { kind: 'agent', name: 'Maya' }, text: 'começou' }],
      pullRequestUrl: 'https://exemplo.test/pr/9',
    })
    const src = source({
      squads: [squad('a')],
      agents: [boss('a', { status: 'working', spentUsd: 4.2, costUsd: 1, context: { used: 120_000, max: 200_000, percent: 60 } })],
      tickets: [t1, ticket('t2', { acceptance: [{ text: 'a', done: false }] }), ticket('t3')],
      queues: [
        queue('a', {
          active: 't1',
          queue: ['t2', 't3', 'sumiu'],
          cycle: { ticketId: 't1', worktree: { path: 'w/p', root: 'w', repo: 'r', branch: 'agent/ao-12', base: 'b' } },
        }),
      ],
    })
    const s = buildWatch(src).summaries[0]
    expect(s).toMatchObject({
      state: 'running',
      costUsd: 4.2,
      contextTokens: 120_000,
      activeTicket: { key: 'T1', title: 'Ticket t1' },
      progress: { done: 2, total: 4 },
      queueLength: 3,
      activeForMs: 72 * MIN,
    })
    const d = squadDetail(src, 'a')!
    expect(d.ticket).toMatchObject({
      what: 'Troca a busca por texto por uma busca com filtros.',
      branch: 'agent/ao-12',
      worktree: 'w',
      prUrl: 'https://exemplo.test/pr/9',
    })
    expect(d.queue.map((q) => [q.key, q.criteria])).toEqual([
      ['T2', 1],
      ['T3', 0],
      ['?', 0],
    ])
  })
  it('sem ticket ativo, sem custo e sem tempo', () => {
    const s = buildWatch(source({ squads: [squad('a')] })).summaries[0]
    expect(s.activeTicket).toBeNull()
    expect(s.progress).toBeNull()
    expect(s.costUsd).toBe(0)
    expect(s.activeForMs).toBeUndefined()
  })
  it('alertas: erro e solicitações esperando', () => {
    const src = source({
      squads: [squad('a')],
      agents: [boss('a', { status: 'error' })],
      permissions: [perm('p', 'o-a', 1)],
    })
    const s = buildWatch(src).summaries[0]
    expect(s.alerts.join(' ')).toMatch(/erro/i)
    expect(s.alerts.join(' ')).toMatch(/1 solicitação/)
  })
})

describe('orquestrador e membros', () => {
  it('lista o orquestrador e cada membro com papel, modelo, esforço e atividade', () => {
    const src = source({
      squads: [squad('a')],
      agents: [
        boss('a', {
          status: 'working',
          model: 'sonnet',
          effort: 'medium',
          account: 'conta1',
          activity: 'Editando app.ts',
          subagents: [
            { id: 's1', description: 'Escrevendo testes', member: 'maya', startedAt: 1, background: false, activity: 'Editando busca.ts' },
          ],
          subagentsDone: [
            { id: 's0', description: 'Revisão', member: 'caio', startedAt: 1, background: false, status: 'failed', error: 'estourou' },
          ],
        }),
      ],
    })
    const d = squadDetail(src, 'a')!
    expect(d.members[0]).toMatchObject({
      orchestrator: true,
      name: 'Chefe a',
      model: 'sonnet',
      effort: 'medium',
      account: 'conta1',
      state: 'working',
      activity: 'Editando app.ts',
      agentId: 'o-a',
    })
    expect(d.members[1]).toMatchObject({
      id: 'maya',
      name: 'Maya',
      roleLabel: 'Implementadora',
      model: 'opus',
      effort: 'high',
      state: 'working',
      activity: 'Editando busca.ts',
    })
    expect(d.members[2]).toMatchObject({ id: 'caio', state: 'error', model: 'sonnet', activity: 'estourou' })
  })
  it('só o orquestrador parado pode ser excluído; membro de squad.yaml não tem agente próprio', () => {
    const idle = squadDetail(source({ squads: [squad('a')], agents: [boss('a', { status: 'idle' })] }), 'a')!
    expect(idle.members.map((m) => m.canDelete)).toEqual([true, false, false])
    const busy = squadDetail(source({ squads: [squad('a')], agents: [boss('a', { status: 'working' })] }), 'a')!
    expect(busy.members[0].canDelete).toBe(false)
  })
  it('squad sem orquestrador ainda mostra os membros, ociosos', () => {
    const d = squadDetail(source({ squads: [squad('a')] }), 'a')!
    expect(d.members.map((m) => m.state)).toEqual(['idle', 'idle'])
  })
  it('código desconhecido não tem detalhe', () => {
    expect(squadDetail(source({ squads: [squad('a')] }), 'zzz')).toBeUndefined()
  })
})

describe('registro somente leitura', () => {
  const src = () =>
    source({
      squads: [squad('a')],
      agents: [boss('a')],
      tickets: [
        ticket('t1', {
          activity: [
            { id: 'ta1', t: 100, actor: { kind: 'agent', name: 'Maya' }, text: 'concluiu o critério 3' },
            { id: 'ta2', t: 300, actor: { kind: 'player', name: 'Você' }, text: 'moveu para Fazendo' },
          ],
        }),
        ticket('alheio', { activity: [{ id: 'tx', t: 999, actor: { kind: 'agent', name: 'X' }, text: 'de outro squad' }] }),
      ],
      queues: [
        queue('a', {
          active: 't1',
          pendingPRs: [{ ticketId: 't1', ticketKey: 'T1', title: 'Ajuste', url: 'https://exemplo.test/pr/1', branch: 'b', createdAt: 250 }],
        }),
      ],
      logs: {
        'o-a': [
          { id: 'l1', t: 200, kind: 'user', text: 'Siga com a correção' },
          { id: 'l2', t: 220, kind: 'assistant', text: 'muito ruído' },
          { id: 'l3', t: 260, kind: 'result', text: 'Entreguei o AO-11' },
          { id: 'l4', t: 280, kind: 'error', text: 'Falhou ao rodar', isError: true },
        ],
      },
    })

  it('junta tickets, agentes e PRs em ordem de hora, do mais novo ao mais antigo, sem o ruído', () => {
    const log = activityLog(src(), 'a', 'all')
    expect(log.map((e) => e.t)).toEqual([300, 280, 260, 250, 200, 100])
    expect(log.some((e) => e.text.includes('ruído') || e.text.includes('outro squad'))).toBe(false)
  })
  it('filtra por tickets, agentes e erros', () => {
    expect(activityLog(src(), 'a', 'tickets').map((e) => e.t)).toEqual([300, 250, 100])
    expect(activityLog(src(), 'a', 'agents').map((e) => e.t)).toEqual([260, 200])
    expect(activityLog(src(), 'a', 'errors').map((e) => e.t)).toEqual([280])
  })
  it('as respostas da usuária aparecem como "você"', () => {
    const e = activityLog(src(), 'a', 'agents').find((x) => x.t === 200)!
    expect(e.actor).toBe('você')
    expect(e.text).toBe('Siga com a correção')
  })
  it('limita o tamanho do texto e a quantidade', () => {
    const s = source({
      squads: [squad('a')],
      agents: [boss('a')],
      logs: { 'o-a': Array.from({ length: 80 }, (_, i) => ({ id: `l${i}`, t: i, kind: 'result' as const, text: 'x'.repeat(500) })) },
    })
    const log = activityLog(s, 'a', 'all')
    expect(log).toHaveLength(40)
    expect(log[0].text.length).toBeLessThanOrEqual(161)
  })
  it('sem log carregado o registro vem só dos tickets', () => {
    const s = src()
    s.logs = new Map()
    expect(activityLog(s, 'a', 'agents').map((e) => e.t)).toEqual([])
    expect(activityLog(s, 'a', 'all').map((e) => e.t)).toEqual([300, 250, 100])
  })
})
