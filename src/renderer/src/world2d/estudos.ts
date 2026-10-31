// The study floor of the 2D world, as scripts/pixel-art/export_app.py describes it
// (assets/pixel/estudos.json), the people who work there and the spots the game walks
// them to. Pure (no DOM), so the tests check it. Layout numbers are art units (16 per
// tile) unless named in tiles. buildEstudos2d (world2d/floor.ts) makes the floor.

import { activeStudyCycle, evaluateStudyGate, type StudyCycleStage, type StudyCycleState } from '@shared/study-cycle'
import type { HomeChair } from './home-layout'
import type { Partition } from './plan'
import type { Grid } from './pathfinding'
import type { Footprint } from './depth'
import { headingOf, TILE } from './iso'
import { grid2d, type ElevatorDoors, type Placement, type SeatArt } from './layout'

type Rect = [number, number, number, number]

/**
 * What a click on something of the study floor does: Cora's shelves (the library), the
 * blackboard (the current topic: the study cycle), the user's desk (sit and study), the
 * question bank, notes and cards, the class schedule, the study trail board in Bonnie's
 * office, Cora and Bonnie at their desks.
 */
export type StudyAct = 'library' | 'cycle' | 'desk' | 'questions' | 'cards' | 'schedule' | 'trail' | 'cora' | 'bonnie'

export interface EstudosLayout {
  tile: number
  /** Tiles. */
  size: [number, number]
  canvas: [number, number]
  origin: [number, number]
  base: string
  /** Furniture and glass walls; the clickable pieces carry their action. */
  static: (Placement & { act?: StudyAct })[]
  walls: Partition[]
  blocked: [number, number][]
  /** Clickable things drawn in the base image (the class schedule, the trail board): their box on the native canvas. */
  hot: { act: StudyAct; box: Rect }[]
  /** Where the HTML tags float, by name: art units x, y and height. */
  tags: Record<string, [number, number, number]>
  cora: SeatArt
  bonnie: SeatArt
  /** The two chairs in front of Bonnie's desk. */
  visitors: SeatArt[]
  /** The teachers' chairs in the sala dos professores, in the order of TEACHERS. */
  teachers: SeatArt[]
  /** The user's chair and desk in the classroom. */
  student: { seat: SeatArt; desk: Footprint }
  /** The chair of the notes desk (estudo individual). */
  notes: SeatArt
  /** Where the teacher of the turn stands in front of the class, and the point it looks at. */
  class: { at: [number, number]; look: [number, number] }
  /** Names shown when the pointer is over a part of the floor (tiles); the first one listed wins. */
  zones: { name: string; rect: Rect }[]
  elevator: {
    tile: [number, number]
    point: [number, number]
    door: [number, number, number]
    /** The doors half open and open, drawn over the base while someone arrives or leaves. */
    open: [ElevatorDoors, ElevatorDoors]
  }
}

/** A teacher of the study floor: who it is, its sprite and what it does in the cycle. */
export interface Teacher {
  id: 'curador' | 'tutor' | 'verificador' | 'cartoes' | 'fontes'
  name: string
  /** Variant of the sprite sheet (the approved art's). */
  variant: number
  role: string
}

/** The teachers, in the order of their chairs in the approved art. */
export const TEACHERS: readonly Teacher[] = [
  { id: 'curador', name: 'Curador', variant: 0, role: 'fontes e prática' },
  { id: 'tutor', name: 'Tutor', variant: 2, role: 'diagnóstico' },
  { id: 'verificador', name: 'Verificador', variant: 4, role: 'reteste' },
  { id: 'cartoes', name: 'Assistente de cartões', variant: 1, role: 'cartões' },
  { id: 'fontes', name: 'Verificador de fontes', variant: 7, role: 'fontes dos cartões' },
]

/** Sprite variants of Cora and Bonnie (scripts/pixel-art/scene_estudos.py). */
export const CORA_VARIANT = 5
export const BONNIE_VARIANT = 3

/**
 * The teacher who gives the class in a stage of the study cycle: the Tutor checks the
 * diagnosis, the Curador the practice, the Verificador the retest. Nobody between cycles.
 */
export function teacherOfStage(stage: StudyCycleStage | null | undefined): Teacher['id'] | null {
  switch (stage) {
    case 'diagnosis':
    case 'review-required':
      return 'tutor'
    case 'practice':
      return 'curador'
    case 'retest-ready':
    case 'retest':
      return 'verificador'
    default:
      return null
  }
}

/** What the study floor shows of the cycle: its stage, its topic and whether Bonnie can let it move on. */
export interface StudyCycleView {
  stage: StudyCycleStage
  topic: string
  /** The objective criteria of the stage passed: Bonnie waits for the user to ask her to advance. */
  ready: boolean
}

/** The study floor's part of a study cycle state: null between cycles. */
export function studyCycleView(state: StudyCycleState): StudyCycleView | null {
  const cycle = activeStudyCycle(state)
  if (!cycle) return null
  return { stage: cycle.stage, topic: cycle.topic, ready: cycle.stage === 'diagnosis' && evaluateStudyGate(cycle).ready }
}

/** The spots of the study floor, in tiles: chairs, the class spot, the elevator. */
export interface StudyPlan {
  size: [number, number]
  elevator: { tile: [number, number]; point: { x: number; z: number } }
  cora: HomeChair
  bonnie: HomeChair
  /** One chair per teacher, in the order of TEACHERS. */
  teachers: HomeChair[]
  student: HomeChair
  notes: HomeChair
  visitors: HomeChair[]
  /** Where the teacher of the turn stands (and the tile it walks to), looking at the user's desk. */
  classSpot: { x: number; z: number; tile: [number, number]; face: number }
}

const chairOf = (s: SeatArt): HomeChair => ({ x: s.at[0] / TILE, z: s.at[1] / TILE, face: headingOf(s.dir) })
const inRect = (r: Rect, x: number, z: number) => x >= r[0] && x < r[2] && z >= r[1] && z < r[3]

/** The zone of a tile, by name; the first one listed wins. */
export function studyZoneAt(layout: EstudosLayout, x: number, z: number): string | null {
  return layout.zones.find((zone) => inRect(zone.rect, x, z))?.name ?? null
}

/** The spots of the 2D study floor. */
export function studyPlan(layout: EstudosLayout, grid: Grid = grid2d(layout)): StudyPlan {
  if (layout.teachers.length !== TEACHERS.length) throw new Error('estudos.json sem uma cadeira por professor')
  const [cx, cz] = [layout.class.at[0] / TILE, layout.class.at[1] / TILE]
  const tile: [number, number] = [Math.floor(cx), Math.floor(cz)]
  const [lx, lz] = [layout.class.look[0] / TILE, layout.class.look[1] / TILE]
  const [ex, ez] = layout.elevator.point
  return {
    size: layout.size,
    elevator: { tile: layout.elevator.tile, point: { x: ex, z: ez } },
    cora: chairOf(layout.cora),
    bonnie: chairOf(layout.bonnie),
    teachers: layout.teachers.map(chairOf),
    student: chairOf(layout.student.seat),
    notes: chairOf(layout.notes),
    visitors: layout.visitors.map(chairOf),
    classSpot: {
      x: cx,
      z: cz,
      tile: grid.walkable(tile[0], tile[1]) ? tile : (grid.nearestWalkable(tile[0], tile[1]) ?? tile),
      face: Math.atan2(lx - cx, lz - cz),
    },
  }
}

/** What the 2D renderer needs about the study floor. */
export interface EstudosFlat {
  kind: 'estudos'
  layout: EstudosLayout
}
