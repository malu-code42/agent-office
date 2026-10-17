import type { FocusItem } from '@shared/planning'
import type { State } from '../state'
import { arrowList, keepFocus, rove } from './a11y'
import { h } from './dom'
import { cleanError, modal } from './modals/common'
import { openTasksBoard } from './tasks-board'
import './focus.css'

/**
 * The "Tarefas em foco" popup (key F): the focused tasks in one column, stacked and scrolled.
 * It reads tarefas.md each time it opens; a focused task whose id is gone is shown as missing,
 * and can only be taken out of the focus. Esc or a click outside closes it, and the focus goes
 * back to what had it.
 */
export async function openFocusPopup(
  root: HTMLElement,
  state: State,
  toast: (msg: string, type?: 'info' | 'ok' | 'err') => void,
): Promise<void> {
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

  const count = h('div', { class: 'focus-count', role: 'status' })
  const list = h('ul', { class: 'focus-list', 'aria-label': 'Tarefas em foco' })
  const empty = h(
    'div',
    { class: 'focus-empty' },
    h('span', {}, 'Nenhuma tarefa em foco. Ponha uma tarefa em foco no quadro Tarefas, com o botão “Pôr em foco” ou a tecla F.'),
    h(
      'button',
      {
        class: 'btn btn-primary',
        type: 'button',
        onclick: () => {
          backdrop.remove()
          void openTasksBoard(root, state, toast)
        },
      },
      'Abrir quadro Tarefas',
    ),
  )

  const card = (item: FocusItem): HTMLElement =>
    h(
      'li',
      { class: `focus-card${item.missing ? ' focus-card-missing' : ''}`, 'data-focus-key': item.id },
      h('div', { class: 'focus-card-title' }, item.missing ? 'Não está mais no tarefas.md' : item.text),
      h('div', { class: 'focus-card-origin' }, item.missing ? `Identificador ${item.id}` : `Lista: ${item.list}`),
      h('button', { class: 'btn btn-small focus-card-remove', type: 'button', onclick: () => void remove(item.id) }, 'Tirar do foco'),
    )

  const paint = (next: FocusItem[]): void => {
    count.textContent = next.length === 1 ? '1 tarefa em foco' : `${next.length} tarefas em foco`
    list.hidden = next.length === 0
    empty.hidden = next.length > 0
    keepFocus(list, () => list.replaceChildren(...next.map(card)))
    const cards = [...list.querySelectorAll<HTMLElement>('.focus-card')]
    if (cards.length) rove(cards, 0)
  }

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

  arrowList(list, '.focus-card')
  const backdrop = modal('Tarefas em foco', [count, list, empty], [], () => backdrop.remove())
  paint(items)
  root.append(backdrop)
  ;(list.querySelector<HTMLElement>('.focus-card') ?? empty.querySelector<HTMLElement>('button'))?.focus()
}
