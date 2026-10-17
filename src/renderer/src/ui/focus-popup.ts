import { type FocusItem, STEP_MAX } from '@shared/planning'
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
  let current: FocusItem[] = items

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

  const card = (item: FocusItem): HTMLElement => {
    const el = h('li', { class: `focus-card${item.missing ? ' focus-card-missing' : ''}`, 'data-focus-key': item.id })
    const actions = h('div', { class: 'focus-card-actions' })
    if (item.missing) {
      el.append(
        h('div', { class: 'focus-card-title' }, 'Não está mais no tarefas.md'),
        h('div', { class: 'focus-card-origin' }, `Identificador ${item.id}`),
      )
    } else {
      el.append(h('div', { class: 'focus-card-title' }, item.text), h('div', { class: 'focus-card-origin' }, `Lista: ${item.list}`))
      if (item.step) el.append(h('div', { class: 'focus-card-step' }, `Passo de hoje: ${item.step}`))
      actions.append(
        h('button', { class: 'btn btn-small', type: 'button', onclick: () => openStep(actions, item.id, item.step) }, 'Passo de hoje'),
      )
    }
    actions.append(
      h('button', { class: 'btn btn-small focus-card-remove', type: 'button', onclick: () => void remove(item.id) }, 'Tirar do foco'),
    )
    el.append(actions)
    return el
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
