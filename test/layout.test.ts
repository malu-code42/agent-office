import { describe, expect, it } from 'vitest'
import { Grid } from '../src/renderer/src/world/pathfinding'
import { SQUAD_MAX_MEMBERS, SQUAD_MIN_MEMBERS, SQUAD_ROOM_COUNT } from '@shared/types'
import { AGENT_DESK_COUNT, AGENT_ROOM_RECT, DIRECTOR_RECT, SQUAD_ROOM_RECTS, projectPlan } from '../src/renderer/src/world/layout'

/** A squad with `n` members that each get a desk of their own. */
function squad(code: string, n: number, name = code) {
  return {
    code,
    name,
    members: Array.from({ length: n }, (_, i) => ({ id: `m${i}`, execution: 'subagent' })),
  }
}

describe('projectPlan', () => {
  it('always has three squad rooms on the west side', () => {
    const plan = projectPlan([])
    expect(plan.rooms).toHaveLength(SQUAD_ROOM_COUNT)
    expect(plan.rooms.map((r) => r.rect)).toEqual(SQUAD_ROOM_RECTS)
    for (const room of plan.rooms) {
      expect(room.rect[0]).toBe(0)
      expect(room.rect[2]).toBe(10)
    }
  })

  it('keeps the coordinator desk of an empty room, with no member desks', () => {
    const plan = projectPlan([])
    const room = plan.rooms[0]
    expect(room.squad).toBeNull()
    expect(room.desks).toEqual([])
    expect(room.members).toEqual([])
    // The coordinator's desk sits in the corner by the door, facing the members.
    expect(room.coordinator.at).toEqual({ x: 8.3, z: 6.3 })
    expect(room.coordinator.rot).toBe(-Math.PI / 2)
    expect(room.coordinator.seat).toEqual({ x: 9.3, z: 6.3 })
  })

  it('makes one desk per member, in the order of the room', () => {
    const plan = projectPlan([squad('alfa', 3)])
    const room = plan.rooms[0]
    expect(room.squad).toBe('alfa')
    expect(room.members).toEqual(['alfa/m0', 'alfa/m1', 'alfa/m2'])
    expect(room.desks).toHaveLength(3)
    // 1 top row by the coordinator, 2 bottom row of the same column, 3 middle column.
    expect(room.desks.map((d) => [d.center!.x, d.center!.z])).toEqual([
      [5.5, 2],
      [5.5, 6],
      [3.5, 2],
    ])
    // Every member desk is turned 90°, with the agent on its west side.
    for (const d of room.desks) {
      expect(d.turned).toBe(true)
      expect(d.face).toBe(Math.PI / 2)
      expect(d.seat.x).toBeCloseTo(d.center!.x - 0.9)
    }
  })

  it('holds six member desks at most, in the order of the room', () => {
    const plan = projectPlan([squad('alfa', 8)])
    const room = plan.rooms[0]
    expect(room.desks).toHaveLength(SQUAD_MAX_MEMBERS)
    expect(room.desks.map((d) => [d.center!.x, d.center!.z])).toEqual([
      [5.5, 2],
      [5.5, 6],
      [3.5, 2],
      [3.5, 6],
      [1.5, 2],
      [1.5, 6],
    ])
  })

  it('gives each room its own screen numbers, after the ten desks of the agents', () => {
    const plan = projectPlan([squad('alfa', 3), squad('beta', 2)])
    expect(plan.agentDesks.map((d) => d.index)).toEqual([...Array(AGENT_DESK_COUNT).keys()])
    expect(plan.rooms[0].desks.map((d) => d.index)).toEqual([10, 11, 12])
    expect(plan.rooms[1].desks.map((d) => d.index)).toEqual([16, 17])
  })

  it('has ten desks for the individual agents, in two columns of five, turned 90°', () => {
    const plan = projectPlan([])
    expect(plan.agentDesks).toHaveLength(AGENT_DESK_COUNT)
    const west = plan.agentDesks.slice(0, 5)
    const east = plan.agentDesks.slice(5)
    expect(new Set(west.map((d) => d.center!.x))).toEqual(new Set([24.5]))
    expect(new Set(east.map((d) => d.center!.x))).toEqual(new Set([29.5]))
    expect(new Set(west.map((d) => d.center!.z))).toEqual(new Set([2.5, 7.5, 12.5, 17.5, 22.5]))
    for (const d of plan.agentDesks) {
      expect(d.turned).toBe(true)
      expect(d.face).toBe(Math.PI / 2)
      expect(d.seat.x).toBeCloseTo(d.center!.x - 0.9)
    }
  })

  it('keeps every squad when there are more than three, and says so', () => {
    const squads = [squad('a', 3), squad('b', 3), squad('c', 3), squad('d', 3)]
    const plan = projectPlan(squads)
    expect(plan.rooms.map((r) => r.squad)).toEqual(['a', 'b', 'c'])
    // The squad without a room is not hidden: it comes back as an issue.
    expect(plan.issues.map((i) => i.code)).toEqual(['d'])
    expect(plan.issues[0].reason).toContain('d')
    expect(plan.issues[0].reason).toContain('3')
    expect(plan.squadOf.get('d/m0')).toBe('d')
  })

  it('says when the composition of a squad does not fit the room', () => {
    const plan = projectPlan([squad('a', SQUAD_MIN_MEMBERS - 1), squad('b', 3), squad('c', 3), squad('d', SQUAD_MAX_MEMBERS + 1)])
    const codes = plan.issues.map((i) => i.code)
    expect(codes).toContain('a')
    expect(codes).toContain('d')
    expect(plan.issues.find((i) => i.code === 'a')!.reason).toContain('1')
  })

  it('a sala vazia fica vazia, a sala com proposta fica à espera, a sala com squad fica acesa', () => {
    const plan = projectPlan([squad('sala-1', 3)], [1])
    expect(plan.rooms[0]!.state).toBe('live')
    expect(plan.rooms[1]!.state).toBe('proposed')
    expect(plan.rooms[2]!.state).toBe('empty')
    // A sala com proposta não tem mesas de membros: o time ainda não existe.
    expect(plan.rooms[1]!.desks).toEqual([])
    expect(plan.rooms[1]!.members).toEqual([])
    // O móvel fixo continua lá.
    expect(plan.rooms[1]!.coordinator.at).toBeDefined()
  })

  it('o squad do office fica na sala que o código nomeia', () => {
    const plan = projectPlan([squad('sala-3', 2)])
    expect(plan.rooms[2]!.squad).toBe('sala-3')
    expect(plan.rooms[0]!.squad).toBeNull()
  })

  it('uma sala com proposta não fica livre para outro squad', () => {
    const plan = projectPlan([squad('alfa', 2)], [0])
    expect(plan.rooms[0]!.state).toBe('proposed')
    expect(plan.rooms[1]!.squad).toBe('alfa')
  })

  it('puts the doors where the plan says: the squad rooms to the hall, the director room to the elevator', () => {
    const plan = projectPlan([])
    const doorsOf = (axis: 'x' | 'z', at: number) => plan.partitions.find((p) => p.axis === axis && p.at === at)?.doors
    expect(doorsOf('x', 10)).toEqual([3, 4])
    expect(doorsOf('x', 10)).toBeDefined()
    expect(doorsOf('z', 16)).toEqual([14, 15, 16])
    expect(doorsOf('x', AGENT_ROOM_RECT[0])).toEqual([3, 4, 19, 20])
    expect(DIRECTOR_RECT).toEqual([11, 16, 20, 24])
  })

  it('closes the director room on the east side: the north door is the only way in', () => {
    const plan = projectPlan([])
    const wall = (axis: 'x' | 'z', at: number) => plan.partitions.find((p) => p.axis === axis && p.at === at)
    // The east wall of the room, from the north wall to the end of the floor.
    const east = wall('x', DIRECTOR_RECT[2])
    expect(east).toBeDefined()
    expect(east!.doors).toEqual([])
    expect(east!.from).toBe(DIRECTOR_RECT[1])
    expect(east!.to).toBe(DIRECTOR_RECT[3])
    // The other three sides: the west wall and the south wall of the building are
    // closed too, and the north wall has the one door.
    expect(wall('x', DIRECTOR_RECT[0])!.doors).toEqual([])
    expect(wall('z', DIRECTOR_RECT[1])!.doors).toEqual([14, 15, 16])
  })

  it('the wall of the director room blocks the way to the corridor, the door does not', () => {
    const grid = new Grid(32, 24)
    for (const p of projectPlan([]).partitions) {
      for (let i = p.from; i < p.to; i++) {
        if (p.doors.includes(i)) continue
        if (p.axis === 'x') grid.blockEdgeX(p.at, i)
        else grid.blockEdgeZ(p.at, i)
      }
    }
    // The east wall: from the room (x 11..19) to the corridor (x 20) there is no way.
    expect(grid.canStep(19, 20, 20, 20)).toBe(false)
    // The door of the north wall: the hall reaches the room.
    expect(grid.canStep(15, 15, 15, 16)).toBe(true)
    expect(grid.findPath(15, 15, 15, 20)).not.toBeNull()
    // The corridor still goes on: it links the hall to the doors of the agents' room.
    expect(grid.canStep(20, 15, 20, 16)).toBe(true)
  })
})

describe('the delivery at the coordinator', () => {
  const full = projectPlan([squad('alfa', SQUAD_MAX_MEMBERS)])

  it('has a tile per member of a full room, and no two are the same', () => {
    for (const room of full.rooms) {
      expect(room.coordinator.deliver).toHaveLength(SQUAD_MAX_MEMBERS)
      expect(new Set(room.coordinator.deliver.map(([x, z]) => `${x},${z}`)).size).toBe(SQUAD_MAX_MEMBERS)
    }
  })

  it('the tiles stand inside the room, free of the desks', () => {
    for (const room of full.rooms) {
      const [x0, z0, x1, z1] = room.rect
      const blocked = new Set<string>()
      // the coordinator's desk: the column by the wall, three tiles deep
      for (let z = z0 + 5; z <= z0 + 7; z++) blocked.add(`${x1 - 2},${z}`)
      // the member desks: one tile wide, two deep
      for (const d of room.desks) {
        blocked.add(`${d.x},${d.z}`)
        blocked.add(`${d.x},${d.z + 1}`)
      }
      // the bookshelf and the plant of the room
      blocked.add(`0,${z0 + 5}`)
      blocked.add(`0,${z0 + 6}`)
      blocked.add(`${x1 - 1},${z0}`)
      for (const [x, z] of room.coordinator.deliver) {
        expect(blocked.has(`${x},${z}`)).toBe(false)
        expect(x).toBeGreaterThanOrEqual(x0)
        expect(x).toBeLessThan(x1)
        expect(z).toBeGreaterThanOrEqual(z0)
        expect(z).toBeLessThan(z1)
      }
    }
  })

  it('every tile is reachable on foot from the door of the room', () => {
    for (const room of full.rooms) {
      const [, z0, x1] = room.rect
      const grid = new Grid(32, 24)
      for (const p of full.partitions) {
        for (let i = p.from; i < p.to; i++) {
          if (p.doors.includes(i)) continue
          if (p.axis === 'x') grid.blockEdgeX(p.at, i)
          else grid.blockEdgeZ(p.at, i)
        }
      }
      // the furniture of the room
      grid.blockRect(x1 - 2, z0 + 5, 1, 3)
      for (const d of room.desks) grid.blockRect(d.x, d.z, 1, 2)
      grid.blockRect(0, z0 + 5, 1, 2)
      grid.blockRect(x1 - 1, z0, 1, 1)
      // the door of the room is on its east wall
      const door: [number, number] = [x1 - 1, z0 + 3]
      for (const [x, z] of room.coordinator.deliver) {
        expect(grid.walkable(x, z)).toBe(true)
        expect(grid.findPath(door[0], door[1], x, z)).not.toBeNull()
      }
    }
  })
})
