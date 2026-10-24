import type { State } from '../state'
import { focusKey } from '@shared/planning'
import { tasksToFocusSelection, toggleSelectedTask } from '@shared/task-focus-selection'
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
import { asDialog, FocusReturn, focusedKey, isTyping, refocusKey, rove } from './a11y'
import { h, icon } from './dom'
import { cleanError } from './modals'
import { offerUndo, type Toast } from './tasks-complete'
import { openMoveMenu, openTaskMenu } from './tasks-move'
import { openNewTask } from './tasks-new'
import { openGoals } from './goals'
import { openMediaLibrary } from './media-library'
import { runDiscard, runReopen } from './tasks-discard'
import { keepScroll } from './tasks-scroll'
import './focus.css'

const ARROWS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']

/** The focus memory of each open board. A redraw hands it to the board that replaces it. */
const focusMemory = new WeakMap<HTMLElement, FocusReturn>()
/** Boards taken out by a redraw: their close watcher must not give the focus back. */
const replaced = new WeakSet<HTMLElement>()

/** Scroll of the lists (by name) and of the columns row, read before a redraw. */
function readScroll(board: HTMLElement): { lists: Record<string, number>; columns: number } {
  const lists: Record<string, number> = {}
  for (const el of board.querySelectorAll<HTMLElement>('.tcol-list')) lists[el.dataset.list ?? ''] = el.scrollTop
  return { lists, columns: board.querySelector<HTMLElement>('.board-cols')?.scrollTop ?? 0 }
}

/** Puts the scroll back on the new board; it must be in the document, so the sizes are known. */
function applyScroll(board: HTMLElement, scroll: { lists: Record<string, number>; columns: number }): void {
  const els = [...board.querySelectorAll<HTMLElement>('.tcol-list')]
  const names = els.map((el) => el.dataset.list ?? '')
  const maxScroll: Record<string, number> = {}
  els.forEach((el, i) => (maxScroll[names[i]!] = el.scrollHeight - el.clientHeight))
  const kept = keepScroll(scroll.lists, names, maxScroll)
  els.forEach((el, i) => {
    const top = kept[names[i]!]
    if (top !== undefined) el.scrollTop = top
  })
  const columns = board.querySelector<HTMLElement>('.board-cols')
  if (columns) columns.scrollTop = scroll.columns
}

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
    const taskAriaLabel = (task: Task) =>
      [
        parseEmphasis(task.text).map((segment) => segment.text).join(''),
        task.status === 'discarded' ? 'Descartada' : '',
        isFocused(task) ? 'Em foco' : '',
        taskWhen(task) ? `Data ${taskWhen(task)}` : '',
        task.completedDate ? `Descartada em ${task.completedDate}` : '',
        `Pressione Enter para mover para outra lista, F para pôr ou tirar do foco${task.status === 'open' ? ', R para reagendar, D para descartar' : ''}`,
      ]
        .filter(Boolean)
        .join('. ')
    // The Archive is not a column, and completed tasks are listed apart: see boardView.
    const { columns, completed } = boardView(data.lists)
    let dragging: { line: number; list: string; text: string } | null = null
    let selectingFocus = false
    const selectedFocusLines = new Set<number>()
    const actionDisabledBeforeSelection = new WeakMap<HTMLButtonElement | HTMLInputElement, boolean>()
    // The main process checks the file again; a refusal (the file changed) comes back as the toast.
    const move = async (line: number, text: string, list: string) => {
      try {
        const next = await window.office.moveTask({ line, list })
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
        void openTasksBoard(root, state, toast, next, { list: list.name, text: task.text })
      } catch (err) {
        toast(cleanError(err), 'err')
      }
    }
    const focusSelectionLabel = h('span', {}, 'Pôr em foco')
    const focusSelectionButton = h('button', {
      class: 'btn btn-small tasks-focus-select',
      type: 'button',
      'aria-pressed': 'false',
      'data-focus-key': 'selecionar-foco',
    }, icon('pin', 14), focusSelectionLabel) as HTMLButtonElement
    const cancelFocusSelectionButton = h('button', {
      class: 'btn btn-small tasks-focus-cancel hidden',
      type: 'button',
      'data-focus-key': 'cancelar-selecao-foco',
    }, 'Cancelar') as HTMLButtonElement
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
        void openTasksBoard(root, state, toast, next.board)
      })
    // A completed or discarded task goes back to its origin list, and its card is focused there.
    const reopenRow = (task: Task) =>
      void runReopen(root, toast, { line: task.line }, task.text, (next) => {
        void openTasksBoard(root, state, toast, next.board, { list: next.list, text: task.text })
      })
    /** Drag and keyboard for a card; the Archive is read-only. */
    const dragAndMove = (list: TaskList, task: Task): Record<string, string | EventListener | undefined> => {
      if (list.name === ARCHIVE_LIST) return {}
      return {
        draggable: 'true',
        ondragstart: (e: Event) => {
          if (selectingFocus) {
            e.preventDefault()
            return
          }
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
          if (selectingFocus) {
            if (key.key === 'Enter' || key.key === ' ') {
              key.preventDefault()
              key.stopPropagation()
              toggleFocusSelection(task, key.currentTarget as HTMLElement)
            }
            return
          }
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
    const board = h(
      'div',
      { class: 'board', tabindex: '-1', 'data-tasks-board': 'true' },
      h(
        'div',
        { class: 'board-head' },
        h('div', { class: 'board-title' }, icon('list', 18), 'Tarefas'),
        h('span', { class: 'board-count' }, `${columns.reduce((count, list) => count + list.tasks.length, 0)} tarefas`),
        h('span', { class: 'grow' }),
        focusSelectionButton,
        cancelFocusSelectionButton,
        h('button', { class: 'btn btn-small', type: 'button', 'data-focus-key': 'objetivos', onclick: () => openGoals(root, toast) }, 'Objetivos'),
        h('button', { class: 'btn btn-small', type: 'button', 'data-focus-key': 'midias', onclick: () => void openMediaLibrary(root, toast) }, 'Mídias'),
        h(
          'button',
          {
            class: 'btn btn-small btn-primary',
            type: 'button',
            'data-focus-key': 'nova-tarefa',
            onclick: () =>
              openNewTask(
                root,
                columns.map((list) => list.name),
                (next) => void openTasksBoard(root, state, toast, next),
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
            'data-focus-key': 'concluidas',
            onclick: (e: Event) => toggleCompleted(e.currentTarget as HTMLButtonElement),
          },
          'Mostrar concluídas',
        ),
        h(
          'button',
          {
            class: 'icon-btn',
            type: 'button',
            'data-focus-key': 'fechar',
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
                {
                  class: 'tcol-list',
                  style: 'list-style:none;margin:0',
                  'data-list': list.name,
                  'aria-label': `Tarefas de ${list.name}`,
                },
                ...(list.tasks.length === 0
                  ? [h('li', { class: 'tcol-empty' }, 'Nenhuma tarefa')]
                  : list.tasks.map((task) =>
                      h(
                        'li',
                        {
                          class: `tcard task-readonly${task.status === 'discarded' ? ' task-discarded' : ''}`,
                          role: 'button',
                          tabindex: '0',
                          'data-focus-key': `${list.name} / ${task.text}`,
                          'data-task-line': String(task.line),
                          ...dragAndMove(list, task),
                          onclick: (event: Event) => {
                            if (!selectingFocus || task.status !== 'open') return
                            const target = event.target instanceof HTMLElement ? event.target : null
                            if (target?.closest('button, input')) return
                            toggleFocusSelection(task, event.currentTarget as HTMLElement)
                          },
                          'aria-label': taskAriaLabel(task),
                        },
                        h(
                          'div',
                          { class: 'tcard-top' },
                          task.status === 'open' ? completeBox(task) : null,
                          taskWhen(task)
                            ? h('div', { class: 'tcard-date' }, h('span', { class: 'tcard-date-text' }, taskWhen(task)))
                            : null,
                          h('span', { class: `tcard-title${task.date ? ' tcard-bold' : ''}` }, ...taskTitle(task.text)),
                          task.status !== 'open'
                            ? h(
                                'span',
                                { class: `chip ${task.status === 'completed' ? 'chip-done' : 'chip-err'}` },
                                task.status === 'completed' ? 'Concluída' : 'Descartada',
                              )
                            : null,
                          isFocused(task) ? h('span', { class: 'chip' }, 'Em foco') : null,
                        ),
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
        ),
        completedPanel,
      ),
    ) as HTMLElement

    const updateFocusSelectionCard = (card: HTMLElement, task: Task) => {
      const selected = selectedFocusLines.has(task.line)
      card.classList.toggle('focus-select-selected', selectingFocus && selected)
      if (selectingFocus) {
        card.setAttribute('aria-pressed', String(selected))
        card.setAttribute('aria-label', `${task.text}. ${selected ? 'Selecionada' : 'Não selecionada'} para pôr em foco. Pressione Enter ou Espaço para alterar.`)
      } else {
        card.removeAttribute('aria-pressed')
        card.setAttribute('aria-label', taskAriaLabel(task))
      }
    }
    const toggleFocusSelection = (task: Task, card: HTMLElement) => {
      if (task.status !== 'open') return
      toggleSelectedTask(selectedFocusLines, task.line)
      updateFocusSelectionCard(card, task)
      syncFocusSelectionButtons()
    }
    const syncFocusSelectionButtons = () => {
      focusSelectionButton.classList.toggle('btn-primary', selectingFocus)
      focusSelectionButton.setAttribute('aria-pressed', String(selectingFocus))
      focusSelectionLabel.textContent = selectingFocus
        ? selectedFocusLines.size
          ? `Pôr ${selectedFocusLines.size} em foco`
          : 'Selecione tarefas'
        : 'Pôr em foco'
      cancelFocusSelectionButton.classList.toggle('hidden', !selectingFocus)
      board.classList.toggle('tasks-focus-selecting', selectingFocus)
      for (const card of board.querySelectorAll<HTMLElement>('.task-readonly')) {
        const task = columns.flatMap((list) => list.tasks).find((item) => `${item.line}` === card.dataset.taskLine)
        if (!task) continue
        updateFocusSelectionCard(card, task)
        for (const action of card.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input')) {
          if (selectingFocus) {
            if (!actionDisabledBeforeSelection.has(action)) actionDisabledBeforeSelection.set(action, action.disabled)
            action.disabled = true
          } else if (actionDisabledBeforeSelection.has(action)) {
            action.disabled = actionDisabledBeforeSelection.get(action) ?? false
            actionDisabledBeforeSelection.delete(action)
          }
        }
      }
    }
    const finishFocusSelection = () => {
      selectingFocus = false
      selectedFocusLines.clear()
      syncFocusSelectionButtons()
    }
    const applyFocusSelection = async () => {
      if (!selectedFocusLines.size) {
        toast('Selecione ao menos uma tarefa para pôr em foco.', 'info')
        return
      }
      const selected = tasksToFocusSelection(columns.flatMap((list) => list.tasks), selectedFocusLines, focused)
      if (!selected.length) {
        finishFocusSelection()
        toast('As tarefas selecionadas já estão em foco.', 'info')
        return
      }
      let added = 0
      try {
        let nextBoard = data
        for (const task of selected) {
          const next = await window.office.focusTask(task.line)
          nextBoard = next.board
          added++
        }
        finishFocusSelection()
        toast(`${added} ${added === 1 ? 'tarefa posta' : 'tarefas postas'} em foco.`, 'ok')
        void openTasksBoard(root, state, toast, nextBoard)
      } catch (err) {
        finishFocusSelection()
        toast(added ? `${added} tarefa(s) foram adicionadas; a seleção parou: ${cleanError(err)}` : cleanError(err), 'err')
        void openTasksBoard(root, state, toast)
      }
    }
    focusSelectionButton.addEventListener('click', () => {
      if (selectingFocus) void applyFocusSelection()
      else {
        selectingFocus = true
        selectedFocusLines.clear()
        syncFocusSelectionButtons()
        board.querySelector<HTMLElement>('.task-readonly')?.focus({ preventScroll: true })
      }
    })
    cancelFocusSelectionButton.addEventListener('click', () => {
      finishFocusSelection()
      focusSelectionButton.focus({ preventScroll: true })
    })

    asDialog(board, { label: 'Quadro Tarefas' })
    const columnEls = [...board.querySelectorAll<HTMLElement>('.tcol')]
    const cardsOf = (column: HTMLElement) => [...column.querySelectorAll<HTMLElement>('.task-readonly')]
    for (const column of columnEls) {
      const cards = cardsOf(column)
      if (cards.length) rove(cards, 0)
    }
    board.addEventListener('focusin', (event) => {
      const card = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('.task-readonly') : null
      const column = card?.closest<HTMLElement>('.tcol')
      if (card && column) rove(cardsOf(column), cardsOf(column).indexOf(card))
    })
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
    // Capture on window, like the "?" shortcut: the game listens on window and would move the player.
    const onKey = (event: KeyboardEvent) => {
      if (!board.isConnected || isTyping() || event.altKey || event.metaKey || event.ctrlKey) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (selectingFocus) {
          finishFocusSelection()
          focusSelectionButton.focus({ preventScroll: true })
        } else board.remove()
        return
      }
      if (!ARROWS.includes(event.key)) return
      event.preventDefault()
      event.stopPropagation()
      moveFocus(columnEls, event.key)
    }
    window.addEventListener('keydown', onKey, true)
    board.addEventListener('click', (event) => {
      if (event.target !== board) return
      if (selectingFocus) {
        finishFocusSelection()
        focusSelectionButton.focus({ preventScroll: true })
      } else board.remove()
    })
    // Read after the awaits, so it is the board that is open now. The old board is replaced in
    // one step: between the remove and the append there is no frame without a board.
    const previous = root.querySelector<HTMLElement>('[data-tasks-board]')
    const scroll = previous ? readScroll(previous) : undefined
    const keyBefore = previous ? focusedKey(previous) : undefined
    const hadFocus = !!previous?.contains(document.activeElement)
    const focusBack = (previous && focusMemory.get(previous)) || new FocusReturn()
    focusMemory.set(board, focusBack)
    if (!previous) focusBack.save(board)
    const observer = new MutationObserver(() => {
      if (board.isConnected) return
      observer.disconnect()
      window.removeEventListener('keydown', onKey, true)
      if (!replaced.has(board)) focusBack.restore(board)
    })
    observer.observe(root, { childList: true })
    const landing = moved
      ? [...board.querySelectorAll<HTMLElement>('.task-readonly')].find(
          (card) =>
            card.closest('.tcol')?.getAttribute('aria-label') === `Lista ${moved.list}` &&
            card.querySelector('.tcard-title')?.textContent === moved.text,
        )
      : undefined
    const target: HTMLElement = landing ?? columnEls[0] ?? board
    if (previous && scroll) {
      replaced.add(previous)
      board.classList.add('board-redraw')
      previous.replaceWith(board)
      applyScroll(board, scroll)
      // The focus moves to the same card or button; if it was outside the board (a text field, the popup), it stays there.
      const back = keyBefore !== undefined && refocusKey(board, keyBefore)
      if (hadFocus && !back) target.focus({ preventScroll: true })
    } else {
      root.append(board)
      target.focus({ preventScroll: true })
    }
  } catch (err) {
    toast(cleanError(err), 'err')
  }
}

/**
 * Draws the Tarefas board again with `board` when it is open; a board the user closed stays
 * closed. Used after a completion and after its undo, which can come from the focus popup.
 */
export function refreshTasksBoard(root: HTMLElement, state: State, toast: Toast, board: ParsedBoard): void {
  if (!root.querySelector('[data-tasks-board]')) return
  void openTasksBoard(root, state, toast, board)
}
