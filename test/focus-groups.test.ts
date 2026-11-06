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

  it('tirar do foco: o grupo some quando a última tarefa dele sai', () => {
    const before = focusItems(lists, ['tdddddd', 'tbbbbbb'])
    expect(groupFocusItems(lists, before).map((g) => g.name)).toEqual(['Casa', 'Estudo'])
    const after = focusItems(lists, ['tbbbbbb'])
    expect(groupFocusItems(lists, after)).toEqual([{ name: 'Casa', items: [after[0]] }])
  })

  it('concluir: a tarefa sai da lista e do foco, e o grupo dela some', () => {
    const open = parseTasksFile('## Casa\n- [ ] Um ^taaaaaa\n- [ ] Dois ^tbbbbbb\n## Estudo\n- [ ] Ler ^tdddddd\n').lists
    const items = focusItems(open, ['taaaaaa', 'tdddddd'])
    expect(groupFocusItems(open, items).map((g) => g.name)).toEqual(['Casa', 'Estudo'])
    // completed: the line leaves tarefas.md and the id leaves the focus
    const done = parseTasksFile('## Casa\n- [ ] Um ^taaaaaa\n- [ ] Dois ^tbbbbbb\n').lists
    const left = focusItems(done, ['taaaaaa'])
    expect(groupFocusItems(done, left)).toEqual([{ name: 'Casa', items: [left[0]] }])
    expect(groupFocusItems(done, focusItems(done, []))).toEqual([])
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
