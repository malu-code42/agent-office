// The project floor of the 2D world, as scripts/pixel-art/export_app.py describes it
// (assets/pixel/project.json), and the seat/desk/room plan the game walks by. Pure: no
// DOM, so the tests check it. Layout numbers are art units (16 per tile) unless named
// in tiles; the plan is in tiles, like the 3D plan of world/layout.ts.

import { SQUAD_MAX_MEMBERS, SQUAD_MIN_MEMBERS, SQUAD_ROOM_COUNT } from '@shared/types'
import { floorRooms } from '@shared/squad-rooms'
import {
  AGENT_DESK_COUNT,
  memberKey,
  type DeskSlot,
  type Partition,
  type ProjectIssue,
  type ProjectPlan,
  type SquadRoom,
} from '../world/layout'
import { Grid } from '../world/pathfinding'
import type { Footprint } from './depth'
import { headingOf, TILE, type Dir } from './iso'

type Rect = [number, number, number, number]

/** A sprite at its place on the native canvas, with the footprint it sorts by. */
export interface Placement {
  /** Atlas frame. */
  f: string
  /** Top-left corner on the native canvas (art pixels). */
  x: number
  y: number
  fp: Footprint
  /** A glass wall piece: it blocks tile edges, not tiles. */
  wall?: boolean
}

export type CrtState = 'green' | 'amber' | 'red' | 'off'

/** A desk drawn with its monitor in each state. */
export type DeskArt = Record<CrtState, Placement>

/** A chair: the seat, the backrest (in front of the sitter or behind it) and where the sitter is drawn. */
export interface SeatArt {
  /** Middle of the chair (art units). */
  at: [number, number]
  fp: Footprint
  seat: Placement
  back: Placement
  /** The backrest stands between the sitter and the viewer. */
  front: boolean
  /** Top-left of the seated sprite. */
  sit: [number, number]
  /** Tail of a speech bubble over the sitter's head. */
  head: [number, number]
  dir: Dir
  pose: 'sitF' | 'sitB'
}

export interface RoomArt {
  /** Tiles. */
  rect: Rect
  /** Centre x and top y of the room's plate. */
  plate: [number, number]
  /** Outline of the room's volume, for the lights-off shade. */
  dark: [number, number][]
  coordinator: { desk: DeskArt; center: [number, number]; seat: SeatArt; plate: [number, number] }
  /** The member desks in creation order; the first four are the approved art's. */
  slots: { desk: DeskArt; seat: SeatArt; plate: [number, number] }[]
}

export interface ProjectLayout {
  tile: number
  /** Tiles. */
  size: [number, number]
  /** Native canvas (art pixels) and where the floor's back corner sits on it. */
  canvas: [number, number]
  origin: [number, number]
  base: string
  static: Placement[]
  walls: Partition[]
  /** Tiles taken by furniture. */
  blocked: [number, number][]
  rooms: RoomArt[]
  emi: { desk: DeskArt; seat: SeatArt; plate: [number, number] }
  meeting: { rect: Rect; table: [number, number]; seats: SeatArt[]; plate: [number, number] }
  director: { rect: Rect; plate: [number, number] }
  lounge: { rect: Rect; plate: [number, number] }
  /** Door tile, drop point (tiles) and the door on the back wall (x0, x1, height in art units). */
  elevator: { tile: [number, number]; point: [number, number]; door: [number, number, number] }
}

/** Tile of a point in art units. */
const tileOf = (a: number) => Math.floor(a / TILE)

/** The walkability of the floor: furniture tiles and the glass walls with their doors. */
export function grid2d(layout: Pick<ProjectLayout, 'size' | 'blocked' | 'walls'>): Grid {
  const grid = new Grid(layout.size[0], layout.size[1])
  for (const [x, z] of layout.blocked) grid.block(x, z)
  for (const p of layout.walls)
    for (let i = p.from; i < p.to; i++) {
      if (p.doors.includes(i)) continue
      if (p.axis === 'x') grid.blockEdgeX(p.at, i)
      else grid.blockEdgeZ(p.at, i)
    }
  return grid
}

/** A desk slot of the plan: the seat is the chair's middle, the agent looks the way the chair faces. */
function deskSlot(index: number, desk: DeskArt, seat: SeatArt): DeskSlot {
  const fp = desk.green.fp
  const sx = seat.at[0] / TILE
  const sz = seat.at[1] / TILE
  return {
    index,
    x: tileOf(fp[0]),
    z: tileOf(fp[1]),
    turned: true,
    center: { x: (fp[0] + fp[2]) / 2 / TILE, z: (fp[1] + fp[3]) / 2 / TILE },
    seat: { x: sx, z: sz },
    approach: [Math.floor(sx), Math.floor(sz)],
    face: headingOf(seat.dir),
  }
}

/** Screen index of a member desk: the agents' desks first, then six per room (as in the 3D plan). */
export const memberDeskIndex = (room: number, k: number) => AGENT_DESK_COUNT + room * SQUAD_MAX_MEMBERS + k

/** An empty squad room of the 2D floor: the coordinator's desk is there, no member desks. */
function emptyRoom(art: RoomArt, index: number): SquadRoom {
  const [, z0] = art.rect
  const seat = art.coordinator.seat
  const sx = seat.at[0] / TILE
  const sz = seat.at[1] / TILE
  return {
    index,
    rect: art.rect,
    squad: null,
    name: `Sala ${index + 1}`,
    coordinator: {
      at: { x: art.coordinator.center[0] / TILE, z: art.coordinator.center[1] / TILE },
      rot: headingOf(seat.dir),
      seat: { x: sx, z: sz },
      approach: [Math.floor(sx), Math.floor(sz)],
      // beside the coordinator, between the desk and the bookshelf
      side: { x: Math.floor(sx) + 0.5, z: z0 + 4.5 },
      sideApproach: [Math.floor(sx), z0 + 4],
      // the aisle in front of the coordinator's desk, middle first
      deliver: [2, 3, 1, 4, 0, 5].map((dz): [number, number] => [3, z0 + dz]),
    },
    desks: [],
    // along the east wall, clear of the doors' middle
    stand: [
      [8, z0 + 1],
      [8, z0 + 4],
      [8, z0 + 5],
      [8, z0],
      [7, z0 + 5],
    ],
    members: [],
    state: 'empty',
  }
}

/** Walkable tiles of a rectangle (tiles), row by row from the bottom. */
function freeTiles(grid: Grid, rect: Rect): [number, number][] {
  const out: [number, number][] = []
  for (let z = rect[3] - 1; z >= rect[1]; z--) for (let x = rect[0]; x < rect[2]; x++) if (grid.walkable(x, z)) out.push([x, z])
  return out
}

/**
 * The plan of a 2D project floor: the same rules as projectPlan (world/layout.ts) for
 * which squad takes which room and what does not fit, on the approved layout. The
 * individual agents sit at the member desks no squad uses (the approved art shows one
 * in a squad room), up to AGENT_DESK_COUNT; the rest stand in the lounge.
 */
export function projectPlan2d(
  layout: ProjectLayout,
  squads: { code: string; name?: string; members: { id: string; execution: string; sector?: string }[] }[],
  proposedRooms: readonly number[] = [],
): ProjectPlan {
  const grid = grid2d(layout)
  const issues: ProjectIssue[] = []
  const rooms = layout.rooms.slice(0, SQUAD_ROOM_COUNT).map((art, i) => emptyRoom(art, i))
  const squadOf = new Map<string, string>()
  for (const squad of squads) for (const m of squad.members) squadOf.set(memberKey(squad.code, m.id), squad.code)

  const reserved = new Set(proposedRooms.filter((r) => r >= 0 && r < rooms.length))
  for (const room of reserved) rooms[room].state = 'proposed'

  const floor = floorRooms(squads, [...reserved])
  const placed = new Map<number, (typeof squads)[number]>()
  for (const squad of squads) {
    const room = floor.rooms.get(squad.code)
    if (room !== undefined && !placed.has(room)) placed.set(room, squad)
  }
  for (const squad of squads) {
    if (floor.rooms.has(squad.code)) continue
    issues.push({
      code: squad.code,
      name: squad.name || squad.code,
      reason: `Não há sala livre para ${squad.name || squad.code}: o andar tem ${SQUAD_ROOM_COUNT} salas de squad e elas já têm squad ou uma proposta em aberto.`,
    })
  }

  const used = rooms.map(() => 0)
  for (const [roomIndex, squad] of placed) {
    const room = rooms[roomIndex]
    const members = squad.members.filter((m) => m.execution === 'subagent')
    room.squad = squad.code
    room.name = squad.name || squad.code
    room.state = 'live'
    if (members.length < SQUAD_MIN_MEMBERS || members.length > SQUAD_MAX_MEMBERS) {
      issues.push({
        code: squad.code,
        name: room.name,
        reason: `A sala comporta de ${SQUAD_MIN_MEMBERS} a ${SQUAD_MAX_MEMBERS} membros e ${room.name} tem ${members.length}.`,
      })
    }
    const slots = layout.rooms[roomIndex].slots
    const seated = members.slice(0, Math.min(SQUAD_MAX_MEMBERS, slots.length))
    room.members = seated.map((m) => memberKey(squad.code, m.id))
    room.desks = seated.map((_, k) => deskSlot(memberDeskIndex(roomIndex, k), slots[k].desk, slots[k].seat))
    used[roomIndex] = seated.length
  }

  // the desks no squad member takes, room by room, for the individual agents
  const agentDesks: DeskSlot[] = []
  rooms.forEach((_, r) =>
    layout.rooms[r].slots.slice(used[r]).forEach((slot) => {
      if (agentDesks.length < AGENT_DESK_COUNT) agentDesks.push(deskSlot(agentDesks.length, slot.desk, slot.seat))
    }),
  )
  const lounge = freeTiles(grid, layout.lounge.rect)
  const [ex, ez] = layout.elevator.tile
  const emi = layout.emi.seat
  const ux = emi.at[0] / TILE
  const uz = emi.at[1] / TILE
  return {
    size: layout.size,
    elevator: { tile: layout.elevator.tile, point: { x: layout.elevator.point[0], z: layout.elevator.point[1] } },
    meeting: {
      rect: layout.meeting.rect,
      table: { x: layout.meeting.table[0] / TILE, z: layout.meeting.table[1] / TILE },
      seats: layout.meeting.seats.map((s) => ({
        x: s.at[0] / TILE,
        z: s.at[1] / TILE,
        approach: [tileOf(s.at[0]), tileOf(s.at[1])],
        face: headingOf(s.dir),
      })),
    },
    // by the elevator, a step into the lounge
    overflow: lounge.filter(([x, z]) => Math.abs(x - ex) <= 3 && z <= ez + 2).slice(0, 8),
    rooms,
    agentDesks,
    agentStand: lounge.slice(0, 8),
    director: {
      index: 0,
      x: tileOf(layout.emi.desk.green.fp[0]),
      z: tileOf(layout.emi.desk.green.fp[1]),
      seat: { x: ux, z: uz },
      approach: [Math.floor(ux), Math.floor(uz)],
      face: headingOf(emi.dir),
    },
    partitions: layout.walls,
    squadOf,
    issues,
  }
}

/** The slot (room, index) a desk of the plan is drawn at, by its screen index. */
export function slotOfDesk(plan: ProjectPlan, layout: ProjectLayout): Map<number, { room: number; slot: number }> {
  const out = new Map<number, { room: number; slot: number }>()
  const key = (d: DeskSlot) => `${d.seat.x},${d.seat.z}`
  const where = new Map<string, { room: number; slot: number }>()
  layout.rooms.forEach((room, r) =>
    room.slots.forEach((s, k) => where.set(`${s.seat.at[0] / TILE},${s.seat.at[1] / TILE}`, { room: r, slot: k })),
  )
  for (const d of [...plan.agentDesks, ...plan.rooms.flatMap((r) => r.desks)]) {
    const at = where.get(key(d))
    if (at) out.set(d.index, at)
  }
  return out
}
