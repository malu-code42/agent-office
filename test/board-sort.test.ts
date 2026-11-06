import { describe, expect, it } from 'vitest'
import type { Actor, Ticket } from '@shared/types'
import { DEFAULT_SORT, parseSortMap, resolveSort, sortTickets, withSort, type SortKey } from '../src/renderer/src/ui/board/model'

// AO-77: ordenação das listas do quadro (regras puras, sem DOM).

const me: Actor = { kind: 'player', name: 'Você' }

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
    cwd: 'D:/a',
    reporter: me,
    order: n,
    createdAt: 1,
    updatedAt: 1,
    comments: [],
    ...over,
  } as Ticket
}

const keys = (tickets: Ticket[], sort: SortKey) => sortTickets(tickets, sort).map((t) => t.key)

describe('sortTickets', () => {
  it('manual mantém exatamente a ordem do campo order', () => {
    const list = [ticket(10, { order: 2 }), ticket(9, { order: 3 }), ticket(11, { order: 1 })]
    expect(keys(list, 'manual')).toEqual(['AO-11', 'AO-10', 'AO-9'])
  })

  it('não altera a lista recebida', () => {
    const list = [ticket(2, { order: 2 }), ticket(1, { order: 1 })]
    sortTickets(list, 'key-asc')
    expect(list.map((t) => t.key)).toEqual(['AO-2', 'AO-1'])
  })

  it('número: AO-9 antes de AO-10 nos dois sentidos', () => {
    const list = [ticket(10, { order: 1 }), ticket(9, { order: 2 }), ticket(100, { order: 3 }), ticket(2, { order: 4 })]
    expect(keys(list, 'key-asc')).toEqual(['AO-2', 'AO-9', 'AO-10', 'AO-100'])
    expect(keys(list, 'key-desc')).toEqual(['AO-100', 'AO-10', 'AO-9', 'AO-2'])
  })

  it('etiqueta: agrupa pela primeira etiqueta alfabética e deixa sem etiqueta ao final', () => {
    const list = [
      ticket(1, { order: 1 }),
      ticket(2, { order: 2, tags: ['zeta', 'beta'] }),
      ticket(3, { order: 3, tags: ['alfa'] }),
      ticket(4, { order: 4, tags: ['beta'] }),
      ticket(5, { order: 5 }),
      ticket(6, { order: 6, tags: ['Ágata'] }),
    ]
    expect(keys(list, 'tag')).toEqual(['AO-6', 'AO-3', 'AO-2', 'AO-4', 'AO-1', 'AO-5'])
  })

  it('prioridade: maior primeiro e menor primeiro', () => {
    const list = [
      ticket(1, { order: 1, priority: 'low' }),
      ticket(2, { order: 2, priority: 'critical' }),
      ticket(3, { order: 3, priority: 'medium' }),
      ticket(4, { order: 4, priority: 'high' }),
    ]
    expect(keys(list, 'priority-desc')).toEqual(['AO-2', 'AO-4', 'AO-3', 'AO-1'])
    expect(keys(list, 'priority-asc')).toEqual(['AO-1', 'AO-3', 'AO-4', 'AO-2'])
  })

  it('tipo segue a ordem dos tipos do quadro', () => {
    const list = [ticket(1, { type: 'bug' }), ticket(2, { type: 'task' }), ticket(3, { type: 'feature' })]
    expect(keys(list, 'type')).toEqual(['AO-2', 'AO-3', 'AO-1'])
  })

  it('datas de criação e de atualização, nos dois sentidos', () => {
    const list = [
      ticket(1, { order: 1, createdAt: 30, updatedAt: 10 }),
      ticket(2, { order: 2, createdAt: 10, updatedAt: 30 }),
      ticket(3, { order: 3, createdAt: 20, updatedAt: 20 }),
    ]
    expect(keys(list, 'created-desc')).toEqual(['AO-1', 'AO-3', 'AO-2'])
    expect(keys(list, 'created-asc')).toEqual(['AO-2', 'AO-3', 'AO-1'])
    expect(keys(list, 'updated-desc')).toEqual(['AO-2', 'AO-3', 'AO-1'])
    expect(keys(list, 'updated-asc')).toEqual(['AO-1', 'AO-3', 'AO-2'])
  })

  it('empate mantém a ordem manual', () => {
    const list = [
      ticket(5, { order: 3, priority: 'high' }),
      ticket(6, { order: 1, priority: 'high' }),
      ticket(7, { order: 2, priority: 'high' }),
    ]
    expect(keys(list, 'priority-desc')).toEqual(['AO-6', 'AO-7', 'AO-5'])
    const tagged = [ticket(1, { order: 2, tags: ['a'] }), ticket(2, { order: 1, tags: ['a'] })]
    expect(keys(tagged, 'tag')).toEqual(['AO-2', 'AO-1'])
  })
})

describe('resolveSort', () => {
  it('valor desconhecido volta ao padrão manual', () => {
    expect(DEFAULT_SORT).toBe('manual')
    expect(resolveSort('xyz')).toBe('manual')
    expect(resolveSort(undefined)).toBe('manual')
    expect(resolveSort(42)).toBe('manual')
    expect(resolveSort('key-desc')).toBe('key-desc')
  })
})

describe('persistência da ordenação por andar', () => {
  it('lê o mapa salvo e descarta valores inválidos', () => {
    expect(parseSortMap(JSON.stringify({ '': 'key-asc', a: 'lixo', b: 'tag' }))).toEqual({ '': 'key-asc', b: 'tag' })
  })

  it('JSON quebrado, nulo ou de outro formato vira mapa vazio', () => {
    expect(parseSortMap(null)).toEqual({})
    expect(parseSortMap('{quebrado')).toEqual({})
    expect(parseSortMap('[1,2]')).toEqual({})
    expect(parseSortMap('"texto"')).toEqual({})
  })

  it('withSort troca só o andar pedido e não guarda o padrão', () => {
    const a = withSort({ x: 'tag' }, 'y', 'key-desc')
    expect(a).toEqual({ x: 'tag', y: 'key-desc' })
    expect(withSort(a, 'x', 'manual')).toEqual({ y: 'key-desc' })
    expect(a).toEqual({ x: 'tag', y: 'key-desc' })
  })
})
