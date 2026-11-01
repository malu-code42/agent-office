import { describe, expect, it, vi } from 'vitest'
import type { AgentResult, AgentSummary, ProjectFloor, ResultChanges, SquadInfo, Ticket } from '@shared/types'
import {
  footerActions,
  isTicketResult,
  readableResults,
  readerActions,
  readerView,
  startsReply,
  stepResult,
  type ReaderSource,
} from '../src/renderer/src/ui/result-reader-model'

const look = { skin: '', hair: '', hairStyle: 0, shirt: '', pants: '', shoes: '' }

function agent(id: string, extra: Partial<AgentSummary> = {}): AgentSummary {
  return {
    id,
    name: `Agente ${id}`,
    source: 'office',
    cwd: 'C:/sintetico',
    permissionMode: 'default',
    status: 'done',
    activity: '',
    desk: 0,
    look,
    costUsd: 0,
    createdAt: 1,
    ...extra,
  }
}

function result(id: string, agentId: string, extra: Partial<AgentResult> = {}): AgentResult {
  return { id, agentId, text: 'Feito.', isError: false, costUsd: 0, durationMs: 0, turns: 0, createdAt: 1, ...extra }
}

const projects = [{ id: 'p1', name: 'Loja', cwd: 'C:/loja' }] as ProjectFloor[]
const squads = [{ code: 'front', name: 'Squad Front' }] as SquadInfo[]
const tickets = new Map([['t1', { id: 't1', key: 'AO-12', title: 'Corrigir o login' } as Ticket]])

function changes(extra: Partial<ResultChanges> = {}): ResultChanges {
  return {
    git: true,
    root: 'C:/loja',
    files: [{ path: 'src/a.ts', status: 'modified', added: 3, removed: 1 }],
    ...extra,
  }
}

describe('tela de leitura: quais resultados ganham "Ler"', () => {
  it('resultado entregue para um ticket do quadro', () => {
    expect(isTicketResult(agent('a'), result('r', 'a', { ticketId: 't1' }), projects)).toBe(true)
  })
  it('agente trabalhando num ticket (delegado ou de squad)', () => {
    expect(isTicketResult(agent('a', { ticketId: 't1' }), result('r', 'a'), projects)).toBe(true)
    expect(isTicketResult(agent('a', { role: 'orchestrator', squad: 'front', ticketId: 't1' }), result('r', 'a'), projects)).toBe(true)
  })
  it('agente de projeto cujo andar existe (vai para a sala de reunião, #57)', () => {
    expect(isTicketResult(agent('a', { project: 'p1' }), result('r', 'a'), projects)).toBe(true)
    expect(isTicketResult(agent('a', { project: 'sumiu' }), result('r', 'a'), projects)).toBe(false)
  })
  it('resultado comum, sem ticket nem projeto, fica só na carta', () => {
    expect(isTicketResult(agent('a'), result('r', 'a'), projects)).toBe(false)
    expect(isTicketResult(undefined, result('r', 'a'), projects)).toBe(false)
    expect(isTicketResult(agent('b', { ticketId: 't1' }), result('r', 'a'), projects)).toBe(false)
  })
})

describe('tela de leitura: dados mostrados', () => {
  it('mostra o ticket, o andar, o squad e os fatos que o resultado tem', () => {
    const a = agent('a', { project: 'p1', squad: 'front', role: 'orchestrator' })
    const r = result('r', 'a', { ticketId: 't1', durationMs: 125_000, turns: 7, costUsd: 0.42, changes: changes({ branch: 'agent/x' }) })
    const v = readerView({ tickets, squads, projects }, a, r)
    expect(v.name).toBe('Agente a')
    expect(v.where).toBe('Loja · Squad Front')
    expect(v.ticket).toEqual({ key: 'AO-12', title: 'Corrigir o login' })
    expect(v.facts).toEqual([
      { label: 'Duração', value: '2min 5s' },
      { label: 'Turnos', value: '7' },
      { label: 'Custo', value: '$0,42' },
      { label: 'Arquivos', value: '1' },
    ])
    expect(v.files?.map((f) => f.path)).toEqual(['src/a.ts'])
    expect(v.branch).toBe('agent/x')
    expect(v.canReply).toBe(true)
  })
  it('não inventa: sem dado, o campo some; sem arquivos, a caixa some', () => {
    const v = readerView({ tickets, squads, projects }, agent('a', { source: 'terminal' }), result('r', 'a', { ticketId: 'outro' }))
    expect(v.where).toBeNull()
    expect(v.ticket).toBeNull()
    expect(v.facts).toEqual([])
    expect(v.files).toBeNull()
    expect(v.canReply).toBe(false)
    expect(readerView({ tickets, squads, projects }, agent('a'), result('r', 'a', { changes: changes({ files: [] }) })).files).toBeNull()
  })
  it('custo sem preço e lista de arquivos cortada', () => {
    const r = result('r', 'a', { costUnknown: true, changes: changes({ truncated: true, total: 40 }) })
    const v = readerView({ tickets, squads, projects }, agent('a'), r)
    expect(v.facts).toContainEqual({ label: 'Custo', value: 's/ preço' })
    expect(v.filesTotal).toBe(40)
  })
})

describe('tela de leitura: ▲▼ entre os pendentes', () => {
  const src: ReaderSource = {
    agents: new Map([
      ['a', agent('a', { project: 'p1' })],
      ['b', agent('b')],
      ['c', agent('c', { ticketId: 't1' })],
    ]),
    results: new Map([
      ['r3', result('r3', 'c', { createdAt: 30 })],
      ['r1', result('r1', 'a', { createdAt: 10 })],
      ['r2', result('r2', 'b', { createdAt: 20 })],
    ]),
    tickets,
    squads,
    projects,
  }
  it('só os resultados de ticket, do mais antigo ao mais novo', () => {
    expect(readableResults(src).map((r) => r.id)).toEqual(['r1', 'r3'])
  })
  it('anda e dá a volta', () => {
    const list = readableResults(src)
    expect(stepResult(list, 'r1', 1)).toBe('r3')
    expect(stepResult(list, 'r3', 1)).toBe('r1')
    expect(stepResult(list, 'r1', -1)).toBe('r3')
  })
  it('sozinho não anda; aberto fora da lista vai para uma ponta', () => {
    expect(stepResult([result('x', 'a')], 'x', 1)).toBeNull()
    expect(stepResult([], 'x', 1)).toBeNull()
    expect(stepResult(readableResults(src), 'sumiu', 1)).toBe('r1')
    expect(stepResult(readableResults(src), 'sumiu', -1)).toBe('r3')
  })
})

describe('tela de leitura: ações do rodapé', () => {
  const handlers = () => ({ ack: vi.fn(), discard: vi.fn(), openPR: vi.fn() })

  it('mesmas regras da carta: Descartar e Abrir PR só com git, arquivos e branch', () => {
    expect(readerActions(agent('a'), result('r', 'a'))).toEqual({ discard: null, pr: null })
    expect(readerActions(agent('a'), result('r', 'a', { changes: changes({ git: false }) }))).toEqual({ discard: null, pr: null })
    expect(readerActions(agent('a'), result('r', 'a', { changes: changes() }))).toEqual({ discard: 'on', pr: null })
    expect(readerActions(agent('a'), result('r', 'a', { changes: changes({ branch: 'b' }) }))).toEqual({ discard: 'on', pr: 'on' })
    // Depois do commit, o PR continua e o descarte desliga, como na carta.
    expect(readerActions(agent('a'), result('r', 'a', { changes: changes({ branch: 'b', committed: 'abc' }) }))).toEqual({
      discard: 'off',
      pr: 'on',
    })
  })
  it('ticket de squad: a fila do squad publica; o rodapé só tem Recebido', () => {
    const sq = agent('a', { role: 'orchestrator', squad: 'front', ticketId: 't1' })
    const acts = footerActions(sq, result('r', 'a', { changes: changes({ branch: 'b' }) }), handlers())
    expect(acts.map((a) => a.id)).toEqual(['ack'])
  })
  it('cada botão chama o handler da carta com o resultado, e nada roda sozinho', () => {
    const h = handlers()
    const r = result('r', 'a', { changes: changes({ branch: 'b' }) })
    const acts = footerActions(agent('a'), r, h)
    expect(acts.map((a) => [a.id, a.label, a.enabled])).toEqual([
      ['discard', 'Descartar', true],
      ['pr', 'Abrir PR', true],
      ['ack', 'Recebido', true],
    ])
    expect(h.ack).not.toHaveBeenCalled()
    expect(h.discard).not.toHaveBeenCalled()
    expect(h.openPR).not.toHaveBeenCalled()
    for (const a of acts) void a.run()
    expect(h.discard).toHaveBeenCalledWith(r)
    expect(h.openPR).toHaveBeenCalledWith(r)
    expect(h.ack).toHaveBeenCalledWith(r)
  })
})

describe('tela de leitura: digitar começa a resposta', () => {
  const k = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; isComposing: boolean }> = {}) => ({
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...mods,
  })
  it('letras e sinais começam; atalhos, espaço e teclas de controle não', () => {
    expect(startsReply(k('o'))).toBe(true)
    expect(startsReply(k('?'))).toBe(true)
    expect(startsReply(k(' '))).toBe(false)
    expect(startsReply(k('Enter'))).toBe(false)
    expect(startsReply(k('ArrowDown'))).toBe(false)
    expect(startsReply(k('c', { ctrlKey: true }))).toBe(false)
    expect(startsReply(k('c', { metaKey: true }))).toBe(false)
    expect(startsReply(k('a', { isComposing: true }))).toBe(false)
  })
})
