import { clockText, type FocusItem, STEP_MAX, TIMER_MINUTES } from '@shared/planning'
import type { State } from '../state'
import { arrowList, keepFocus, modalA11y, rove } from './a11y'
import { h, icon } from './dom'
import { setFocusPopupOpen } from './focus-state'
import { cleanError } from './modals/common'
import { openTasksBoard, refreshTasksBoard } from './tasks-board'
import { offerUndo, type Toast } from './tasks-complete'
import { runDiscard } from './tasks-discard'
import './focus.css'

/**
 * The "Tarefas em foco" popup (key F): the focused tasks in one column, stacked and scrolled.
 * It reads tarefas.md each time it opens; a focused task whose id is gone is shown as missing,
 * and can only be taken out of the focus. Esc or a click outside closes it, and the focus goes
 * back to what had it. The focus timer (AO-08) is one session for all tasks: its card shows it,
 * and the running clock counts down here until the main process reports the new state.
 */

type TaskItem = Extract<FocusItem, { missing: false }>

export async function openFocusPopup(root: HTMLElement, state: State, toast: Toast): Promise<void> {
  if (!state.settings.vaultPath) {
    toast('Configure a pasta do vault em Ajustes → Tarefas do Obsidian.', 'err')
    return
  }
  let items: FocusItem[]
  try {
    items = await window.office.readFocus()
  } catch (err) {
    toast(cleanError(err), 'err')
    return
  }
  let current: FocusItem[] = items
  // When the running clock was last set from the main process; the countdown is relative to it.
  let clockBase = Date.now()

  // The approved look (HANDOFF 3.1): the same card of the board Tarefas, anchored above the dock.
  const title = h('span', { id: 'focus-t' }, 'Tarefas em foco')
  const status = h('span', { class: 'board-count', role: 'status' })
  const colCount = h('span', { class: 'tcol-count' }, '0')
  const list = h('ul', { class: 'tcol-list', 'aria-label': 'Tarefas em foco' })
  const empty = h(
    'div',
    { class: 'tcol-empty empty-box' },
    icon('pin', 30),
    h('b', {}, 'Nenhuma tarefa em foco'),
    h('span', {}, 'Escolha no quadro Tarefas o que merece atenção agora, ou peça à Luna para ajudar a montar o foco.'),
    h(
      'button',
      {
        class: 'btn btn-primary',
        type: 'button',
        onclick: () => {
          close()
          void openTasksBoard(root, state, toast)
        },
      },
      'Abrir quadro Tarefas',
    ),
  )
  const change = h(
    'button',
    { class: 'btn btn-small', type: 'button', hidden: true, onclick: () => { close(); void openTasksBoard(root, state, toast) } },
    'Mudar seleção',
  )
  const col = h(
    'section',
    { class: 'tcol', 'aria-label': 'Em foco' },
    h(
      'div',
      { class: 'tcol-head' },
      h('span', { class: 'tcol-dot', style: 'background: var(--accent)' }),
      h('span', { class: 'tcol-label' }, 'Em foco'),
      colCount,
    ),
    list,
    empty,
    h('div', { class: 'foco-note' }, 'Marque a caixa quando concluir a tarefa. Só você conclui; a seleção continua amanhã.'),
  )

  const card = (item: FocusItem): HTMLElement => {
    const el = h('li', { class: `focus-card${item.missing ? ' focus-card-missing' : ''}`, 'data-focus-key': item.id })
    const actions = h('div', { class: 'focus-card-actions' })
    if (item.missing) {
      el.append(
        h('div', { class: 'focus-card-title' }, 'Não está mais no tarefas.md'),
        h('div', { class: 'focus-card-origin' }, `Identificador ${item.id}`),
      )
    } else {
      el.append(
        h(
          'label',
          { class: 'focus-card-done-label' },
          h('input', {
            class: 'focus-card-done',
            type: 'checkbox',
            'aria-label': `Marcar “${item.text}” como concluída`,
            onchange: (e: Event) => void complete(e.currentTarget as HTMLInputElement, item),
          }),
          h('span', {}, 'Concluir'),
        ),
        h('div', { class: 'focus-card-title' }, item.text),
        h('div', { class: 'focus-card-origin' }, `Lista: ${item.list}`),
      )
      if (item.step) el.append(h('div', { class: 'focus-card-step' }, `Passo de hoje: ${item.step}`))
      el.append(timerBlock(item))
      actions.append(
        h('button', { class: 'btn btn-small', type: 'button', onclick: () => openStep(actions, item.id, item.step) }, 'Passo de hoje'),
        h('button', { class: 'btn btn-small focus-card-discard', type: 'button', onclick: () => void discard(item) }, 'Descartar'),
      )
    }
    actions.append(
      h('button', { class: 'btn btn-small focus-card-remove', type: 'button', onclick: () => void remove(item.id) }, 'Tirar do foco'),
    )
    el.append(actions)
    return el
  }

  // One session for the whole popup: the card of its task shows it; the other cards only offer to start one,
  // and the main process refuses while another session is running, paused or unconfirmed.
  const timerBlock = (item: TaskItem): HTMLElement => {
    const box = h('div', { class: 'focus-timer' })
    const timer = item.timer
    const start = h(
      'button',
      {
        class: 'btn btn-small',
        type: 'button',
        onclick: () => void act(item.id, () => window.office.startTimer(item.id), 'Timer de foco iniciado.'),
      },
      `Começar timer de ${TIMER_MINUTES} min`,
    )
    if (!timer || timer.state === 'confirmada') {
      if (timer)
        box.append(h('div', { class: 'focus-timer-line' }, `Última sessão: ${timer.confirmedMinutes ?? 0} min feitos, confirmados.`))
      box.append(start)
      return box
    }
    if (timer.state === 'em andamento') {
      box.append(
        h(
          'div',
          { class: 'focus-timer-line' },
          'Em andamento: ',
          h('span', { class: 'focus-timer-clock', 'data-timer-clock': '' }, clockText(timer.remainingMs)),
          ' restantes',
        ),
        h(
          'div',
          { class: 'focus-card-actions' },
          h(
            'button',
            {
              class: 'btn btn-small',
              type: 'button',
              onclick: () => void act(item.id, () => window.office.pauseTimer(item.id), 'Timer pausado.'),
            },
            'Pausar',
          ),
          h(
            'button',
            {
              class: 'btn btn-small',
              type: 'button',
              onclick: () => void act(item.id, () => window.office.stopTimer(item.id), 'Timer parado. Confirme os minutos feitos.'),
            },
            'Parar',
          ),
        ),
      )
    } else if (timer.state === 'pausada') {
      box.append(
        h(
          'div',
          { class: 'focus-timer-line' },
          'Pausado: ',
          h('span', { class: 'focus-timer-clock', 'data-timer-clock': '' }, clockText(timer.remainingMs)),
          ' restantes',
        ),
        h(
          'div',
          { class: 'focus-card-actions' },
          h(
            'button',
            {
              class: 'btn btn-small',
              type: 'button',
              onclick: () => void act(item.id, () => window.office.resumeTimer(item.id), 'Timer retomado.'),
            },
            'Retomar',
          ),
          h(
            'button',
            {
              class: 'btn btn-small',
              type: 'button',
              onclick: () => void act(item.id, () => window.office.stopTimer(item.id), 'Timer parado. Confirme os minutos feitos.'),
            },
            'Parar',
          ),
        ),
      )
    } else {
      box.append(h('div', { class: 'focus-timer-line' }, 'Sessão interrompida, com tempo não confirmado.'), confirmEditor(item.id))
    }
    return box
  }

  // The minutes done in an interrupted session: typed by the user, checked by the main process (0 to 25 whole minutes).
  const confirmEditor = (id: string): HTMLElement => {
    const input = h('input', {
      class: 'input focus-timer-input',
      type: 'number',
      min: '0',
      max: String(TIMER_MINUTES),
      step: '1',
      inputmode: 'numeric',
      'aria-label': 'Minutos feitos nesta sessão',
      placeholder: `0 a ${TIMER_MINUTES}`,
    })
    const confirm = (): void => {
      const raw = input.value.trim()
      void act(id, () => window.office.confirmTimer(id, raw === '' ? Number.NaN : Number(raw)), 'Minutos confirmados.')
    }
    input.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.isComposing) return
      if (e.key === 'Enter') {
        e.preventDefault()
        confirm()
      }
    })
    return h(
      'div',
      { class: 'focus-timer-confirm' },
      h(
        'div',
        { class: 'focus-card-actions' },
        input,
        h('button', { class: 'btn btn-small btn-primary', type: 'button', onclick: confirm }, 'Confirmar minutos'),
      ),
      h('div', { class: 'focus-step-hint' }, `Quantos minutos você fez, de 0 a ${TIMER_MINUTES}? Só você confirma.`),
    )
  }

  // Edits today's step in place of the card's buttons. Enter saves, Esc cancels; an empty text takes the step out.
  const openStep = (actions: HTMLElement, id: string, step: string | undefined): void => {
    const input = h('input', {
      class: 'input focus-step-input',
      type: 'text',
      maxlength: String(STEP_MAX),
      'aria-label': 'Passo de hoje',
      placeholder: 'Ex.: ler até a página 40',
    })
    input.value = step ?? ''
    const cancel = (): void => {
      paint(current)
      focusCard(id)
    }
    const save = async (): Promise<void> => {
      const text = input.value.trim()
      if (!text && !step) return cancel()
      try {
        const next = text ? await window.office.saveStep(id, text) : await window.office.clearStep(id)
        paint(next)
        toast(text ? 'Passo de hoje salvo.' : 'Passo de hoje tirado.', 'ok')
        focusCard(id)
      } catch (err) {
        toast(cleanError(err), 'err')
        input.focus()
      }
    }
    input.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.isComposing) return
      if (e.key === 'Enter') {
        e.preventDefault()
        void save()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        cancel()
      }
    })
    const editor = h(
      'div',
      { class: 'focus-step-editor' },
      input,
      h('div', { class: 'focus-step-hint' }, 'Enter salva. Esc cancela. Campo vazio tira o passo de hoje.'),
      h(
        'div',
        { class: 'focus-card-actions' },
        h('button', { class: 'btn btn-small btn-primary', type: 'button', onclick: () => void save() }, 'Salvar'),
        h('button', { class: 'btn btn-small', type: 'button', onclick: cancel }, 'Cancelar'),
      ),
    )
    actions.replaceWith(editor)
    input.focus()
  }

  const focusCard = (id: string): void => {
    const cards = [...list.querySelectorAll<HTMLElement>('.focus-card')]
    ;(cards.find((c) => c.dataset.focusKey === id) ?? cards[0])?.focus()
  }

  const paint = (next: FocusItem[]): void => {
    current = next
    clockBase = Date.now()
    status.textContent = next.length === 1 ? '1 tarefa em foco' : `${next.length} tarefas em foco`
    colCount.textContent = String(next.length)
    change.hidden = next.length === 0
    list.hidden = next.length === 0
    empty.hidden = next.length > 0
    keepFocus(list, () => list.replaceChildren(...next.map(card)))
    const cards = [...list.querySelectorAll<HTMLElement>('.focus-card')]
    if (cards.length) rove(cards, 0)
  }

  // Runs a timer action and repaints with the focus it returns; the card keeps the focus.
  const act = async (id: string, run: () => Promise<FocusItem[]>, done: string): Promise<void> => {
    try {
      paint(await run())
      toast(done, 'ok')
      focusCard(id)
    } catch (err) {
      toast(cleanError(err), 'err')
    }
  }

  // The checkbox completes the task at once: it leaves the focus and the Archive gets it. Undo stays for 10 s.
  const complete = async (box: HTMLInputElement, item: TaskItem): Promise<void> => {
    try {
      const next = await window.office.completeTask({ id: item.id })
      paint(next.focus)
      offerUndo(toast, item.text, next.id, (undone) => {
        if (backdrop.isConnected) paint(undone.focus)
        refreshTasksBoard(root, state, toast, undone.board)
      })
      refreshTasksBoard(root, state, toast, next.board)
    } catch (err) {
      box.checked = false
      toast(cleanError(err), 'err')
    }
  }

  // Discarding asks for the reason; the task leaves the focus and the board is drawn again if it is open.
  const discard = (item: TaskItem): Promise<void> =>
    runDiscard(root, toast, { id: item.id }, item.text, (next) => {
      paint(next.focus)
      refreshTasksBoard(root, state, toast, next.board)
    })

  // Taking a task out writes nothing to tarefas.md: only the focus set changes.
  const remove = async (id: string) => {
    try {
      paint(await window.office.unfocusTask(id))
      toast('Tarefa tirada do foco.', 'ok')
      ;(list.querySelector<HTMLElement>('.focus-card') ?? empty.querySelector<HTMLElement>('button'))?.focus()
    } catch (err) {
      toast(cleanError(err), 'err')
    }
  }

  // The running clock counts down here, from the time the main process gave. At zero the popup asks for the
  // state again: the main process then reports the session as interrupted, never as completed.
  let refreshing = false
  const refresh = async (): Promise<void> => {
    try {
      paint(await window.office.readFocus())
    } catch (err) {
      toast(cleanError(err), 'err')
    } finally {
      refreshing = false
    }
  }
  const tick = window.setInterval(() => {
    if (!backdrop.isConnected) {
      window.clearInterval(tick)
      return
    }
    const running = current.find((i): i is TaskItem => !i.missing && i.timer?.state === 'em andamento')
    if (!running?.timer) return
    const left = running.timer.remainingMs - (Date.now() - clockBase)
    for (const el of list.querySelectorAll<HTMLElement>('[data-timer-clock]')) el.textContent = clockText(left)
    if (left <= 0 && !refreshing) {
      refreshing = true
      void refresh()
    }
  }, 1000)

  arrowList(list, '.focus-card')
  let closed = false
  const close = (): void => {
    if (closed) return
    closed = true
    backdrop.remove()
    // The button in the dock shows that the popup is open: it stops showing it.
    setFocusPopupOpen(false)
  }
  const closeBtn = h(
    'button',
    { class: 'icon-btn', type: 'button', title: 'Fechar (Esc)', 'aria-label': 'Fechar Tarefas em foco', onclick: close },
    icon('x', 18),
  )
  const board = h(
    'section',
    { class: 'board card foco-pop', tabindex: '-1' },
    h(
      'div',
      { class: 'board-head' },
      h('div', { class: 'board-title' }, icon('pin', 18), title, status),
      change,
      h('span', { class: 'grow' }),
      closeBtn,
    ),
    h('div', { class: 'board-body' }, h('div', { class: 'board-cols foco-cols' }, col)),
  )
  const backdrop = h('div', { class: 'backdrop backdrop-foco' }, board)
  // The same habits of every popup (see modal, in modals/common.ts): a dialog with the focus
  // kept inside that returns the focus, Esc closes, and a click outside closes it too.
  modalA11y(backdrop, board, title)
  backdrop.addEventListener('pointerdown', (e) => {
    if (e.target === backdrop) close()
  })
  backdrop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close()
    e.stopPropagation()
  })
  paint(items)
  root.append(backdrop)
  setFocusPopupOpen(true)
  ;(list.querySelector<HTMLElement>('.focus-card') ?? empty.querySelector<HTMLElement>('button'))?.focus()
}
