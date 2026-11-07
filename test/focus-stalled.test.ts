import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Selo "Parada" da janela Tarefas em foco (AO-114), no padrão de focus-popup-close.test.ts:
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
import { focusItems, groupFocusItems } from '../src/shared/planning'
import { parseTasksFile } from '../src/shared/tasks'
import { PlanningStore } from '../src/main/planning'

const lists = parseTasksFile(['## Casa', '- [ ] Um ^taaaaaa', '## Estudo', '- [ ] Ler ^tdddddd', ''].join('\n')).lists
const plain = focusItems(lists, ['tdddddd', 'taaaaaa'])
const marked = focusItems(lists, ['tdddddd', 'taaaaaa'], undefined, undefined, new Set(['taaaaaa']))

function setup() {
  const office = {
    readFocus: vi.fn(async () => plain),
    readTasks: vi.fn(async () => ({ lists })),
    setStalled: vi.fn(async (_id: string, on: boolean) => (on ? marked : plain)),
    unfocusTask: vi.fn(),
    completeTask: vi.fn(),
    saveStep: vi.fn(),
    clearStep: vi.fn(),
    discardTask: vi.fn(),
  }
  vi.stubGlobal('window', { office })
  return { office, root: { append: vi.fn() }, toast: vi.fn(), state: { settings: { vaultPath: 'C:/vault' } } }
}

const all = (): Fake[] => made as Fake[]
const cardOf = (id: string): Fake => {
  const el = [...all()].reverse().find((e) => e.tag === 'li' && e.attrs['data-focus-key'] === id)
  if (!el) throw new Error(`sem cartão ${id}`)
  return el
}
const flatten = (el: Fake): Fake[] => el.children.flatMap((c) => (c && typeof c === 'object' && 'tag' in c ? [c as Fake, ...flatten(c as Fake)] : []))
const stalledBtn = (id: string): Fake => {
  const found = flatten(cardOf(id)).find((e) => String(e.attrs.class ?? '').split(' ').includes('focus-card-stalled'))
  if (!found) throw new Error('sem selo')
  return found
}
const settle = () => new Promise((r) => setTimeout(r, 0))

describe('selo Parada na janela Tarefas em foco', () => {
  beforeEach(() => {
    made.length = 0
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('marca e desmarca no foco agrupado, com as classes dos botões da janela e o estado em aria-pressed', async () => {
    const ctx = setup()
    await openFocusPopup(ctx.root as never, ctx.state as never, ctx.toast as never)
    expect(stalledBtn('taaaaaa').attrs['aria-pressed']).toBe('false')
    expect(String(stalledBtn('taaaaaa').attrs.class)).toContain('btn btn-small')
    stalledBtn('taaaaaa').listeners.click[0]({})
    await settle()
    expect(ctx.office.setStalled).toHaveBeenLastCalledWith('taaaaaa', true)
    expect(stalledBtn('taaaaaa').attrs['aria-pressed']).toBe('true')
    expect(stalledBtn('tdddddd').attrs['aria-pressed']).toBe('false')
    stalledBtn('taaaaaa').listeners.click[0]({})
    await settle()
    expect(ctx.office.setStalled).toHaveBeenLastCalledWith('taaaaaa', false)
    expect(stalledBtn('taaaaaa').attrs['aria-pressed']).toBe('false')
    expect(ctx.office.unfocusTask).not.toHaveBeenCalled()
    expect(ctx.office.completeTask).not.toHaveBeenCalled()
  })

  it('se marcar falha, mostra o erro e o selo fica como estava', async () => {
    const ctx = setup()
    ctx.office.setStalled.mockRejectedValueOnce(new Error('sem acesso'))
    await openFocusPopup(ctx.root as never, ctx.state as never, ctx.toast as never)
    stalledBtn('taaaaaa').listeners.click[0]({})
    await settle()
    expect(ctx.toast).toHaveBeenCalledWith(expect.stringContaining('sem acesso'), 'err')
    expect(stalledBtn('taaaaaa').attrs['aria-pressed']).toBe('false')
  })
})

describe('marca de parada no PlanningStore', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ao-stalled-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('planning.json antigo, sem o campo, abre sem marcas e é regravado sem corromper nada', () => {
    const old = { focus: ['taaaaaa', 'tdddddd'], steps: { taaaaaa: { date: '2026-11-01', text: 'ler' } } }
    writeFileSync(join(dir, 'planning.json'), JSON.stringify(old), 'utf8')
    const store = new PlanningStore(dir)
    expect(store.stalled().size).toBe(0)
    store.setStalled('taaaaaa', true)
    const saved = JSON.parse(readFileSync(join(dir, 'planning.json'), 'utf8'))
    expect(saved.focus).toEqual(old.focus)
    expect(saved.steps).toEqual(old.steps)
    expect(saved.stalled).toEqual(['taaaaaa'])
    expect(new PlanningStore(dir).isStalled('TAAAAAA')).toBe(true)
    store.setStalled('taaaaaa', false)
    expect('stalled' in JSON.parse(readFileSync(join(dir, 'planning.json'), 'utf8'))).toBe(false)
  })

  it('marcar nunca toca o tarefas.md (arquivo antigo fica byte a byte igual)', () => {
    const md = '## Casa\n- [ ] Um ^taaaaaa\n- [ ] sem id\n## Estudo\n- [ ] Ler ^tdddddd\n'
    const file = join(dir, 'tarefas.md')
    writeFileSync(file, md, 'utf8')
    const store = new PlanningStore(dir)
    store.add('taaaaaa')
    store.setStalled('taaaaaa', true)
    store.setStalled('taaaaaa', false)
    expect(readFileSync(file, 'utf8')).toBe(md)
  })

  it('só tarefa em foco pode ser marcada', () => {
    expect(() => new PlanningStore(dir).setStalled('tzzzzzz', true)).toThrow('em foco')
  })

  it('tirar do foco e concluir levam a marca junto, e o grupo vazio some', () => {
    const store = new PlanningStore(dir)
    store.add('taaaaaa')
    store.add('tdddddd')
    store.setStalled('taaaaaa', true)
    store.setStalled('tdddddd', true)
    const view = () => groupFocusItems(lists, focusItems(lists, store.focus(), undefined, undefined, store.stalled()))
    expect(view().map((g) => g.name)).toEqual(['Casa', 'Estudo'])
    expect(view().every((g) => g.items.every((i) => !i.missing && i.stalled))).toBe(true)
    store.remove('taaaaaa')
    expect(view().map((g) => g.name)).toEqual(['Estudo'])
    store.archive('tdddddd', { origin: 'Estudo', completedAt: '2026-11-07', originalLine: '- [ ] Ler ^tdddddd' })
    expect(view()).toEqual([])
    expect(store.stalled().size).toBe(0)
    store.add('taaaaaa')
    expect(store.isStalled('taaaaaa')).toBe(false)
  })
})
