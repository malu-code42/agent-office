import { beforeEach, describe, expect, it, vi } from 'vitest'

// "Concluir" e "Tirar do foco" da janela Tarefas em foco (AO-55 critério 3, AO-81 critério 2), no padrão de focus-popup-close.test.ts:
// o renderer não tem DOM no teste, então os auxiliares de desenho são fakes que gravam; o código da janela é o de verdade.
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
import { refreshTasksBoard } from '../src/renderer/src/ui/tasks-board'
import { offerUndo } from '../src/renderer/src/ui/tasks-complete'
import { focusItems } from '../src/shared/planning'
import { parseTasksFile } from '../src/shared/tasks'

const lists = parseTasksFile(['## Casa', '- [ ] Um ^taaaaaa', '## Estudo', '- [ ] Ler ^tdddddd', ''].join('\n')).lists
const items = focusItems(lists, ['tdddddd', 'taaaaaa'])
const onlyLer = items.filter((i) => i.id === 'tdddddd')
const board = { lists }

function setup() {
  const office = {
    readFocus: vi.fn(async () => items),
    readTasks: vi.fn(async () => ({ lists })),
    unfocusTask: vi.fn(async () => onlyLer),
    completeTask: vi.fn(async () => ({ id: 'taaaaaa', board, focus: onlyLer })),
    saveStep: vi.fn(),
    clearStep: vi.fn(),
    discardTask: vi.fn(),
  }
  vi.stubGlobal('window', { office })
  return { office, root: { append: vi.fn() }, toast: vi.fn(), state: { settings: { vaultPath: 'C:/vault' } } }
}

const all = (): Fake[] => made as Fake[]
/** O cartão mais recente desenhado para a tarefa (a janela redesenha a lista a cada mudança). */
const cardOf = (id: string): Fake => {
  const el = [...all()].reverse().find((e) => e.tag === 'li' && e.attrs['data-focus-key'] === id)
  if (!el) throw new Error(`sem cartão ${id}`)
  return el
}
const flatten = (el: Fake): Fake[] => el.children.flatMap((c) => (c && typeof c === 'object' && 'tag' in c ? [c as Fake, ...flatten(c as Fake)] : []))
const within = (el: Fake, cls: string): Fake => {
  const found = flatten(el).find((e) => String(e.attrs.class ?? '').split(' ').includes(cls))
  if (!found) throw new Error(`sem ${cls}`)
  return found
}
const countText = (): string => (all().find((e) => e.attrs.role === 'status') as Fake).textContent
const rendered = (): string[] =>
  [...new Set(all().filter((e) => e.tag === 'li' && e.attrs['data-focus-key']).map((e) => String(e.attrs['data-focus-key'])))]
const settle = () => new Promise((r) => setTimeout(r, 0))

describe('Concluir e Tirar do foco na janela Tarefas em foco', () => {
  beforeEach(() => {
    made.length = 0
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  async function open() {
    const ctx = setup()
    await openFocusPopup(ctx.root as never, ctx.state as never, ctx.toast as never)
    return ctx
  }

  it('marcar a caixa conclui a tarefa certa, redesenha o foco sem ela e oferece desfazer', async () => {
    const { office, toast } = await open()
    expect(countText()).toBe('2')
    const box = within(cardOf('taaaaaa'), 'focus-card-done')
    await (box.attrs.onchange as (e: unknown) => Promise<void>)({ currentTarget: box })
    expect(office.completeTask).toHaveBeenCalledWith({ id: 'taaaaaa' })
    expect(office.unfocusTask).not.toHaveBeenCalled()
    expect(countText()).toBe('1')
    expect(offerUndo).toHaveBeenCalledWith(toast, 'Um', 'taaaaaa', expect.any(Function))
    expect(refreshTasksBoard).toHaveBeenCalledTimes(1)
    // a lista foi redesenhada só com a tarefa que sobrou
    const last = all().filter((e) => e.tag === 'ul')[0] as Fake
    expect(last.children.filter((c) => (c as Fake).tag === 'li' && (c as Fake).attrs['data-focus-key']).map((c) => (c as Fake).attrs['data-focus-key'])).toEqual(['tdddddd'])
  })

  it('se concluir falha, a caixa desmarca e o erro aparece, sem mexer na lista', async () => {
    const { office, toast } = await open()
    office.completeTask.mockRejectedValueOnce(new Error('tarefas.md mudou'))
    const box = within(cardOf('taaaaaa'), 'focus-card-done') as Fake & { checked?: boolean }
    box.checked = true
    await (box.attrs.onchange as (e: unknown) => Promise<void>)({ currentTarget: box })
    expect(box.checked).toBe(false)
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('tarefas.md mudou'), 'err')
    expect(offerUndo).not.toHaveBeenCalled()
    expect(countText()).toBe('2')
  })

  it('Tirar do foco só tira do foco: chama unfocusTask com o id, redesenha e não conclui nem descarta', async () => {
    const { office, toast } = await open()
    within(cardOf('taaaaaa'), 'focus-card-remove').listeners.click[0]({})
    await settle()
    expect(office.unfocusTask).toHaveBeenCalledWith('taaaaaa')
    expect(office.completeTask).not.toHaveBeenCalled()
    expect(office.discardTask).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith('Tarefa tirada do foco.', 'ok')
    expect(countText()).toBe('1')
    expect(rendered()).toContain('tdddddd')
  })

  it('se Tirar do foco falha, mostra o erro e o foco continua como estava', async () => {
    const { office, toast } = await open()
    office.unfocusTask.mockRejectedValueOnce(new Error('sem acesso'))
    within(cardOf('tdddddd'), 'focus-card-remove').listeners.click[0]({})
    await settle()
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('sem acesso'), 'err')
    expect(countText()).toBe('2')
  })
})
