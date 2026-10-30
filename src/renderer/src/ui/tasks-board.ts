import type { State } from '../state'
import { focusKey } from '@shared/planning'
import { tasksToFocusSelection, toggleSelectedTask } from '@shared/task-focus-selection'
import { parseEmphasis } from '@shared/emphasis'
import {
  ARCHIVE_LIST,
  boardView,
  type DueKind,
  type ParsedBoard,
  rescheduleTargets,
  type Task,
  taskDue,
  taskWhen,
  type TaskList,
  type TaskRef,
} from '@shared/tasks'
import { asDialog, FocusReturn, focusedKey, isTyping, refocusKey, rove } from './a11y'
import { h, icon } from './dom'
import { renderInlineMarkdown } from './markdown'
import { cleanError } from './modals'
import { offerUndo, type Toast } from './tasks-complete'
import { openMoveMenu, openTaskMenu } from './tasks-move'
import { openNewTask } from './tasks-new'
import { openGoals } from './goals'
import { openWritingLibrary } from './writing'
import { openMediaLibrary } from './media-library'
import { runDiscard, runReopen } from './tasks-discard'
import { keepScroll } from './tasks-scroll'
import './focus.css'

/** The focus memory of each open board. A redraw hands it to the board that replaces it. */
const focusMemory = new WeakMap<HTMLElement, FocusReturn>()
/** Boards taken out by a redraw: their close watcher must not give the focus back. */
const replaced = new WeakSet<HTMLElement>()
/** The list shown on the right, remembered between openings (round 5: one list at a time). */
let chosenList: string | undefined
/** Whether the "Concluídas e descartadas" group of the list is open. */
let doneOpen = true

const DUE_LABEL: Record<DueKind, string> = { late: 'Atrasada', today: 'Hoje', soon: 'Amanhã', later: '', none: 'Sem prazo' }

/** The deadline badge of the boards: label and color, never color alone (Atrasada · 22/10, Hoje, Amanhã, 02/11, Sem prazo). */
export function dueBadge(kind: DueKind, day: string): HTMLElement {
  const text = kind === 'later' ? day : kind === 'late' && day ? `${DUE_LABEL.late} · ${day}` : DUE_LABEL[kind]
  return h('span', { class: `due due-${kind}` }, kind === 'none' ? null : icon('calendar', 12), text)
}

/** Scroll of the open list (by name), read before a redraw. */
function readScroll(board: HTMLElement): Record<string, number> {
  const panel = board.querySelector<HTMLElement>('.tk-panel')
  return panel ? { [panel.dataset.list ?? '']: panel.scrollTop } : {}
}

/** Puts the scroll back on the new board; it must be in the document, so the sizes are known. */
function applyScroll(board: HTMLElement, scroll: Record<string, number>): void {
  const panel = board.querySelector<HTMLElement>('.tk-panel')
  if (!panel) return
  const name = panel.dataset.list ?? ''
  const top = keepScroll(scroll, [name], { [name]: panel.scrollHeight - panel.clientHeight })[name]
  if (top !== undefined) panel.scrollTop = top
}

/** `moved` is the card to focus after a change: the list it is in and its title. */
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
    const now = new Date()
    const taskAriaLabel = (task: Task) =>
      [
        parseEmphasis(task.text)
          .map((segment) => segment.text)
          .join(''),
        task.status === 'open' ? 'Aberta' : task.status === 'completed' ? 'Concluída' : 'Descartada',
        isFocused(task) ? 'Em foco' : '',
        taskWhen(task) ? `Data ${taskWhen(task)}` : 'Sem prazo',
        task.completedDate ? `Em ${task.completedDate}` : '',
        task.status === 'open'
          ? 'Enter move para outra lista, F põe ou tira do foco, R reagenda, D descarta'
          : 'Enter move para outra lista, F põe ou tira do foco',
      ]
        .filter(Boolean)
        .join('. ')
    // The Archive is not a list of its own on the left unless it holds something: see boardView.
    const { columns, completed } = boardView(data.lists)
    const openOf = (list: TaskList) => list.tasks.filter((task) => task.status === 'open')
    const archived = completed.filter((item) => item.list === ARCHIVE_LIST).map((item) => item.task)
    const names = columns.map((list) => list.name).concat(archived.length ? [ARCHIVE_LIST] : [])
    if (moved && names.includes(moved.list)) chosenList = moved.list
    if (!chosenList || !names.includes(chosenList)) chosenList = names[0]
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
    const openMove = (card: HTMLElement, list: string, task: Task) =>
      openMoveMenu(
        card,
        data.lists.map((l) => l.name).filter((name) => name !== list && name !== ARCHIVE_LIST),
        (to) => void move(task.line, task.text, to),
      )
    // The main process writes the new date; a refusal (a legacy line, the file changed) comes back as the toast.
    const reschedule = async (list: string, task: Task, date: string) => {
      try {
        const next = await window.office.rescheduleTask({ line: task.line, date })
        toast(`Tarefa reagendada para ${date}.`, 'ok')
        void openTasksBoard(root, state, toast, next.board, { list, text: task.text })
      } catch (err) {
        toast(cleanError(err), 'err')
      }
    }
    const openReschedule = (card: HTMLElement, list: string, task: Task) =>
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
    const toggleFocus = async (list: string, task: Task, wasFocused: boolean) => {
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
        void openTasksBoard(root, state, toast, next, { list, text: task.text })
      } catch (err) {
        toast(cleanError(err), 'err')
      }
    }
    const focusSelectionLabel = h('span', {}, 'Pôr em foco')
    const focusSelectionButton = h(
      'button',
      {
        class: 'btn btn-small tasks-focus-select',
        type: 'button',
        'aria-pressed': 'false',
        'data-focus-key': 'selecionar-foco',
      },
      icon('pin', 14),
      focusSelectionLabel,
    ) as HTMLButtonElement
    const cancelFocusSelectionButton = h(
      'button',
      {
        class: 'btn btn-small tasks-focus-cancel hidden',
        type: 'button',
        'data-focus-key': 'cancelar-selecao-foco',
      },
      'Cancelar',
    ) as HTMLButtonElement
    // "Concluir" completes the task at once: the card leaves the list, and the undo toast stays for 10 s.
    const complete = async (button: HTMLButtonElement, target: TaskRef, title: string) => {
      button.disabled = true
      try {
        const next = await window.office.completeTask(target)
        offerUndo(toast, title, next.id, (undone) => refreshTasksBoard(root, state, toast, undone.board))
        refreshTasksBoard(root, state, toast, next.board)
      } catch (err) {
        button.disabled = false
        toast(cleanError(err), 'err')
      }
    }
    // Discarding asks for the reason first; the card leaves the list and its line goes to the Archive.
    const discardCard = (task: Task) =>
      void runDiscard(root, toast, { line: task.line }, task.text, (next) => {
        void openTasksBoard(root, state, toast, next.board)
      })
    // A completed or discarded task goes back to its origin list, and its card is focused there.
    const reopenRow = (task: Task) =>
      void runReopen(root, toast, { line: task.line }, task.text, (next) => {
        void openTasksBoard(root, state, toast, next.board, { list: next.list, text: task.text })
      })
    /** Drag (onto a list button) and keyboard for a card; the Archive is read-only. */
    const dragAndMove = (list: string, task: Task): Record<string, string | EventListener | undefined> => {
      if (list === ARCHIVE_LIST) return {}
      return {
        draggable: 'true',
        ondragstart: (e: Event) => {
          if (selectingFocus) {
            e.preventDefault()
            return
          }
          const drag = e as DragEvent
          dragging = { line: task.line, list, text: task.text }
          if (drag.dataTransfer) {
            drag.dataTransfer.effectAllowed = 'move'
            drag.dataTransfer.setData('text/plain', task.text)
          }
          ;(drag.currentTarget as HTMLElement).classList.add('dragging')
        },
        ondragend: () => {
          dragging = null
          board.querySelectorAll('.dragging, .tk-over').forEach((n) => n.classList.remove('dragging', 'tk-over'))
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
          const plain = !key.ctrlKey && !key.metaKey && !key.altKey
          if (key.key === 'Enter' || key.key === ' ') {
            key.preventDefault()
            openMove(key.currentTarget as HTMLElement, list, task)
          } else if (plain && key.key.toLowerCase() === 'f') {
            key.preventDefault()
            void toggleFocus(list, task, isFocused(task))
          } else if (plain && key.key.toLowerCase() === 'r' && task.status === 'open') {
            // R is also the Reports shortcut of the page: this keeps it from opening over the board.
            key.preventDefault()
            key.stopPropagation()
            openReschedule(key.currentTarget as HTMLElement, list, task)
          } else if (plain && key.key.toLowerCase() === 'd' && task.status === 'open') {
            key.preventDefault()
            discardCard(task)
          }
        },
      }
    }
    const cardOf = (e: Event) => (e.currentTarget as HTMLElement).closest<HTMLElement>('.tk-card')!
    /** The actions of a card show when it is selected (clicked or focused): round 5, capture 20. */
    const cardActions = (list: string, task: Task) => {
      const button = (text: string, onclick: (e: Event) => void, extra = '') =>
        h('button', { class: `btn btn-small${extra}`, type: 'button', onclick }, text)
      if (task.status === 'open')
        return h(
          'div',
          { class: 'tk-actions' },
          button('Concluir', (e) => void complete(e.currentTarget as HTMLButtonElement, { line: task.line }, task.text), ' tcard-complete'),
          button('Reagendar', (e) => openReschedule(cardOf(e), list, task), ' tcard-reschedule'),
          button('Mover', (e) => openMove(cardOf(e), list, task), ' tcard-move'),
          button(isFocused(task) ? 'Tirar do foco' : 'Pôr em foco', () => void toggleFocus(list, task, isFocused(task)), ' tcard-focus'),
          button('Descartar', () => discardCard(task), ' btn-danger-soft tcard-discard'),
        )
      return h(
        'div',
        { class: 'tk-actions' },
        button('Reabrir', () => reopenRow(task), ' tcard-reopen'),
        list !== ARCHIVE_LIST && isFocused(task) ? button('Tirar do foco', () => void toggleFocus(list, task, true), ' tcard-focus') : null,
      )
    }
    const card = (list: string, task: Task, pos: number) => {
      const due = taskDue(task, now)
      const late = task.status === 'open' && due.kind === 'late'
      return h(
        'li',
        {
          class: `tcard task-readonly tk-card${late ? ' tk-late' : ''}${task.status === 'open' ? '' : ` task-${task.status}`}`,
          tabindex: '0',
          'data-focus-key': `${list} / ${task.text}`,
          'data-task-line': String(task.line),
          'data-task-text': task.text,
          ...dragAndMove(list, task),
          onclick: (event: Event) => {
            if (!selectingFocus || task.status !== 'open') return
            const target = event.target instanceof HTMLElement ? event.target : null
            if (target?.closest('button, input, a')) return
            toggleFocusSelection(task, event.currentTarget as HTMLElement)
          },
          'aria-label': taskAriaLabel(task),
        },
        h(
          'div',
          { class: 'tk-top' },
          h('span', { class: 'tk-pos', title: 'Posição na lista' }, `#${pos}`),
          h(
            'span',
            { class: `tk-state tk-state-${task.status}` },
            task.status === 'open' ? 'Aberta' : task.status === 'completed' ? 'Concluída' : 'Descartada',
          ),
          isFocused(task) ? h('span', { class: 'tk-focus-chip' }, icon('pin', 11), 'Em foco') : null,
          h('span', { class: 'grow' }),
          task.status === 'open'
            ? dueBadge(due.kind, due.day)
            : task.completedDate
              ? h('span', { class: 'tk-sub' }, task.completedDate)
              : null,
        ),
        renderInlineMarkdown(task.text, 'tcard-title tk-title'),
        task.time ? h('div', { class: 'tk-sub' }, `às ${task.time}`) : null,
        task.reason ? h('div', { class: 'tk-sub' }, `Motivo: ${task.reason}`) : null,
        cardActions(list, task),
      )
    }
    const legend = h(
      'div',
      { class: 'tk-legend', 'aria-label': 'Cores do prazo' },
      dueBadge('late', ''),
      dueBadge('today', ''),
      dueBadge('soon', ''),
      dueBadge('later', 'Data'),
      dueBadge('none', ''),
    )
    const nav = h('nav', { class: 'tk-lists', 'aria-label': 'Listas' }, h('div', { class: 'tk-lists-cap' }, 'Listas'))
    const panel = h('section', { class: 'tk-panel', tabindex: '-1' })
    /** The tasks of the chosen list in one column; completed and discarded ones in a group below. */
    const paintPanel = () => {
      const name = chosenList ?? ''
      const column = columns.find((list) => list.name === name)
      const open = column ? openOf(column) : []
      const done = column
        ? column.tasks.filter((task) => task.status === 'discarded').concat(completed.filter((c) => c.list === name).map((c) => c.task))
        : archived
      const doneList = h('ul', { class: 'tk-cards', hidden: !doneOpen }, ...done.map((task, i) => card(name, task, open.length + i + 1)))
      const doneHead = h(
        'button',
        {
          class: 'tk-done-head',
          type: 'button',
          'aria-expanded': String(doneOpen),
          'data-focus-key': 'concluidas',
          onclick: () => {
            doneOpen = !doneOpen
            doneList.hidden = !doneOpen
            doneHead.setAttribute('aria-expanded', String(doneOpen))
          },
        },
        icon('chevron', 13),
        `Concluídas e descartadas (${done.length})`,
      )
      panel.dataset.list = name
      panel.setAttribute('aria-label', `Lista ${name}`)
      panel.replaceChildren(
        ...[
          h(
            'div',
            { class: 'tk-panel-head' },
            h('h3', {}, name === ARCHIVE_LIST ? 'Arquivo' : name),
            h('span', { class: 'tk-sub' }, column ? `${open.length} aberta${open.length === 1 ? '' : 's'}` : 'só leitura'),
            column ? legend : null,
          ),
          open.length
            ? h('ul', { class: 'tk-cards', 'aria-label': `Tarefas de ${name}` }, ...open.map((task, i) => card(name, task, i + 1)))
            : column
              ? h(
                  'div',
                  { class: 'tk-empty' },
                  icon('list', 26),
                  h('b', {}, 'Nenhuma tarefa aberta nesta lista'),
                  h('span', {}, 'Use “Nova tarefa” ou peça à Luna.'),
                )
              : null,
          done.length ? h('div', { class: 'tk-done' }, doneHead, doneList) : null,
        ].filter((n) => n !== null),
      )
      for (const btn of nav.querySelectorAll<HTMLElement>('.tk-lbtn')) {
        const on = btn.dataset.list === name
        btn.classList.toggle('on', on)
        btn.setAttribute('aria-current', String(on))
      }
      const cards = [...panel.querySelectorAll<HTMLElement>('.tk-card')]
      if (cards.length) rove(cards, 0)
      if (selectingFocus) syncFocusSelectionButtons()
    }
    const choose = (name: string) => {
      if (name === chosenList) return
      chosenList = name
      paintPanel()
    }
    for (const name of names) {
      const column = columns.find((list) => list.name === name)
      const open = column ? openOf(column) : []
      const kinds = open.map((task) => taskDue(task, now).kind)
      const late = kinds.filter((k) => k === 'late').length
      const today = kinds.filter((k) => k === 'today').length
      const btn = h(
        'button',
        {
          class: 'tk-lbtn',
          type: 'button',
          'data-list': name,
          'data-focus-key': `lista / ${name}`,
          onclick: () => choose(name),
        },
        h('span', { class: 'grow' }, name === ARCHIVE_LIST ? 'Arquivo' : name),
        late
          ? h('span', { class: 'tk-lbadge late' }, `${late} atrasada${late === 1 ? '' : 's'}`)
          : today
            ? h('span', { class: 'tk-lbadge today' }, `${today} hoje`)
            : null,
        h('span', { class: 'tk-lcount', title: column ? 'Abertas' : 'Descartadas' }, String(column ? open.length : archived.length)),
      )
      // Dropping a card on another list's button moves the task there.
      if (column) {
        btn.addEventListener('dragover', (e) => {
          if (!dragging || dragging.list === name) return
          e.preventDefault()
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
          btn.classList.add('tk-over')
        })
        btn.addEventListener('dragleave', () => btn.classList.remove('tk-over'))
        btn.addEventListener('drop', (e) => {
          e.preventDefault()
          btn.classList.remove('tk-over')
          const drop = dragging
          dragging = null
          if (drop && drop.list !== name) void move(drop.line, drop.text, name)
        })
      }
      nav.append(btn)
    }
    const openTotal = columns.reduce((count, list) => count + openOf(list).length, 0)
    const board = h(
      'div',
      { class: 'board tasks-board', tabindex: '-1', 'data-tasks-board': 'true' },
      h(
        'div',
        { class: 'board-head' },
        h('div', { class: 'board-title' }, icon('kanban', 18), 'Tarefas'),
        h(
          'span',
          { class: 'board-count' },
          `${openTotal} aberta${openTotal === 1 ? '' : 's'} em ${columns.length} lista${columns.length === 1 ? '' : 's'}`,
        ),
        h('span', { class: 'grow' }),
        focusSelectionButton,
        cancelFocusSelectionButton,
        h(
          'button',
          { class: 'btn btn-small', type: 'button', 'data-focus-key': 'escrita', onclick: () => openWritingLibrary(root, toast) },
          'Escrita',
        ),
        h(
          'button',
          { class: 'btn btn-small', type: 'button', 'data-focus-key': 'objetivos', onclick: () => openGoals(root, toast) },
          'Objetivos',
        ),
        h(
          'button',
          { class: 'btn btn-small', type: 'button', 'data-focus-key': 'midias', onclick: () => void openMediaLibrary(root, toast) },
          'Mídias',
        ),
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
      names.length === 0
        ? h(
            'div',
            { class: 'board-body tk-board' },
            h(
              'div',
              { class: 'empty-box panelbox' },
              h('b', {}, 'Nenhuma lista encontrada'),
              h('span', {}, 'O arquivo tarefas.md não contém títulos de lista iniciados por “##”.'),
            ),
          )
        : h('div', { class: 'board-body tk-board' }, nav, panel),
    ) as HTMLElement

    const updateFocusSelectionCard = (card: HTMLElement, task: Task) => {
      const selected = selectedFocusLines.has(task.line)
      card.classList.toggle('focus-select-selected', selectingFocus && selected)
      if (selectingFocus) {
        card.setAttribute('aria-pressed', String(selected))
        card.setAttribute(
          'aria-label',
          `${task.text}. ${selected ? 'Selecionada' : 'Não selecionada'} para pôr em foco. Pressione Enter ou Espaço para alterar.`,
        )
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
      const selected = tasksToFocusSelection(
        columns.flatMap((list) => list.tasks),
        selectedFocusLines,
        focused,
      )
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
        board.querySelector<HTMLElement>('.tk-card')?.focus({ preventScroll: true })
      }
    })
    cancelFocusSelectionButton.addEventListener('click', () => {
      finishFocusSelection()
      focusSelectionButton.focus({ preventScroll: true })
    })

    asDialog(board, { label: 'Quadro Tarefas' })
    if (names.length) paintPanel()
    // The selected card shows its actions; it stays selected until another card is.
    const select = (event: Event) => {
      const card = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('.tk-card') : null
      if (!card) return
      for (const other of board.querySelectorAll('.tk-card.tk-sel')) if (other !== card) other.classList.remove('tk-sel')
      card.classList.add('tk-sel')
      const cards = [...panel.querySelectorAll<HTMLElement>('.tk-card')]
      rove(cards, cards.indexOf(card))
    }
    board.addEventListener('focusin', select)
    board.addEventListener('click', select)
    /** ↑/↓ go through the lists (choosing them) or through the cards; ← and → cross between the two. */
    const arrow = (key: string): void => {
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
      const buttons = [...nav.querySelectorAll<HTMLElement>('.tk-lbtn')]
      const cards = [...panel.querySelectorAll<HTMLElement>('.tk-card')].filter((c) => c.offsetParent !== null)
      const current = buttons.find((b) => b.dataset.list === chosenList)
      if (active && nav.contains(active)) {
        if (key === 'ArrowRight') return cards[0]?.focus()
        if (key !== 'ArrowUp' && key !== 'ArrowDown') return
        const at = Math.max(0, Math.min(buttons.length - 1, buttons.indexOf(active) + (key === 'ArrowDown' ? 1 : -1)))
        buttons[at]?.focus()
        choose(buttons[at]?.dataset.list ?? '')
        return
      }
      const card = active?.closest<HTMLElement>('.tk-card') ?? null
      if (key === 'ArrowLeft') return current?.focus()
      if (key === 'ArrowRight') return
      if (!card) return (cards[0] ?? current)?.focus()
      const at = Math.max(0, Math.min(cards.length - 1, cards.indexOf(card) + (key === 'ArrowDown' ? 1 : -1)))
      cards[at]?.focus()
    }
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
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return
      event.preventDefault()
      event.stopPropagation()
      arrow(event.key)
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
      ? [...panel.querySelectorAll<HTMLElement>('.tk-card')].find((card) => card.dataset.taskText === moved.text)
      : undefined
    const target: HTMLElement = landing ?? nav.querySelector<HTMLElement>('.tk-lbtn.on') ?? board
    if (previous && scroll) {
      replaced.add(previous)
      board.classList.add('board-redraw')
      previous.replaceWith(board)
      applyScroll(board, scroll)
      // The focus moves to the same card or button; if it was outside the board (a text field, the popup), it stays there.
      const back = !landing && keyBefore !== undefined && refocusKey(board, keyBefore)
      if ((hadFocus || landing) && !back) target.focus({ preventScroll: true })
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
