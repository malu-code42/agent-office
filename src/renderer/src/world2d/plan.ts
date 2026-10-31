// The plan the game walks by on any floor: desks, squad rooms, seats and walls, in tiles.
// Pure types and rules; each 2D floor fills them from its pixel-art layout (layout.ts,
// casa.ts, estudos.ts).

type Rect = [number, number, number, number]

export const DEFAULT_SECTOR = 'Equipe'
/** Desks of the glass room with the individual agents: two columns of five. */
export const AGENT_DESK_COUNT = 10

/** Squad members share one floor: `squad/member` ids keep two squads with the same member id apart. */
export const memberKey = (squad: string, member: string) => `${squad}/${member}`

/** Glass partition along a tile edge. axis 'x' = line x = at, spanning z in [from, to). */
export interface Partition {
  axis: 'x' | 'z'
  at: number
  from: number
  to: number
  doors: number[] // tile indices along the span left open
  /** Whether the wall is a low garden fence instead of beadboard. */
  fence?: boolean
}

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

/** Where idle agents hang out: final position, the point they look at, and the tile they walk to first. */
export interface HangSpot {
  x: number
  z: number
  look: [number, number]
  approach: [number, number]
  /** sit on a sofa or bean bag, stand around with a coffee, or play a game */
  kind: 'sit' | 'stand' | 'play'
}

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

/** What a squad room shows: nobody, a team proposed and waiting, or the squad itself. */
export type SquadRoomState = 'empty' | 'proposed' | 'live'

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
  /** What the room shows now. */
  state: SquadRoomState
}

/** Something of the project that does not fit on the floor; the user has to know. */
export interface ProjectIssue {
  /** Squad code. */
  code: string
  name: string
  /** What does not fit, in pt-BR. */
  reason: string
}

/** A chair where an agent waiting in the meeting room sits (2D floors). */
export interface MeetingSeat {
  x: number
  z: number
  approach: [number, number]
  /** Which way the sitter looks (radians, 0 = towards +z). */
  face: number
}

export interface ProjectPlan {
  /** Floor size in tiles. */
  size: [number, number]
  /** The elevator: the tile its door opens on and where it drops people. */
  elevator: { tile: [number, number]; point: { x: number; z: number } }
  /** Where the results of the project wait: the room, its table and its chairs (none: they stand). */
  meeting: { rect: Rect; table: { x: number; z: number }; seats: MeetingSeat[] }
  /** Tiles where an orchestrator whose squad has no room waits. */
  overflow: [number, number][]
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

/** The name of the plate of a room: the squad's, or what the room is waiting for. */
export function roomLabel(room: SquadRoom): string {
  if (room.state === 'proposed') return 'Equipe proposta'
  return room.name
}
