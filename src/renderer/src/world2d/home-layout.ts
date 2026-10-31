// The spots of the ground floor (the Casa) the game walks people to: casaPlan (casa.ts) fills them.
import type { HangSpot } from './plan'

export type HomeAction = 'agenda' | 'goals' | 'books' | 'films' | 'games' | 'writing' | 'personal-routines' | 'radio'

/** A seat (tiles) and the way its sitter looks (radians, 0 = towards +z). */
export interface HomeChair {
  x: number
  z: number
  face: number
}

/**
 * The spots of the ground floor the game walks people to (world2d/casa.ts casaPlan).
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
  /** Where an agent with no desk waits. */
  overflow: [number, number][]
}
