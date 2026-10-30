import * as THREE from 'three'
import type { ProjectPlan } from '../world/layout'
import type { DeskScreen } from '../world/office'
import type { CostBoard, Beacon } from '../world/props'
import type { ScreenMode } from '../world/screens'
import type { UpperFloor } from '../world/upper-floor'
import { PROJECT_LAYOUT } from './atlas'
import { grid2d, slotOfDesk, type CrtState, type ProjectLayout } from './layout'

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
export class Crt implements DeskScreen {
  mode: ScreenMode = 'off'
  setMode(mode: ScreenMode): void {
    this.mode = mode
  }
  update(): void {}
}

/** What the 2D renderer needs about a project floor, besides the people on it. */
export interface FlatFloor {
  layout: ProjectLayout
  plan: ProjectPlan
  /** Desk screen index -> the room and slot it is drawn at. */
  slots: Map<number, { room: number; slot: number }>
  crts: Crt[]
}

/**
 * A project floor of the 2D world, shaped like the 3D UpperFloor so the game logic
 * (seats, walking, boards) runs unchanged: the grid comes from the pixel-art layout,
 * the screens are plain modes, and the THREE group only holds the anchors of the
 * HTML tags (nothing in it is drawn).
 */
export function buildFloor2d(plan: ProjectPlan, layout: ProjectLayout = PROJECT_LAYOUT): UpperFloor & { flat: FlatFloor } {
  const group = new THREE.Group()
  const anchor = (x: number, y: number, z: number) => {
    const o = new THREE.Object3D()
    o.position.set(x, y, z)
    group.add(o)
    return o
  }
  const crts: Crt[] = []
  for (const d of [...plan.agentDesks, ...plan.rooms.flatMap((r) => r.desks)]) crts[d.index] = new Crt()
  // the spending total and the limit alarm keep their HTML tags; the 2D art has no board
  const money: CostBoard = { group: new THREE.Group(), anchor: anchor(20.5, 3.1, 0.2), set() {}, update() {} }
  const alarm: Beacon & { on: boolean } = {
    group: new THREE.Group(),
    anchor: anchor(15.5, 3.4, 0.2),
    on: false,
    setOn(on: boolean) {
      this.on = on
    },
    update() {},
  }
  return {
    group,
    grid: grid2d(layout),
    floor: new THREE.Mesh(),
    deskScreens: crts,
    plan,
    money,
    alarm,
    reducedMotion: false,
    update() {},
    ding() {},
    setFloors() {},
    flat: { layout, plan, slots: slotOfDesk(plan, layout), crts },
  }
}
