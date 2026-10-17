import './tasks-move.css'
import { arrowList, rove } from './a11y'
import { h } from './dom'

/**
 * The "Mover para…" menu of a task card: the lists it can go to, opened from the card with
 * Enter or its button. ↑/↓ pick a list and Enter chooses it; Esc or Tab closes the menu and
 * gives the focus back to the card. The menu lives inside the card, so keys pressed in it never
 * reach the board (the arrows, and Esc, that close the board).
 */
export function openMoveMenu(card: HTMLElement, destinations: string[], choose: (list: string) => void): void {
  if (card.querySelector(':scope > .tmenu')) return
  const close = (back: boolean) => {
    menu.remove()
    if (back) card.focus({ preventScroll: true })
  }
  const menu = h(
    'div',
    { class: 'tmenu', role: 'menu', tabindex: '-1', 'aria-label': 'Mover para…' },
    ...(destinations.length
      ? destinations.map((name) =>
          h(
            'button',
            {
              class: 'tmenu-item',
              type: 'button',
              role: 'menuitem',
              tabindex: '-1',
              onclick: () => {
                close(false)
                choose(name)
              },
            },
            name,
          ),
        )
      : [h('div', { class: 'tmenu-empty' }, 'Não há outra lista para esta tarefa.')]),
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
