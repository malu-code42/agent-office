import { describe, expect, it } from 'vitest'
import { Grid } from '../src/renderer/src/world2d/pathfinding'
import { strikeSpot } from '../src/renderer/src/game/strike-spot'

describe('strikeSpot (caveira no sofá)', () => {
  // A 5×5 room with a two-tile sofa at (2,2)-(3,2).
  const grid = () => {
    const g = new Grid(5, 5)
    g.block(2, 2)
    g.block(3, 2)
    return g
  }

  it('tira do sofá para o piso livre mais perto antes de cair', () => {
    const spot = strikeSpot(grid(), { x: 2.5, z: 2.5 }, 'relax')
    expect(spot).not.toBeNull()
    const [x, z] = [Math.floor(spot!.x), Math.floor(spot!.z)]
    expect(grid().walkable(x, z)).toBe(true)
    expect(Math.max(Math.abs(x - 2), Math.abs(z - 2))).toBe(1)
  })

  it('não cai em cima de outro agente', () => {
    const g = grid()
    const taken = (x: number, z: number) => Math.max(Math.abs(x - 2), Math.abs(z - 2)) === 1 && !(x === 1 && z === 1)
    expect(strikeSpot(g, { x: 2.5, z: 2.5 }, 'relax', taken)).toEqual({ x: 1.5, z: 1.5 })
  })

  it('quem está de pé ou à mesa cai onde está', () => {
    expect(strikeSpot(grid(), { x: 0.5, z: 0.5 }, 'stand')).toBeNull()
    expect(strikeSpot(grid(), { x: 2.5, z: 2.5 }, 'type')).toBeNull()
  })
})
