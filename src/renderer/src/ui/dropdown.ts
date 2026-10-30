import { h, icon } from './dom'
import { type DropdownOption, dropdownMatch, dropdownMove } from './dropdown-keys'

/**
 * The dropdown of the whole app (round 5, captures 22 and 23): every native <select> gets a
 * combobox button and a listbox drawn by the app, in the theme, in place of the light menu of
 * the system. The <select> stays in the page, hidden, as the source of truth: its value, its
 * options, `disabled`, `aria-invalid` and its change events keep working for the code that made it.
 */

let nextId = 0
const enhanced = new WeakSet<HTMLSelectElement>()

/** Turns one <select> into the app's dropdown. A <select multiple> or a sized list stays native. */
export function enhanceSelect(select: HTMLSelectElement): void {
  if (enhanced.has(select) || select.multiple || select.size > 1) return
  enhanced.add(select)
  const id = `dd-${++nextId}`
  const label = h('span', { class: 'dd-value grow' })
  const trigger = h(
    'button',
    {
      class: `${select.className} dd-trigger`,
      type: 'button',
      role: 'combobox',
      'aria-haspopup': 'listbox',
      'aria-expanded': 'false',
      'aria-controls': `${id}-list`,
    },
    label,
    h('span', { class: 'dd-chev', 'aria-hidden': 'true' }, icon('chevron', 14)),
  ) as HTMLButtonElement
  const list = h('ul', { class: 'dd-list', id: `${id}-list`, role: 'listbox', tabindex: '-1' })
  // The name the <select> had: its aria-label, or its <label>.
  const named = select.getAttribute('aria-label')
  const labelEl = select.id ? document.querySelector<HTMLElement>(`label[for="${CSS.escape(select.id)}"]`) : select.closest('label')
  if (named) trigger.setAttribute('aria-label', named)
  else if (labelEl) {
    if (!labelEl.id) labelEl.id = `${id}-label`
    trigger.setAttribute('aria-labelledby', `${labelEl.id} ${id}-value`)
    label.id = `${id}-value`
    list.setAttribute('aria-labelledby', labelEl.id)
    // A click on the <label> went to the hidden select; now it opens nothing, it focuses the button.
    labelEl.addEventListener('click', (e) => {
      if (e.target === trigger || trigger.contains(e.target as Node)) return
      e.preventDefault()
      trigger.focus()
    })
  }
  if (select.title) trigger.title = select.title

  const options = (): HTMLOptionElement[] => [...select.options]
  const sync = (): void => {
    const chosen = select.selectedOptions[0]
    label.textContent = chosen?.textContent ?? ''
    trigger.disabled = select.disabled
    trigger.classList.toggle('err', select.getAttribute('aria-invalid') === 'true')
  }
  // Code that sets the value (or the index) of the select by hand also updates the button.
  for (const prop of ['value', 'selectedIndex'] as const) {
    const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, prop)!
    Object.defineProperty(select, prop, {
      configurable: true,
      get: () => desc.get!.call(select),
      set: (v) => {
        desc.set!.call(select, v)
        sync()
      },
    })
  }
  select.focus = (opts?: FocusOptions) => trigger.focus(opts)
  new MutationObserver(sync).observe(select, { childList: true, subtree: true, attributes: true, characterData: true })
  select.addEventListener('change', sync)

  let active = -1
  let typed = ''
  let typedAt = 0
  const isOpen = () => list.isConnected
  const paintActive = (): void => {
    list.querySelectorAll('.dd-opt.active').forEach((el) => el.classList.remove('active'))
    const el = active >= 0 ? list.children[active] : undefined
    if (el instanceof HTMLElement) {
      el.classList.add('active')
      trigger.setAttribute('aria-activedescendant', el.id)
      el.scrollIntoView({ block: 'nearest' })
    } else trigger.removeAttribute('aria-activedescendant')
  }
  const choose = (i: number): void => {
    const opt = options()[i]
    if (!opt || opt.disabled) return
    close()
    if (select.selectedIndex !== i) {
      select.selectedIndex = i
      select.dispatchEvent(new Event('input', { bubbles: true }))
      select.dispatchEvent(new Event('change', { bubbles: true }))
    }
  }
  const place = (): void => {
    const r = trigger.getBoundingClientRect()
    list.style.minWidth = `${r.width}px`
    list.style.left = `${Math.max(8, Math.min(r.left, innerWidth - list.offsetWidth - 8))}px`
    const below = innerHeight - r.bottom - 8
    // It opens upwards when it does not fit below, and never leaves the window.
    if (list.offsetHeight > below && r.top > below) {
      list.style.maxHeight = `${Math.min(320, r.top - 12)}px`
      list.style.top = `${Math.max(8, r.top - 4 - list.offsetHeight)}px`
    } else {
      list.style.maxHeight = `${Math.min(320, below - 4)}px`
      list.style.top = `${r.bottom + 4}px`
    }
  }
  const open = (): void => {
    if (isOpen() || select.disabled) return
    list.replaceChildren(
      ...options().map((opt, i) =>
        h(
          'li',
          {
            id: `${id}-o${i}`,
            class: `dd-opt${opt.selected ? ' sel' : ''}${opt.disabled ? ' dis' : ''}`,
            role: 'option',
            'aria-selected': String(opt.selected),
            'aria-disabled': opt.disabled ? 'true' : undefined,
            onclick: () => choose(i),
            onpointermove: () => {
              if (opt.disabled || active === i) return
              active = i
              paintActive()
            },
          },
          h('span', { class: 'dd-check', 'aria-hidden': 'true' }, opt.selected ? icon('check', 14) : null),
          h('span', { class: 'grow' }, opt.textContent ?? ''),
        ),
      ),
    )
    // In the backdrop of an open dialog (no transform or overflow there), so the dialog's focus trap and stacking hold it too.
    ;(trigger.closest('.backdrop') ?? document.body).append(list)
    trigger.setAttribute('aria-expanded', 'true')
    trigger.classList.add('open')
    active =
      select.selectedIndex >= 0 && !options()[select.selectedIndex]?.disabled ? select.selectedIndex : dropdownMove(items(), -1, 'Home')
    place()
    paintActive()
    document.addEventListener('pointerdown', outside, true)
    window.addEventListener('resize', close)
  }
  const close = (): void => {
    if (!isOpen()) return
    list.remove()
    trigger.setAttribute('aria-expanded', 'false')
    trigger.classList.remove('open')
    trigger.removeAttribute('aria-activedescendant')
    document.removeEventListener('pointerdown', outside, true)
    window.removeEventListener('resize', close)
  }
  const outside = (e: Event): void => {
    const target = e.target as Node
    if (!list.contains(target) && !trigger.contains(target)) close()
  }
  const items = (): DropdownOption[] => options().map((o) => ({ text: o.textContent ?? '', disabled: o.disabled }))
  // Keep the focus on the button while the mouse picks an option.
  list.addEventListener('pointerdown', (e) => e.preventDefault())
  trigger.addEventListener('click', () => (isOpen() ? close() : open()))
  trigger.addEventListener('blur', () => setTimeout(() => document.activeElement !== trigger && close(), 0))
  trigger.addEventListener('keydown', (e) => {
    const key = e.key
    if (!isOpen()) {
      if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ') {
        e.preventDefault()
        e.stopPropagation()
        open()
      }
      return
    }
    if (key === 'Escape') {
      // Esc closes the list only: the dialog around it stays open.
      e.preventDefault()
      e.stopPropagation()
      close()
    } else if (key === 'Tab') close()
    else if (key === 'Enter' || key === ' ') {
      e.preventDefault()
      e.stopPropagation()
      if (key === ' ' && typed && Date.now() - typedAt < 600) return
      choose(active)
    } else if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End') {
      e.preventDefault()
      e.stopPropagation()
      active = dropdownMove(items(), active, key)
      paintActive()
    } else if (key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault()
      e.stopPropagation()
      typed = Date.now() - typedAt < 600 ? typed + key : key
      typedAt = Date.now()
      const at = dropdownMatch(items(), typed.length > 1 ? active - 1 : active, typed)
      if (at >= 0) {
        active = at
        paintActive()
      }
    }
  })

  select.classList.add('dd-native')
  select.tabIndex = -1
  select.setAttribute('aria-hidden', 'true')
  select.after(trigger)
  sync()
}

/** Enhances every <select> under `root` now and every one added later. */
export function enhanceSelects(root: HTMLElement): void {
  const all = (node: ParentNode) => node.querySelectorAll('select').forEach(enhanceSelect)
  all(root)
  new MutationObserver((records) => {
    for (const r of records)
      for (const n of r.addedNodes) {
        if (n instanceof HTMLSelectElement) enhanceSelect(n)
        else if (n instanceof HTMLElement) all(n)
      }
  }).observe(root, { childList: true, subtree: true })
}
