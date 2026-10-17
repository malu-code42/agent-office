import type { State } from '../state'
import type { ParsedBoard, Task, TaskList } from '@shared/tasks'
import { arrowList, asDialog, FocusReturn, rove } from './a11y'
import { h, icon } from './dom'
import { cleanError } from './modals'
import { openNewTask } from './tasks-new'

/** The date and time of a task as written in the file, e.g. "16.10.2026 09:00". */
function when(task: Task): string {
  return [task.date ?? task.dueDate, task.time].filter(Boolean).join(' ')
}

export async function openTasksBoard(
  root: HTMLElement,
  state: State,
  toast: (msg: string, type?: 'info' | 'ok' | 'err') => void,
  initialBoard?: ParsedBoard,
): Promise<void> {
  const vaultPath = state.settings.vaultPath
  if (!vaultPath && !initialBoard) {
    toast('Configure a pasta do vault em Ajustes → Tarefas do Obsidian.', 'err')
    return
  }

  try {
    const data = initialBoard ?? (await window.office.readTasks())
    const focusBack = new FocusReturn()
    const board = h(
      'div',
      { class: 'board', tabindex: '-1' },
      h(
        'div',
        { class: 'board-head' },
        h('div', { class: 'board-title' }, icon('list', 18), 'Tarefas'),
        h('span', { class: 'board-count' }, `${data.lists.reduce((count, list) => count + list.tasks.length, 0)} tarefas`),
        h('span', { class: 'grow' }),
        h(
          'button',
          {
            class: 'btn btn-small btn-primary',
            type: 'button',
            onclick: () =>
              openNewTask(
                root,
                data.lists.map((list) => list.name),
                (next) => {
                  board.remove()
                  void openTasksBoard(root, state, toast, next)
                },
                toast,
              ),
          },
          icon('plus', 14),
          'Nova tarefa',
        ),
        h(
          'button',
          {
            class: 'icon-btn',
            type: 'button',
            title: 'Fechar (Esc)',
            'aria-label': 'Fechar quadro Tarefas',
            onclick: () => board.remove(),
          },
          icon('x', 18),
        ),
      ),
      data.warnings.length
        ? h(
            'div',
            { class: 'tasks-warnings', role: 'status' },
            h('strong', {}, `${data.warnings.length} linha(s) não reconhecida(s)`),
            h('ul', {}, ...data.warnings.map((warning) => h('li', {}, warning))),
          )
        : null,
      h(
        'div',
        { class: 'board-body' },
        h(
          'div',
          { class: 'board-cols', role: 'group', 'aria-label': 'Colunas do quadro Tarefas' },
          ...(data.lists.length === 0
            ? [
                h(
                  'div',
                  { class: 'empty-box panelbox' },
                  h('b', {}, 'Nenhuma lista encontrada'),
                  h('span', {}, 'O arquivo tarefas.md não contém títulos de lista iniciados por “##”.'),
                ),
              ]
            : []),
          ...data.lists.map((list: TaskList) =>
            h(
              'section',
              { class: 'tcol', tabindex: '0', 'aria-label': `Lista ${list.name}` },
              h(
                'div',
                { class: 'tcol-head' },
                h('span', { class: 'tcol-dot' }),
                h('span', { class: 'grow' }, list.name),
                h('span', { class: 'tcol-count' }, String(list.tasks.length)),
              ),
              h(
                'ul',
                { class: 'tcol-list', style: 'list-style:none;margin:0', tabindex: '0', 'aria-label': `Tarefas de ${list.name}` },
                ...(list.tasks.length === 0
                  ? [h('li', { class: 'tcol-empty' }, 'Nenhuma tarefa')]
                  : list.tasks.map((task) =>
                      h(
                        'li',
                        {
                          class: `tcard task-readonly${task.status === 'completed' ? ' task-completed' : task.status === 'discarded' ? ' task-discarded' : ''}`,
                          tabindex: '0',
                          'aria-label': [
                            task.text,
                            task.status === 'completed' ? 'Concluída' : task.status === 'discarded' ? 'Descartada' : '',
                            when(task) ? `Data ${when(task)}` : '',
                            task.completedDate
                              ? `${task.status === 'completed' ? 'Concluída em' : 'Descartada em'} ${task.completedDate}`
                              : '',
                          ]
                            .filter(Boolean)
                            .join('. '),
                        },
                        h(
                          'div',
                          { class: 'tcard-top' },
                          h('span', { class: 'tcard-title' }, task.text),
                          task.status !== 'open'
                            ? h(
                                'span',
                                { class: `chip ${task.status === 'completed' ? 'chip-done' : 'chip-err'}` },
                                task.status === 'completed' ? 'Concluída' : 'Descartada',
                              )
                            : null,
                        ),
                        when(task) ? h('div', { class: 'tcard-foot' }, `📅 ${when(task)}`) : null,
                        task.completedDate
                          ? h('div', { class: 'tcard-foot' }, `${task.status === 'completed' ? '✅' : '❌'} ${task.completedDate}`)
                          : null,
                        task.reason ? h('div', { class: 'hint' }, task.reason) : null,
                      ),
                    )),
              ),
            ),
          ),
        ),
      ),
    ) as HTMLElement

    asDialog(board, { label: 'Quadro Tarefas' })
    arrowList(board, '.tcol')
    const columns = [...board.querySelectorAll<HTMLElement>('.tcol')]
    if (columns.length) rove(columns, 0)
    for (const column of columns) {
      arrowList(column, '.task-readonly')
      const cards = [...column.querySelectorAll<HTMLElement>('.task-readonly')]
      if (cards.length) rove(cards, 0)
    }
    board.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement
      )
        return
      event.stopPropagation()
      board.remove()
    })
    board.addEventListener('click', (event) => {
      if (event.target === board) board.remove()
    })
    focusBack.save(board)
    const observer = new MutationObserver(() => {
      if (board.isConnected) return
      observer.disconnect()
      focusBack.restore(board)
    })
    observer.observe(root, { childList: true })
    root.append(board)
    board.focus({ preventScroll: true })
  } catch (err) {
    toast(cleanError(err), 'err')
  }
}
