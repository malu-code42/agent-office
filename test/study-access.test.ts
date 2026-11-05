import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StudyFloor } from '../src/renderer/src/game/study'
import type { Overlays, Tag } from '../src/renderer/src/world2d/overlays'

// Only the DOM surface used by Tag; input events still run its real listeners.
class TagElement extends EventTarget {
  className = ''
  textContent = ''
  tabIndex = -1
  children: TagElement[] = []
  attributes = new Map<string, string>()
  classList = { add: (..._names: string[]) => {} }
  append(...children: TagElement[]): void {
    this.children.push(...children)
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }
  querySelector(selector: string): TagElement | null {
    return this.children.find((child) => `.${child.className}` === selector) ?? null
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('acesso às ideias no andar de estudo (AO-33)', () => {
  it('a tag acessível encaminha mouse, Enter e Espaço para a ação ideas', () => {
    vi.stubGlobal('document', { createElement: () => new TagElement() })
    const tags: Tag[] = []
    const overlays = { add: (tag: Tag) => (tags.push(tag), tag) } as Overlays
    const onAct = vi.fn()
    const floor = new StudyFloor(overlays, onAct)
    const tag = tags.find((item) => item.el.title === 'Ideias de software')
    expect(tag).toBeDefined()
    const pill = tag!.el.querySelector<HTMLElement>('.tag-pill')!
    expect(pill.getAttribute('role')).toBe('button')
    expect(pill.getAttribute('aria-label')).toBe('Abrir Ideias de software')
    expect(pill.tabIndex).toBe(0)
    expect(tag!.hidden).toBe(true)
    floor.show(true)
    expect(tag!.hidden).toBe(false)
    pill.dispatchEvent(new Event('click'))
    for (const key of ['Enter', ' ', 'Escape']) {
      const event = new Event('keydown', { cancelable: true })
      Object.assign(event, { key })
      pill.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(key !== 'Escape')
    }
    expect(onAct.mock.calls).toEqual([['ideas'], ['ideas'], ['ideas']])
    floor.show(false)
    expect(tag!.hidden).toBe(true)
  })

  it('a ação do jogo abre o popup existente, sem abrir cartões', () => {
    // Execute the real boot callback without starting Electron or reading userData.
    const source = ts.createSourceFile('main.ts', readFileSync('src/renderer/src/main.ts', 'utf8'), ts.ScriptTarget.Latest, true)
    let callback: ts.Expression | undefined
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'onStudy') callback = node.initializer
      ts.forEachChild(node, visit)
    }
    visit(source)
    expect(callback).toBeDefined()
    const ui = {}
    const toast = vi.fn()
    const openStudyIdeas = vi.fn()
    const openStudyCards = vi.fn()
    const code = ts.transpileModule(`(${callback!.getText(source)})`, { compilerOptions: { target: ts.ScriptTarget.ES2023 } }).outputText
    const onStudy = runInNewContext(code, { ui, toast, openStudyIdeas, openStudyCards }) as (act: string) => void
    onStudy('ideas')
    expect(openStudyIdeas).toHaveBeenCalledExactlyOnceWith(ui, toast)
    expect(openStudyCards).not.toHaveBeenCalled()
    onStudy('cards')
    expect(openStudyCards).toHaveBeenCalledExactlyOnceWith(ui, toast)
  })

  it('a trilha não mantém o botão nem importa a janela de ideias', () => {
    const source = readFileSync('src/renderer/src/ui/study-trail-board.ts', 'utf8')
    expect(source).not.toContain('Ideias de software')
    expect(source).not.toContain('openStudyIdeas')
  })
})
