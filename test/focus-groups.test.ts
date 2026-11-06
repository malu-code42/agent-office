import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PlanningStore } from '../src/main/planning'
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

  it('concluir: a tarefa sai do foco pela ação real (archive) e o grupo dela some', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ao-focus-groups-'))
    try {
      const store = new PlanningStore(dir)
      const open = parseTasksFile('## Casa\n- [ ] Um ^taaaaaa\n- [ ] Dois ^tbbbbbb\n## Estudo\n- [ ] Ler ^tdddddd\n').lists
      store.add('taaaaaa')
      store.add('tdddddd')
      expect(groupFocusItems(open, focusItems(open, store.focus())).map((g) => g.name)).toEqual(['Casa', 'Estudo'])
      // Concluir: the line leaves tarefas.md, and planning archives it, which drops the id from the focus
      const done = parseTasksFile('## Casa\n- [ ] Um ^taaaaaa\n- [ ] Dois ^tbbbbbb\n').lists
      store.archive('tdddddd', { origin: 'Estudo', completedAt: '2026-11-06', originalLine: '- [ ] Ler ^tdddddd' })
      expect(store.focus()).toEqual(['taaaaaa'])
      expect(groupFocusItems(done, focusItems(done, store.focus())).map((g) => g.name)).toEqual(['Casa'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
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
