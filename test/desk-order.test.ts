import { describe, expect, it } from 'vitest'
import { hashKey, memberDeskOrder, stableOrder } from '../src/renderer/src/world2d/desk-order'

describe('ordem das mesas (AO-106)', () => {
  it('o hash é estável e espalha chaves vizinhas', () => {
    expect(hashKey('squad:a')).toBe(hashKey('squad:a'))
    expect(hashKey('squad:a')).not.toBe(hashKey('squad:b'))
  })

  it('devolve uma permutação de 0..n-1, sempre a mesma para a mesma semente', () => {
    const order = memberDeskOrder(9, 'squad:x')
    expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
    expect(memberDeskOrder(9, 'squad:x')).toEqual(order)
  })

  it('tirar um item não reordena os outros', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f']
    const full = stableOrder(items, 's', (x) => x)
    const without = stableOrder(
      items.filter((x) => x !== 'c'),
      's',
      (x) => x,
    )
    expect(without).toEqual(full.filter((x) => x !== 'c'))
  })

  it('varia com a semente (sorteio de verdade, não a ordem da arte)', () => {
    const orders = new Set(['a', 'b', 'c', 'd', 'e'].map((s) => memberDeskOrder(9, `squad:${s}`).join()))
    expect(orders.size).toBeGreaterThan(1)
  })

  it('sorteia de maneira equilibrada: cada mesa abre a fila com frequência parecida', () => {
    const first = new Array(5).fill(0)
    for (let i = 0; i < 1000; i++) first[memberDeskOrder(5, `squad:${i}`)[0]]++
    for (const n of first) expect(n).toBeGreaterThan(120)
  })
})
