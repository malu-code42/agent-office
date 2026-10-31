import { describe, expect, it } from 'vitest'
import { dropdownMatch, dropdownMove } from '../src/renderer/src/ui/dropdown-keys'

const opts = [
  { text: 'Alta', disabled: false },
  { text: 'Equilibrada', disabled: false },
  { text: 'Economia', disabled: false },
  { text: 'Personalizada', disabled: true },
]

describe('dropdownMove', () => {
  it('moves with the arrows, Home and End, and skips disabled options', () => {
    expect(dropdownMove(opts, 1, 'ArrowDown')).toBe(2)
    expect(dropdownMove(opts, 2, 'ArrowDown')).toBe(2)
    expect(dropdownMove(opts, 1, 'ArrowUp')).toBe(0)
    expect(dropdownMove(opts, 0, 'ArrowUp')).toBe(0)
    expect(dropdownMove(opts, 2, 'Home')).toBe(0)
    expect(dropdownMove(opts, 0, 'End')).toBe(2)
    expect(dropdownMove(opts, -1, 'ArrowDown')).toBe(0)
    expect(dropdownMove([{ text: 'x', disabled: true }], -1, 'Home')).toBe(-1)
  })
})

describe('dropdownMatch', () => {
  it('finds the next enabled option by its first letters, without case or accents', () => {
    expect(dropdownMatch(opts, 1, 'e')).toBe(2)
    expect(dropdownMatch(opts, 2, 'e')).toBe(1)
    expect(dropdownMatch(opts, 0, 'equ')).toBe(1)
    expect(dropdownMatch(opts, 0, 'p')).toBe(-1)
    expect(dropdownMatch([{ text: 'Média', disabled: false }], -1, 'MED')).toBe(0)
  })
})

// A tiny stand-in for the DOM: enough for h() and icon() to build elements whose class, attributes and text can be read.
class FakeNode {
  className = ''
  attrs = new Map<string, string>()
  children: (FakeNode | string)[] = []
  classList = { add: (c: string) => (this.className = `${this.className} ${c}`.trim()) }
  constructor(readonly tag: string) {}
  setAttribute(k: string, v: string) {
    this.attrs.set(k, v)
  }
  getAttribute(k: string) {
    return this.attrs.get(k) ?? null
  }
  append(...nodes: (FakeNode | string)[]) {
    this.children.push(...nodes)
  }
  addEventListener() {}
  get textContent(): string {
    return this.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join('')
  }
  set innerHTML(_html: string) {}
}

// The DOM modules load by a computed path, so the type check of the tests (no DOM lib) does not pull them in.
const DROPDOWN = '../src/renderer/src/ui/dropdown'
const BRAIN = '../src/renderer/src/ui/modals/brain'
type FakeOption = { selected: boolean; textContent: string; dataset: Record<string, string> }

async function withFakeDom<T>(run: () => Promise<T>): Promise<T> {
  const g = globalThis as Record<string, unknown>
  g.document = { createElement: (tag: string) => new FakeNode(tag), createElementNS: (_ns: string, tag: string) => new FakeNode(tag) }
  g.Node = FakeNode
  try {
    return await run()
  } finally {
    delete g.document
    delete g.Node
  }
}

describe('optionBody', () => {
  it('desenha a dica do <option> (data-hint) apagada ao lado do rótulo, fora do texto da opção', async () => {
    await withFakeDom(async () => {
      const { optionBody } = (await import(/* @vite-ignore */ DROPDOWN)) as { optionBody: (opt: FakeOption) => unknown[] }
      const parts = optionBody({ selected: true, textContent: 'Equilibrada', dataset: { hint: 'padrão' } }) as unknown as FakeNode[]
      expect(parts.map((p) => p.className)).toEqual(['dd-check', 'dd-label', 'dd-hint grow'])
      expect(parts[1]!.textContent).toBe('Equilibrada')
      expect(parts[2]!.textContent).toBe('padrão')
      const plain = optionBody({ selected: false, textContent: 'Alta', dataset: {} }) as unknown as FakeNode[]
      expect(plain.map((p) => p.className)).toEqual(['dd-check', 'grow'])
    })
  })
})

describe('modeOptions', () => {
  it('marca como "padrão" só o modo que vale quando ninguém escolhe', async () => {
    await withFakeDom(async () => {
      const { MODES, modeOptions } = (await import(/* @vite-ignore */ BRAIN)) as {
        MODES: { value: string; label: string }[]
        modeOptions: (modes: { value: string; label: string }[], fallback: string, hint?: string) => unknown[]
      }
      const options = modeOptions(MODES, 'acceptEdits') as unknown as FakeNode[]
      expect(options.filter((o) => o.getAttribute('data-hint')).map((o) => [o.textContent, o.getAttribute('data-hint')])).toEqual([
        ['Editar livremente', 'padrão'],
      ])
      expect((modeOptions(MODES, 'default', 'padrão do app') as unknown as FakeNode[])[0]!.getAttribute('data-hint')).toBe('padrão do app')
    })
  })
})
