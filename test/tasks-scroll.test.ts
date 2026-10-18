import { describe, expect, it } from 'vitest'
import { keepScroll } from '../src/renderer/src/ui/tasks-scroll'

/** The scroll of the Tarefas lists survives a redraw of the board (the board is replaced, not rebuilt from scratch). */

describe('keepScroll (quadro Tarefas sem piscar)', () => {
  it('mantém a posição de uma lista que continua no quadro', () => {
    expect(keepScroll({ Fazer: 120 }, ['Fazer', 'Feito'], { Fazer: 400, Feito: 0 })).toEqual({ Fazer: 120 })
  })

  it('descarta a posição de uma lista que sumiu', () => {
    expect(keepScroll({ Fazer: 120, Antiga: 80 }, ['Fazer'], { Fazer: 400 })).toEqual({ Fazer: 120 })
  })

  it('limita a posição ao novo máximo da lista', () => {
    expect(keepScroll({ Fazer: 300 }, ['Fazer'], { Fazer: 90 })).toEqual({ Fazer: 90 })
  })

  it('uma lista que deixou de rolar volta para zero', () => {
    expect(keepScroll({ Fazer: 300 }, ['Fazer'], {})).toEqual({ Fazer: 0 })
  })

  it('não inventa posição para lista nova', () => {
    expect(keepScroll({}, ['Fazer'], { Fazer: 400 })).toEqual({})
  })
})
