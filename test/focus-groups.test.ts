import { describe, expect, it } from 'vitest'
import { groupFocusItems, focusItems } from '../src/shared/planning'
import { parseTasksFile } from '../src/shared/tasks'

describe('groupFocusItems', () => {
  const lists = parseTasksFile(
    '## Casa\n- [ ] Um ^taaaaaa\n- [ ] Dois ^tbbbbbb\n## Vazia\n- [ ] Outro ^tcccccc\n## Estudo\n- [ ] Ler ^tdddddd\n',
  ).lists

  it('uses board order for lists and focus order within each list', () => {
    const items = focusItems(lists, ['tdddddd', 'tbbbbbb', 'taaaaaa'])
    expect(groupFocusItems(lists, items)).toEqual([
      { name: 'Casa', items: [items[1], items[2]] },
      { name: 'Estudo', items: [items[0]] },
    ])
  })

  it('returns no groups when focus is empty', () => {
    expect(groupFocusItems(lists, [])).toEqual([])
  })

  it('keeps missing or stale items accessible without inventing a list', () => {
    const items = focusItems(lists, ['taaaaaa', 'tzzzzzz'])
    expect(groupFocusItems([], items)).toEqual([{ name: null, items }])
    expect(groupFocusItems(lists, items)).toEqual([
      { name: 'Casa', items: [items[0]] },
      { name: null, items: [items[1]] },
    ])
  })
})
