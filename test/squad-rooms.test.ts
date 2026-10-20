import { describe, expect, it } from 'vitest'
import { floorRooms, floorSquads, roomCode, roomOfCode, squadInRoom } from '../src/shared/squad-rooms'
import { orderedTickets, pendingTickets } from '../src/shared/squad-tickets'
import { holdsRoom, proposalCloseAction } from '../src/shared/types'
import type { ProjectFloor, SquadInfo, Ticket } from '../src/shared/types'

// The room of a squad and the order of the tickets: the same rule on both sides of
// the app, so the floor and the proposal always agree.

const squad = (code: string, cwd = '/projeto'): SquadInfo => ({
  code,
  name: code,
  icon: '🧩',
  description: '',
  cwd,
  members: [],
  steps: [],
})

const project: ProjectFloor = { id: 'p1', name: 'Loja Aurora', cwd: '/projeto' }

const ticket = (id: string, over: Partial<Ticket> = {}): Ticket => ({
  id,
  key: id.toUpperCase(),
  title: id,
  type: 'task',
  priority: 'medium',
  status: 'todo',
  description: '',
  acceptance: [],
  cwd: '/projeto',
  tags: [],
  reporter: { kind: 'player', name: 'Malu' },
  order: 0,
  createdAt: 0,
  updatedAt: 0,
  comments: [],
  activity: [],
  ...over,
})

describe('o código da sala', () => {
  it('nomeia a pasta pela sala', () => {
    expect(roomCode(0)).toBe('sala-1')
    expect(roomCode(2)).toBe('sala-3')
  })

  it('o código diz em que sala o squad está', () => {
    expect(roomOfCode('sala-1')).toBe(0)
    expect(roomOfCode('sala-3')).toBe(2)
    expect(roomOfCode('sala-3-2')).toBe(2)
    expect(roomOfCode('minha-equipe')).toBeUndefined()
    expect(roomOfCode('sala-9')).toBeUndefined()
  })
})

describe('as salas de um andar', () => {
  it('o squad do office fica na sala que o código nomeia', () => {
    const squads = [squad('sala-3'), squad('sala-1')]
    const { rooms } = floorRooms(squads)
    expect(rooms.get('sala-3')).toBe(2)
    expect(rooms.get('sala-1')).toBe(0)
  })

  it('os squads de fora tomam as salas livres, na ordem', () => {
    const { rooms, without } = floorRooms([squad('alfa'), squad('beta')])
    expect(rooms.get('alfa')).toBe(0)
    expect(rooms.get('beta')).toBe(1)
    expect(without).toEqual([])
  })

  it('uma sala com proposta não fica livre', () => {
    const { rooms, without } = floorRooms([squad('sala-1'), squad('alfa')], [1])
    expect(rooms.get('sala-1')).toBe(0)
    // The squad without a code takes the first free room: the third.
    expect(rooms.get('alfa')).toBe(2)
    expect(without).toEqual([])
  })

  it('quem não tem sala volta como issue, e some do mapa', () => {
    const { rooms, without } = floorRooms([squad('sala-1'), squad('sala-2'), squad('sala-3'), squad('alfa')])
    expect(rooms.size).toBe(3)
    expect(without.map((s) => s.code)).toEqual(['alfa'])
  })

  it('a squad de uma sala é a que o office criou', () => {
    const squads = [squad('sala-2')]
    expect(squadInRoom(squads, 1)?.code).toBe('sala-2')
    expect(squadInRoom(squads, 0)).toBeUndefined()
  })
  it('só os squads da pasta do andar entram na conta', () => {
    const squads = [squad('sala-1', '/outro'), squad('sala-1', '/projeto')]
    expect(floorSquads(squads, '/projeto')).toHaveLength(1)
    expect(floorRooms(floorSquads(squads, '/projeto')).rooms.size).toBe(1)
  })
})

describe('os tickets do quadro', () => {
  it('os pendentes de um andar, na ordem do quadro', () => {
    const tickets = [
      ticket('c', { status: 'backlog', order: 0 }),
      ticket('a', { status: 'todo', order: 1 }),
      ticket('b', { status: 'todo', order: 0 }),
    ]
    expect(pendingTickets(tickets, [project], 'p1').map((t) => t.id)).toEqual(['c', 'b', 'a'])
  })

  it('um ticket com responsável, fechado ou de outro andar não é pendente', () => {
    const tickets = [
      ticket('a', { assignee: { kind: 'agent', name: 'Ada', id: 'x' } }),
      ticket('b', { closedAt: 1 }),
      ticket('c', { cwd: '/outro' }),
      ticket('d', { status: 'doing' }),
    ]
    expect(pendingTickets(tickets, [project], 'p1')).toEqual([])
  })

  it('os escolhidos voltam na ordem do quadro, mesmo com responsável', () => {
    const tickets = [
      ticket('c', { status: 'backlog', order: 0 }),
      ticket('a', { status: 'todo', order: 1, assignee: { kind: 'agent', name: 'Ada', id: 'x' } }),
    ]
    expect(orderedTickets(tickets, [project], 'p1', ['a', 'c']).map((t) => t.id)).toEqual(['c', 'a'])
  })
})

describe('o que o fechamento da janela faz com a proposta', () => {
  const base = { discard: false, hasProposal: true, step: 'proposal' as const, assigned: false }

  it('fechar a janela mantém a proposta pendente', () => {
    expect(proposalCloseAction(base)).toBe('keep')
  })

  it('cancelar de verdade joga a proposta fora', () => {
    expect(proposalCloseAction({ ...base, discard: true })).toBe('discard')
  })

  it('a primeira composição ainda em andamento leva o id junto', () => {
    // Ainda não há proposta na tela: o id que a página escolheu vai embora com ela.
    expect(proposalCloseAction({ ...base, hasProposal: false, step: 'loading' })).toBe('discard-id')
    expect(proposalCloseAction({ ...base, hasProposal: false, step: 'brief' })).toBe('none')
  })

  it('fechar a janela durante um ajuste mantém a proposta', () => {
    // A proposta já existe (com a composição): ela fica, e a sala continua âmbar.
    expect(proposalCloseAction({ ...base, step: 'loading' })).toBe('discard')
    expect(proposalCloseAction({ ...base, step: 'error' })).toBe('discard')
    expect(proposalCloseAction(base)).toBe('keep')
  })

  it('depois que o squad foi criado, não há mais nada a guardar', () => {
    expect(proposalCloseAction({ ...base, assigned: true })).toBe('none')
    expect(proposalCloseAction({ ...base, assigned: true, discard: true })).toBe('none')
  })
})

describe('a sala que a proposta segura', () => {
  const proposal = (over: Partial<Parameters<typeof holdsRoom>[0]> = {}) => ({
    id: 'p1',
    projectId: 'proj',
    cwd: '/projeto',
    room: 0,
    createdAt: 1,
    updatedAt: 1,
    brief: 'Refazer a busca',
    ticketIds: [],
    adjustments: [],
    name: 'Squad da Sala 1',
    composition: { name: 'Squad da Sala 1', members: [] },
    status: 'pending' as const,
    ...over,
  })

  it('uma proposta com composição segura a sala, mesmo durante o ajuste', () => {
    expect(holdsRoom(proposal())).toBe(true)
    expect(holdsRoom(proposal({ status: 'generating' }))).toBe(true)
  })

  it('sem composição, a sala ainda não é segurada', () => {
    expect(holdsRoom(proposal({ composition: null, status: 'generating' }))).toBe(false)
  })

  it('um squad já criado não segura a sala', () => {
    expect(holdsRoom(proposal({ status: 'assigned' }))).toBe(false)
  })
})
