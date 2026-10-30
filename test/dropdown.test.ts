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
