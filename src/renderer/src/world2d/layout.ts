// The project floor of the 2D world, as scripts/pixel-art/export_app.py describes it
// (assets/pixel/project.json), and the seat/desk/room plan the game walks by. Pure: no
// DOM, so the tests check it. Layout numbers are art units (16 per tile) unless named
// in tiles (world2d/plan.ts).

import { SQUAD_DESKS_PER_ROOM, SQUAD_MAX_MEMBERS, SQUAD_MIN_MEMBERS, SQUAD_ROOM_COUNT } from '@shared/types'
import { floorRooms, roomTitle } from '@shared/squad-rooms'
import { AGENT_DESK_COUNT, memberKey, type DeskSlot, type Partition, type ProjectIssue, type ProjectPlan, type SquadRoom } from './plan'
import { Grid } from './pathfinding'
import { memberDeskOrder, stableOrder } from './desk-order'
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

/** A frame of the elevator doors at its place on the native canvas. */
export interface ElevatorDoors {
  f: string
  x: number
  y: number
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

/**
 * A squad room: an L (AO-106). Every place the game walks to comes from the art, so the plan has no numbers of
 * its own about the room's shape.
 */
export interface RoomArt {
  /** The bounding box of the L, in tiles: only for a first look; the room is `rects`. */
  rect: Rect
  /** The rectangles of the L, in tiles: the block with its extension, and the coordinator's strip. */
  rects: Rect[]
  /** The outline of the L (tile corners), for the amber outline of a proposal. */
  outline: [number, number][]
  /**
   * The back wall the room touches in the isometric scene: the west one (x = 0), the north one (y = 0), or none
   * (the corner nearest the viewer, whose click lands on the coordinator's desk and the floor).
   */
  back: 'west' | 'north' | null
  /** The door at the end of the extension, on the wall x = at: its tile along z and the tiles inside and outside. */
  door: { axis: 'x'; at: number; tile: number; in: [number, number]; out: [number, number] }
  /** Centre x and top y of the room's plate. */
  plate: [number, number]
  /** Outlines of the room's volume (one per rectangle), for the lights-off shade. */
  dark: [number, number][][]
  coordinator: {
    desk: DeskArt
    center: [number, number]
    seat: SeatArt
    plate: [number, number]
    /** Where an inline member stands, beside the coordinator, and the tile it walks to first. */
    side: [number, number]
    sideApproach: [number, number]
    /** The tiles in front of the desk where members hand their delivery over, the middle first: one per member of a full room. */
    deliver: [number, number][]
  }
  /** Tiles along the extension, door end first, where a member stands when the room has no desk for it. */
  stand: [number, number][]
  /** The member desks (nine: a 3 x 3 grid), always built; the plan hands them out at random. */
  slots: { desk: DeskArt; seat: SeatArt; plate: [number, number] }[]
}

/** A window at the end of a corridor: on the plane x = at ('x') or y = at ('y'), spanning `span` (art units). */
export interface WindowArt {
  end: 'cima' | 'baixo' | 'esquerda'
  plane: 'x' | 'y'
  at: number
  span: [number, number]
  /** False on the front walls, which the isometric scene does not draw. */
  drawn: boolean
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
  /** Emi's office in the middle of the floor, with the door on the wall x = at (tiles along z). */
  office: { rect: Rect; door: { axis: 'x'; at: number; tiles: number[] } }
  windows: WindowArt[]
  /** Door tile, drop point (tiles) and the door on the back wall (x0, x1, height in art units). */
  elevator: {
    tile: [number, number]
    point: [number, number]
    door: [number, number, number]
    /** The doors half open and open, drawn over the base while someone arrives or leaves. */
    open: [ElevatorDoors, ElevatorDoors]
  }
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

/** Screen index of a member desk: the agents' desks first, then SQUAD_DESKS_PER_ROOM per room. */
export const memberDeskIndex = (room: number, k: number) => AGENT_DESK_COUNT + room * SQUAD_DESKS_PER_ROOM + k

/** An empty squad room of the 2D floor: the coordinator's desk is there, no member desks. */
function emptyRoom(art: RoomArt, index: number): SquadRoom {
  const seat = art.coordinator.seat
  const sx = seat.at[0] / TILE
  const sz = seat.at[1] / TILE
  const [side, sideApproach, stand] = [art.coordinator.side, art.coordinator.sideApproach, art.stand]
  return {
    index,
    rect: art.rect,
    rects: art.rects,
    squad: null,
    name: roomTitle(index),
    coordinator: {
      at: { x: art.coordinator.center[0] / TILE, z: art.coordinator.center[1] / TILE },
      rot: headingOf(seat.dir),
      seat: { x: sx, z: sz },
      approach: [Math.floor(sx), Math.floor(sz)],
      side: { x: side[0], z: side[1] },
      sideApproach,
      deliver: art.coordinator.deliver,
    },
    desks: [],
    stand,
    members: [],
    state: 'empty',
    off: false,
  }
}

/**
 * The walkable tiles outside the squad rooms, nearest first from a start tile: the aisles where the ones
 * without a desk wait (AO-106: no lounge). Walking from the elevator, so every tile can be reached.
 */
function aisleTiles(grid: Grid, from: [number, number], inside: readonly Rect[], limit: number): [number, number][] {
  const inRoom = (x: number, z: number) => inside.some((r) => x >= r[0] && x < r[2] && z >= r[1] && z < r[3])
  const key = (x: number, z: number) => z * grid.w + x
  const seen = new Set<number>([key(from[0], from[1])])
  const queue: [number, number][] = [from]
  const out: [number, number][] = []
  for (let i = 0; i < queue.length && out.length < limit; i++) {
    const [x, z] = queue[i]
    if (i > 0 && !inRoom(x, z)) out.push([x, z])
    for (const [dx, dz] of [
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
    ]) {
      const nx = x + dx
      const nz = z + dz
      if (nx < 0 || nz < 0 || nx >= grid.w || nz >= grid.h || seen.has(key(nx, nz))) continue
      if (!grid.canStep(x, z, nx, nz) || inRoom(nx, nz)) continue
      seen.add(key(nx, nz))
      queue.push([nx, nz])
    }
  }
  return out
}

/**
 * The plan of a 2D project floor: the same rules as projectPlan (world/layout.ts) for
 * which squad takes which room and what does not fit, on the approved layout. The
 * individual agents sit at the member desks no squad uses (any room's, at random but
 * stable), up to AGENT_DESK_COUNT; the rest stand in the corridors.
 */
export function projectPlan2d(
  layout: ProjectLayout,
  squads: { code: string; name?: string; state?: 'paused' | 'disabled'; members: { id: string; execution: string; sector?: string }[] }[],
  proposedRooms: readonly number[] = [],
): ProjectPlan {
  const grid = grid2d(layout)
  const issues: ProjectIssue[] = []
  // The floor has the rooms its art draws, never more than the limit: a squad is never sent to a room that is not there.
  const rooms = layout.rooms.slice(0, SQUAD_ROOM_COUNT).map((art, i) => emptyRoom(art, i))
  const squadOf = new Map<string, string>()
  for (const squad of squads) for (const m of squad.members) squadOf.set(memberKey(squad.code, m.id), squad.code)

  const reserved = new Set(proposedRooms.filter((r) => r >= 0 && r < rooms.length))
  for (const room of reserved) rooms[room].state = 'proposed'

  const floor = floorRooms(squads, [...reserved], rooms.length)
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
      reason: `Não há sala livre para ${squad.name || squad.code}: o andar tem ${rooms.length} ${rooms.length === 1 ? 'sala' : 'salas'} de squad e elas já têm squad ou uma proposta em aberto.`,
    })
  }

  const taken = rooms.map(() => new Set<number>())
  for (const [roomIndex, squad] of placed) {
    const room = rooms[roomIndex]
    if (!room) continue // floorRooms already keeps squads inside rooms.length; this is the last guard
    const members = squad.members.filter((m) => m.execution === 'subagent')
    room.squad = squad.code
    room.name = squad.name || squad.code
    room.state = 'live'
    room.off = squad.state === 'disabled'
    const slots = layout.rooms[roomIndex].slots
    // what the room really seats: the limit, the desks the art draws and the screen indexes reserved to the room
    const capacity = Math.min(SQUAD_MAX_MEMBERS, SQUAD_DESKS_PER_ROOM, slots.length)
    if (members.length < SQUAD_MIN_MEMBERS || members.length > capacity) {
      issues.push({
        code: squad.code,
        name: room.name,
        reason: `A sala comporta de ${SQUAD_MIN_MEMBERS} a ${capacity} membros e ${room.name} tem ${members.length}.`,
      })
    }
    const seated = members.slice(0, capacity)
    room.members = seated.map((m) => memberKey(squad.code, m.id))
    // Any desk of the room, at random but always the same one for this squad (AO-106): the k-th member
    // takes the k-th desk of the squad's own order, and the screen index names the desk, not the member.
    const order = memberDeskOrder(capacity, `squad:${squad.code}`)
    room.desks = seated.map((_, k) => deskSlot(memberDeskIndex(roomIndex, order[k]), slots[order[k]].desk, slots[order[k]].seat))
    for (const s of order.slice(0, seated.length)) taken[roomIndex].add(s)
  }

  // The desks no squad member takes, for the individual agents: any free desk of any room, at random but
  // stable (each desk ranks by its own place, so a desk taken by a squad does not reshuffle the others).
  const free: { room: number; slot: number }[] = []
  rooms.forEach((_, r) => {
    const n = Math.min(layout.rooms[r].slots.length, SQUAD_DESKS_PER_ROOM)
    for (let s = 0; s < n; s++) if (!taken[r].has(s)) free.push({ room: r, slot: s })
  })
  const agentDesks: DeskSlot[] = stableOrder(free, 'agentes', (f) => `${f.room}:${f.slot}`)
    .slice(0, AGENT_DESK_COUNT)
    .map((f, i) => deskSlot(i, layout.rooms[f.room].slots[f.slot].desk, layout.rooms[f.room].slots[f.slot].seat))
  // the aisles by the elevator: the first eight for the orchestrators without a room, the next eight for the agents without a desk
  const aisle = aisleTiles(grid, layout.elevator.tile, [...layout.rooms.flatMap((r) => r.rects), layout.office.rect], 16)
  return {
    size: layout.size,
    elevator: { tile: layout.elevator.tile, point: { x: layout.elevator.point[0], z: layout.elevator.point[1] } },
    overflow: aisle.slice(0, 8),
    rooms,
    agentDesks,
    agentStand: aisle.slice(8, 16),
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
