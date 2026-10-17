import { describe, expect, it } from 'vitest'
import { createCompletionUndo, type PendingCompletion } from '../src/main/tasks-undo'
import { boardView, parseTasksFile } from '../src/shared/tasks'

/** The undo window of a completion: 10 seconds, counted from the completion, with the clock injected. */

const done = (id: string, vault = 'C:/vault'): PendingCompletion => ({
  id,
  origin: 'Casa',
  completedAt: '2026-10-17',
  originalLine: '- [ ] Lavar roupa ^tabc123',
  before: 'antes',
  after: 'depois',
  vault,
  wasFocused: true,
})

describe('createCompletionUndo', () => {
  it('offers the undo for 10 seconds after the completion, and refuses it after', () => {
    let now = 1_000
    const undo = createCompletionUndo(() => now)
    undo.remember(done('tabc123'))

    now = 10_999
    expect(undo.peek('TABC123', 'C:/vault').id).toBe('tabc123')

    now = 11_000
    expect(() => undo.peek('tabc123', 'C:/vault')).toThrow('Passaram os 10 segundos para desfazer. A tarefa continua concluída.')
  })

  it('refuses a task that was never completed here, or a vault other than the one it was completed in', () => {
    const undo = createCompletionUndo(() => 0)
    undo.remember(done('tabc123', 'C:/vault'))

    expect(() => undo.peek('tzzzzzz', 'C:/vault')).toThrow('Não há conclusão para desfazer.')
    expect(() => undo.peek('tabc123', 'C:/outro')).toThrow('Não há conclusão para desfazer.')
  })

  it('forgets a completion once it is undone, so a second undo is refused', () => {
    const undo = createCompletionUndo(() => 0)
    undo.remember(done('tabc123'))
    undo.forget('tabc123')

    expect(() => undo.peek('tabc123', 'C:/vault')).toThrow('Não há conclusão para desfazer.')
  })

  it('keeps every completion of the window, each with its own id', () => {
    let now = 0
    const undo = createCompletionUndo(() => now)
    undo.remember(done('tabc123'))
    now = 4_000
    undo.remember(done('tdef456'))

    expect(undo.peek('tabc123', 'C:/vault').id).toBe('tabc123')
    expect(undo.peek('tdef456', 'C:/vault').id).toBe('tdef456')
  })
})

describe('boardView', () => {
  const board = parseTasksFile(
    [
      '## Estudo',
      '- [ ] Ler capítulo 3 ^t1a2b3c',
      '- [x] Terminar exercício ✅ 2026-10-12 ^t4c5d6e',
      '## Casa',
      '- [ ] 16.10.2026 | 09:00 | Casa | Lavar roupa ^tabc123',
      '- [-] Passar pano ❌ 2026-10-11 ^tdef456',
      '## Archive',
      '- [x] 16.10.2026 | 09:00 | Casa | Lavar louça ✅ 17.10.2026 ^tghi789',
      '- [-] Ler artigo antigo ❌ 2026-10-10 ^t7e8f9a',
      '',
    ].join('\n'),
  )

  it('draws one column per list but the Archive, with the open and discarded tasks', () => {
    const view = boardView(board.lists)

    expect(view.columns.map((c) => c.name)).toEqual(['Estudo', 'Casa'])
    expect(view.columns[0]!.tasks.map((t) => t.text)).toEqual(['Ler capítulo 3'])
    expect(view.columns[1]!.tasks.map((t) => t.text)).toEqual(['Lavar roupa', 'Passar pano'])
  })

  it('lists every completed task and the discarded ones of the Archive, with their list and date, but not a discarded task of a column', () => {
    const view = boardView(board.lists)

    expect(view.completed.map(({ list, task }) => [list, task.text, task.completedDate])).toEqual([
      ['Estudo', 'Terminar exercício', '2026-10-12'],
      ['Archive', 'Lavar louça', '17.10.2026'],
      ['Archive', 'Ler artigo antigo', '2026-10-10'],
    ])
  })

  it('shows nothing of the Archive as a column even when it is the only list, and lists its discarded task to reopen', () => {
    const only = parseTasksFile('## Archive\n- [-] Velho ^t7e8f9a\n').lists

    expect(boardView(only).columns).toEqual([])
    expect(boardView(only).completed.map(({ task }) => task.text)).toEqual(['Velho'])
  })
})
