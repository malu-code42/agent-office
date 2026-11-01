import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import type { AgentSummary, OfficeEvent } from '../src/shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Economia de tokens (porte do upstream 70ae59f): conversa nova por ticket e por ciclo de squad,
// teto de custo por dia e a marca do último turno (memória fria). Os fixos (Luna, Emi, Bonnie)
// nunca são limpos por conta própria.

const queries: Array<{ prompt: unknown; options: Record<string, unknown> }> = []
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: { prompt: unknown; options: Record<string, unknown> }) => {
    queries.push(args)
    return {
      [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => undefined) }),
      close: () => undefined,
      interrupt: async () => undefined,
    }
  },
}))
vi.mock('../src/main/claude-path', () => ({ findClaude: () => '/bin/false' }))
vi.mock('../src/main/git', () => ({
  createWorktree: async () => null,
  changesSince: async () => null,
  takeSnapshot: async () => null,
}))
const { Store } = await import('../src/main/store')
const { AgentManager } = await import('../src/main/agents')
const { TicketDesk } = await import('../src/main/delegate')
const { TicketBoard } = await import('../src/main/tickets')

const flush = () => new Promise<void>((r) => setTimeout(r, 10))
const LAST = 1_700_000_000_000

/** An office agent that already talked (a saved session), idle, as the office reloads it. */
const saved = (over: Partial<AgentSummary> = {}): AgentSummary =>
  ({
    id: 'ada',
    name: 'Ada',
    source: 'office',
    engine: 'claude',
    cwd: mkdtempSync(join(tmpdir(), 'ao-eco-proj-')),
    permissionMode: 'default',
    status: 'idle',
    activity: '',
    look: { skin: '#e0b48c', hair: '#3a2a20', hairStyle: 0, shirt: '#6f6d8a', pants: '#2c2d40', shoes: '#1a1b2b' },
    costUsd: 1,
    createdAt: 1,
    sessionId: 'old-session',
    context: { used: 300_000, max: 1_000_000, percent: 30 },
    lastTurnAt: LAST,
    ...over,
  }) as AgentSummary

const office = (agents: AgentSummary[], settings: Record<string, unknown> = {}) => {
  const store = new Store()
  store.settings = { ...store.settings, ...settings }
  store.agents = agents.map((summary) => ({ summary, log: [{ id: 'l1', t: LAST, kind: 'assistant' as const, text: 'feito' }] }))
  const m = new AgentManager(store)
  return { store, m }
}

/** A fake cost book: only what the run path and the caps read. */
const book = (spent: number) =>
  ({ spentToday: () => spent, begin: () => undefined, switched: () => undefined, isMarked: () => true }) as never

beforeEach(() => {
  app.setPath('userData', mkdtempSync(join(tmpdir(), 'ao-eco-')))
  queries.length = 0
})

describe('freshStart: conversa nova', () => {
  it('limpa um agente que já conversou: sessão nova, sem contexto nem marca de turno, com a nota no log', () => {
    const { m } = office([saved()])
    expect(m.freshStart('ada', 'Ticket novo (AO-1), conversa nova.')).toBe(true)
    const a = m.agent('ada')!
    expect(a.sessionId).not.toBe('old-session')
    expect(a.context).toBeUndefined()
    expect(a.lastTurnAt).toBeUndefined()
    expect(m.getLog('ada').at(-1)?.text).toBe('Ticket novo (AO-1), conversa nova.')
  })

  it('nunca limpa os fixos, um histórico OpenCode nem uma tarefa pausada pela cota', () => {
    const { m } = office([
      saved({ id: 'op', engine: 'opencode' }),
      saved({ id: 'paused', quotaPaused: { accountId: 'main' } }),
      saved({ id: 'agent-office:luna', name: 'Luna', builtIn: 'luna' }),
    ])
    for (const id of ['op', 'paused', 'agent-office:luna', 'agent-office:bonnie', 'nobody']) expect(m.freshStart(id, 'x'), id).toBe(false)
    expect(m.agent('paused')?.sessionId).toBe('old-session')
    expect(m.agent('agent-office:luna')?.sessionId).toBe('old-session')
  })

  it('não mexe num agente ocupado', async () => {
    const { m } = office([saved()])
    m.sendMessage('ada', 'continue')
    await flush()
    expect(m.isBusy('ada')).toBe(true)
    const session = m.agent('ada')?.sessionId
    expect(m.freshStart('ada', 'x')).toBe(false)
    expect(m.agent('ada')?.sessionId).toBe(session)
  })

  it('a marca do último turno volta do disco; sem ela, vale a última linha do log', () => {
    const { m } = office([saved(), saved({ id: 'old', lastTurnAt: undefined })])
    expect(m.agent('ada')?.lastTurnAt).toBe(LAST)
    expect(m.agent('old')?.lastTurnAt).toBe(LAST)
  })
})

describe('ciclo de squad: conversa nova', () => {
  const squad = (cwd: string) => ({ code: 'sq', name: 'Squad', cwd }) as never
  const orchestrator = (cwd: string) => saved({ id: 'orq', name: 'Squad', role: 'orchestrator', squad: 'sq', cwd })

  it('com a chave ligada (padrão), o orquestrador começa o ciclo numa sessão nova', () => {
    const o = orchestrator(mkdtempSync(join(tmpdir(), 'ao-eco-sq-')))
    const { m } = office([o])
    m.runSquad(squad(o.cwd), 'rode o ciclo', 'Ciclo', { permissionMode: 'default' })
    expect(m.agent('orq')?.sessionId).not.toBe('old-session')
    expect(m.getLog('orq').some((e) => e.text.startsWith('Ciclo novo, conversa nova'))).toBe(true)
  })

  it('com a chave desligada, continua a conversa anterior', () => {
    const o = orchestrator(mkdtempSync(join(tmpdir(), 'ao-eco-sq-')))
    const { m } = office([o], { freshSquadCycle: false })
    m.runSquad(squad(o.cwd), 'rode o ciclo', 'Ciclo', { permissionMode: 'default' })
    expect(m.agent('orq')?.sessionId).toBe('old-session')
  })
})

describe('teto de custo por dia', () => {
  it('chegou ao teto: entrega o aviso em vez de rodar, para qualquer agente', async () => {
    const { m } = office([saved()], { dailyBudgetUsd: 5 })
    m.book = book(5)
    const events: OfficeEvent[] = []
    m.on('event', (e: OfficeEvent) => events.push(e))
    m.sendMessage('ada', 'continue')
    await flush()
    expect(queries).toHaveLength(0)
    const result = events.find((e) => e.type === 'result:new')
    expect(result && 'result' in result && result.result.text).toMatch(/teto de custo do dia \(\$5\.00\)/)
  })

  it('abaixo do teto: a consulta leva só o que sobra do dia como orçamento', async () => {
    const { m } = office([saved()], { dailyBudgetUsd: 5, agentBudgetUsd: 0 })
    m.book = book(3)
    m.sendMessage('ada', 'continue')
    await flush()
    expect(queries).toHaveLength(1)
    expect(queries[0].options.maxBudgetUsd).toBeCloseTo(2)
  })

  it('sem teto (0), nenhum orçamento vai para a consulta', async () => {
    const { m } = office([saved()])
    m.book = book(1_000)
    m.sendMessage('ada', 'continue')
    await flush()
    expect(queries[0].options.maxBudgetUsd).toBeUndefined()
  })
})

describe('ticket delegado a quem já está aqui', () => {
  const desk = (fresh: boolean | undefined) => {
    const dataDir = mkdtempSync(join(tmpdir(), 'ao-eco-tk-'))
    const cwd = mkdtempSync(join(tmpdir(), 'ao-eco-tk-proj-'))
    const board = new TicketBoard(dataDir)
    const ticket = board.create({ title: 'Arrumar o login', cwd }, { kind: 'player', name: 'Malu' })
    const calls: string[] = []
    const a = saved({ cwd })
    const manager = Object.assign(new EventEmitter(), {
      list: () => [a],
      isBusy: () => false,
      setTicketId: () => undefined,
      freshStart: vi.fn((_id: string, note: string) => calls.push(`fresh:${note}`)),
      sendMessage: vi.fn(() => calls.push('send')),
    })
    const settings = { projects: [], defaultPermissionMode: 'default', ...(fresh === undefined ? {} : { freshTicketSession: fresh }) }
    return { d: new TicketDesk(board, manager as never, () => settings as never), ticket, calls, a }
  }

  it('começa conversa nova antes de mandar o ticket (padrão e chave ligada)', async () => {
    for (const fresh of [undefined, true]) {
      const { d, ticket, calls, a } = desk(fresh)
      await d.delegate(ticket.id, { agentId: a.id }, { kind: 'player', name: 'Malu' })
      expect(calls).toEqual([`fresh:Ticket novo (${ticket.key}), conversa nova: o histórico anterior não vai junto.`, 'send'])
    }
  })

  it('com a chave desligada, manda o ticket na conversa que já existe', async () => {
    const { d, ticket, calls, a } = desk(false)
    await d.delegate(ticket.id, { agentId: a.id }, { kind: 'player', name: 'Malu' })
    expect(calls).toEqual(['send'])
  })
})
