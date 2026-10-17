import type { State } from '../state'
import { focusKey } from '@shared/planning'
import {
  ARCHIVE_LIST,
  boardView,
  type ParsedBoard,
  rescheduleTargets,
  type Task,
  taskWhen,
  type TaskList,
  type TaskRef,
} from '@shared/tasks'
import { arrowList, asDialog, FocusReturn, rove } from './a11y'
import { h, icon } from './dom'
import { cleanError } from './modals'
import { offerUndo, type Toast } from './tasks-complete'
import { openMoveMenu, openTaskMenu } from './tasks-move'
import { openNewTask } from './tasks-new'
import './focus.css'

/** `moved` is the card to focus after a move: the list it went to and its title. */
export async function openTasksBoard(
  root: HTMLElement,
  state: State,
  toast: Toast,
  initialBoard?: ParsedBoard,
  moved?: { list: string; text: string },
): Promise<void> {
  const vaultPath = state.settings.vaultPath
  if (!vaultPath && !initialBoard) {
    toast('Configure a pasta do vault em Ajustes → Tarefas do Obsidian.', 'err')
    return
  }

  try {
    const data = initialBoard ?? (await window.office.readTasks())
    const focused = new Set((await window.office.readFocus()).map((item) => item.id))
    const isFocused = (task: Task) => !!task.id && focused.has(focusKey(task.id))
    // The Archive is not a column, and completed tasks are listed apart: see boardView.
    const { columns, completed } = boardView(data.lists)
    const focusBack = new FocusReturn()
    let dragging: { line: number; list: string; text: string } | null = null
    // The main process checks the file again; a refusal (the file changed) comes back as the toast.
    const move = async (line: number, text: string, list: string) => {
      try {
        const next = await window.office.moveTask({ line, list })
        board.remove()
        toast(`Tarefa movida para ${list}.`, 'ok')
        void openTasksBoard(root, state, toast, next.board, { list, text })
      } catch (err) {
        toast(cleanError(err), 'err')
      }
    }
    const openMove = (card: HTMLElement, list: TaskList, task: Task) =>
      openMoveMenu(
        card,
        data.lists.map((l) => l.name).filter((name) => name !== list.name && name !== ARCHIVE_LIST),
        (to) => void move(task.line, task.text, to),
      )
    // The main process writes the new date; a refusal (a legacy line, the file changed) comes back as the toast.
    const reschedule = async (list: TaskList, task: Task, date: string) => {
      try {
        const next = await window.office.rescheduleTask({ line: task.line, date })
        board.remove()
        toast(`Tarefa reagendada para ${date}.`, 'ok')
        void openTasksBoard(root, state, toast, next.board, { list: list.name, text: task.text })
      } catch (err) {
        toast(cleanError(err), 'err')
      }
    }
    const openReschedule = (card: HTMLElement, list: TaskList, task: Task) =>
      openTaskMenu(
        card,
        'Reagendar para…',
        rescheduleTargets(new Date()).map(({ label, date }) => ({
          text: `${label} (${date})`,
          choose: () => void reschedule(list, task, date),
        })),
        'Não há data para escolher.',
      )
    // A task with no id gets one in tarefas.md when it is put in focus; the card is focused again after the redraw.
    const toggleFocus = async (list: TaskList, task: Task, wasFocused: boolean) => {
      try {
        let next: ParsedBoard
        if (wasFocused) {
          await window.office.unfocusTask(task.id!)
          next = await window.office.readTasks()
          toast('Tarefa tirada do foco.', 'ok')
        } else {
          next = (await window.office.focusTask(task.line)).board
          toast('Tarefa posta em foco.', 'ok')
        }
        board.remove()
        void openTasksBoard(root, state, toast, next, { list: list.name, text: task.text })
      } catch (err) {
        toast(cleanError(err), 'err')
      }
    }
    // The checkbox completes the task at once: the card leaves the board, and the undo toast stays for 10 s.
    const complete = async (box: HTMLInputElement, target: TaskRef, title: string) => {
      try {
        const next = await window.office.completeTask(target)
        offerUndo(toast, title, next.id, (undone) => refreshTasksBoard(root, state, toast, undone.board))
        refreshTasksBoard(root, state, toast, next.board)
      } catch (err) {
        box.checked = false
        toast(cleanError(err), 'err')
      }
    }
    /** Drag and keyboard for a card; the Archive is read-only. */
    const dragAndMove = (list: TaskList, task: Task): Record<string, string | EventListener | undefined> => {
      if (list.name === ARCHIVE_LIST) return {}
      return {
        draggable: 'true',
        ondragstart: (e: Event) => {
          const drag = e as DragEvent
          dragging = { line: task.line, list: list.name, text: task.text }
          if (drag.dataTransfer) {
            drag.dataTransfer.effectAllowed = 'move'
            drag.dataTransfer.setData('text/plain', task.text)
          }
          const card = drag.currentTarget as HTMLElement
          card.classList.add('dragging')
        },
        ondragend: () => {
          dragging = null
          board.querySelectorAll('.dragging, .tcol-over').forEach((n) => n.classList.remove('dragging', 'tcol-over'))
        },
        onkeydown: (e: Event) => {
          const key = e as KeyboardEvent
          if (key.target !== key.currentTarget) return
          if (key.key === 'Enter' || key.key === ' ') {
            key.preventDefault()
            openMove(key.currentTarget as HTMLElement, list, task)
          } else if (key.key.toLowerCase() === 'f' && !key.ctrlKey && !key.metaKey && !key.altKey) {
            key.preventDefault()
            void toggleFocus(list, task, isFocused(task))
          } else if (key.key.toLowerCase() === 'r' && !key.ctrlKey && !key.metaKey && !key.altKey && task.status === 'open') {
            // R is also the Reports shortcut of the page: this keeps it from opening over the board.
            key.preventDefault()
            key.stopPropagation()
            openReschedule(key.currentTarget as HTMLElement, list, task)
          }
        },
      }
    }
    const moveButton = (list: TaskList, task: Task) =>
      h(
        'button',
        {
          class: 'btn btn-small tcard-move',
          type: 'button',
          tabindex: '-1',
          onclick: (e: Event) => openMove((e.currentTarget as HTMLElement).closest<HTMLElement>('.tcard')!, list, task),
        },
        'Mover para…',
      )
    const rescheduleButton = (list: TaskList, task: Task) =>
      h(
        'button',
        {
          class: 'btn btn-small tcard-reschedule',
          type: 'button',
          tabindex: '-1',
          onclick: (e: Event) => openReschedule((e.currentTarget as HTMLElement).closest<HTMLElement>('.tcard')!, list, task),
        },
        'Reagendar…',
      )
    // Tab reaches it and Space toggles it. Only open tasks have one.
    const completeBox = (task: Task) =>
      h('input', {
        class: 'tcard-done',
        type: 'checkbox',
        'aria-label': `Marcar “${task.text}” como concluída`,
        onchange: (e: Event) => void complete(e.currentTarget as HTMLInputElement, { line: task.line }, task.text),
      })
    const focusButton = (list: TaskList, task: Task) => {
      const wasFocused = isFocused(task)
      return h(
        'button',
        {
          class: 'btn btn-small tcard-focus',
          type: 'button',
          tabindex: '-1',
          onclick: () => void toggleFocus(list, task, wasFocused),
        },
        wasFocused ? 'Tirar do foco' : 'Pôr em foco',
      )
    }
    const toggleCompleted = (button: HTMLButtonElement) => {
      const show = completedPanel.hidden
      completedPanel.hidden = !show
      button.textContent = show ? 'Ocultar concluídas' : 'Mostrar concluídas'
      button.setAttribute('aria-pressed', String(show))
    }
    const completedPanel = h(
      'section',
      { class: 'tasks-completed', hidden: true, 'aria-label': 'Tarefas concluídas', tabindex: '0' },
      completed.length === 0
        ? h('div', { class: 'hint' }, 'Nenhuma tarefa concluída ainda.')
        : h(
            'ul',
            { class: 'tcompleted-list', 'aria-label': 'Tarefas concluídas' },
            ...completed.map(({ list, task }) =>
              h(
                'li',
                { class: 'tcompleted-row' },
                h('span', { class: 'tcompleted-title' }, `✅ ${task.text}`),
                h(
                  'span',
                  { class: 'tcompleted-foot' },
                  [task.completedDate, list === ARCHIVE_LIST ? '' : list].filter(Boolean).join(' · '),
                ),
              ),
            ),
          ),
    )
    const board = h(
      'div',
      { class: 'board', tabindex: '-1', 'data-tasks-board': 'true' },
      h(
        'div',
        { class: 'board-head' },
        h('div', { class: 'board-title' }, icon('list', 18), 'Tarefas'),
        h('span', { class: 'board-count' }, `${columns.reduce((count, list) => count + list.tasks.length, 0)} tarefas`),
        h('span', { class: 'grow' }),
        h(
          'button',
          {
            class: 'btn btn-small btn-primary',
            type: 'button',
            onclick: () =>
              openNewTask(
                root,
                columns.map((list) => list.name),
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
            class: 'btn btn-small',
            type: 'button',
            'aria-pressed': 'false',
            onclick: (e: Event) => toggleCompleted(e.currentTarget as HTMLButtonElement),
          },
          'Mostrar concluídas',
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
          ...columns.map((list: TaskList) =>
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
                          class: `tcard task-readonly${task.status === 'discarded' ? ' task-discarded' : ''}`,
                          tabindex: '0',
                          ...dragAndMove(list, task),
                          'aria-label': [
                            task.text,
                            task.status === 'discarded' ? 'Descartada' : '',
                            isFocused(task) ? 'Em foco' : '',
                            taskWhen(task) ? `Data ${taskWhen(task)}` : '',
                            task.completedDate ? `Descartada em ${task.completedDate}` : '',
                            `Pressione Enter para mover para outra lista, F para pôr ou tirar do foco${task.status === 'open' ? ', R para reagendar' : ''}`,
                          ]
                            .filter(Boolean)
                            .join('. '),
                        },
                        h(
                          'div',
                          { class: 'tcard-top' },
                          task.status === 'open' ? completeBox(task) : null,
                          h('span', { class: 'tcard-title' }, task.text),
                          task.status !== 'open' ? h('span', { class: 'chip chip-err' }, 'Descartada') : null,
                          isFocused(task) ? h('span', { class: 'chip' }, 'Em foco') : null,
                        ),
                        taskWhen(task) ? h('div', { class: 'tcard-foot' }, taskWhen(task)) : null,
                        task.completedDate ? h('div', { class: 'tcard-foot' }, `❌ ${task.completedDate}`) : null,
                        task.reason ? h('div', { class: 'hint' }, task.reason) : null,
                        moveButton(list, task),
                        task.status === 'open' ? rescheduleButton(list, task) : null,
                        task.status === 'open' || isFocused(task) ? focusButton(list, task) : null,
                      ),
                    )),
              ),
            ),
          ),
        ),
        completedPanel,
      ),
    ) as HTMLElement

    asDialog(board, { label: 'Quadro Tarefas' })
    arrowList(board, '.tcol')
    const columnEls = [...board.querySelectorAll<HTMLElement>('.tcol')]
    if (columnEls.length) rove(columnEls, 0)
    for (const column of columnEls) {
      arrowList(column, '.task-readonly')
      const cards = [...column.querySelectorAll<HTMLElement>('.task-readonly')]
      if (cards.length) rove(cards, 0)
    }
    const dropZone = (column: HTMLElement, name: string) => {
      column.addEventListener('dragover', (e) => {
        if (!dragging || dragging.list === name) return
        e.preventDefault()
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
        column.classList.add('tcol-over')
      })
      column.addEventListener('dragleave', (e) => {
        if (!column.contains(e.relatedTarget as Node | null)) column.classList.remove('tcol-over')
      })
      column.addEventListener('drop', (e) => {
        e.preventDefault()
        column.classList.remove('tcol-over')
        const drop = dragging
        dragging = null
        if (drop && drop.list !== name) void move(drop.line, drop.text, name)
      })
    }
    columnEls.forEach((column, i) => dropZone(column, columns[i]!.name))
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
    const landing = moved
      ? [...board.querySelectorAll<HTMLElement>('.task-readonly')].find(
          (card) =>
            card.closest('.tcol')?.getAttribute('aria-label') === `Lista ${moved.list}` &&
            card.querySelector('.tcard-title')?.textContent === moved.text,
        )
      : undefined
    const target: HTMLElement = landing ?? board
    target.focus({ preventScroll: true })
  } catch (err) {
    toast(cleanError(err), 'err')
  }
}

/**
 * Draws the Tarefas board again with `board` when it is open; a board the user closed stays
 * closed. Used after a completion and after its undo, which can come from the focus popup.
 */
export function refreshTasksBoard(root: HTMLElement, state: State, toast: Toast, board: ParsedBoard): void {
  const open = root.querySelector<HTMLElement>('[data-tasks-board]')
  if (!open) return
  open.remove()
  void openTasksBoard(root, state, toast, board)
}
