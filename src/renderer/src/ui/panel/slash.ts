import { h } from '../dom'
import { cleanError } from '../modals/common'
import { filterCommands, slashKey, slashQuery, type Outcome, type SlashCommand } from '../luna-commands'

/** The "/" list above Luna's message box: filtered as she types, arrows, Enter/Tab, Esc, mouse. */
export class SlashMenu {
  readonly el: HTMLDivElement
  private items: SlashCommand[] = []
  private index = 0

  constructor(
    private input: HTMLTextAreaElement,
    private onPick: (cmd: SlashCommand) => void,
  ) {
    this.el = h('div', { class: 'slash-menu hidden', role: 'listbox', id: 'slash-menu', 'aria-label': 'Comandos' })
    input.setAttribute('aria-autocomplete', 'list')
    input.setAttribute('aria-controls', 'slash-menu')
    input.setAttribute('aria-expanded', 'false')
  }

  get open(): boolean {
    return !this.el.classList.contains('hidden')
  }

  /** Follows the box: open while it holds "/name" being typed; `commands` is what this agent offers (none = closed). */
  update(commands: readonly SlashCommand[] | null): void {
    const q = commands ? slashQuery(this.input.value) : null
    this.items = q === null ? [] : filterCommands(q, commands!)
    this.index = 0
    this.render()
  }

  close(): void {
    this.items = []
    this.render()
  }

  /** A key in the box while the list is open; true when the list took it. */
  key(e: KeyboardEvent): boolean {
    if (!this.open || e.isComposing) return false
    const k = slashKey(this.index, this.items.length, e.key)
    if (!k) return false
    e.preventDefault()
    if (k === 'close') this.close()
    else if (k === 'pick') this.pick(this.items[this.index]!)
    else {
      this.index = k.move
      this.render()
    }
    return true
  }

  private pick(cmd: SlashCommand): void {
    this.close()
    this.onPick(cmd)
  }

  private render(): void {
    const open = this.items.length > 0
    this.el.classList.toggle('hidden', !open)
    this.input.setAttribute('aria-expanded', String(open))
    if (!open) {
      this.input.removeAttribute('aria-activedescendant')
      this.el.replaceChildren()
      return
    }
    this.input.setAttribute('aria-activedescendant', `slash-opt-${this.items[this.index]!.name}`)
    this.el.replaceChildren(
      ...this.items.map((c, i) => {
        const row = h(
          'div',
          { class: 'slash-opt', role: 'option', id: `slash-opt-${c.name}`, 'aria-selected': String(i === this.index) },
          h('span', { class: 'slash-name' }, `/${c.name}`),
          c.args ? h('span', { class: 'slash-args' }, c.args) : null,
          h('span', { class: 'slash-hint' }, c.hint),
          h('span', { class: `slash-tag slash-tag-${c.kind}` }, c.kind === 'direct' ? 'DIRETO' : c.kind === 'panel' ? 'AGENTE' : 'LUNA'),
        )
        // mousedown keeps the focus in the box.
        row.addEventListener('mousedown', (e) => e.preventDefault())
        row.addEventListener('click', () => this.pick(c))
        row.addEventListener('mousemove', () => {
          if (this.index === i) return
          this.index = i
          this.render()
        })
        return row
      }),
    )
    this.el.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }
}

/**
 * Shows a direct command's outcome in the feed: a local line (with "Desfazer" when it can be
 * undone) or a short form. Nothing is saved in the log: it is this session's view only.
 */
export function slashOutcome(feed: HTMLElement, cmd: string, out: Exclude<Outcome, { kind: 'luna' }>, focusBack: () => void): void {
  const el = out.kind === 'done' ? doneLine(cmd, out) : formCard(feed, cmd, out, focusBack)
  feed.append(el)
  feed.scrollTop = feed.scrollHeight
  if (out.kind === 'form') (el.querySelector('input:not([value]), input[value=""], select, input') as HTMLElement | null)?.focus()
}

export function slashError(feed: HTMLElement, cmd: string, err: unknown): void {
  feed.append(h('div', { class: 'slash-note slash-note-err', role: 'alert' }, h('code', { class: 'slash-cmd' }, cmd), cleanError(err)))
  feed.scrollTop = feed.scrollHeight
}

function doneLine(cmd: string, out: Extract<Outcome, { kind: 'done' }>): HTMLElement {
  const text = h('span', { class: 'slash-text' }, out.text)
  const line = h('div', { class: 'slash-note', role: 'status' }, h('code', { class: 'slash-cmd' }, cmd), text)
  if (out.undo) {
    const undo = out.undo
    const btn = h('button', { class: 'btn btn-small slash-undo', type: 'button' }, 'Desfazer')
    btn.addEventListener('click', async () => {
      btn.disabled = true
      try {
        text.textContent = await undo()
        line.classList.add('slash-note-undone')
        btn.remove()
      } catch (err) {
        btn.disabled = false
        text.textContent = `${out.text} Não deu para desfazer: ${cleanError(err)}`
      }
    })
    line.append(btn)
  }
  return line
}

function formCard(feed: HTMLElement, cmd: string, out: Extract<Outcome, { kind: 'form' }>, focusBack: () => void): HTMLElement {
  const error = h('div', { class: 'slash-form-err', role: 'alert' }, out.error ?? '')
  const controls = out.fields.map((f) => {
    const id = `slash-f-${f.name}-${crypto.randomUUID().slice(0, 6)}`
    const control = f.options
      ? h(
          'select',
          { class: 'input', id, name: f.name },
          ...f.options.map((o) => h('option', { value: o.value, selected: o.value === f.value }, o.label)),
        )
      : h('input', { class: 'input', id, name: f.name, value: f.value ?? '', placeholder: f.placeholder ?? '', autocomplete: 'off' })
    return { name: f.name, control, row: h('label', { class: 'slash-field', for: id }, h('span', {}, f.label), control) }
  })
  const confirm = h('button', { class: out.danger ? 'btn btn-small btn-danger' : 'btn btn-small btn-primary', type: 'submit' }, out.confirm)
  const cancel = h('button', { class: 'btn btn-small', type: 'button' }, 'Cancelar')
  const form = h(
    'form',
    { class: 'slash-form', 'aria-label': out.title },
    h('div', { class: 'slash-form-title' }, h('code', { class: 'slash-cmd' }, cmd), out.title),
    ...controls.map((c) => c.row),
    error,
    h('div', { class: 'slash-form-actions' }, cancel, confirm),
  )
  cancel.addEventListener('click', () => {
    form.replaceWith(h('div', { class: 'slash-note slash-note-undone' }, h('code', { class: 'slash-cmd' }, cmd), 'Cancelado.'))
    focusBack()
  })
  form.addEventListener('keydown', (e) => {
    // Keys stay in the form: the app's shortcuts do not fire while typing here.
    e.stopPropagation()
    if (e.key === 'Escape') cancel.click()
  })
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    confirm.disabled = true
    const values = Object.fromEntries(controls.map((c) => [c.name, c.control.value]))
    try {
      const next = await out.submit(values)
      form.remove()
      if (next.kind !== 'luna') slashOutcome(feed, cmd, next, focusBack)
      if (next.kind === 'done') focusBack()
    } catch (err) {
      confirm.disabled = false
      error.textContent = cleanError(err)
    }
  })
  return form
}
