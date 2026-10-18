import './tasks-move.css'
import { arrowList, rove } from './a11y'
import { h } from './dom'

export interface TaskMenuOption {
  text: string
  choose: () => void
}

/**
 * A menu of a task card, opened from the card with R or its button: the options are picked
 * with ↑/↓ and Enter chooses one; Esc or Tab closes the menu and gives the focus back to the card.
 * The menu lives inside the card, so keys pressed in it never reach the board (the arrows, and Esc, that close the board).
 */
export function openTaskMenu(card: HTMLElement, label: string, options: TaskMenuOption[], empty: string): void {
  if (card.querySelector(':scope > .tmenu')) return
  const close = (back: boolean) => {
    menu.remove()
    if (back) card.focus({ preventScroll: true })
  }
  const menu = h(
    'div',
    { class: 'tmenu', role: 'menu', tabindex: '-1', 'aria-label': label },
    ...(options.length
      ? options.map((option) =>
          h(
            'button',
            {
              class: 'tmenu-item',
              type: 'button',
              role: 'menuitem',
              tabindex: '-1',
              onclick: () => {
                close(false)
                option.choose()
              },
            },
            option.text,
          ),
        )
      : [h('div', { class: 'tmenu-empty' }, empty)]),
  )
  menu.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault()
      close(true)
    }
  })
  menu.addEventListener('focusout', (e) => {
    if (!menu.contains(e.relatedTarget as Node | null)) close(false)
  })
  card.append(menu)
  arrowList(menu, '.tmenu-item')
  const items = [...menu.querySelectorAll<HTMLElement>('.tmenu-item')]
  if (items.length) rove(items, 0)
  const first: HTMLElement = items[0] ?? menu
  first.focus({ preventScroll: true })
}
