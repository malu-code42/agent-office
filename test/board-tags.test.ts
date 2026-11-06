import { describe, expect, it } from 'vitest'
import type { Actor, ProjectFloor, Ticket } from '@shared/types'
import { matchesFilters, resolveTag, tagOptions, ticketsOnFloor, type BoardFilters } from '../src/renderer/src/ui/board/model'

// AO-71: filtro de etiqueta do quadro (regras puras, sem DOM).

const me: Actor = { kind: 'player', name: 'Você' }
const projects: ProjectFloor[] = [
  { id: 'a', name: 'A', cwd: 'D:\\a' },
  { id: 'b', name: 'B', cwd: 'D:\\b' },
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
    cwd: 'D:\\a',
    reporter: me,
    order: n,
    createdAt: 1,
    updatedAt: 1,
    comments: [],
    ...over,
  } as Ticket
}

const none: BoardFilters = { query: '', type: '', priority: '', who: '', tag: '' }
const filter = (tickets: Ticket[], f: Partial<BoardFilters>) =>
  tickets.filter((t) => matchesFilters(t, { ...none, ...f })).map((t) => t.key)

describe('tagOptions', () => {
  it('lista cada etiqueta uma vez, em ordem alfabética', () => {
    const tickets = [ticket(1, { tags: ['squads', 'estudo'] }), ticket(2, { tags: ['emi', 'estudo'] }), ticket(3)]
    expect(tagOptions(tickets)).toEqual(['emi', 'estudo', 'squads'])
  })

  it('ordena acentuadas junto das letras base', () => {
    expect(tagOptions([ticket(1, { tags: ['zeta', 'ágata', 'beta'] })])).toEqual(['ágata', 'beta', 'zeta'])
  })

  it('vem vazia sem tickets ou sem etiquetas', () => {
    expect(tagOptions([])).toEqual([])
    expect(tagOptions([ticket(1)])).toEqual([])
  })

  it('usa só os tickets do andar mostrado', () => {
    const tickets = [ticket(1, { tags: ['x'] }), ticket(2, { cwd: 'D:\\b', tags: ['y'] })]
    expect(tagOptions(ticketsOnFloor(tickets, 'b', projects))).toEqual(['y'])
  })
})

describe('resolveTag', () => {
  it('mantém a etiqueta que ainda existe e a vazia', () => {
    expect(resolveTag('emi', ['emi', 'estudo'])).toBe('emi')
    expect(resolveTag('', ['emi'])).toBe('')
  })

  it('volta para "Todas" quando a etiqueta some (troca de andar ou edição)', () => {
    const tickets = [ticket(1, { tags: ['x'] }), ticket(2, { cwd: 'D:\\b', tags: ['y'] })]
    expect(resolveTag('x', tagOptions(ticketsOnFloor(tickets, 'b', projects)))).toBe('')
    expect(resolveTag('y', tagOptions([ticket(2)]))).toBe('')
  })
})

describe('matchesFilters com etiqueta', () => {
  const tickets = [
    ticket(1, { tags: ['emi'], priority: 'high' }),
    ticket(2, { tags: ['emi', 'estudo'], priority: 'low' }),
    ticket(3, { tags: ['estudo'], priority: 'high' }),
    ticket(4),
  ]

  it('sem etiqueta escolhida mostra todos', () => {
    expect(filter(tickets, {})).toEqual(['AO-1', 'AO-2', 'AO-3', 'AO-4'])
  })

  it('com etiqueta mostra só os tickets que a têm', () => {
    expect(filter(tickets, { tag: 'emi' })).toEqual(['AO-1', 'AO-2'])
  })

  it('combina com a prioridade em E lógico', () => {
    expect(filter(tickets, { tag: 'emi', priority: 'high' })).toEqual(['AO-1'])
  })

  it('combina com a busca de texto e com o responsável', () => {
    const t = [ticket(1, { tags: ['emi'], title: 'Alfa', assignee: me }), ticket(2, { tags: ['emi'], title: 'Beta' })]
    expect(filter(t, { tag: 'emi', query: 'beta' })).toEqual(['AO-2'])
    expect(filter(t, { tag: 'emi', who: 'me' })).toEqual(['AO-1'])
    expect(filter(t, { tag: 'emi', who: 'none' })).toEqual(['AO-2'])
  })

  it('etiqueta inexistente no andar não casa nada (a interface a reseta antes com resolveTag)', () => {
    expect(filter(tickets, { tag: 'fantasma' })).toEqual([])
  })
})
