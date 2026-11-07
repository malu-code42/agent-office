import { describe, expect, it } from 'vitest'
import layoutData from '../src/renderer/src/assets/pixel/project.json'
import atlasData from '../src/renderer/src/assets/pixel/atlas.json'
import { grid2d, projectPlan2d, type ProjectLayout } from '../src/renderer/src/world2d/layout'
import { onNorthWall, onWestWall, toScreen } from '../src/renderer/src/world2d/iso'
import { inRects, roomUnder, WALL_H } from '../src/renderer/src/world2d/room-hit'
import { roomNumeral, roomTitle } from '../src/shared/squad-rooms'
import { AGENT_DESK_COUNT, roomLabel } from '../src/renderer/src/world2d/plan'
import { SQUAD_DESKS_PER_ROOM, SQUAD_ROOM_COUNT } from '../src/shared/types'

// AO-106: the four L-shaped rooms around Emi's office, checked on the exported layout (project.json). The art has
// no picture test, so this is what proves the geometry: nothing overlaps, no desk blocks a chair, and everything
// can be reached from the elevator.
const LAYOUT = layoutData as unknown as ProjectLayout
const ORIGIN = LAYOUT.origin
const TILE = 16

type Fp = [number, number, number, number]
const overlap = (a: readonly number[], b: readonly number[]) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]
const tilesOf = (fp: readonly number[]) => {
  // the tiles the exporter blocks for a footprint: those it covers by at least half (or the one under its middle)
  const span = (a: number, b: number) => {
    const need = Math.min(TILE / 2, (b - a) / 2)
    const out: number[] = []
    for (let i = Math.floor(a / TILE); i <= Math.floor((b - 1) / TILE); i++) if (Math.min(b, (i + 1) * TILE) - Math.max(a, i * TILE) >= need) out.push(i)
    return out
  }
  return span(fp[0], fp[2]).flatMap((x) => span(fp[1], fp[3]).map((z): [number, number] => [x, z]))
}

const squad = (code: string, n: number) => ({
  code,
  name: code,
  members: Array.from({ length: n }, (_, i) => ({ id: `m${i}`, execution: 'subagent' })),
})

describe('a arte do andar de quatro salas (AO-106)', () => {
  it('não tem mais lounge, sala de reuniões nem diretoria no layout', () => {
    expect(Object.keys(LAYOUT)).not.toContain('meeting')
    expect(Object.keys(LAYOUT)).not.toContain('lounge')
    expect(Object.keys(LAYOUT)).not.toContain('director')
    expect(LAYOUT.static.filter((p) => p.f.startsWith('meeting') || p.f.startsWith('lounge') || p.f.startsWith('diretoria'))).toEqual([])
    const frames = Object.keys(atlasData.frames)
    expect(frames.filter((f) => f.startsWith('meeting/') || f.startsWith('lounge/') || f.startsWith('diretoria/'))).toEqual([])
  })

  it('nenhuma peça fixa se sobrepõe: mesas, cadeiras, móveis e a mesa da Emi', () => {
    const parts: { name: string; fp: Fp }[] = []
    LAYOUT.static.filter((p) => !p.wall).forEach((p, i) => parts.push({ name: `fixo ${i} (${p.f})`, fp: p.fp as Fp }))
    LAYOUT.rooms.forEach((room, r) => {
      parts.push({ name: `sala ${r} coordenador`, fp: room.coordinator.desk.green.fp as Fp }, { name: `sala ${r} cadeira do coordenador`, fp: room.coordinator.seat.fp as Fp })
      room.slots.forEach((s, k) => parts.push({ name: `sala ${r} mesa ${k}`, fp: s.desk.green.fp as Fp }, { name: `sala ${r} cadeira ${k}`, fp: s.seat.fp as Fp }))
    })
    parts.push({ name: 'mesa da Emi', fp: LAYOUT.emi.desk.green.fp as Fp }, { name: 'cadeira da Emi', fp: LAYOUT.emi.seat.fp as Fp })
    const clashes: string[] = []
    for (let i = 0; i < parts.length; i++)
      for (let j = i + 1; j < parts.length; j++) if (overlap(parts[i].fp, parts[j].fp)) clashes.push(`${parts[i].name} x ${parts[j].name}`)
    expect(clashes).toEqual([])
    // 36 member desks and 4 coordinator desks, each with its chair
    expect(parts.filter((p) => /^sala \d (mesa \d|coordenador)$/.test(p.name)).length).toBe(40)
  })

  it('as mesas e cadeiras de cada sala ficam dentro do L; nenhuma mesa atravessa a parede de vidro', () => {
    const grid = grid2d(LAYOUT)
    LAYOUT.rooms.forEach((room, r) => {
      const inside = (fp: readonly number[]) => tilesOf(fp).every(([x, z]) => inRects(room.rects, { x, z }))
      const desks = [room.coordinator.desk.green.fp, ...room.slots.map((s) => s.desk.green.fp)]
      const chairs = [room.coordinator.seat, ...room.slots.map((s) => s.seat)]
      desks.forEach((fp, k) => expect(inside(fp), `sala ${r} mesa ${k} fora do L`).toBe(true))
      chairs.forEach((seat, k) => {
        const tile: [number, number] = [Math.floor(seat.at[0] / TILE), Math.floor(seat.at[1] / TILE)]
        expect(inRects(room.rects, { x: tile[0], z: tile[1] }), `sala ${r} cadeira ${k} fora do L`).toBe(true)
        // the chair stands on a free tile (no desk on it): the sitter walks to it
        expect(grid.walkable(tile[0], tile[1]), `sala ${r} cadeira ${k} em tile bloqueado`).toBe(true)
      })
    })
  })

  it('a coluna da extensão fica livre em toda sala, da porta à última coluna de cadeiras', () => {
    const grid = grid2d(LAYOUT)
    for (const room of LAYOUT.rooms) {
      const z = room.door.tile
      const xs = room.rects[0]
      for (let x = xs[0]; x < xs[2]; x++) expect(grid.walkable(x, z), `${room.rect} x ${x}`).toBe(true)
    }
  })

  it('a porta do elevador fica na ponta direita do corredor do meio, janelas nas outras três pontas', () => {
    // the elevator door is on the back wall y = 0, between the strips of the two right-hand rooms
    const [x0, x1] = LAYOUT.elevator.door
    expect(x0 / TILE).toBeGreaterThan(LAYOUT.rooms[1].rect[2])
    expect(x1 / TILE).toBeLessThan(LAYOUT.rooms[3].rect[0])
    expect(LAYOUT.windows.map((w) => w.end).sort()).toEqual(['baixo', 'cima', 'esquerda'])
    // only the top one is on a wall the scene draws (x = 0); the other two are on the front walls
    expect(LAYOUT.windows.filter((w) => w.drawn).map((w) => w.end)).toEqual(['cima'])
    const top = LAYOUT.windows.find((w) => w.end === 'cima')!
    expect(top.plane === 'x' && top.at === 0).toBe(true)
    // it ends the corridor between rooms I and II, in the middle of the office's width
    const mid = (top.span[0] + top.span[1]) / 2 / TILE
    expect(mid).toBeGreaterThan(LAYOUT.rooms[1].rect[3])
    expect(mid).toBeLessThan(LAYOUT.rooms[0].rect[1] + 1)
  })

  it('a Emi senta no escritório central, e a porta de cada sala dá para o corredor ao redor dele', () => {
    const [ox0, oz0, ox1, oz1] = LAYOUT.office.rect
    const seat = LAYOUT.emi.seat
    expect(seat.at[0] / TILE).toBeGreaterThan(ox0)
    expect(seat.at[0] / TILE).toBeLessThan(ox1)
    expect(seat.at[1] / TILE).toBeGreaterThan(oz0)
    expect(seat.at[1] / TILE).toBeLessThan(oz1)
    for (const room of LAYOUT.rooms) {
      // the tile outside the door is in the ring around the office, one tile off its box, and not in any room
      const [x, z] = room.door.out
      expect(x >= ox0 - 2 && x < ox1 + 2 && z >= oz0 - 1 && z < oz1 + 1).toBe(true)
      expect(LAYOUT.rooms.some((o) => inRects(o.rects, { x, z }))).toBe(false)
      expect(inRects(room.rects, { x: room.door.in[0], z: room.door.in[1] })).toBe(true)
    }
  })

  it('o contorno e a sombra de cada sala seguem o L, sem repetir a caixa que cobre o corredor', () => {
    for (const room of LAYOUT.rooms) {
      expect(room.outline).toHaveLength(6)
      expect(room.dark).toHaveLength(room.rects.length)
      // the L is smaller than its bounding box: the corner tile at the ring is not part of the room
      const cells = room.rects.reduce((n, r) => n + (r[2] - r[0]) * (r[3] - r[1]), 0)
      expect(cells).toBeLessThan((room.rect[2] - room.rect[0]) * (room.rect[3] - room.rect[1]))
    }
  })
})

describe('ocupação das 40 mesas (AO-106)', () => {
  it('as nove mesas de uma sala cheia ficam todas ocupadas, sem repetir lugar', () => {
    const plan = projectPlan2d(LAYOUT, [squad('sala-1', 9), squad('sala-2', 9), squad('sala-3', 9), squad('sala-4', 9)])
    const all = plan.rooms.flatMap((r) => r.desks)
    expect(all).toHaveLength(SQUAD_ROOM_COUNT * SQUAD_DESKS_PER_ROOM)
    expect(new Set(all.map((d) => d.index)).size).toBe(all.length)
    expect(new Set(all.map((d) => `${d.seat.x},${d.seat.z}`)).size).toBe(all.length)
  })

  it('squads pequenas sentam ao acaso entre as nove mesas, e a ordem muda de squad para squad', () => {
    const orders = new Set<string>()
    const used = new Set<number>()
    for (const code of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      const desks = projectPlan2d(LAYOUT, [squad(code, 3)]).rooms[0].desks.map((d) => d.index)
      orders.add(desks.join(','))
      desks.forEach((d) => used.add(d))
    }
    expect(orders.size).toBeGreaterThan(4)
    // over eight squads nearly every one of the nine desks is chosen at least once
    expect(used.size).toBeGreaterThanOrEqual(7)
  })

  it('os agentes individuais vão para mesas livres de qualquer das quatro salas', () => {
    const plan = projectPlan2d(LAYOUT, [squad('sala-1', 4)])
    expect(plan.agentDesks).toHaveLength(AGENT_DESK_COUNT)
    const seats = new Set(plan.rooms[0].desks.map((d) => `${d.seat.x},${d.seat.z}`))
    for (const d of plan.agentDesks) expect(seats.has(`${d.seat.x},${d.seat.z}`)).toBe(false)
  })

  it('quem espera sem mesa fica nos corredores, nunca dentro de uma sala nem no escritório', () => {
    const plan = projectPlan2d(LAYOUT, [squad('sala-1', 9), squad('sala-2', 9), squad('sala-3', 9), squad('sala-4', 9)])
    const waiting = [...plan.overflow, ...plan.agentStand]
    expect(waiting.length).toBe(16)
    for (const [x, z] of waiting) {
      expect(LAYOUT.rooms.some((r) => inRects(r.rects, { x, z })), `${x},${z} em sala`).toBe(false)
      expect(inRects([LAYOUT.office.rect], { x, z }), `${x},${z} no escritório`).toBe(false)
    }
    expect(new Set(waiting.map(([x, z]) => `${x},${z}`)).size).toBe(waiting.length)
  })
})

describe('rótulos: número no código, romano na tela (AO-106)', () => {
  it('as salas se chamam Sala I a Sala IV na tela', () => {
    expect([0, 1, 2, 3].map(roomNumeral)).toEqual(['I', 'II', 'III', 'IV'])
    expect(roomTitle(3)).toBe('Sala IV')
    const plan = projectPlan2d(LAYOUT, [])
    expect(plan.rooms.map((r) => r.name)).toEqual(['Sala I', 'Sala II', 'Sala III', 'Sala IV'])
    expect(plan.rooms.map(roomLabel)).toEqual(['Sala I', 'Sala II', 'Sala III', 'Sala IV'])
  })

  it('o código da sala continua com o número', () => {
    const plan = projectPlan2d(LAYOUT, [squad('sala-4', 2)])
    expect(plan.rooms[3].squad).toBe('sala-4')
  })
})

describe('alvo de clique de cada sala (AO-106)', () => {
  // a pixel of the back wall at art units (along, height); the wall x = 0 spans y, the wall y = 0 spans x
  const west = (y: number, z: number) => ({ x: ORIGIN[0] - y, y: ORIGIN[1] + y / 2 - z })
  const north = (x: number, z: number) => ({ x: ORIGIN[0] + x, y: ORIGIN[1] + x / 2 - z })
  const noSprite = () => false

  it('a sala I e a II respondem na parede do fundo esquerda; a IV, na parede do fundo direita', () => {
    const [i, ii, , iv] = LAYOUT.rooms
    const mid = (r: number[]) => ((r[1] + r[3]) / 2) * TILE
    expect(roomUnder(LAYOUT, west(mid(i.rect), 30), noSprite)).toBe(0)
    expect(roomUnder(LAYOUT, west(mid(ii.rect), 30), noSprite)).toBe(1)
    expect(onWestWall(ORIGIN, west(mid(ii.rect), 30), ii.rect[1] * TILE, ii.rect[3] * TILE, WALL_H)).toBe(true)
    const nx = ((iv.rect[0] + iv.rect[2]) / 2) * TILE
    expect(onNorthWall(ORIGIN, north(nx, 30), iv.rect[0] * TILE, iv.rect[2] * TILE, WALL_H)).toBe(true)
    expect(roomUnder(LAYOUT, north(nx, 30), noSprite)).toBe(3)
  })

  it('o corredor da janela, no fim da parede esquerda, não é de nenhuma sala', () => {
    // between rooms I and II on the west wall
    const hall = LAYOUT.windows.find((w) => w.end === 'cima')!
    expect(roomUnder(LAYOUT, west((hall.span[0] + hall.span[1]) / 2, 30), noSprite)).toBe(-1)
    // and the elevator end of the north wall, between rooms II and IV
    const [e0, e1] = LAYOUT.elevator.door
    expect(roomUnder(LAYOUT, north((e0 + e1) / 2, 30), noSprite)).toBe(-1)
  })

  it('a sala do canto da frente não tem parede do fundo: responde na mesa do coordenador e no piso', () => {
    const iii = LAYOUT.rooms[2]
    expect(iii.back).toBeNull()
    // the floor of its block
    const block = iii.rects[0]
    const floor = toScreen(ORIGIN, (block[0] + block[2]) / 2, (block[1] + block[3]) / 2)
    expect(roomUnder(LAYOUT, floor, noSprite)).toBe(2)
    // its coordinator's desk, by a painted pixel of the sprite
    const desk = iii.coordinator.desk.green
    const solid = (f: string, u: number, v: number) => f === desk.f && u === 3 && v === 3
    expect(roomUnder(LAYOUT, { x: desk.x + 3, y: desk.y + 3 }, solid)).toBe(2)
    // the floor of the corridor outside it is nobody's
    expect(roomUnder(LAYOUT, toScreen(ORIGIN, 12, 14), noSprite)).toBe(-1)
  })

  it('a sala que tem parede do fundo não rouba o clique do piso: andar dentro dela continua possível', () => {
    for (const r of [0, 1, 3]) {
      const block = LAYOUT.rooms[r].rects[0]
      const floor = toScreen(ORIGIN, (block[0] + block[2]) / 2, (block[1] + block[3]) / 2)
      // the floor point is lower on screen than any wall of the room: no room answers there
      expect(roomUnder(LAYOUT, floor, noSprite), `sala ${r}`).not.toBe(r)
    }
  })
})
