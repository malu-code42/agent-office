import { describe, expect, it } from 'vitest'
import { otherFieldEditing } from '../src/renderer/src/ui/panel/focus-input'

// Fake elements: the renderer has no DOM in the test environment.
const el = (tagName: string, isContentEditable = false) => ({ tagName, isContentEditable }) as unknown as Element

describe('otherFieldEditing', () => {
  const input = el('TEXTAREA')

  it('lets the chat box take the focus when nothing else is being edited', () => {
    expect(otherFieldEditing(null, input)).toBe(false)
    expect(otherFieldEditing(el('BODY'), input)).toBe(false)
    expect(otherFieldEditing(el('BUTTON'), input)).toBe(false)
    expect(otherFieldEditing(input, input)).toBe(false)
  })

  it('does not take the focus from another field being edited', () => {
    expect(otherFieldEditing(el('INPUT'), input)).toBe(true)
    expect(otherFieldEditing(el('TEXTAREA'), input)).toBe(true)
    expect(otherFieldEditing(el('SELECT'), input)).toBe(true)
    expect(otherFieldEditing(el('DIV', true), input)).toBe(true)
  })
})
