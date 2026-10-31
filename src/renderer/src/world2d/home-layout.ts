import {
  BOSS_SEAT,
  behindBossDesk,
  DESKS,
  H,
  inBossRoom,
  LOUNGE_SEATS,
  SPAWN_POINT,
  SPAWN_TILE,
  UPPER_OVERFLOW,
  VISIT_SPOTS,
  W,
  type DeskSlot,
  type HangSpot,
  type Partition,
} from './layout'

export type HomeRoomId = 'office' | 'entry' | 'kitchen' | 'garden' | 'reading' | 'corridor' | 'living' | 'bedroom' | 'games' | 'atelier'

export interface HomeRoom {
  id: HomeRoomId
  label: string
  rect: [number, number, number, number]
  floor: 'walnut' | 'oak' | 'terracotta' | 'grass' | 'herringbone' | 'petrol' | 'pine' | 'ash'
}

/** Approved ground-floor plan. Rectangles use exclusive x1/z1 bounds. */
export const HOME_ROOMS: HomeRoom[] = [
  { id: 'office', label: 'Escritório', rect: [0, 0, 10, 10], floor: 'walnut' },
  { id: 'entry', label: 'Entrada', rect: [10, 0, 17, 10], floor: 'oak' },
  { id: 'kitchen', label: 'Cozinha', rect: [17, 0, 25, 10], floor: 'terracotta' },
  { id: 'garden', label: 'Jardim', rect: [25, 0, 32, 10], floor: 'grass' },
  { id: 'reading', label: 'Cantinho de leitura', rect: [0, 10, 8, 14], floor: 'oak' },
  { id: 'corridor', label: 'Corredor', rect: [8, 10, 23, 13], floor: 'oak' },
  { id: 'living', label: 'Sala de estar', rect: [8, 13, 23, 24], floor: 'herringbone' },
  { id: 'bedroom', label: 'Quarto · privado', rect: [0, 14, 8, 24], floor: 'ash' },
  { id: 'games', label: 'Jogos', rect: [23, 10, 32, 16], floor: 'petrol' },
  { id: 'atelier', label: 'Cantinho criativo', rect: [23, 16, 32, 24], floor: 'pine' },
]

/** Low partitions and doors from the approved plan; the bedroom has one entrance, from reading. */
export const HOME_PARTITIONS: Partition[] = [
  { axis: 'x', at: 10, from: 0, to: 10, doors: [4, 5] },
  { axis: 'x', at: 17, from: 0, to: 10, doors: [5, 6] },
  { axis: 'x', at: 25, from: 0, to: 10, doors: [4, 5] },
  { axis: 'z', at: 10, from: 0, to: 10, doors: [4, 5] },
  { axis: 'z', at: 10, from: 10, to: 17, doors: [12, 13, 14] },
  { axis: 'z', at: 10, from: 17, to: 25, doors: [19, 20] },
  { axis: 'z', at: 10, from: 25, to: 32, doors: [], fence: true },
  { axis: 'z', at: 14, from: 0, to: 8, doors: [2, 3] },
  { axis: 'z', at: 13, from: 8, to: 23, doors: [13, 14] },
  { axis: 'x', at: 8, from: 13, to: 14, doors: [] },
  { axis: 'x', at: 8, from: 14, to: 24, doors: [] },
  { axis: 'x', at: 23, from: 10, to: 24, doors: [20, 21] },
  { axis: 'z', at: 16, from: 23, to: 32, doors: [27, 28] },
]

export type HomeAction = 'agenda' | 'goals' | 'books' | 'films' | 'games' | 'writing' | 'personal-routines' | 'radio'

export interface HomeInteraction {
  id: HomeAction
  at: [number, number, number]
  approach: [number, number]
}

/** Clickable objects and their nearest reachable tiles; decorative objects have no action. */
export const HOME_INTERACTIONS: HomeInteraction[] = [
  { id: 'agenda', at: [0.08, 1.35, 8.5], approach: [1, 8] },
  { id: 'personal-routines', at: [0.08, 1.35, 6.975], approach: [1, 7] },
  { id: 'goals', at: [0.08, 1.35, 4.725], approach: [1, 5] },
  { id: 'radio', at: [7.6, 1.05, 0.35], approach: [7, 1] },
  { id: 'books', at: [0.45, 1.2, 12], approach: [1, 12] },
  { id: 'films', at: [8.7, 1.2, 18.5], approach: [9, 18] },
  { id: 'games', at: [29, 1.2, 10.55], approach: [29, 11] },
  { id: 'writing', at: [29.6, 1.25, 22.6], approach: [29, 21] },
]

export const HOME_SPAWN_TILE: [number, number] = [13, 1]
export const HOME_SPAWN_POINT = { x: 13.5, z: 0.45 }

/** Luna's round table in the personal office and its eight chairs, facing the table. */
export const HOME_TABLE_AT = { x: 5, z: 5.6 }
export const HOME_TABLE_SEATS = [157.5, 202.5, 247.5, 292.5, 337.5, 22.5, 67.5, 112.5].map((degrees) => {
  const angle = (degrees * Math.PI) / 180
  const x = HOME_TABLE_AT.x + Math.sin(angle) * 1.85
  const z = HOME_TABLE_AT.z + Math.cos(angle) * 1.85
  return { x, z, face: Math.atan2(HOME_TABLE_AT.x - x, HOME_TABLE_AT.z - z) }
})
/** The chair Luna always sits on. */
export const LUNA_SEAT = 1

export function isHomeRoomTile(x: number, z: number): boolean {
  return x >= 0 && z >= 0 && x < W && z < H && HOME_ROOMS.some(({ rect }) => x >= rect[0] && x < rect[2] && z >= rect[1] && z < rect[3])
}

/** A seat (tiles) and the way its sitter looks (radians, 0 = towards +z). */
export interface HomeChair {
  x: number
  z: number
  face: number
}

/**
 * The spots of the ground floor the game walks people to. The 3D Casa and the 2D one
 * (world2d/casa.ts) have different plans; the game asks the one on screen.
 */
export interface HomePlan {
  /** Tiles. */
  size: [number, number]
  elevator: { tile: [number, number]; point: { x: number; z: number } }
  /** The user's chair: where the player sits and visitors come to. */
  boss: HomeChair
  /** The player is in the user's corner: visitors come to the player instead of the chair. */
  inBossRoom(x: number, z: number): boolean
  /** Tiles a visitor never stands on (behind the user's desk). */
  noVisit(x: number, z: number): boolean
  /** Where visitors stand while the user sits, best first. */
  visit: [number, number][]
  /** Luna's table, her chair and the chairs the residents take, in order. */
  table: { x: number; z: number }
  luna: HomeChair
  chairs: HomeChair[]
  /** Where the residents past the chairs stand: tiles x0, z0, x1, z1 (exclusive). */
  around: [number, number, number, number]
  /** Tiles the standing residents keep clear (the clickable objects' approach). */
  keepClear: [number, number][]
  /** Where idle agents of the ground floor hang out. */
  hang: HangSpot[]
  /** Desks of the ground floor agents (none in the 2D Casa: they stand by the elevator). */
  desks: DeskSlot[]
  /** Where an agent with no desk waits. */
  overflow: [number, number][]
}

/** The plan of the 3D Casa (world/home.ts). */
export const HOME_PLAN_3D: HomePlan = {
  size: [W, H],
  elevator: { tile: SPAWN_TILE, point: SPAWN_POINT },
  boss: { x: BOSS_SEAT.x, z: BOSS_SEAT.z, face: 0 },
  inBossRoom,
  noVisit: behindBossDesk,
  visit: VISIT_SPOTS,
  table: HOME_TABLE_AT,
  luna: HOME_TABLE_SEATS[LUNA_SEAT],
  chairs: HOME_TABLE_SEATS.filter((_, i) => i !== LUNA_SEAT),
  around: HOME_ROOMS.find((room) => room.id === 'office')!.rect,
  keepClear: HOME_INTERACTIONS.map(({ approach }) => approach),
  hang: LOUNGE_SEATS,
  desks: DESKS,
  // as before: the overflow of the project floors (the 3D Casa has no spot of its own)
  overflow: UPPER_OVERFLOW,
}
