import type { ProjectPlan } from './plan'
import type { Grid } from './pathfinding'
import { PROJECT_LAYOUT } from './atlas'
import type { CasaFlat, CasaLayout } from './casa'
import type { EstudosFlat, EstudosLayout } from './estudos'
import { grid2d, slotOfDesk, type CrtState, type ProjectLayout } from './layout'

/** What an agent's desk monitor shows. */
export type ScreenMode = 'off' | 'boot' | 'working' | 'waiting' | 'done' | 'error' | 'idle'

/** The monitor colour of a desk in the 2D art for what its agent is doing. */
export function crtOf(mode: ScreenMode | null | undefined): CrtState {
  switch (mode) {
    case 'working':
    case 'boot':
    case 'done':
      return 'green'
    case 'waiting':
      return 'amber'
    case 'error':
      return 'red'
    default:
      return 'off'
  }
}

/** A desk monitor of a 2D floor: only its mode; the renderer reads it. */
export class Crt {
  mode: ScreenMode = 'off'
  setMode(mode: ScreenMode): void {
    this.mode = mode
  }
}

/** What the 2D renderer needs about a project floor, besides the people on it. */
export interface FlatFloor {
  kind: 'project'
  layout: ProjectLayout
  plan: ProjectPlan
  /** Desk screen index -> the room and slot it is drawn at. */
  slots: Map<number, { room: number; slot: number }>
  crts: Crt[]
}

/** A floor the game walks on: its grid, its desk monitors and what the renderer draws. */
export interface Floor2d<F = FlatFloor | CasaFlat | EstudosFlat> {
  grid: Grid
  deskScreens: Crt[]
  flat: F
}

/** A project floor: the grid comes from the pixel-art layout, the plan says who sits where. */
export interface ProjectFloor2d extends Floor2d<FlatFloor> {
  plan: ProjectPlan
}

export function buildFloor2d(plan: ProjectPlan, layout: ProjectLayout = PROJECT_LAYOUT): ProjectFloor2d {
  const crts: Crt[] = []
  for (const d of [...plan.agentDesks, ...plan.rooms.flatMap((r) => r.desks)]) crts[d.index] = new Crt()
  return { grid: grid2d(layout), deskScreens: crts, plan, flat: { kind: 'project', layout, plan, slots: slotOfDesk(plan, layout), crts } }
}

/** The Casa (ground floor). */
export function buildCasa2d(layout: CasaLayout): Floor2d<CasaFlat> {
  return { grid: grid2d(layout), deskScreens: [], flat: { kind: 'casa', layout } }
}

/** The study floor: no desks of agents. */
export function buildEstudos2d(layout: EstudosLayout): Floor2d<EstudosFlat> {
  return { grid: grid2d(layout), deskScreens: [], flat: { kind: 'estudos', layout } }
}
