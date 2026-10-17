import { describe, expect, it } from 'vitest'
import { parseEmphasis } from '../src/shared/emphasis'

describe('parseEmphasis', () => {
  it('returns the text unchanged when there are no markers', () => {
    expect(parseEmphasis('Comprar pão')).toEqual([{ kind: 'plain', text: 'Comprar pão' }])
  })

  it('splits bold and italic runs around plain text', () => {
    expect(parseEmphasis('Pagar **conta** de *luz* hoje')).toEqual([
      { kind: 'plain', text: 'Pagar ' },
      { kind: 'bold', text: 'conta' },
      { kind: 'plain', text: ' de ' },
      { kind: 'italic', text: 'luz' },
      { kind: 'plain', text: ' hoje' },
    ])
  })

  it('reads a double star as bold, not as two italic markers', () => {
    expect(parseEmphasis('**tudo**')).toEqual([{ kind: 'bold', text: 'tudo' }])
  })

  it('keeps unpaired or spaced markers as plain text', () => {
    expect(parseEmphasis('2 * 3 * 4 e **aberto')).toEqual([{ kind: 'plain', text: '2 * 3 * 4 e **aberto' }])
  })

  it('leaves other markdown alone', () => {
    expect(parseEmphasis('[link](x) `codigo` _sublinhado_')).toEqual([{ kind: 'plain', text: '[link](x) `codigo` _sublinhado_' }])
  })
})
