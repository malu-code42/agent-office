import { describe, expect, it } from 'vitest'
import { Avatar } from '../src/renderer/src/world2d/avatar'

const look = { skin: '#f2c49b', hair: '#3a3340', hairStyle: 0, shirt: '#4a90d9', pants: '#4f5873', shoes: '#5a4038' }

describe('Avatar 2D (sem three.js)', () => {
  it('anda pelos pontos, olha para onde vai e chama a chegada uma vez', () => {
    const av = new Avatar(look, 'a')
    av.placeAt(1, 1)
    let arrived = 0
    av.walk([{ x: 1, z: 3 }], () => arrived++)
    expect(av.isMoving).toBe(true)
    for (let i = 0; i < 40; i++) av.update(0.05)
    expect([av.position.x, av.position.z]).toEqual([1, 3])
    expect(av.heading).toBe(0)
    expect(arrived).toBe(1)
    expect(av.isWalking).toBe(false)
  })

  it('volta a ficar de pé ao andar e a tag acompanha a posição', () => {
    const av = new Avatar(look, 'a')
    av.pose = 'type'
    av.walk([{ x: 2, z: 0 }])
    expect(av.pose).toBe('stand')
    av.update(1)
    expect(av.anchor.x).toBeCloseTo(av.position.x)
    expect(av.anchor.y).toBeGreaterThan(0.5)
  })

  it('a caveira derruba: fica no chão, a tag desce e levanta de novo', () => {
    const av = new Avatar(look, 'a')
    av.walk([{ x: 5, z: 5 }])
    av.knockDown()
    expect(av.isWalking).toBe(false)
    expect(av.isDown).toBe(true)
    expect(av.anchor.y).toBeLessThan(1)
    av.getUp()
    expect(av.isDown).toBe(false)
  })

  it('uniforme troca só a camisa; olhar para um ponto encaixa em 8 direções', () => {
    const av = new Avatar(look, 'a')
    av.setUniform({ color: '#ff0000' })
    expect(av.worn).toEqual({ ...look, shirt: '#ff0000' })
    av.setUniform(null)
    expect(av.worn).toBe(look)
    av.faceTowards(1, 0.1)
    expect(av.heading).toBeCloseTo(Math.PI / 2)
  })
})
