import { beforeEach, describe, expect, it, vi } from 'vitest'

// Closing "Tarefas em foco" (AO-81, criterion 3). The renderer has no DOM in the test environment, so the
// helpers the popup draws with are replaced by recording fakes; the popup code itself is the real one.
interface Fake {
  tag: string
  attrs: Record<string, unknown>
  children: unknown[]
  listeners: Record<string, Array<(e: unknown) => void>>
  hidden?: boolean
  textContent: string
  remove: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
  append(...c: unknown[]): void
  replaceChildren(...c: unknown[]): void
  replaceWith(): void
  addEventListener(n: string, f: (e: unknown) => void): void
  querySelector(): null
  querySelectorAll(): never[]
}

const { made } = vi.hoisted(() => ({ made: [] as unknown[] }))

vi.mock('../src/renderer/src/ui/dom', () => ({
  icon: () => 'icon',
  h: (tag: string, attrs: Record<string, unknown> = {}, ...kids: unknown[]): Fake => {
    const el: Fake = {
      tag,
      attrs,
      children: kids.flat(),
      listeners: {},
      hidden: attrs.hidden as boolean | undefined,
      textContent: '',
      remove: vi.fn(),
      focus: vi.fn(),
      append(...c) {
        this.children.push(...c)
      },
      replaceChildren(...c) {
        this.children = c
      },
      replaceWith() {},
      addEventListener(n, f) {
        ;(this.listeners[n] ??= []).push(f)
      },
      querySelector: () => null,
      querySelectorAll: () => [],
    }
    if (typeof attrs.onclick === 'function') el.addEventListener('click', attrs.onclick as (e: unknown) => void)
    made.push(el)
    return el
  },
}))
vi.mock('../src/renderer/src/ui/a11y', () => ({
  arrowList: vi.fn(),
  keepFocus: (_l: unknown, fn: () => void) => fn(),
  modalA11y: vi.fn(),
  rove: vi.fn(),
}))
vi.mock('../src/renderer/src/ui/modals/common', () => ({ cleanError: (e: unknown) => String(e) }))
vi.mock('../src/renderer/src/ui/markdown', () => ({ renderInlineMarkdown: () => 'md' }))
vi.mock('../src/renderer/src/ui/tasks-board', () => ({ dueBadge: () => 'badge', openTasksBoard: vi.fn(), refreshTasksBoard: vi.fn() }))
vi.mock('../src/renderer/src/ui/tasks-complete', () => ({ offerUndo: vi.fn() }))
vi.mock('../src/renderer/src/ui/tasks-discard', () => ({ runDiscard: vi.fn() }))
vi.mock('../src/renderer/src/ui/timer-state', () => ({ closeTimerPopup: vi.fn() }))
vi.mock('../src/renderer/src/ui/focus.css', () => ({}))

import { openFocusPopup } from '../src/renderer/src/ui/focus-popup'
import { isFocusPopupOpen } from '../src/renderer/src/ui/focus-state'
import { focusItems } from '../src/shared/planning'
import { parseTasksFile } from '../src/shared/tasks'

const lists = parseTasksFile('## Casa\n- [ ] Um ^taaaaaa\n## Estudo\n- [ ] Ler ^tdddddd\n').lists
const items = focusItems(lists, ['tdddddd', 'taaaaaa'])

function setup() {
  const office = {
    readFocus: vi.fn(async () => items),
    readTasks: vi.fn(async () => ({ lists })),
    unfocusTask: vi.fn(),
    completeTask: vi.fn(),
    saveStep: vi.fn(),
    clearStep: vi.fn(),
    discardTask: vi.fn(),
  }
  vi.stubGlobal('window', { office })
  return { office, root: { append: vi.fn() }, toast: vi.fn(), state: { settings: { vaultPath: 'C:/vault' } } }
}

const byLabel = (label: string): Fake => {
  const el = (made as Fake[]).find((e) => e.attrs['aria-label'] === label)
  if (!el) throw new Error(`sem elemento ${label}`)
  return el
}
const backdrop = (): Fake => (made as Fake[]).find((e) => e.attrs.class === 'backdrop backdrop-foco') as Fake

describe('fechar a janela Tarefas em foco', () => {
  beforeEach(() => {
    made.length = 0
    vi.unstubAllGlobals()
  })

  async function open() {
    const ctx = setup()
    await openFocusPopup(ctx.root as never, ctx.state as never, ctx.toast as never)
    return ctx
  }

  it('o botão de fechar tira a janela e não mexe no foco salvo', async () => {
    const { office } = await open()
    expect(isFocusPopupOpen()).toBe(true)
    byLabel('Fechar Tarefas em foco').listeners.click[0]({})
    expect(backdrop().remove).toHaveBeenCalledTimes(1)
    expect(isFocusPopupOpen()).toBe(false)
    for (const call of [office.unfocusTask, office.completeTask, office.saveStep, office.clearStep, office.discardTask]) {
      expect(call).not.toHaveBeenCalled()
    }
    expect(office.readFocus).toHaveBeenCalledTimes(1)
  })

  it('Esc fecha sem alterar o foco, e fechar duas vezes só remove uma vez', async () => {
    const { office } = await open()
    const bd = backdrop()
    bd.listeners.keydown[0]({ key: 'Escape', stopPropagation() {} })
    bd.listeners.keydown[0]({ key: 'Escape', stopPropagation() {} })
    expect(bd.remove).toHaveBeenCalledTimes(1)
    expect(isFocusPopupOpen()).toBe(false)
    expect(office.unfocusTask).not.toHaveBeenCalled()
    expect(office.completeTask).not.toHaveBeenCalled()
  })

  it('clicar fora fecha; clicar dentro não', async () => {
    const { office } = await open()
    const bd = backdrop()
    bd.listeners.pointerdown[0]({ target: {} })
    expect(bd.remove).not.toHaveBeenCalled()
    bd.listeners.pointerdown[0]({ target: bd })
    expect(bd.remove).toHaveBeenCalledTimes(1)
    expect(office.unfocusTask).not.toHaveBeenCalled()
  })
})
