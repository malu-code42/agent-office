import { describe, expect, it } from 'vitest'
import { parseBooks } from '../src/main/study-book-suggestions'

describe('parseBooks', () => {
  it('keeps https items, open first, and drops the rest', () => {
    const raw = `texto [
      {"title":"Pago","author":"A","url":"https://x.com/1","access":"paid"},
      {"title":"Livre","author":"B","url":"https://x.com/2","access":"open","license":"CC BY 4.0"},
      {"title":"Sem https","author":"C","url":"http://x.com/3","access":"open"},
      {"author":"D","url":"https://x.com/4"}
    ]`
    expect(parseBooks(raw)).toEqual([
      { title: 'Livre', author: 'B', url: 'https://x.com/2', access: 'open', license: 'CC BY 4.0' },
      { title: 'Pago', author: 'A', url: 'https://x.com/1', access: 'paid' },
    ])
  })
  it('returns nothing when there is no list', () => {
    expect(parseBooks('nada')).toEqual([])
  })
})
