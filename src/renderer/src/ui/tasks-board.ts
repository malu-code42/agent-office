import type { State } from '../state'
import { parseEmphasis } from '@shared/emphasis'
import type { ParsedBoard, TaskList } from '@shared/tasks'
import { asDialog, FocusReturn, isTyping, rove } from './a11y'
import { h, icon } from './dom'
import { cleanError } from './modals'

const ARROWS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']

/** Renders `**negrito**` and `*itálico*` as elements; everything else stays text. */
function taskTitle(text: string): (Node | string)[] {
  return parseEmphasis(text).map((segment) =>
    segment.kind === 'bold'
      ? h('strong', { class: 'tcard-bold' }, segment.text)
      : segment.kind === 'italic'
        ? h('em', { class: 'tcard-italic' }, segment.text)
        : segment.text,
  )
}

/** ↑/↓ move between the cards of a list, ←/→ between lists (same row when there is one). */
function moveFocus(columns: HTMLElement[], key: string): void {
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const column = focused?.closest<HTMLElement>('.tcol') ?? columns[0]
  if (!column) return
  const cards = [...column.querySelectorAll<HTMLElement>('.task-readonly')]
  const card = focused?.closest<HTMLElement>('.task-readonly') ?? null
  const row = card ? cards.indexOf(card) : -1

  if (key === 'ArrowUp' || key === 'ArrowDown') {
    if (!cards.length) return
    if (row < 0) {
      const current = cards.find((c) => c.tabIndex === 0) ?? cards[0]
      current.focus()
      return
    }
    const next = Math.max(0, Math.min(cards.length - 1, row + (key === 'ArrowDown' ? 1 : -1)))
    rove(cards, next)
    cards[next].focus()
    return
  }

  const col = columns.indexOf(column)
  const target = columns[Math.max(0, Math.min(columns.length - 1, col + (key === 'ArrowRight' ? 1 : -1)))]
  if (!target || target === column) return
  const targetCards = [...target.querySelectorAll<HTMLElement>('.task-readonly')]
  if (!targetCards.length || row < 0) {
    target.focus()
    return
  }
  const at = Math.min(row, targetCards.length - 1)
  rove(targetCards, at)
  targetCards[at].focus()
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
                { class: 'tcol-list', style: 'list-style:none;margin:0', 'aria-label': `Tarefas de ${list.name}` },
                ...(list.tasks.length === 0
                  ? [h('li', { class: 'tcol-empty' }, 'Nenhuma tarefa')]
                  : list.tasks.map((task) =>
                      h(
                        'li',
                        {
                          class: `tcard task-readonly${task.status === 'completed' ? ' task-completed' : task.status === 'discarded' ? ' task-discarded' : ''}`,
                          tabindex: '0',
                          'aria-label': [
                            parseEmphasis(task.text)
                              .map((segment) => segment.text)
                              .join(''),
                            task.status === 'completed' ? 'Concluída' : task.status === 'discarded' ? 'Descartada' : '',
                            task.dueDate ? `Data ${task.dueDate}` : '',
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
                          h('span', { class: 'tcard-title' }, ...taskTitle(task.text)),
                          task.status !== 'open'
                            ? h(
                                'span',
                                { class: `chip ${task.status === 'completed' ? 'chip-done' : 'chip-err'}` },
                                task.status === 'completed' ? 'Concluída' : 'Descartada',
                              )
                            : null,
                        ),
                        task.dueDate ? h('div', { class: 'tcard-foot' }, `📅 ${task.dueDate}`) : null,
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
    const columns = [...board.querySelectorAll<HTMLElement>('.tcol')]
    const cardsOf = (column: HTMLElement) => [...column.querySelectorAll<HTMLElement>('.task-readonly')]
    for (const column of columns) {
      const cards = cardsOf(column)
      if (cards.length) rove(cards, 0)
    }
    board.addEventListener('focusin', (event) => {
      const card = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('.task-readonly') : null
      const column = card?.closest<HTMLElement>('.tcol')
      if (card && column) rove(cardsOf(column), cardsOf(column).indexOf(card))
    })
    // Capture on window, like the "?" shortcut: the game listens on window and would move the player.
    const onKey = (event: KeyboardEvent) => {
      if (!board.isConnected || isTyping() || event.altKey || event.metaKey || event.ctrlKey) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        board.remove()
        return
      }
      if (!ARROWS.includes(event.key)) return
      event.preventDefault()
      event.stopPropagation()
      moveFocus(columns, event.key)
    }
    window.addEventListener('keydown', onKey, true)
    board.addEventListener('click', (event) => {
      if (event.target === board) board.remove()
    })
    focusBack.save(board)
    const observer = new MutationObserver(() => {
      if (board.isConnected) return
      observer.disconnect()
      window.removeEventListener('keydown', onKey, true)
      focusBack.restore(board)
    })
    observer.observe(root, { childList: true })
    root.append(board)
    ;(columns[0] ?? board).focus({ preventScroll: true })
  } catch (err) {
    toast(cleanError(err), 'err')
  }
}
