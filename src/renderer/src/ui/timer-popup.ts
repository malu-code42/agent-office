import {
  BAR_INTERVALS,
  BAR_STATUS,
  barClockText,
  barMs,
  barRemaining,
  intervalTitle,
  type BarMode,
  type BarTimerView,
} from '@shared/barTimer'
import type { FocusItem } from '@shared/planning'
import type { State } from '../state'
import { keepFocus, modalA11y } from './a11y'
import { h, icon } from './dom'
import { renderInlineMarkdown } from './markdown'
import { closeFocusPopup } from './focus-state'
import { openFocusPopup } from './focus-popup'
import { cleanError } from './modals/common'
import { onBarTimerView, requestTimerPopupClose, setTimerPopupOpen } from './timer-state'
import type { Toast } from './tasks-complete'
import './focus.css'

/**
 * The popup of the Timer (the bar button): the approved card of the board "Tarefas em foco",
 * in its same popover, with the clock face, the fixed intervals, the optional task link and
 * the three actions. It reads the Timer and the focus every time it opens; the watchers of
 * the barTimer events redraw the open popup. It never completes a task: at zero it only
 * warns once, and the Timer goes back to stopped.
 */

/** The bar's clock icon: the mark of icon() dressed as a clock, without arrows. */
const clockSvg = (size: number): SVGSVGElement => {
  const mark = icon('spark', size)
  mark.innerHTML = '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
  return mark
}

/** A focused task available to be linked to the interval: id, title and list. */
type TaskItem = Extract<FocusItem, { missing: false }>

export async function openTimerPopup(root: HTMLElement, state: State, toast: Toast): Promise<void> {
  // One popup of the bar at a time: "Tarefas em foco" closes itself before this one opens.
  closeFocusPopup()
  let fresh: BarTimerView | null
  let tasks: TaskItem[]
  try {
    const [v, items] = await Promise.all([window.office.readBarTimer(), window.office.readFocus()])
    fresh = v
    tasks = items.filter((i): i is TaskItem => !i.missing)
  } catch (err) {
    toast(cleanError(err), 'err')
    return
  }

  let view = fresh
  // While the Timer is stopped, the chosen interval and task live only here, in the popup:
  // they become the real session when "Iniciar" runs.
  let chosen: { id: string; text: string } | null = null
  let chosenMode: BarMode = 25
  // The "the interval ended" toast comes out once for each interval that is running.
  let settled = false

  // Repaints with the view the main process gave (or none): the truth comes from the store,
  // and the running countdown is computed here against the wall clock.
  const applyView = (v: BarTimerView | null): void => {
    // The settled-once guard belongs to the running interval: a new one (or none) re-arms it.
    if (!v || v.state === 'parada' || !view || view.state !== 'em andamento' || view.endsAt !== v.endsAt) {
      settled = false
    }
    view = v
    paint()
  }

  const dot = h('span', { class: 'tcol-dot' })
  const headLabel = h('span', { class: 'tcol-label' })
  const headCount = h('span', { class: 'tcol-count' })
  const count = h('span', { class: 'board-count', role: 'status' })
  const list = h('ul', { class: 'tcol-list', 'aria-label': 'Timer' })
  const sr = h('span', { class: 'sr-only', role: 'status' })

  // The interval picker: only while the Timer is stopped, because a session has one interval.
  const seg = (): HTMLElement =>
    h(
      'div',
      { class: 'seg', role: 'group', 'aria-label': 'Tipo de intervalo' },
      ...BAR_INTERVALS.map((i) =>
        h(
          'button',
          {
            class: `seg-btn${i.mode === (view?.mode ?? chosenMode) ? ' on' : ''}`,
            type: 'button',
            'aria-pressed': String(i.mode === (view?.mode ?? chosenMode)),
            ...(view ? { disabled: '' } : {}),
            'data-focus-key': `tm-${i.mode}`,
            onclick: () => {
              chosenMode = i.mode
              paint()
            },
          },
          i.short,
        ),
      ),
    )

  // One radio per focused task, plus "Sem tarefa". While the Timer is stopped the pick waits
  // in `chosen` for Iniciar; otherwise it goes to the session through the store at once.
  const taskRow = (task: TaskItem | null): HTMLElement => {
    const key = task ? `tm-task-${task.id}` : 'tm-task-none'
    const selected = view
      ? view.taskId
        ? task?.id === view.taskId
        : false
      : task
        ? chosen?.id === task.id
        : chosen === null
    return h(
      'label',
      { class: 'rev-check tm-task' },
      h('input', {
        type: 'radio',
        name: 'tm-task',
        ...(selected ? { checked: '' } : {}),
        'data-focus-key': key,
        onchange: () => {
          const pick = task ? { id: task.id, text: task.text } : null
          // While stopped the pick stays local; otherwise it goes straight to the session.
          if (!view) {
            chosen = pick
            paint()
          } else {
            void setPick(pick)
          }
        },
      }),
      h(
        'span',
        {},
        task ? h('span', { class: 'tfloor', title: `Lista: ${task.list}` }, task.list) : null,
        ' ',
        task ? renderInlineMarkdown(task.text, 'tm-task-title') : 'Sem tarefa',
      ),
    )
  }

  // This is exactly what the approved design of the popup shows (proto, timerPopup()).
  const face = (v: BarTimerView | null, shown: BarMode, left: number, running: boolean): HTMLElement => {
    const linked = v?.taskText ?? chosen?.text
    const hints: HTMLElement[] = []
    if (v) {
      hints.push(h('div', { class: 'hint' }, 'Para trocar o intervalo, zere o Timer.'))
      if (v.state === 'interrompida')
        hints.push(h('div', { class: 'hint' }, 'Este intervalo terminou sem ser zerado. Zere o Timer para começar outro.'))
    }
    return h(
      'li',
      { class: 'tcard' },
      h(
        'div',
        { class: 'tm-face' },
        linked
          ? h('div', { class: 'hint' }, `${intervalTitle(shown)} em: `, renderInlineMarkdown(linked, 'tm-task-title'))
          : h('div', { class: 'hint' }, intervalTitle(shown)),
        h(
          'div',
          {
            class: `tm-clock${running ? ' running' : ''}`,
            role: 'timer',
            'aria-live': 'off',
            'aria-label': 'Tempo restante',
            'data-timer-clock': '',
          },
          barClockText(left),
        ),
        h('div', {
          class: 'tm-prog',
          style: `--p:${((barMs(shown) - left) / barMs(shown)) * 100}%`,
          'aria-hidden': 'true',
          'data-timer-prog': '',
        }),
      ),
      seg(),
      ...hints,
    )
  }

  const tasksCard = (): HTMLElement =>
    h(
      'li',
      { class: 'tcard' },
      h('div', { class: 'tcard-title' }, 'Em qual tarefa? (opcional)'),
      h(
        'div',
        { class: 'tm-tasks', role: 'radiogroup', 'aria-label': 'Tarefa em foco para este intervalo' },
        taskRow(null),
        ...tasks.map((t) => taskRow(t)),
      ),
    )

  // The three actions: Iniciar/Pausar/Retomar (the main one) and Zerar. An interrupted
  // session cannot be resumed: it shows "Iniciar" disabled, and Zerar is the only way out.
  const actionsCard = (v: BarTimerView | null): HTMLElement => {
    const label = v ? (v.state === 'em andamento' ? 'Pausar' : v.state === 'pausada' ? 'Retomar' : 'Iniciar') : 'Iniciar'
    return h(
      'li',
      { class: 'tcard' },
      h(
        'div',
        { class: 'focus-card-actions' },
        h(
          'button',
          {
            class: 'btn btn-primary',
            type: 'button',
            ...(v?.state === 'interrompida' ? { disabled: '' } : {}),
            'data-focus-key': 'tm-main',
            onclick: () =>
              void run(() => {
                if (!view) return window.office.startBarTimer(chosenMode, picked())
                if (view.state === 'em andamento') return window.office.pauseBarTimer()
                if (view.state === 'pausada') return window.office.resumeBarTimer()
                return Promise.resolve(null)
              }),
          },
          label,
        ),
        h(
          'button',
          {
            class: 'btn',
            type: 'button',
            ...(view ? {} : { disabled: '' }),
            'data-focus-key': 'tm-zerar',
            onclick: async () => {
              try {
                await window.office.resetBarTimer()
                applyView(null)
              } catch (err) {
                toast(cleanError(err), 'err')
              }
            },
          },
          'Zerar',
        ),
      ),
    )
  }

  // Runs a Timer action and repaints with the view it returns; the store broadcasts the same
  // event, which lands on the other windows' open popups too.
  const run = async (go: () => Promise<BarTimerView | null>): Promise<void> => {
    try {
      applyView(await go())
    } catch (err) {
      toast(cleanError(err), 'err')
    }
  }

  const picked = (): { id?: string; text?: string } | undefined => (chosen ? { id: chosen.id, text: chosen.text } : undefined)

  const setPick = async (pick: { id: string; text: string } | null): Promise<void> => {
    try {
      applyView(await window.office.setBarTimerTask(pick))
    } catch (err) {
      toast(cleanError(err), 'err')
    }
  }

  const paint = (): void => {
    const v = view
    const shown: BarMode = v?.mode ?? chosenMode
    // An absolute deadline never lies about an old session: the time left comes from the wall clock.
    const left = v ? (v.state === 'em andamento' ? barRemaining(v, Date.now()) : v.remainingMs) : barMs(shown)
    const running = v?.state === 'em andamento' && left > 0

    dot.style.background = running ? 'var(--green)' : v?.state === 'pausada' ? 'var(--amber)' : 'var(--dim)'
    // The head names the interval and its length apart, like the prototype: "Foco" and "25 min".
    headLabel.textContent = intervalTitle(shown).replace(/ · \d+ min$/, '')
    headCount.textContent = `${shown} min`
    count.textContent = BAR_STATUS[v?.state ?? 'parada']
    keepFocus(list, () => list.replaceChildren(face(v, shown, left, running), tasksCard(), actionsCard(v)))
    sr.textContent = v ? `Timer ${BAR_STATUS[v.state].toLowerCase()}, ${barClockText(left)}` : 'Timer parado'
  }

  // The interval finished while the popup was open: warn once and zero the Timer. The popup
  // never confirms a task here; the toast says just that.
  const settleZero = (): void => {
    if (settled) return
    if (!view || view.state !== 'em andamento') return
    if (barRemaining(view, Date.now()) > 0) return
    settled = true
    toast(`Intervalo terminado: ${intervalTitle(view.mode)}. O Timer só avisa; não conclui tarefas.`, 'ok')
    void window.office
      .resetBarTimer()
      .catch(() => undefined)
      .then(() => applyView(null))
  }

  const unsub = onBarTimerView(applyView)
  let closed = false
  const close = (): void => {
    if (closed) return
    closed = true
    window.clearInterval(tick)
    backdrop.remove()
    // The button in the dock shows that the popup is open: it stops showing it.
    setTimerPopupOpen(false)
    unsub()
  }

  // The running clock counts down here, one tick a second, straight on the drawn text: the
  // events of the main process repaint, the seconds do not.
  const tick = window.setInterval(() => {
    if (!backdrop.isConnected) {
      window.clearInterval(tick)
      return
    }
    if (!view || view.state !== 'em andamento') return
    const left = barRemaining(view, Date.now())
    for (const el of list.querySelectorAll<HTMLElement>('[data-timer-clock]')) el.textContent = barClockText(left)
    const prog = list.querySelector<HTMLElement>('[data-timer-prog]')
    if (prog) prog.style.setProperty('--p', `${((barMs(view.mode) - left) / barMs(view.mode)) * 100}%`)
    sr.textContent = `Timer ${BAR_STATUS['em andamento'].toLowerCase()}, ${barClockText(left)}`
    if (left <= 0) settleZero()
  }, 1000)

  const verFoco = h(
    'button',
    { class: 'btn btn-small', type: 'button', onclick: () => void openTasks() },
    'Ver Tarefas em foco',
  )
  // One single title element: the board head and the dialog of modalA11y point at the same span.
  const title = h('span', { id: 'timer-t' }, 'Timer')
  const openTasks = (): void => {
    close()
    void openFocusPopup(root, state, toast)
  }

  const closeBtn = h(
    'button',
    { class: 'icon-btn', type: 'button', title: 'Fechar (Esc)', 'aria-label': 'Fechar o Timer', onclick: close },
    icon('x', 18),
  )

  const col = h(
    'section',
    { class: 'tcol', 'aria-label': 'Timer' },
    h('div', { class: 'tcol-head' }, dot, headLabel, headCount),
    list,
    h('div', { class: 'foco-note' }, 'O Timer não conclui tarefas: só você marca a caixa em Tarefas em foco. Ao chegar a zero ele só avisa.'),
    sr,
  )

  const board = h(
    'section',
    { class: 'board card foco-pop timer-pop', tabindex: '-1' },
    h('div', { class: 'board-head' }, h('div', { class: 'board-title' }, clockSvg(18), title, count), verFoco, h('span', { class: 'grow' }), closeBtn),
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

  paint()
  root.append(backdrop)
  setTimerPopupOpen(true)
  requestTimerPopupClose(close)
  settleZero()
  list.querySelector<HTMLElement>('[data-focus-key="tm-main"]')?.focus()
}
