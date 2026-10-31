import { describe, expect, it } from 'vitest'
import { SQUAD_MAX_MEMBERS } from '@shared/types'
import { AGENT_DESK_COUNT } from '../src/renderer/src/world/layout'
import layoutData from '../src/renderer/src/assets/pixel/project.json'
import { behind, depthSort, type Footprint } from '../src/renderer/src/world2d/depth'
import { plaqueLeft, plaqueSize, ringColors, textWidth } from '../src/renderer/src/world2d/font'
import { topmost } from '../src/renderer/src/world2d/hit'
import {
  artToScreen,
  clampCenter,
  deviceScale,
  dirOf,
  fitZoom,
  floorBounds,
  headingOf,
  toFloor,
  toScreen,
} from '../src/renderer/src/world2d/iso'
import { grid2d, memberDeskIndex, projectPlan2d, slotOfDesk, type ProjectLayout } from '../src/renderer/src/world2d/layout'
import { agentBubble, variantOf } from '../src/renderer/src/world2d/sprites'
import charsData from '../src/renderer/src/assets/pixel/chars.json'
import refs from './fixtures/pixel-chars-ref.json'
import { CUTS, cutOf, paletteFromHex, paletteOf, recolor, rgb } from '../src/renderer/src/world2d/recolor'

const LAYOUT = layoutData as unknown as ProjectLayout
const ORIGIN: [number, number] = [320, 87]

const squad = (code: string, n: number, name = code) => ({
  code,
  name,
  members: Array.from({ length: n }, (_, i) => ({ id: `m${i}`, execution: 'subagent' })),
})

describe('iso', () => {
  it('projeta 2:1: um tile tem 32x16 pixels e o canto do fundo fica na origem', () => {
    expect(toScreen(ORIGIN, 0, 0)).toEqual({ x: 320, y: 87 })
    expect(toScreen(ORIGIN, 1, 0)).toEqual({ x: 336, y: 95 })
    expect(toScreen(ORIGIN, 0, 1)).toEqual({ x: 304, y: 95 })
    expect(toScreen(ORIGIN, 0, 0, 1)).toEqual({ x: 320, y: 71 })
  })

  it('volta do pixel para o chão', () => {
    for (const [x, z] of [
      [3.5, 7.25],
      [0, 17.9],
      [23.2, 0.1],
    ]) {
      const p = toScreen(ORIGIN, x, z)
      const back = toFloor(ORIGIN, p.x, p.y)
      expect(back.x).toBeCloseTo(x)
      expect(back.z).toBeCloseTo(z)
    }
  })

  it('usa a mesma projeção do gerador (16 unidades por tile)', () => {
    expect(artToScreen(ORIGIN, 48, 32, 8)).toEqual(toScreen(ORIGIN, 3, 2, 0.5))
  })

  it('escolhe o sprite pela direção: frente para baixo da tela, direita para a direita', () => {
    expect(dirOf(0)).toBe('FL') // +z
    expect(dirOf(Math.PI / 2)).toBe('FR') // +x
    expect(dirOf(-Math.PI / 2)).toBe('BL') // -x
    expect(dirOf(Math.PI)).toBe('BR') // -z
    for (const d of ['FL', 'FR', 'BL', 'BR'] as const) expect(dirOf(headingOf(d))).toBe(d)
  })

  it('só escala em números inteiros', () => {
    expect(deviceScale(2, 1)).toBe(2)
    expect(deviceScale(2, 1.25)).toBe(2)
    expect(deviceScale(3, 2)).toBe(6)
    expect(deviceScale(0.4, 1)).toBe(1)
  })

  it('o zoom inicial é o maior que cabe na janela', () => {
    const b = floorBounds(ORIGIN, [24, 18])
    expect(fitZoom(b, { w: 1424, h: 835 }, 1)).toBe(2)
    expect(fitZoom(b, { w: 800, h: 600 }, 1)).toBe(1)
    expect(fitZoom(b, { w: 2200, h: 1300 }, 1)).toBe(3)
  })

  it('a câmera fica no andar e centraliza quando ele cabe', () => {
    const b: [number, number, number, number] = [0, 0, 700, 400]
    expect(clampCenter({ x: 0, y: 0 }, b, { w: 1000, h: 1000 })).toEqual({ x: 350, y: 200 })
    expect(clampCenter({ x: 0, y: 0 }, b, { w: 200, h: 100 })).toEqual({ x: 100, y: 50 })
    expect(clampCenter({ x: 999, y: 999 }, b, { w: 200, h: 100 })).toEqual({ x: 600, y: 350 })
  })
})

describe('depth', () => {
  it('quem está todo atrás num eixo e se sobrepõe no outro vem antes', () => {
    expect(behind([0, 0, 10, 10], [10, 0, 20, 10])).toBe(true)
    expect(behind([0, 0, 10, 10], [0, 10, 10, 20])).toBe(true)
    expect(behind([10, 0, 20, 10], [0, 0, 10, 10])).toBe(false)
    // in front on the other axis: no order between them
    expect(behind([0, 40, 10, 50], [10, 0, 20, 10])).toBe(false)
  })

  it('ordena de trás para frente, mesmo contra a soma x + y', () => {
    // a long desk along y, and a chair east of its far end: the chair's x0 + y0 is smaller, but the desk is behind it
    const desk = { id: 'desk', fp: [64, 8, 78, 34] as Footprint }
    const chair = { id: 'chair', fp: [80, 11, 90, 21] as Footprint }
    const wall = { id: 'wall', fp: [0, 96, 144, 98] as Footprint }
    expect(depthSort([wall, chair, desk]).map((i) => i.id)).toEqual(['desk', 'chair', 'wall'])
  })

  it('mantém a ordem de quem empata', () => {
    const a = { id: 'a', fp: [0, 0, 4, 4] as Footprint }
    const b = { id: 'b', fp: [0, 0, 4, 4] as Footprint }
    expect(depthSort([a, b]).map((i) => i.id)).toEqual(['a', 'b'])
    expect(depthSort([b, a]).map((i) => i.id)).toEqual(['b', 'a'])
  })
})

describe('hit', () => {
  it('acerta quem está na frente, só em pixel pintado', () => {
    const list = [
      { key: 'back', char: { f: 'a', x: 0, y: 0 } },
      { key: 'front', char: { f: 'a', x: 4, y: 0 } },
    ]
    // a 10x10 sprite painted only on its left half
    const solid = (_f: string, u: number, v: number) => u >= 0 && u < 5 && v >= 0 && v < 10
    expect(topmost(list, { x: 6, y: 2 }, solid)?.key).toBe('front')
    expect(topmost(list, { x: 2, y: 2 }, solid)?.key).toBe('back')
    expect(topmost(list, { x: 9.5, y: 2 }, solid)).toBeNull()
  })
})

describe('layout 2D do andar de projeto', () => {
  it('tem as três salas de squad 9x6, a reunião, a diretoria e o elevador', () => {
    expect(LAYOUT.size).toEqual([24, 18])
    expect(LAYOUT.rooms.map((r) => r.rect)).toEqual([
      [0, 0, 9, 6],
      [0, 6, 9, 12],
      [0, 12, 9, 18],
    ])
    expect(LAYOUT.rooms.every((r) => r.slots.length === SQUAD_MAX_MEMBERS)).toBe(true)
    expect(LAYOUT.meeting.rect).toEqual([11, 7, 18, 18])
    expect(LAYOUT.director.rect).toEqual([18, 7, 24, 18])
    expect(LAYOUT.meeting.seats).toHaveLength(6)
  })

  it('a porta da diretoria abre para a sala de reunião', () => {
    const wall = LAYOUT.walls.find((w) => w.axis === 'x' && w.at === 18)
    expect(wall?.doors.length).toBeGreaterThan(0)
  })

  it('dá para chegar a toda cadeira, à mesa de reunião e à porta de cada sala saindo do elevador', () => {
    const grid = grid2d(LAYOUT)
    const plan = projectPlan2d(LAYOUT, [squad('sala-1', 6), squad('sala-2', 4), squad('sala-3', 2)])
    const [ex, ez] = plan.elevator.tile
    expect(grid.walkable(ex, ez)).toBe(true)
    const goals: [number, number][] = [
      ...plan.rooms.flatMap((r) => [
        r.coordinator.approach,
        r.coordinator.sideApproach,
        ...r.coordinator.deliver,
        ...r.desks.map((d) => d.approach),
      ]),
      ...plan.agentDesks.map((d) => d.approach),
      ...plan.meeting.seats.map((s) => s.approach),
      plan.director.approach,
    ]
    for (const [x, z] of goals) {
      expect(grid.walkable(x, z), `${x},${z}`).toBe(true)
      expect(grid.findPath(ex, ez, x, z), `${x},${z}`).not.toBeNull()
    }
  })

  it('não atravessa as paredes de vidro fora das portas', () => {
    const grid = grid2d(LAYOUT)
    // squad room 1 east wall: closed at row 0, a door at rows 2 and 3
    expect(grid.canStep(8, 0, 9, 0)).toBe(false)
    expect(grid.canStep(8, 2, 9, 2)).toBe(true)
    // between squad rooms 1 and 2
    expect(grid.canStep(1, 5, 1, 6)).toBe(false)
  })
})

describe('projectPlan2d', () => {
  it('cada squad pega sua sala; as mesas dos membros seguem a ordem da sala', () => {
    const plan = projectPlan2d(LAYOUT, [squad('sala-2', 3, 'Dev Beta')])
    expect(plan.rooms.map((r) => r.state)).toEqual(['empty', 'live', 'empty'])
    const room = plan.rooms[1]
    expect(room.name).toBe('Dev Beta')
    expect(room.desks.map((d) => d.index)).toEqual([memberDeskIndex(1, 0), memberDeskIndex(1, 1), memberDeskIndex(1, 2)])
    // members face the coordinator (-x), the coordinator faces them (+x)
    expect(room.desks.every((d) => d.face === -Math.PI / 2)).toBe(true)
    expect(room.coordinator.rot).toBe(Math.PI / 2)
    expect(plan.issues).toEqual([])
  })

  it('os agentes individuais sentam nas mesas que sobram, no máximo dez', () => {
    const none = projectPlan2d(LAYOUT, [])
    expect(none.agentDesks).toHaveLength(AGENT_DESK_COUNT)
    expect(none.agentDesks.map((d) => d.index)).toEqual([...Array(AGENT_DESK_COUNT).keys()])
    const busy = projectPlan2d(LAYOUT, [squad('sala-1', 6), squad('sala-2', 6), squad('sala-3', 3)])
    expect(busy.agentDesks).toHaveLength(3)
    // nobody shares a chair with a squad member
    const seats = new Set(busy.rooms.flatMap((r) => r.desks.map((d) => `${d.seat.x},${d.seat.z}`)))
    for (const d of busy.agentDesks) expect(seats.has(`${d.seat.x},${d.seat.z}`)).toBe(false)
    expect(busy.agentStand.length).toBeGreaterThan(0)
  })

  it('squads demais ficam de fora como problema, sem sumir', () => {
    const plan = projectPlan2d(LAYOUT, [squad('a', 2), squad('b', 2), squad('c', 2), squad('d', 2, 'Quarto')])
    expect(plan.rooms.every((r) => r.state === 'live')).toBe(true)
    expect(plan.issues.map((i) => i.code)).toEqual(['d'])
    expect(plan.squadOf.get('d/m0')).toBe('d')
  })

  it('a sala com proposta fica reservada e composição fora do limite vira aviso', () => {
    const plan = projectPlan2d(LAYOUT, [squad('x', 1)], [0])
    expect(plan.rooms[0].state).toBe('proposed')
    expect(plan.rooms[1].squad).toBe('x')
    expect(plan.issues.map((i) => i.code)).toEqual(['x'])
  })

  it('cada mesa do plano sabe em que sala e lugar é desenhada', () => {
    const plan = projectPlan2d(LAYOUT, [squad('sala-3', 2)])
    const slots = slotOfDesk(plan, LAYOUT)
    expect(slots.get(memberDeskIndex(2, 1))).toEqual({ room: 2, slot: 1 })
    expect(slots.get(0)).toEqual({ room: 0, slot: 0 })
    expect(slots.size).toBe(plan.agentDesks.length + 2)
  })

  it('o elevador e a sala de reunião vêm do layout', () => {
    const plan = projectPlan2d(LAYOUT, [])
    expect(plan.elevator.tile).toEqual(LAYOUT.elevator.tile)
    expect(plan.size).toEqual([24, 18])
    expect(plan.meeting.seats).toHaveLength(6)
    expect(plan.overflow.length).toBeGreaterThan(0)
  })
})

describe('placas e sprites', () => {
  it('mede o texto como a fonte do gerador', () => {
    expect(textWidth('II')).toBe(2 * textWidth('I') + 1)
    expect(plaqueSize('Sala 1').h).toBe(11)
    expect(plaqueSize('Coordenação').h).toBe(13) // ç hangs below the line
    expect(plaqueLeft(100, 'Sala 1')).toBe(Math.trunc(100 - plaqueSize('Sala 1').w / 2))
  })

  it('o anel da placa é mais claro em cima e à esquerda', () => {
    const { lit, shade } = ringColors()
    expect(lit[0]).toBeGreaterThan(shade[0])
  })

  it('o mesmo visual sempre dá a mesma variante, entre as seis de agente', () => {
    const look = { skin: '#f7d7b5', hair: '#3a3340', hairStyle: 2, shirt: '#86acd8', pants: '#4f5873', shoes: '#5a4038' }
    expect(variantOf(look)).toBe(variantOf({ ...look }))
    const seen = new Set<number>()
    for (let i = 0; i < 40; i++) seen.add(variantOf({ ...look, hairStyle: i, shirt: `#${i}0a0b0` }))
    for (const v of seen) expect(v >= 0 && v < 6).toBe(true)
    expect(seen.size).toBeGreaterThan(3)
  })

  it('o balão de pixel diz o que o agente faz', () => {
    expect(agentBubble('working', false, null)).toBe('dots')
    expect(agentBubble('working', true, null)).toBe('ask')
    expect(agentBubble('idle', false, 'error')).toBe('bang')
    expect(agentBubble('idle', false, 'ok')).toBe('ok')
    expect(agentBubble('idle', false, null)).toBeNull()
  })
})

describe('visual do agente nos sprites 2D (troca de paleta)', () => {
  const chars = charsData as unknown as { frames: string[]; grids: Record<string, string[][]> }
  const look = { skin: '#d9a066', hair: '#b33a3a', hairStyle: 3, shirt: '#f0a23b', pants: '#24496b', shoes: '#1e1e24' }

  it('pinta pixel por pixel o mesmo que o gerador, contorno incluído', () => {
    for (const ref of refs) {
      const grid = chars.grids[ref.cut][chars.frames.indexOf(ref.frame)]
      expect(grid, ref.cut + ' ' + ref.frame).toBeDefined()
      const px = recolor(grid, paletteFromHex(ref.palette))
      const hex = Array.from({ length: px.length / 4 }, (_, i) =>
        [0, 1, 2, 3].map((k) => px[i * 4 + k].toString(16).padStart(2, '0')).join(''),
      )
      // transparent pixels may carry any colour in the PNG export; compare colour only where painted
      const norm = (h: string) => (h.endsWith('00') ? '00000000' : h)
      expect(hex.map(norm), ref.cut + ' ' + ref.frame).toEqual(ref.pixels.map(norm))
    }
  })

  it('a pele, o cabelo, a camiseta, a calça e o sapato vêm do visual', () => {
    const pal = paletteOf(look)
    expect(pal.S).toEqual(rgb(look.skin))
    expect(pal.H).toEqual(rgb(look.hair))
    expect(pal.C).toEqual(rgb(look.shirt))
    expect(pal.P).toEqual(rgb(look.pants))
    expect(pal.B).toEqual(rgb(look.shoes))
    // shades are darker than their base, the hair's light is lighter
    for (const [base, shade] of [
      ['S', 's'],
      ['H', 'h'],
      ['C', 'c'],
      ['P', 'p'],
    ])
      expect(pal[shade].reduce((a, b) => a + b)).toBeLessThan(pal[base].reduce((a, b) => a + b))
    expect(pal.L.reduce((a, b) => a + b)).toBeGreaterThan(pal.H.reduce((a, b) => a + b))
    // the face and the outline do not change with the look
    expect(paletteOf({ ...look, skin: '#5e3a24' }).E).toEqual(pal.E)
  })

  it('cada corte (1 a 6) é um penteado diferente, e todos existem no sprite', () => {
    const cuts = [0, 1, 2, 3, 4, 5].map((i) => cutOf({ ...look, hairStyle: i }))
    expect(new Set(cuts).size).toBe(6)
    expect(cuts).toEqual([...CUTS])
    expect(cutOf({ ...look, hairStyle: 7 })).toBe(CUTS[1])
    const front = chars.frames.indexOf('FL/idle')
    const heads = cuts.map((c) => chars.grids[c][front].slice(0, 14).join(''))
    expect(new Set(heads).size).toBe(6)
  })

  it('a camiseta pinta só os pixels da camiseta', () => {
    const grid = chars.grids[cutOf(look)][chars.frames.indexOf('FL/idle')]
    const a = recolor(grid, paletteOf(look))
    const b = recolor(grid, paletteOf({ ...look, shirt: '#3b4a8f' }))
    for (let y = 0; y < grid.length; y++)
      for (let x = 0; x < grid[0].length; x++) {
        const i = (y * grid[0].length + x) * 4
        const same = a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2]
        if (grid[y][x] === 'S' || grid[y][x] === 'H' || grid[y][x] === 'P') expect(same).toBe(true)
        if (grid[y][x] === 'C') expect(same).toBe(false)
      }
  })
})
