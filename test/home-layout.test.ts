import { describe, expect, it } from 'vitest'
import { Grid } from '../src/renderer/src/world/pathfinding'
import { LOUNGE_SEATS } from '../src/renderer/src/world/layout'
import { HOME_INTERACTIONS, HOME_PARTITIONS, HOME_ROOMS, HOME_SPAWN_TILE, isHomeRoomTile } from '../src/renderer/src/world/home-layout'

function houseGrid(): Grid {
  const grid = new Grid(32, 24)
  for (const wall of HOME_PARTITIONS) {
    for (let i = wall.from; i < wall.to; i++) {
      if (wall.doors.includes(i)) continue
      if (wall.axis === 'x') grid.blockEdgeX(wall.at, i)
      else grid.blockEdgeZ(wall.at, i)
    }
  }
  grid.blockRect(4, 5, 2, 2)
  grid.block(16, 8)
  return grid
}

describe('planta da casa', () => {
  it('cobre a planta aprovada de 32×24 com os dez cômodos', () => {
    expect(HOME_ROOMS.map(({ id }) => id)).toEqual([
      'office',
      'entry',
      'kitchen',
      'garden',
      'reading',
      'corridor',
      'living',
      'bedroom',
      'games',
      'atelier',
    ])
    for (let z = 0; z < 24; z++) for (let x = 0; x < 32; x++) expect(isHomeRoomTile(x, z)).toBe(true)
    expect(isHomeRoomTile(-1, 0)).toBe(false)
    expect(isHomeRoomTile(32, 0)).toBe(false)
  })

  it('mantém todos os objetos interativos alcançáveis desde o elevador', () => {
    const grid = houseGrid()
    for (const { approach } of HOME_INTERACTIONS) {
      expect(grid.walkable(...approach)).toBe(true)
      expect(grid.findPath(...HOME_SPAWN_TILE, ...approach), `objeto em ${approach}`).not.toBeNull()
    }
  })

  it('mantém todos os cômodos ligados à entrada e não reserva o quarto para agentes ociosos', () => {
    const grid = houseGrid()
    for (const {
      id,
      rect: [x0, z0, x1, z1],
    } of HOME_ROOMS) {
      const target: [number, number] = [Math.floor((x0 + x1) / 2), Math.floor((z0 + z1) / 2)]
      if (id === 'office') target[0] = 3
      expect(grid.findPath(...HOME_SPAWN_TILE, ...target), `cômodo ${target}`).not.toBeNull()
    }
    for (const spot of LOUNGE_SEATS) {
      expect(spot.x < 8 && spot.z >= 14 && spot.z < 24).toBe(false)
    }
  })

  it('fecha o quarto para a sala e mantém apenas a porta do cantinho de leitura', () => {
    const grid = houseGrid()
    expect(grid.canStep(3, 13, 3, 14)).toBe(true)
    expect(grid.canStep(7, 18, 8, 18)).toBe(false)
    expect(grid.findPath(13, 1, 4, 20)).not.toBeNull()
  })

  it('define atalhos só para integrações existentes, sem encaminhar para o agendador', () => {
    expect(HOME_INTERACTIONS.map(({ id }) => id)).toEqual(['agenda', 'personal-routines', 'goals', 'radio', 'media', 'writing'])
    expect(HOME_INTERACTIONS.some(({ id }) => id === ('agent-scheduler' as never))).toBe(false)
  })
})
