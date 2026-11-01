import { describe, expect, it } from 'vitest'
import { skyPeriod, skyPixels } from '../src/renderer/src/world2d/window-sky'

describe('janela da Casa', () => {
  it('troca o céu por hora: manhã, dia, entardecer e noite', () => {
    expect([4, 5, 9, 10, 16, 17, 18, 19, 23, 0].map(skyPeriod)).toEqual([
      'night', 'morning', 'morning', 'day', 'day', 'evening', 'evening', 'night', 'night', 'night',
    ])
  })

  it('pinta o tamanho pedido, com a cruz do caixilho e céu diferente de dia e de noite', () => {
    const day = skyPixels('day', 30, 20)
    const night = skyPixels('night', 30, 20)
    expect(day).toHaveLength(20)
    expect(day[0]).toHaveLength(30)
    expect(day[3]![14]).toBe('#8a6448')
    expect(day[0]![0]).not.toBe(night[0]![0])
  })
})
