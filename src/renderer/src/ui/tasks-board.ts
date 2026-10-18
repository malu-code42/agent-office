import type { State } from '../state'
import { focusKey } from '@shared/planning'
import { parseEmphasis } from '@shared/emphasis'
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
import { openAgenda } from './agenda'
import { asDialog, FocusReturn, isTyping, rove } from './a11y'
import { h, icon } from './dom'
import { cleanError } from './modals'
import { offerUndo, type Toast } from './tasks-complete'
import { openMoveMenu, openTaskMenu } from './tasks-move'
import { openIris } from './iris'
import { openNewTask } from './tasks-new'
import { runDiscard, runReopen } from './tasks-discard'
import { keepListScroll } from './tasks-board-scroll'
import './focus.css'

const ARROWS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']

/** The card to focus after a move: the list it went to and its title. */
type Moved = { list: string; text: string }

/** Draws the open board again, in place, with new data. */
type Render = (next: ParsedBoard, nextFocused: Set<string>, moved?: Moved) => void

/** The render of each open board: an action draws the same element again, so it does not blink. */
const renders = new WeakMap<HTMLElement, Render>()
let latestRefresh = 0

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

/** Scroll offset of each list in the open board, by name. */
function listScroll(cols: HTMLElement): Map<string, number> {
  return new Map(
    [...cols.querySelectorAll<HTMLElement>('.tcol')].map((column): [string, number] => [
      column.dataset.list ?? '',
      column.querySelector<HTMLElement>('.tcol-list')?.scrollTop ?? 0,
    ]),
  )
}

/** `moved` is the card to focus after a move: the list it went to and its title. */
export async function openTasksBoard(
  root: HTMLElement,
  state: State,
  toast: Toast,
  initialBoard?: ParsedBoard,
  moved?: Moved,
): Promise<void> {
  const vaultPath = state.settings.vaultPath
  if (!vaultPath && !initialBoard) {
    toast('Configure a pasta do vault em Ajustes → Tarefas do Obsidian.', 'err')
    return
  }

  try {
    const initial = initialBoard ?? (await window.office.readTasks())
    const initialFocused = new Set((await window.office.readFocus()).map((item) => item.id))
    // The board element stays while it is open: every change goes through render, never a new board.
    let data = initial
    let focused = initialFocused
    let columns: TaskList[] = []
    let dragging: { line: number; list: string; text: string } | null = null
    let showCompleted = false
    const isFocused = (task: Task) => !!task.id && focused.has(focusKey(task.id))
    const focusBack = new FocusReturn()
    // The main process checks the file again; a refusal (the file changed) comes back as the toast.
    const move = async (line: number, text: string, list: string) => {
      try {
        const next = await window.office.moveTask({ line, list })
        toast(`Tarefa movida para ${list}.`, 'ok')
        refreshTasksBoard(root, state, toast, next.board, { list, text })
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
        toast(`Tarefa reagendada para ${date}.`, 'ok')
        refreshTasksBoard(root, state, toast, next.board, { list: list.name, text: task.text })
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
        refreshTasksBoard(root, state, toast, next, { list: list.name, text: task.text })
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
    // Discarding asks for the reason first; the card leaves the board and its line goes to the Archive.
    const discardCard = (task: Task) =>
      void runDiscard(root, toast, { line: task.line }, task.text, (next) => {
        refreshTasksBoard(root, state, toast, next.board)
      })
    // A completed or discarded task goes back to its origin list, and its card is focused there.
    const reopenRow = (task: Task) =>
      void runReopen(root, toast, { line: task.line }, task.text, (next) => {
        refreshTasksBoard(root, state, toast, next.board, { list: next.list, text: task.text })
      })
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
          } else if (key.key.toLowerCase() === 'd' && !key.ctrlKey && !key.metaKey && !key.altKey && task.status === 'open') {
            key.preventDefault()
            discardCard(task)
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
    const discardButton = (task: Task) =>
      h(
        'button',
        {
          class: 'btn btn-small tcard-discard',
          type: 'button',
          tabindex: '-1',
          onclick: () => discardCard(task),
        },
        'Descartar…',
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
    const applyCompleted = () => {
      completedPanel.hidden = !showCompleted
      completedToggle.textContent = showCompleted ? 'Ocultar concluídas' : 'Mostrar concluídas'
      completedToggle.setAttribute('aria-pressed', String(showCompleted))
    }
    const completedToggle = h(
      'button',
      {
        class: 'btn btn-small',
        type: 'button',
        'aria-pressed': 'false',
        onclick: () => {
          showCompleted = !showCompleted
          applyCompleted()
        },
      },
      'Mostrar concluídas',
    )
    const completedPanel = h('section', { class: 'tasks-completed', hidden: true, 'aria-label': 'Tarefas concluídas', tabindex: '0' })
    const countEl = h('span', { class: 'board-count' })
    const colsEl = h('div', { class: 'board-cols', role: 'group', 'aria-label': 'Colunas do quadro Tarefas' })
    const bodyEl = h('div', { class: 'board-body' }, colsEl, completedPanel)
    let warnings: HTMLElement | null = null
    const board = h(
      'div',
      { class: 'board', tabindex: '-1', 'data-tasks-board': 'true' },
      h(
        'div',
        { class: 'board-head' },
        h('div', { class: 'board-title' }, icon('list', 18), 'Tarefas'),
        countEl,
        h('span', { class: 'grow' }),
        h('button', { class: 'btn btn-small', type: 'button', onclick: () => openIris(root, toast) }, 'Pedir à Íris'),
        h('button', { class: 'btn btn-small', type: 'button', onclick: () => openAgenda(root) }, icon('calendar', 14), 'Agenda'),
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
                  refreshTasksBoard(root, state, toast, next)
                },
                toast,
              ),
          },
          icon('plus', 14),
          'Nova tarefa',
        ),
        completedToggle,
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
      bodyEl,
    ) as HTMLElement

    asDialog(board, { label: 'Quadro Tarefas' })
    let columnEls: HTMLElement[] = []
    const cardsOf = (column: HTMLElement) => [...column.querySelectorAll<HTMLElement>('.task-readonly')]
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
    const render: Render = (next, nextFocused, movedTo) => {
      data = next
      focused = nextFocused
      const view = boardView(next.lists)
      columns = view.columns
      // Read the lists' scroll before their elements are replaced, and put it back after.
      const kept = keepListScroll(
        listScroll(colsEl),
        columns.map((list) => list.name),
      )
      countEl.textContent = `${columns.reduce((count, list) => count + list.tasks.length, 0)} tarefas`
      warnings?.remove()
      warnings = next.warnings.length
        ? h(
            'div',
            { class: 'tasks-warnings', role: 'status' },
            h('strong', {}, `${next.warnings.length} linha(s) não reconhecida(s)`),
            h('ul', {}, ...next.warnings.map((warning) => h('li', {}, warning))),
          )
        : null
      if (warnings) bodyEl.before(warnings)
      colsEl.replaceChildren(
        ...(next.lists.length === 0
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
            { class: 'tcol', tabindex: '0', 'aria-label': `Lista ${list.name}`, 'data-list': list.name },
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
                        class: `tcard task-readonly${task.status === 'discarded' ? ' task-discarded' : ''}`,
                        tabindex: '0',
                        ...dragAndMove(list, task),
                        'aria-label': [
                          parseEmphasis(task.text)
                            .map((segment) => segment.text)
                            .join(''),
                          task.status === 'discarded' ? 'Descartada' : '',
                          isFocused(task) ? 'Em foco' : '',
                          taskWhen(task) ? `Data ${taskWhen(task)}` : '',
                          task.completedDate ? `Descartada em ${task.completedDate}` : '',
                          `Pressione Enter para mover para outra lista, F para pôr ou tirar do foco${task.status === 'open' ? ', R para reagendar, D para descartar' : ''}`,
                        ]
                          .filter(Boolean)
                          .join('. '),
                      },
                      h(
                        'div',
                        { class: 'tcard-top' },
                        task.status === 'open' ? completeBox(task) : null,
                        h('span', { class: 'tcard-title' }, ...taskTitle(task.text)),
                        task.status !== 'open'
                          ? h(
                              'span',
                              { class: `chip ${task.status === 'completed' ? 'chip-done' : 'chip-err'}` },
                              task.status === 'completed' ? 'Concluída' : 'Descartada',
                            )
                          : null,
                        isFocused(task) ? h('span', { class: 'chip' }, 'Em foco') : null,
                      ),
                      taskWhen(task) ? h('div', { class: 'tcard-foot' }, taskWhen(task)) : null,
                      task.completedDate ? h('div', { class: 'tcard-foot' }, `❌ ${task.completedDate}`) : null,
                      task.reason ? h('div', { class: 'hint' }, task.reason) : null,
                      moveButton(list, task),
                      task.status === 'open' ? rescheduleButton(list, task) : null,
                      task.status === 'open' ? discardButton(task) : null,
                      task.status === 'open' || isFocused(task) ? focusButton(list, task) : null,
                    ),
                  )),
            ),
          ),
        ),
      )
      columnEls = [...colsEl.querySelectorAll<HTMLElement>('.tcol')]
      for (const column of columnEls) {
        const cards = cardsOf(column)
        if (cards.length) rove(cards, 0)
        const scroller = column.querySelector<HTMLElement>('.tcol-list')
        if (scroller) scroller.scrollTop = kept.get(column.dataset.list ?? '') ?? 0
      }
      columnEls.forEach((column, i) => dropZone(column, columns[i]!.name))
      completedPanel.replaceChildren(
        view.completed.length === 0
          ? h('div', { class: 'hint' }, 'Nenhuma tarefa concluída ainda.')
          : h(
              'ul',
              { class: 'tcompleted-list', 'aria-label': 'Tarefas concluídas' },
              ...view.completed.map(({ list, task }) =>
                h(
                  'li',
                  { class: 'tcompleted-row' },
                  h('span', { class: 'tcompleted-title' }, `${task.status === 'discarded' ? '❌' : '✅'} ${task.text}`),
                  h(
                    'span',
                    { class: 'tcompleted-foot' },
                    [task.completedDate, list === ARCHIVE_LIST ? '' : list].filter(Boolean).join(' · '),
                  ),
                  task.reason ? h('span', { class: 'tcompleted-foot' }, `Motivo: ${task.reason}`) : null,
                  h(
                    'button',
                    {
                      class: 'btn btn-small tcompleted-reopen',
                      type: 'button',
                      'aria-label': `Reabrir “${task.text}”`,
                      onclick: () => reopenRow(task),
                    },
                    'Reabrir',
                  ),
                ),
              ),
            ),
      )
      applyCompleted()
      const landing = movedTo
        ? [...board.querySelectorAll<HTMLElement>('.task-readonly')].find(
            (card) =>
              card.closest('.tcol')?.getAttribute('aria-label') === `Lista ${movedTo.list}` &&
              card.querySelector('.tcard-title')?.textContent === movedTo.text,
          )
        : undefined
      const target: HTMLElement = landing ?? columnEls[0] ?? board
      target.focus({ preventScroll: true })
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
      moveFocus(columnEls, event.key)
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
    renders.set(board, render)
    root.append(board)
    render(initial, initialFocused, moved)
  } catch (err) {
    toast(cleanError(err), 'err')
  }
}

/**
 * Draws the open Tarefas board again with `board`, in place; a board the user closed stays closed.
 * Used after a completion and after its undo, which can come from the focus popup.
 */
export function refreshTasksBoard(root: HTMLElement, state: State, toast: Toast, board: ParsedBoard, moved?: Moved): void {
  const open = root.querySelector<HTMLElement>('[data-tasks-board]')
  const render = open ? renders.get(open) : undefined
  if (!open || !render) return
  const token = ++latestRefresh
  window.office
    .readFocus()
    .then((items) => {
      // A newer action has its own data; an older answer arriving late would put the board back in time.
      if (token === latestRefresh && open.isConnected) render(board, new Set(items.map((item) => item.id)), moved)
    })
    .catch((err: unknown) => toast(cleanError(err), 'err'))
}
