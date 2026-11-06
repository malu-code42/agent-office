import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Layout guard: the "Tarefas em foco" list scrolls only if the popup body keeps a limited height.
// jsdom has no layout, so this checks the CSS rules the scroll depends on.
const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`regra ausente: ${selector}`)
  return css.slice(start, css.indexOf('}', start))
}

describe('janela Tarefas em foco: rolagem da lista', () => {
  const focusCss = read('../src/renderer/src/ui/focus.css')
  const boardCss = read('../src/renderer/src/styles/board.css')

  it('a altura da janela é limitada', () => {
    expect(ruleBody(focusCss, '.board.card.foco-pop')).toMatch(/max-height:\s*min\(/)
  })

  it('o corpo encolhe dentro da janela e não força a altura das colunas', () => {
    expect(ruleBody(boardCss, '.board-body')).toMatch(/min-height:\s*0/)
    expect(ruleBody(focusCss, '.foco-pop .foco-cols')).toMatch(/height:\s*auto/)
  })

  it('a lista de tarefas tem overflow-y auto', () => {
    expect(ruleBody(boardCss, '.tcol-list')).toMatch(/overflow-y:\s*auto/)
  })
})
