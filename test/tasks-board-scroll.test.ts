import { describe, expect, it } from 'vitest'
import { keepListScroll } from '../src/renderer/src/ui/tasks-board-scroll'

describe('keepListScroll', () => {
  it('keeps the offset of each list that is still on the board', () => {
    const previous = new Map([
      ['Hoje', 120],
      ['Depois', 0],
    ])
    expect([...keepListScroll(previous, ['Hoje', 'Depois'])]).toEqual([
      ['Hoje', 120],
      ['Depois', 0],
    ])
  })

  it('starts a new list at the top and drops a list that is gone', () => {
    const previous = new Map([
      ['Hoje', 80],
      ['Feito', 40],
    ])
    expect([...keepListScroll(previous, ['Hoje', 'Nova'])]).toEqual([
      ['Hoje', 80],
      ['Nova', 0],
    ])
  })

  it('starts every list at the top when there was no board before', () => {
    expect([...keepListScroll(new Map(), ['Hoje'])]).toEqual([['Hoje', 0]])
  })
})
