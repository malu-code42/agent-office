import { describe, expect, it } from 'vitest'
import casaData from '../src/renderer/src/assets/pixel/casa.json'
import atlasData from '../src/renderer/src/assets/pixel/atlas.json'
import { homeSpot } from '../src/renderer/src/game/home-seats'
import { casaPlan, zoneAt, type CasaAct, type CasaLayout } from '../src/renderer/src/world2d/casa'
import { depthSort } from '../src/renderer/src/world2d/depth'
import { actAt } from '../src/renderer/src/world2d/hit'
import { artToScreen, headingOf } from '../src/renderer/src/world2d/iso'
import { grid2d } from '../src/renderer/src/world2d/layout'
import { recolour, recolourMap, type Palette } from '../src/renderer/src/world2d/skins'
import { LUNA_VARIANT } from '../src/renderer/src/world2d/sprites'
import { pngAlpha } from './png-alpha'

const CASA = casaData as unknown as CasaLayout
const ATLAS = atlasData as unknown as { frames: Record<string, [number, number, number, number]>; palettes: Palette[] }
const ACTS: CasaAct[] = [
  'agenda',
  'goals',
  'personal-routines',
  'radio',
  'books',
  'films',
  'games',
  'writing',
  'skull',
  'totem',
  'computer',
]

describe('fase 4 no layout da Casa', () => {
  it('cada sofá dos cantos de descanso tem o lugar sentado, atrás do sofá', () => {
    const sit = CASA.hang.filter((h) => h.kind === 'sit')
    expect(CASA.couch).toHaveLength(sit.length)
    for (const c of CASA.couch) {
      const sofa = CASA.static.find((p) => p.fp[0] <= c.at[0] && c.at[0] < p.fp[2] && p.fp[1] <= c.at[1] && c.at[1] < p.fp[3])!
      expect(sofa).toBeTruthy()
      // the sitter sorts before the sofa: its backrest hides the sitter's back
      expect(depthSort([{ fp: sofa.fp }, { fp: c.fp }])[0].fp).toBe(c.fp)
      expect(ATLAS.frames[`char/0/${c.dir}/${c.pose}`]).toBeTruthy()
    }
  })

  it('o quadro de rotinas fica na parede oeste, ao lado da janela, e o elevador abre em dois quadros', () => {
    const [y0, y1, z0, z1] = CASA.totem
    expect(y1 - y0).toBeGreaterThanOrEqual(11) // three 3x5 glyphs
    expect(z1 - z0).toBeGreaterThan(7)
    expect(y1).toBeLessThan(CASA.window[0])
    expect(CASA.elevator.open).toHaveLength(2)
    for (const d of CASA.elevator.open) expect(ATLAS.frames[d.f]).toBeTruthy()
  })

  it('o atlas tem digitando, caído e os efeitos da caveira', () => {
    for (const f of ['char/3/FL/typeF', 'char/3/BR/typeB', 'char/3/down', 'fx/skull', 'fx/ghost', 'fx/puff'])
      expect(ATLAS.frames[f], f).toBeTruthy()
  })
})

describe('layout 2D da Casa', () => {
  it('tem 24x18 tiles, o elevador no fundo do hall e as duas meias-paredes com portas', () => {
    expect(CASA.size).toEqual([24, 18])
    expect(CASA.base).toBe('casa-base.png')
    expect(CASA.elevator.tile).toEqual([11, 1])
    expect(CASA.walls.map((w) => [w.axis, w.at])).toEqual([
      ['x', 10],
      ['x', 14],
    ])
    for (const w of CASA.walls) expect(w.doors.length).toBeGreaterThan(0)
  })

  it('tem cada coisa clicável da Casa 3D, mais a caveira, o totem e o computador', () => {
    const acts = new Set([...CASA.static.flatMap((s) => (s.act ? [s.act] : [])), ...CASA.hot.map((h) => h.act)])
    expect([...acts].sort()).toEqual([...ACTS].sort())
    expect(CASA.static.filter((s) => s.act === 'books')).toHaveLength(5)
    expect(CASA.static.filter((s) => s.act === 'games')).toHaveLength(3)
    // every sprite is in the atlas
    for (const s of CASA.static) expect(ATLAS.frames[s.f], s.f).toBeDefined()
  })

  it('as quatro mesas de trabalho têm uma cadeira cada, a da Luna primeiro, todas viradas para a mesa', () => {
    const { seats } = CASA.table
    expect(seats).toHaveLength(4)
    expect(new Set(seats.map((s) => s.at.join())).size).toBe(4)
    // every sitter faces its desk, which is west of the chair
    for (const s of seats) expect(s.dir, s.seat.f).toBe('BL')
  })

  it('dá para chegar do elevador a toda cadeira, à sua mesa, aos cantos de lazer e às portas', () => {
    const grid = grid2d(CASA)
    const plan = casaPlan(CASA, grid)
    const [ex, ez] = plan.elevator.tile
    const goals: [number, number][] = [
      ...[plan.luna, ...plan.chairs, plan.boss].map((c): [number, number] => [Math.floor(c.x), Math.floor(c.z)]),
      ...plan.visit,
      ...plan.overflow,
      ...plan.hang.map((h) => h.approach),
      ...plan.keepClear,
    ]
    for (const [x, z] of goals) {
      expect(grid.walkable(x, z), `${x},${z}`).toBe(true)
      expect(grid.findPath(ex, ez, x, z), `${x},${z}`).not.toBeNull()
    }
  })

  it('as meias-paredes só deixam passar pelas portas', () => {
    const grid = grid2d(CASA)
    expect(grid.canStep(10, 0, 9, 0)).toBe(false)
    expect(grid.canStep(10, 4, 9, 4)).toBe(true)
    expect(grid.canStep(13, 8, 14, 8)).toBe(false)
    expect(grid.canStep(13, 11, 14, 11)).toBe(true)
  })

  it('diz o nome do lugar sob o ponteiro', () => {
    expect(zoneAt(CASA, 3, 8)).toBe('Mesa da Luna')
    expect(zoneAt(CASA, 12, 9)).toBe('Entrada')
    expect(zoneAt(CASA, 18, 15)).toBe('Jogos')
    expect(zoneAt(CASA, 30, 30)).toBeNull()
  })
})

describe('plano da Casa 2D', () => {
  const grid = grid2d(CASA)
  const plan = casaPlan(CASA, grid)

  it('o jogador senta na cadeira da sua mesa, olhando para o monitor', () => {
    const voce = CASA.voce.seat
    expect(plan.boss).toEqual({ x: voce.at[0] / 16, z: voce.at[1] / 16, face: 0 })
    expect(plan.inBossRoom(plan.boss.x, plan.boss.z)).toBe(true)
    expect(plan.inBossRoom(plan.table.x, plan.table.z)).toBe(false)
    expect(plan.noVisit(Math.floor(plan.boss.x), Math.floor(plan.boss.z))).toBe(true)
    // visitors stand around the user's corner, never on the chair
    for (const [x, z] of plan.visit) {
      expect(plan.inBossRoom(x, z)).toBe(true)
      expect(plan.noVisit(x, z)).toBe(false)
    }
    expect(plan.visit.length).toBeGreaterThan(4)
  })

  it('os residentes sentam nas cadeiras livres na ordem da arte, nunca na da Luna', () => {
    const spots = plan.chairs.map((_, n) => homeSpot(grid, n, plan)!)
    expect(spots).toHaveLength(3)
    expect(spots.every((s) => s.sit)).toBe(true)
    expect(spots.some((s) => s.point.x === plan.luna.x && s.point.z === plan.luna.z)).toBe(false)
    expect(new Set(spots.map((s) => `${s.point.x},${s.point.z}`)).size).toBe(3)
    // the residents fill the desks in order after Luna's
    expect(spots.map((s) => s.tile)).toEqual([
      [6, 8],
      [3, 10],
      [6, 10],
    ])
    // the same seat number always gives the same chair
    expect(homeSpot(grid, 2, plan)).toEqual(spots[2])
  })

  it('quem passa das cadeiras fica de pé perto da mesa, longe das cadeiras e das portas', () => {
    const extra = Array.from({ length: 8 }, (_, n) => homeSpot(grid, plan.chairs.length + n, plan)!)
    const [x0, z0, x1, z1] = plan.around
    expect(new Set(extra.map((s) => s.tile.join())).size).toBe(8)
    for (const s of extra) {
      expect(s.sit).toBe(false)
      expect(grid.walkable(...s.tile)).toBe(true)
      expect(s.tile[0] >= x0 && s.tile[0] < x1 && s.tile[1] >= z0 && s.tile[1] < z1).toBe(true)
      expect([plan.luna, ...plan.chairs].every((c) => Math.hypot(s.point.x - c.x, s.point.z - c.z) >= 1)).toBe(true)
      expect(plan.keepClear.some(([x, z]) => x === s.tile[0] && z === s.tile[1])).toBe(false)
    }
    expect(homeSpot(grid, 500, plan)).toBeNull()
  })

  it('quem fica à toa vai aos sofás, aos fliperamas e ao canto de leitura', () => {
    expect(plan.hang.map((h) => h.kind)).toContain('play')
    expect(plan.hang.filter((h) => h.kind === 'sit').length).toBeGreaterThanOrEqual(4)
    expect(plan.overflow.length).toBeGreaterThan(3)
  })
})

describe('clique na Casa 2D', () => {
  // the real pixels of the sprite sheet, as the app reads them
  const png = pngAlpha('src/renderer/src/assets/pixel/atlas.png')
  const solid = (f: string, u: number, v: number) => {
    const r = ATLAS.frames[f]
    return !!r && u >= 0 && v >= 0 && u < r[2] && v < r[3] && png.alpha(r[0] + Math.floor(u), r[1] + Math.floor(v)) > 0
  }
  const items = depthSort(CASA.static.map((s) => ({ fp: s.fp, sprites: [{ f: s.f, x: s.x, y: s.y }], act: s.act })))

  it('cada coisa clicável tem um ponto que responde por ela', () => {
    for (const act of ACTS) {
      const boxes = [
        ...CASA.static.filter((s) => s.act === act).map((s) => [s.x, s.y, ATLAS.frames[s.f][2], ATLAS.frames[s.f][3]]),
        ...CASA.hot.filter((h) => h.act === act).map((h) => h.box),
      ]
      let hit = false
      for (const [x, y, w, h] of boxes)
        for (let v = 0; v < h && !hit; v++)
          for (let u = 0; u < w && !hit; u++) hit = actAt(items, CASA.hot, { x: x + u, y: y + v }, solid) === act
      expect(hit, act).toBe(true)
    }
  })

  it('o chão vazio e os móveis sem ação não abrem nada', () => {
    const floor = artToScreen(CASA.origin, 340, 200)
    expect(actAt(items, CASA.hot, floor, solid)).toBeNull()
    const sofa = CASA.static.find((s) => s.fp[0] === 62 && s.fp[1] === 28)!
    expect(actAt(items, CASA.hot, { x: sofa.x + 10, y: sofa.y + 10 }, solid)).toBeNull()
  })

  it('um móvel na frente esconde o clicável de trás', () => {
    const list = [{ sprites: [{ f: 'a', x: 0, y: 0 }], act: 'books' }, { sprites: [{ f: 'a', x: 5, y: 0 }] }]
    const box = (_f: string, u: number, v: number) => u >= 0 && v >= 0 && u < 10 && v < 10
    expect(actAt(list, [], { x: 2, y: 2 }, box)).toBe('books')
    expect(actAt(list, [], { x: 7, y: 2 }, box)).toBeNull()
    expect(actAt([], [{ act: 'agenda', box: [0, 0, 4, 4] }], { x: 1, y: 1 }, box)).toBe('agenda')
  })
})

describe('cores do visual nos sprites', () => {
  const luna = ATLAS.palettes[LUNA_VARIANT]
  const hex = (n: number) => n.toString(16).padStart(6, '0')
  const look = { skin: '#a8714b', hair: '#203040', hairStyle: 2, shirt: '#e86a5a', pants: '#3b4259', shoes: '#2f3038' }

  it('a cor base de cada parte vira a cor escolhida', () => {
    const map = recolourMap(luna, look)
    expect(hex(map.get(parseInt(luna.S, 16))!)).toBe('a8714b')
    expect(hex(map.get(parseInt(luna.H, 16))!)).toBe('203040')
    expect(hex(map.get(parseInt(luna.C, 16))!)).toBe('e86a5a')
    expect(hex(map.get(parseInt(luna.P, 16))!)).toBe('3b4259')
    expect(hex(map.get(parseInt(luna.B, 16))!)).toBe('2f3038')
  })

  it('a sombra continua mais escura que a base, e o contorno acompanha', () => {
    const map = recolourMap(luna, look)
    const shade = map.get(parseInt(luna.c, 16))!
    expect(shade >> 16).toBeLessThan(0xe8)
    // a shirt pixel and the outline next to it, lit side
    const px = new Uint8ClampedArray([0x7c, 0xc4, 0xbc, 255, 0, 0, 0, 0])
    recolour(px, map)
    expect([...px.slice(0, 4)]).toEqual([0xe8, 0x6a, 0x5a, 255])
    // transparent pixels stay as they are
    expect([...px.slice(4)]).toEqual([0, 0, 0, 0])
    expect(map.size).toBeGreaterThan(30)
  })

  it('o canto meio transparente do contorno também muda de cor (o canvas arredonda o RGB)', () => {
    const map = recolourMap(luna, look)
    // the shirt base read back from a 50% alpha pixel, a couple of levels off
    const px = new Uint8ClampedArray([0x7c + 2, 0xc4 - 1, 0xbc, 128])
    recolour(px, map)
    expect([...px]).toEqual([0xe8, 0x6a, 0x5a, 128])
    // an opaque pixel off by the same amount is not part of the character: it stays
    const solid = new Uint8ClampedArray([0x7c + 2, 0xc4 - 1, 0xbc, 255])
    recolour(solid, map)
    expect([...solid]).toEqual([0x7c + 2, 0xc4 - 1, 0xbc, 255])
  })

  it('uma cor ilegível deixa aquela parte como estava', () => {
    const map = recolourMap(luna, { ...look, shirt: 'azul' })
    expect(map.has(parseInt(luna.C, 16))).toBe(false)
    expect(map.has(parseInt(luna.S, 16))).toBe(true)
  })
})
