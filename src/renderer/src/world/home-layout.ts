import { H, W, type Partition } from './layout'

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

export function isHomeRoomTile(x: number, z: number): boolean {
  return x >= 0 && z >= 0 && x < W && z < H && HOME_ROOMS.some(({ rect }) => x >= rect[0] && x < rect[2] && z >= rect[1] && z < rect[3])
}
