import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Actor, AgentSummary, ProjectFloor, Ticket, TicketStatus } from '@shared/types'

// The MCP server is the SDK's business: here each tool is just its handler.
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  tool: (name: string, _description: string, _schema: unknown, handler: (args: unknown) => Promise<unknown>) => ({ name, handler }),
  createSdkMcpServer: (options: unknown) => options,
}))

const { TicketBoard } = await import('../src/main/tickets')
const { ALL_FLOORS, GROUND, cardAgent, defaultFloor, elevatorFloorLabel, floorTabs, ticketsOnFloor } = await import('../src/renderer/src/ui/board/model')

const me: Actor = { kind: 'player', name: 'Você' }
const AGENT_OFFICE = 'D:\\Documents\\agent-office'
const LOJA = 'D:\\Documents\\loja'
const projects: ProjectFloor[] = [
  { id: 'agent-office', name: 'Agent Office', cwd: AGENT_OFFICE },
  { id: 'loja', name: 'Loja', cwd: LOJA },
]

function ticket(n: number, over: Partial<Ticket> = {}): Ticket {
  return {
    id: `t${n}`,
    key: `AO-${n}`,
    title: `Ticket ${n}`,
    type: 'task',
    priority: 'medium',
    status: 'todo',
    description: '',
    acceptance: [],
    tags: [],
    cwd: AGENT_OFFICE,
    reporter: me,
    order: n,
    createdAt: 1,
    updatedAt: 1,
    comments: [],
    activity: [],
    ...over,
  }
}

describe('andar ao abrir', () => {
  it('abre em todos os andares, com ou sem andar do jogador', () => {
    expect(defaultFloor(null)).toBe(ALL_FLOORS)
    expect(defaultFloor(projects[0])).toBe(ALL_FLOORS)
  })
})

describe('abas de andar', () => {
  it('são todos os andares, a Casa e um por projeto, nessa ordem', () => {
    expect(floorTabs(projects)).toEqual([
      { value: '', label: 'Todos os andares' },
      { value: GROUND, label: 'Casa' },
      { value: 'agent-office', label: 'Agent Office' },
      { value: 'loja', label: 'Loja' },
    ])
    expect(floorTabs([])).toHaveLength(2)
  })

  it('escolher uma aba só troca o filtro de andar', () => {
    const tickets = [ticket(1), ticket(2, { cwd: LOJA }), ticket(3, { cwd: undefined })]
    const shown = (tab: string) => ticketsOnFloor(tickets, tab, projects).map((t) => t.key)
    expect(shown(ALL_FLOORS)).toEqual(['AO-1', 'AO-2', 'AO-3'])
    expect(shown(GROUND)).toEqual(['AO-3'])
    expect(shown('agent-office')).toEqual(['AO-1'])
    expect(shown('loja')).toEqual(['AO-2'])
  })
})

describe('rótulo dos botões do elevador', () => {
  it('o térreo é a Casa: mostra C, e os andares de cima mostram o número', () => {
    expect(elevatorFloorLabel(0)).toBe('C')
    expect(elevatorFloorLabel(1)).toBe('1')
    expect(elevatorFloorLabel(12)).toBe('12')
  })
})

describe('agente no card', () => {
  const agents = new Map([['ag-1', { id: 'ag-1', name: 'Ada', look: { shirt: '#2f8f83' } } as AgentSummary]])
  const by = (status: TicketStatus, assignee?: Actor) => ticket(1, { status, assignee })

  it('aparece em ticket em andamento com agente, com nome e cor', () => {
    expect(cardAgent(by('doing', { kind: 'agent', name: 'Ada', id: 'ag-1' }), agents)).toEqual({
      name: 'Ada',
      color: '#2f8f83',
      id: 'ag-1',
    })
  })

  it('agente que saiu do escritório: nome de quem foi, sem id para abrir', () => {
    expect(cardAgent(by('doing', { kind: 'agent', name: 'Ada' }), agents)).toEqual({ name: 'Ada', color: null, id: null })
    expect(cardAgent(by('doing', { kind: 'agent', name: 'Bento', id: 'ag-9' }), agents)).toEqual({ name: 'Bento', color: null, id: null })
  })

  it('some sem agente, com pessoa como responsável, e fora de andamento', () => {
    expect(cardAgent(by('doing'), agents)).toBeNull()
    expect(cardAgent(by('doing', me), agents)).toBeNull()
    for (const status of ['backlog', 'todo', 'review', 'done'] as const) {
      expect(cardAgent(by(status, { kind: 'agent', name: 'Ada', id: 'ag-1' }), agents)).toBeNull()
    }
  })

  it('ignora cor fora de #rrggbb (o look vem de fora)', () => {
    const odd = new Map([['ag-1', { id: 'ag-1', name: 'Ada', look: { shirt: 'red;background:url(x)' } } as AgentSummary]])
    expect(cardAgent(by('doing', { kind: 'agent', name: 'Ada', id: 'ag-1' }), odd)?.color).toBeNull()
  })
})

describe('reinício com os 13 tickets', () => {
  it('um quadro novo mostra os 13 no andar padrão', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ao-floors-'))
    const tickets = Array.from({ length: 13 }, (_, i) => ticket(i + 1, { status: i % 2 ? 'doing' : 'todo' }))
    writeFileSync(join(dir, 'tickets.json'), JSON.stringify({ seq: 13, tickets }))

    const board = new TicketBoard(dir)
    expect(board.list()).toHaveLength(13)
    // The player's own floor is a Térreo here: the old default hid every ticket of Agent Office.
    expect(ticketsOnFloor(board.list(), GROUND, projects)).toHaveLength(0)
    expect(ticketsOnFloor(board.list(), defaultFloor(null), projects)).toHaveLength(13)
    expect(ticketsOnFloor(board.list(), defaultFloor(projects[1]), projects)).toHaveLength(13)
  })
})
