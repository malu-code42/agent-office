// Office floor plan. One unit = one tile. x grows to the screen's lower right,
// z grows to the screen's lower left; back walls run along x = 0 and z = 0.

export const W = 32
export const H = 24
export const WALL_H = 2.7

export type FloorStyle = 'hall' | 'boss' | 'team' | 'lounge' | 'cafe'

export interface Zone {
  id: FloorStyle
  label: string
  rect: [number, number, number, number] // x0, z0, x1, z1 (exclusive)
}

export const ZONES: Zone[] = [
  { id: 'boss', label: 'Sua sala', rect: [0, 0, 9, 9] },
  { id: 'team', label: 'Time de agentes', rect: [11, 0, 32, 12] },
  { id: 'lounge', label: 'Lounge', rect: [11, 15, 32, 24] },
  { id: 'cafe', label: 'Copa', rect: [0, 11, 9, 24] },
]

/** Glass partition along a tile edge. axis 'x' = line x = at, spanning z in [from, to). */
export interface Partition {
  axis: 'x' | 'z'
  at: number
  from: number
  to: number
  doors: number[] // tile indices along the span left open
}

export const PARTITIONS: Partition[] = [
  { axis: 'x', at: 9, from: 0, to: 9, doors: [5, 6] },
  { axis: 'z', at: 9, from: 0, to: 9, doors: [] },
]

export interface DeskSlot {
  index: number
  /** Desk top-left tile; desks are 2 tiles wide along x, 1 deep. */
  x: number
  z: number
  /** Where the agent sits (world coords) and the tile it walks to first. */
  seat: { x: number; z: number }
  approach: [number, number]
  /** The desk is turned 90°: one tile wide, two deep; x/z are still its top-left tile. */
  turned?: boolean
  /** Where a turned desk stands (its middle). */
  center?: { x: number; z: number }
  /** Which way the agent at the desk looks (radians, 0 = towards +z). */
  face?: number
}

export const DESKS: DeskSlot[] = (() => {
  const out: DeskSlot[] = []
  let index = 0
  for (const z of [2, 7]) {
    for (let k = 0; k < 5; k++) {
      const x = 12 + k * 3
      out.push({ index: index++, x, z, seat: { x: x + 1, z: z + 1.45 }, approach: [x, z + 1] })
    }
  }
  return out
})()

/** Where the player's own chair is, behind the big desk. */
export const BOSS_SEAT = { x: 4.5, z: 2.5 }
export const BOSS_DESK = { x: 3, z: 3, w: 3 }
/** Spots in front of the boss desk where visiting agents stand, best first. */
export const VISIT_SPOTS: [number, number][] = [
  [4, 4],
  [3, 4],
  [5, 4],
  [2, 4],
  [6, 4],
  [4, 5],
  [3, 5],
  [5, 5],
  [2, 5],
  [6, 5],
  [4, 6],
  [3, 6],
  [5, 6],
]

/** Tiles behind the boss desk, reserved for the player. */
export function behindBossDesk(x: number, z: number): boolean {
  return z <= 2 && x >= 2 && x <= 6
}

export const ELEVATOR = { x: 30, z: 0 }
export const SPAWN_TILE: [number, number] = [30, 1]
/** Where the elevator of the ground floor drops people. */
export const SPAWN_POINT = { x: ELEVATOR.x, z: 0.45 }
export const PLAYER_START: [number, number] = [4, 5]

/** Where idle agents hang out: final position, the point they look at, and the tile they walk to first. */
export interface HangSpot {
  x: number
  z: number
  look: [number, number]
  approach: [number, number]
  /** sit on a sofa or bean bag, stand around with a coffee, or play a game */
  kind: 'sit' | 'stand' | 'play'
}

// Lounge furniture centers, shared with office.ts.
export const LOUNGE = {
  sofaA: { x: 14.5, z: 16.45 },
  tableA: { x: 14.5, z: 18.5 },
  armchairs: [
    { x: 12.45, z: 18.5 },
    { x: 16.55, z: 18.5 },
  ],
  foosball: { x: 21, z: 17.5 },
  circle: { x: 20.5, z: 21.5 },
  circleBags: [
    { x: 19.4, z: 21.5, color: '#a29bfe' },
    { x: 21.6, z: 21.5, color: '#ff7675' },
    { x: 20.5, z: 22.6, color: '#55efc4' },
  ],
  sofaC: { x: 26.5, z: 16.45 },
  tableC: { x: 26.5, z: 18.5 },
  bagsC: [
    { x: 24.5, z: 20.5, color: '#e17055' },
    { x: 28.5, z: 20.5, color: '#00b894' },
    { x: 26.5, z: 21.5, color: '#fdcb6e' },
  ],
  pingPong: { x: 30, z: 22.5 },
}

const sofaSeat = (x: number, z: number): HangSpot => ({ x, z, look: [x, z + 2], approach: [Math.floor(x), Math.floor(z) + 1], kind: 'sit' })
const around = (p: { x: number; z: number }, c: { x: number; z: number }, approach: [number, number]): HangSpot => ({
  x: p.x,
  z: p.z,
  look: [c.x, c.z],
  approach,
  kind: 'sit',
})

/** Ordered so even a few idle agents spread across the lounge. */
export const LOUNGE_SEATS: HangSpot[] = [
  sofaSeat(14.5, 16.45),
  { x: 21, z: 16.55, look: [21, 17.5], approach: [21, 16], kind: 'play' },
  { x: 21, z: 18.45, look: [21, 17.5], approach: [21, 18], kind: 'play' },
  sofaSeat(26.5, 16.45),
  { x: 30.5, z: 16.45, look: [30.5, 15.5], approach: [30, 16], kind: 'play' },
  { x: 28.3, z: 22.5, look: [30, 22.5], approach: [28, 22], kind: 'play' },
  { x: 31.7, z: 22.5, look: [30, 22.5], approach: [31, 22], kind: 'play' },
  // a coffee at the café counter
  { x: 1.5, z: 14.6, look: [0.5, 14.6], approach: [1, 14], kind: 'stand' },
  around(LOUNGE.armchairs[0], LOUNGE.tableA, [12, 19]),
  around(LOUNGE.circleBags[0], LOUNGE.circle, [19, 20]),
  sofaSeat(13.5, 16.45),
  sofaSeat(25.5, 16.45),
  { x: 31.5, z: 16.45, look: [31.5, 15.5], approach: [31, 16], kind: 'play' },
  around(LOUNGE.bagsC[0], LOUNGE.tableC, [24, 21]),
  around(LOUNGE.armchairs[1], LOUNGE.tableA, [16, 19]),
  around(LOUNGE.circleBags[1], LOUNGE.circle, [21, 20]),
  sofaSeat(15.5, 16.45),
  sofaSeat(27.5, 16.45),
  around(LOUNGE.bagsC[1], LOUNGE.tableC, [28, 21]),
  around(LOUNGE.circleBags[2], LOUNGE.circle, [20, 23]),
  around(LOUNGE.bagsC[2], LOUNGE.tableC, [26, 22]),
  { x: 18.5, z: 19.5, look: [17.5, 19.5], approach: [18, 19], kind: 'stand' },
  { x: 23.5, z: 19.5, look: [24.5, 19.5], approach: [23, 19], kind: 'stand' },
  { x: 4.5, z: 16.5, look: [4.5, 15.5], approach: [4, 16], kind: 'stand' },
  { x: 1.5, z: 16.6, look: [0.5, 16.6], approach: [1, 16], kind: 'stand' },
]

export function zoneAt(x: number, z: number): Zone | undefined {
  return ZONES.find((zn) => x >= zn.rect[0] && x < zn.rect[2] && z >= zn.rect[1] && z < zn.rect[3])
}

export function inBossRoom(x: number, z: number): boolean {
  return x >= 0 && x < 9 && z >= 0 && z < 9
}

// ---------- project floors (1º andar and up) ----------
// Three squad rooms along the west wall, the glass room with the individual agents on
// the east side, the director's room at the back of the hall and the hall between them
// (HANDOFF §3.4). The elevator sits in the middle of the back wall of the hall.

export const DEFAULT_SECTOR = 'Equipe'
export const TEAM_ROOM = 'Agentes'
/** Squad rooms per project floor: three, and never more (ticket 04). */
export const SQUAD_ROOM_COUNT = 3
/** Members of a squad besides its coordinator: the room holds from two to six. */
export const SQUAD_MIN_MEMBERS = 2
export const SQUAD_MAX_MEMBERS = 6
/** Desks of the glass room with the individual agents: two columns of five. */
export const AGENT_DESK_COUNT = 10

type Rect = [number, number, number, number]

/** The three squad rooms, west side, one above the other. */
export const SQUAD_ROOM_RECTS: Rect[] = [
  [0, 0, 10, 8],
  [0, 8, 10, 16],
  [0, 16, 10, 24],
]
/** The glass room with the individual agents, east side. */
export const AGENT_ROOM_RECT: Rect = [21, 0, 32, 24]
/** The director's room, at the back of the hall. */
export const DIRECTOR_RECT: Rect = [11, 16, 20, 24]
/** The elevator of a project floor: in the hall, in the middle of the back wall. */
export const UPPER_ELEVATOR = { x: 15.5, z: 0 }
export const UPPER_SPAWN_TILE: [number, number] = [15, 1]
export const UPPER_SPAWN_POINT = { x: 15.5, z: 0.45 }

/** The elevator of a floor: the tile its door opens on, and where it drops people. */
export function elevatorOf(floor: number): { tile: [number, number]; point: { x: number; z: number } } {
  return floor > 0 ? { tile: UPPER_SPAWN_TILE, point: UPPER_SPAWN_POINT } : { tile: SPAWN_TILE, point: SPAWN_POINT }
}

/**
 * A ride between two floors: the agent walks to the elevator of the floor it is on
 * and steps out of the elevator of the floor it is going to. The two ends belong to
 * different floors on purpose: the walk happens where the agent is, the arrival where
 * it ends up.
 */
export interface Ride {
  /** The tile of the elevator door, on the floor the agent leaves. */
  from: [number, number]
  /** The point of the elevator door, on the floor the agent leaves. */
  at: { x: number; z: number }
  /** Where the agent steps out, on the floor it arrives at. */
  to: { x: number; z: number }
}

/** The ride from one floor to another. */
export function rideBetween(from: number, to: number): Ride {
  const here = elevatorOf(from)
  return { from: here.tile, at: here.point, to: elevatorOf(to).point }
}

/** Squad members share one floor: `squad/member` ids keep two squads with the same member id apart. */
export const memberKey = (squad: string, member: string) => `${squad}/${member}`

/** The coordinator's desk of a squad room: fixed furniture, looking at the members. */
export interface CoordinatorDesk {
  /** Where the desk stands. */
  at: { x: number; z: number }
  /** Which way the desk looks (radians, 0 = towards +z). */
  rot: number
  /** Where the coordinator sits. */
  seat: { x: number; z: number }
  approach: [number, number]
  /** Where an inline member sits during its step, beside the coordinator. */
  side: { x: number; z: number }
  sideApproach: [number, number]
  /** Tiles in front of the desk, where the members hand over their delivery: six, one per member of a full room. */
  deliver: [number, number][]
}

/** One of the three squad rooms of a project floor. */
export interface SquadRoom {
  /** 0, 1 or 2: the room's place among the three. */
  index: number
  rect: Rect
  /** Squad code of the room; null while the room is empty. */
  squad: string | null
  /** Name on the room's plate. */
  name: string
  /** Fixed furniture: the coordinator's desk, there even in an empty room. */
  coordinator: CoordinatorDesk
  /** A desk per member of the squad; empty while the room has no squad. */
  desks: DeskSlot[]
  /** Tiles where the members stand when the room has no desk for them. */
  stand: [number, number][]
  /** The squad's members, in the order their desks are made. */
  members: string[]
}

/** Something of the project that does not fit on the floor; the user has to know. */
export interface ProjectIssue {
  /** Squad code. */
  code: string
  name: string
  /** What does not fit, in pt-BR. */
  reason: string
}

export interface ProjectPlan {
  /** The three squad rooms, west side. */
  rooms: SquadRoom[]
  /** The ten desks of the glass room with the individual agents. */
  agentDesks: DeskSlot[]
  /** Tiles of the agents' room where the agents beyond the ten desks stand. */
  agentStand: [number, number][]
  /** The director's desk, in the director's room. */
  director: DeskSlot
  partitions: Partition[]
  /** Member key -> squad code, for every member of every squad of the floor. */
  squadOf: Map<string, string>
  /** Squads and compositions that do not fit: the user has to know about them. */
  issues: ProjectIssue[]
}

/** Columns of the member desks, nearest the coordinator first (HANDOFF §3.4). */
const MEMBER_COLUMNS = [5.5, 3.5, 1.5]
/** Rows of the member desks: the top row and the bottom row of the room. */
const MEMBER_ROWS = [2, 6]
/** Columns of the agents' desks in the glass room: west and east. */
const AGENT_COLUMNS = [24.5, 29.5]
/** Rows of the agents' desks in the glass room, from the back wall. */
const AGENT_ROWS = [2.5, 7.5, 12.5, 17.5, 22.5]

/** A member's desk: turned 90°, the agent sits on its west side facing the coordinator. */
function memberDesk(slot: number, number: number, rect: Rect): DeskSlot {
  const cx = MEMBER_COLUMNS[Math.floor(slot / 2)]
  const cz = rect[1] + MEMBER_ROWS[slot % 2]
  return {
    index: number,
    x: Math.floor(cx),
    z: Math.floor(cz - 1),
    turned: true,
    center: { x: cx, z: cz },
    seat: { x: cx - 0.9, z: cz },
    approach: [Math.floor(cx) - 1, Math.floor(cz)],
    face: Math.PI / 2,
  }
}

/** A desk of the glass room: turned 90°, the agent sits on its west side. */
function agentDesk(index: number): DeskSlot {
  const cx = AGENT_COLUMNS[Math.floor(index / 5)]
  const cz = AGENT_ROWS[index % 5]
  return {
    index,
    x: Math.floor(cx),
    z: Math.floor(cz - 1),
    turned: true,
    center: { x: cx, z: cz },
    seat: { x: cx - 0.9, z: cz },
    approach: [Math.floor(cx) - 1, Math.floor(cz)],
    face: Math.PI / 2,
  }
}

/**
 * The tiles in front of the coordinator's desk where the members hand their
 * delivery over: six of them, one for each member of a full room (HANDOFF §3.4).
 * They stand in two columns beside the desk, in rows that no member desk uses.
 */
function deliverSpots(rect: Rect): [number, number][] {
  const [, z0, x1] = rect
  return [
    [x1 - 3, z0 + 6],
    [x1 - 4, z0 + 6],
    [x1 - 3, z0 + 7],
    [x1 - 4, z0 + 7],
    [x1 - 3, z0 + 5],
    [x1 - 4, z0 + 5],
  ]
}

/** The coordinator's desk of a room: in the bottom-right corner, back to the door wall. */
function coordinatorDesk(rect: Rect): CoordinatorDesk {
  const [, z0, x1] = rect
  const x = x1 - 1.7
  const z = z0 + 6.3
  return {
    at: { x, z },
    rot: -Math.PI / 2,
    seat: { x: x + 1, z },
    approach: [x1 - 1, Math.floor(z)],
    side: { x: x + 1, z: z + 1 },
    sideApproach: [x1 - 1, Math.floor(z) + 1],
    deliver: deliverSpots(rect),
  }
}

/** An empty squad room: fixed furniture, no member desks, nobody inside. */
function emptyRoom(rect: Rect, index: number): SquadRoom {
  const z0 = rect[1]
  return {
    index,
    rect,
    squad: null,
    name: `Sala ${index + 1}`,
    coordinator: coordinatorDesk(rect),
    desks: [],
    stand: [
      [7, z0 + 3],
      [7, z0 + 4],
      [6, z0 + 4],
      [6, z0 + 3],
      [8, z0 + 4],
    ],
    members: [],
  }
}

/** The walls of a project floor: the director's room, the agents' room and the squad rooms. */
function projectPartitions(): Partition[] {
  const parts: Partition[] = [
    // the director's room: one door, on the north wall, straight below the elevator
    { axis: 'x', at: DIRECTOR_RECT[0], from: DIRECTOR_RECT[1], to: DIRECTOR_RECT[3], doors: [] },
    { axis: 'z', at: DIRECTOR_RECT[1], from: DIRECTOR_RECT[0], to: DIRECTOR_RECT[2], doors: [14, 15, 16] },
    // the east wall: the room is glass on the other three sides, and the north door
    // is the only way in (HANDOFF §3.4).
    { axis: 'x', at: DIRECTOR_RECT[2], from: DIRECTOR_RECT[1], to: DIRECTOR_RECT[3], doors: [] },
    // the glass room with the individual agents: two doors on the hall side
    { axis: 'x', at: AGENT_ROOM_RECT[0], from: AGENT_ROOM_RECT[1], to: AGENT_ROOM_RECT[3], doors: [3, 4, 19, 20] },
  ]
  for (const rect of SQUAD_ROOM_RECTS) {
    const [x0, z0, x1, z1] = rect
    // the door to the hall, in the middle of the room's east wall
    parts.push({ axis: 'x', at: x1, from: z0, to: z1, doors: [z0 + 3, z0 + 4] })
    // the wall between two squad rooms
    if (z1 < H) parts.push({ axis: 'z', at: z1, from: x0, to: x1, doors: [] })
  }
  return parts
}

/**
 * Plan of a project floor: three squad rooms on the west side, the glass room with
 * the individual agents on the east side, the director's room and the hall.
 * A project with more squads than rooms keeps every squad: the ones without a room
 * come back as issues, they never disappear.
 */
export function projectPlan(
  squads: { code: string; name?: string; members: { id: string; execution: string; sector?: string }[] }[],
): ProjectPlan {
  const issues: ProjectIssue[] = []
  const rooms: SquadRoom[] = SQUAD_ROOM_RECTS.map((rect, index) => emptyRoom(rect, index))
  const squadOf = new Map<string, string>()
  // Every member of every squad is kept, even of the squads that get no room.
  for (const squad of squads) for (const m of squad.members) squadOf.set(memberKey(squad.code, m.id), squad.code)

  squads.slice(0, SQUAD_ROOM_COUNT).forEach((squad, i) => {
    const room = rooms[i]
    const members = squad.members.filter((m) => m.execution === 'subagent')
    room.squad = squad.code
    room.name = squad.name || squad.code
    if (members.length < SQUAD_MIN_MEMBERS || members.length > SQUAD_MAX_MEMBERS) {
      issues.push({
        code: squad.code,
        name: room.name,
        reason: `A sala comporta de ${SQUAD_MIN_MEMBERS} a ${SQUAD_MAX_MEMBERS} membros e ${room.name} tem ${members.length}.`,
      })
    }
    // The desks follow the order of the room: 1 top row by the coordinator, 2 bottom
    // row, then the middle column and the far column (HANDOFF §3.4).
    const seated = members.slice(0, SQUAD_MAX_MEMBERS)
    room.members = seated.map((m) => memberKey(squad.code, m.id))
    // The screens of the floor are indexed by desk: the agents' room first, then each room.
    room.desks = seated.map((_, k) => memberDesk(k, AGENT_DESK_COUNT + i * SQUAD_MAX_MEMBERS + k, room.rect))
  })

  for (const squad of squads.slice(SQUAD_ROOM_COUNT)) {
    issues.push({
      code: squad.code,
      name: squad.name || squad.code,
      reason: `O andar tem ${SQUAD_ROOM_COUNT} salas de squad e o projeto tem ${squads.length} squads: ${squad.name || squad.code} ficou sem sala.`,
    })
  }

  const agentDesks = Array.from({ length: AGENT_DESK_COUNT }, (_, i) => agentDesk(i))
  const agentStand: [number, number][] = []
  for (const z of [3, 9, 15, 21]) agentStand.push([26, z], [27, z])
  const director: DeskSlot = {
    index: 0,
    x: 14,
    z: 22,
    seat: { x: 15.5, z: 23.4 },
    approach: [15, 23],
    face: Math.PI,
  }
  return { rooms, agentDesks, agentStand, director, partitions: projectPartitions(), squadOf, issues }
}
