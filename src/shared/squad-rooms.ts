import { SQUAD_ROOM_COUNT } from './types/squad-proposals'
import type { SquadInfo } from './types'

// The squads of a floor and the rooms they take. The rule is the same everywhere: the
// squads the office created name their room in the code ("sala-2" is the second room);
// the others take the free rooms, in order. A room with a proposal waiting is not free.

/** The code the office gives to a squad created for a room: "sala-2" is the second room. */
export function roomCode(room: number): string {
  return `sala-${room + 1}`
}

const ROMAN: [number, string][] = [
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
]

/** The numeral a room is called on screen: room 0 is "I" (the code keeps the number: "sala-1"). */
export function roomNumeral(room: number): string {
  let n = room + 1
  let out = ''
  for (const [value, glyph] of ROMAN) {
    while (n >= value) {
      out += glyph
      n -= value
    }
  }
  return out
}

/** The name of a room on screen: "Sala I" to "Sala IV". */
export function roomTitle(room: number): string {
  return `Sala ${roomNumeral(room)}`
}

/** The room a code names, when it is one of ours (the office creates them). */
export function roomOfCode(code: string, count: number = SQUAD_ROOM_COUNT): number | undefined {
  const match = /^sala-(\d+)(?:-\d+)?$/.exec(code)
  if (!match) return undefined
  const room = Number(match[1]) - 1
  return room >= 0 && room < count ? room : undefined
}

/** The squads of a floor, in the order they are read. */
export function floorSquads(squads: readonly SquadInfo[], cwd: string): SquadInfo[] {
  return squads.filter((q) => q.cwd === cwd)
}

/** The rooms of a floor: the room of each squad and the ones that did not get one. */
export interface FloorRooms {
  /** Room of each squad code; a squad without a room is not in the map. */
  rooms: Map<string, number>
  /** The squads that did not get a room. */
  without: RoomSquad[]
}

/** What the room rule needs to know about a squad: its code. */
export interface RoomSquad {
  code: string
}

/**
 * The room of every squad of a floor, and the squads that stayed out. `squads` are the
 * squads of one floor; `proposedRooms` are the rooms a proposal is holding. `count` is how
 * many rooms the floor really has: the art may have fewer than SQUAD_ROOM_COUNT (AO-106).
 */
export function floorRooms(squads: readonly RoomSquad[], proposedRooms: readonly number[] = [], count: number = SQUAD_ROOM_COUNT): FloorRooms {
  const reserved = new Set(proposedRooms)
  const byRoom = new Map<number, RoomSquad>()
  const rest: RoomSquad[] = []
  for (const squad of squads) {
    const named = roomOfCode(squad.code, count)
    if (named !== undefined && !reserved.has(named) && !byRoom.has(named)) byRoom.set(named, squad)
    else rest.push(squad)
  }
  for (const squad of rest) {
    const room = Array.from({ length: count }, (_, i) => i).find((r) => !reserved.has(r) && !byRoom.has(r))
    if (room === undefined) continue
    byRoom.set(room, squad)
  }
  const rooms = new Map<string, number>()
  for (const [room, squad] of byRoom) rooms.set(squad.code, room)
  return { rooms, without: squads.filter((s) => !rooms.has(s.code)) }
}

/** The squad of a room; undefined when the room is empty. */
export function squadInRoom(squads: readonly SquadInfo[], room: number, proposedRooms: readonly number[] = []): SquadInfo | undefined {
  const { rooms } = floorRooms(squads, proposedRooms)
  for (const [code, index] of rooms) if (index === room) return squads.find((q) => q.code === code)
  return undefined
}
