import * as THREE from 'three'
import { directorSign } from '@shared/projects'
import { brandSign, type Brand } from './brand'
import * as F from './furniture'
import { beacon, costBoard } from './props'
import { workstation } from './workstation'
import { box, panel } from './kit'
import { mergeStatic } from './merge'
import { AGENT_ROOM_RECT, DIRECTOR_RECT, H, UPPER_ELEVATOR, W, type ProjectPlan, type SquadRoom } from './layout'
import { buildPartitions, buildShell, CALM_BEACON, type Office } from './office'
import { Grid } from './pathfinding'
import { arcadePainter, LoopScreen, Screen } from './screens'
import { rugTexture, WindowSky } from './textures'

/** A project floor. deskScreens holds the agents' room first, then the member desks of each squad room. */
export interface UpperFloor extends Office {
  plan: ProjectPlan
}

const RUGS: [string, string, string][] = [
  ['#e6eef7', '#7b9cc4', '#4a6fa5'],
  ['#f3e4c4', '#c98b5e', '#d97757'],
  ['#e3f1e6', '#6fae86', '#2f8f83'],
  ['#efe6f7', '#9b85c9', '#6c5ce7'],
  ['#f7ebe1', '#d39a6a', '#b5651d'],
  ['#e9eef0', '#8aa1ab', '#4f6d7a'],
]

type Placer = (o: THREE.Object3D, x: number, z: number, rot?: number, y?: number) => THREE.Object3D
type Blocker = (x: number, z: number, w?: number, h?: number) => void

/**
 * A project floor: the hall with the elevator, three squad rooms on the west wall,
 * the glass room with the individual agents on the east side and the director's room
 * at the back (HANDOFF §3.4).
 */
export function buildUpperFloor(plan: ProjectPlan, brand: Brand): UpperFloor {
  const group = new THREE.Group()
  const grid = new Grid(W, H)
  const loops: LoopScreen[] = []
  const skies: WindowSky[] = []
  const deskScreens: Screen[] = []
  const place: Placer = (obj, x, z, rot = 0, y = 0) => {
    obj.position.set(x, y, z)
    obj.rotation.y = rot
    group.add(obj)
    return obj
  }
  const block: Blocker = (x, z, w = 1, h = 1) => grid.blockRect(Math.floor(x), Math.floor(z), w, h)

  // planks in the hall, carpet in the rooms (under their rugs)
  const floor = buildShell(group, [
    { id: 'boss', label: '', rect: DIRECTOR_RECT },
    ...plan.rooms.map((r) => ({ id: 'team' as const, label: '', rect: r.rect })),
    { id: 'team' as const, label: '', rect: AGENT_ROOM_RECT },
  ])
  buildPartitions(group, grid, plan.partitions)

  // ---------- hall: the elevator, the rest and the games ----------
  const elev = F.elevator()
  place(elev.group, UPPER_ELEVATOR.x, 0.04)
  place(F.plant('tall'), 13.6, 0.6)
  place(F.plant('tall'), 17.4, 0.6)
  // west side: a rest corner (sofa, low table, two bean bags), then the foosball
  place(F.rug(3.2, 4, rugTexture(3.2, 4, '#f3e4c4', '#c98b5e', '#d97757')), 12.7, 7)
  place(F.sofa(3, '#d97757'), 11.6, 7, Math.PI / 2)
  block(11, 5, 1, 3)
  place(F.lowTable(0.4), 13.1, 7)
  block(13, 7)
  place(F.beanBag('#4a8fe0'), 13.1, 5.2, Math.atan2(12.7 - 13.1, 7 - 5.2))
  block(13, 5)
  place(F.beanBag('#2f8f83'), 13.1, 8.8, Math.atan2(12.7 - 13.1, 7 - 8.8))
  block(13, 8)
  place(F.foosball(), 12.4, 11.5, Math.PI / 2)
  block(12, 11, 1, 2)
  place(F.waterCooler(), 11.7, 14.5)
  block(11, 14)
  // east side: the ping-pong table and the arcades, then a second rest corner
  place(F.pingPong(), 18.8, 4.6)
  block(18, 4, 2, 1)
  for (const [x, seed] of [
    [18.4, 8],
    [19.4, 7],
  ] as const) {
    const scr = new LoopScreen(24, 20, arcadePainter, seed)
    loops.push(scr)
    place(F.arcade(scr.texture), x, 0.9)
    block(x, 0.9)
  }
  place(F.rug(3.2, 4, rugTexture(3.2, 4, '#e6eef7', '#7b9cc4', '#d97757')), 18.3, 11.5)
  place(F.sofa(3, '#3d4a6b'), 19.4, 11.5, -Math.PI / 2)
  block(19, 10, 1, 3)
  place(F.lowTable(0.4), 18, 11.5)
  block(18, 11)
  place(F.beanBag('#f4a259'), 18, 9.7, Math.atan2(18.3 - 18, 11.5 - 9.7))
  block(18, 9)
  place(F.beanBag('#6c5ce7'), 18, 13.3, Math.atan2(18.3 - 18, 11.5 - 13.3))
  block(18, 13)
  place(F.plant('tall'), 19.6, 14.6)
  block(19, 14)

  // ---------- the three squad rooms ----------
  plan.rooms.forEach((room, i) => squadRoom(group, room, i, deskScreens, loops, place, block))

  // ---------- the glass room with the individual agents ----------
  place(F.rug(2, 22, rugTexture(2, 22, '#7f88b3', '#5d6591', '#d97757')), 27, 12)
  for (const d of plan.agentDesks) {
    const screen = new Screen()
    deskScreens[d.index] = screen
    const ws = workstation(d.index + 2, screen.texture, screen.led)
    loops.push(...ws.loops)
    place(ws.group, d.center!.x, d.center!.z, -Math.PI / 2)
    block(d.x, d.z, 1, 2)
  }
  for (const x of [24, 29]) {
    const sky = new WindowSky(x)
    skies.push(sky)
    place(F.wallWindow(2.2, 1.3, sky), x + 0.5, 0.02, 0, 1.6)
  }
  place(sign('Agentes individuais', 3, '#5f5a8c'), 26.8, 0.04, 0, 2.55)
  place(F.plant('tall'), 31.3, 0.7)
  block(31, 0)
  place(F.plant('bush'), 21.7, 0.7)
  block(21, 0)
  place(F.plant('tall'), 31.3, 23.2)
  block(31, 23)
  place(F.plant('bush'), 21.7, 23.2)
  block(21, 23)
  place(F.waterCooler(), 30.4, 0.5)
  block(30, 0)

  // ---------- the director's room ----------
  const dcx = (DIRECTOR_RECT[0] + DIRECTOR_RECT[2]) / 2
  place(F.rug(6, 5, rugTexture(6, 5, '#2d3a5c', '#1d2742', brand.color)), dcx, 20.8)
  // the desk against the south wall, with the director's chair behind it, facing the door
  place(directorRig(3), dcx, 22.4, Math.PI)
  block(14, 22, 3, 2)
  place(F.meetingTable(3.6, 1.5), 15.5, 19.1)
  block(14, 18, 4, 2)
  place(F.bookshelf(2, 1.9, 5), 12.8, 16.3)
  block(12, 16, 2, 1)
  place(F.clock(), 18.2, 16.04, 0, 2.25)
  place(F.cabinet(1.4), 18.2, 16.5)
  block(17, 16, 2, 1)
  place(F.plant('tall', '#e9edf2'), 11.8, 23)
  block(11, 23)
  place(F.plant('flower', '#f5f3ee'), 19.2, 23)
  block(19, 23)
  place(F.floorLamp(), 19.2, 18.2)
  block(19, 18)
  // The plate of the room, on the wall of the door: "Diretoria · <project>"
  // (HANDOFF §3.4). One plate only: the room has no other sign, and the company
  // logo rides on this same plate instead of hanging beside it.
  place(brandSign(brand, 2.8, directorSign(brand.name)), 12.8, 16.04, 0, 2.05)
  // No hiring screen here: the squad is proposed from an empty squad room, the
  // only entry the design approves (HANDOFF §3.4.2).

  // the spending board on the west wall of the director's room, the alarm above it
  const money = costBoard(brand.name, 2.2)
  place(money.group, 11.06, 18, Math.PI / 2, 1.0)
  const alarm = beacon()
  place(alarm.group, 11.04, 20, Math.PI / 2, 1.85)

  // every box that never moves becomes one mesh per material (AO-30)
  mergeStatic(group)

  let doorOpen = 0
  let doorTimer = 0
  const [doorL, doorR] = elev.doors
  return {
    group,
    grid,
    floor,
    deskScreens,
    plan,
    money,
    alarm,
    reducedMotion: false,
    update(dt: number) {
      money.update(dt)
      alarm.update(this.reducedMotion ? dt * CALM_BEACON : dt)
      for (const s of deskScreens) s?.update(dt)
      for (const l of loops) l.update(dt)
      for (const s of skies) s.update()
      doorTimer = Math.max(0, doorTimer - dt)
      doorOpen += ((doorTimer > 0 ? 1 : 0) - doorOpen) * Math.min(1, dt * 5)
      const w = 0.72 * (1 - doorOpen * 0.9)
      doorL.scale.x = doorR.scale.x = w
      doorL.position.x = -0.72 + w / 2
      doorR.position.x = 0.72 - w / 2
    },
    ding() {
      doorTimer = 2.2
    },
    setFloors(n: number) {
      elev.buttons.forEach((b, i) => (b.visible = i < n))
    },
  }
}

/**
 * A squad room: the fixed furniture (coordinator's desk, whiteboard, bookshelf, plate)
 * is always there; the member desks only exist when a squad is assigned to the room.
 * An empty room keeps the furniture, but with the lights off and nobody inside. A room
 * with a proposal waiting keeps the furniture and shows an amber outline on the floor.
 */
function squadRoom(
  group: THREE.Group,
  room: SquadRoom,
  rug: number,
  deskScreens: Screen[],
  loops: LoopScreen[],
  place: Placer,
  block: Blocker,
): void {
  const [x0, z0, x1, z1] = room.rect
  const cx = (x0 + x1) / 2
  const cz = (z0 + z1) / 2
  const lit = room.state === 'live'
  const [base, border, accent] = RUGS[rug % RUGS.length]
  place(F.rug(x1 - x0 - 1, z1 - z0 - 1, rugTexture(x1 - x0 - 1, z1 - z0 - 1, base, border, accent)), cx, cz)
  // the coordinator's desk: fixed furniture, in the corner by the door, facing the members
  const c = room.coordinator
  place(coordinatorRig(), c.at.x, c.at.z, c.rot)
  block(c.at.x - 0.3, c.at.z - 1.2, 1, 3)
  place(sign('Coordenação', 1.6, '#5f5a8c'), c.at.x - 0.95, c.at.z, c.rot, 0.05)
  // one desk per member of the squad, in the order of the room
  for (const d of room.desks) {
    const screen = new Screen()
    deskScreens[d.index] = screen
    const ws = workstation(d.index + 2, screen.texture, screen.led)
    loops.push(...ws.loops)
    place(ws.group, d.center!.x, d.center!.z, -Math.PI / 2)
    block(d.x, d.z, 1, 2)
  }
  // the wall opposite the door: the whiteboard and a bookshelf
  place(F.whiteboard(2.2, 1.2), 0.06, z0 + 2.4, Math.PI / 2, 2.0)
  place(F.bookshelf(2, 1.9, 4), 0.3, z0 + 5.4, Math.PI / 2)
  block(0, z0 + 5, 1, 2)
  // the plate of the room, on its back wall
  place(sign(lit ? room.name : room.state === 'proposed' ? 'Equipe proposta' : 'Sala sem squad', 2.2), 3.4, z0 + 0.04, 0, 2.4)
  place(F.plant('fern'), x1 - 0.7, z0 + 0.7)
  block(x1 - 1, z0, 1, 1)
  // a room without a squad is dark and empty; a room with a proposal shows the outline
  if (room.state === 'proposed') proposalOutline(group, room.rect)
  else if (!lit) lightsOff(group, room.rect)
}

/** A team waiting for the approval: only an amber outline on the floor. */
function proposalOutline(group: THREE.Group, rect: [number, number, number, number]): void {
  const [x0, z0, x1, z1] = rect
  const w = x1 - x0
  const d = z1 - z0
  const cx = (x0 + x1) / 2
  const cz = (z0 + z1) / 2
  const edge = new THREE.MeshBasicMaterial({ color: '#ffd76a', transparent: true, opacity: 0.95, depthWrite: false })
  const fill = new THREE.MeshBasicMaterial({ color: '#ffd76a', transparent: true, opacity: 0.26, depthWrite: false })
  box(group, w - 0.2, 0.01, d - 0.2, fill, cx, 0.07, cz, false)
  box(group, w - 0.1, 0.05, 0.24, edge, cx, 0.07, z0 + 0.05, false)
  box(group, w - 0.1, 0.05, 0.24, edge, cx, 0.07, z1 - 0.05, false)
  box(group, 0.24, 0.05, d - 0.1, edge, x0 + 0.05, 0.07, cz, false)
  box(group, 0.24, 0.05, d - 0.1, edge, x1 - 0.05, 0.07, cz, false)
}

/** Lights off: a dim volume over the whole room. */
function lightsOff(group: THREE.Group, rect: [number, number, number, number]): void {
  const [x0, z0, x1, z1] = rect
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(x1 - x0 - 0.12, 1.9, z1 - z0 - 0.12),
    new THREE.MeshBasicMaterial({ color: '#080916', transparent: true, opacity: 0.64, depthWrite: false }),
  )
  m.position.set((x0 + x1) / 2, 0.95, (z0 + z1) / 2)
  m.renderOrder = 6
  group.add(m)
}

/** The coordinator's desk: the boss-style desk of the app, so it reads as the head of the room. */
function coordinatorRig(w = 2.4): THREE.Group {
  const rig = new THREE.Group()
  const put = (o: THREE.Object3D, x: number, z: number, rot = 0, y = 0) => {
    o.position.set(x, y, z)
    o.rotation.y = rot
    rig.add(o)
  }
  put(F.bossDesk(w), 0, 0)
  put(F.monitorBack(0.85), -0.1, -0.15, Math.PI, 0.78)
  put(F.keyboard(), -0.1, -0.4, Math.PI, 0.78)
  put(F.paperStack(), -w / 3, 0.1, 0.2, 0.78)
  put(F.mug('#d97757'), w / 3, 0.2, 0, 0.78)
  put(F.bossChair(), 0, -1.0, 0)
  return rig
}

/** The director's desk: the same rig, wider, with the chair behind it. */
function directorRig(w: number): THREE.Group {
  const rig = new THREE.Group()
  const put = (o: THREE.Object3D, x: number, z: number, rot = 0, y = 0) => {
    o.position.set(x, y, z)
    o.rotation.y = rot
    rig.add(o)
  }
  put(F.bossDesk(w), 0, 0)
  put(F.monitorBack(0.85), -0.2, -0.15, Math.PI, 0.78)
  put(F.keyboard(), -0.2, -0.4, Math.PI, 0.78)
  put(F.paperStack(), -w / 3, 0.1, 0.2, 0.78)
  put(F.mug('#fdcb6e'), w / 3, 0.2, 0, 0.78)
  put(F.bossChair(), 0, -1.0, 0)
  return rig
}

/** A flat name plate (facing +z) for walls and doors. */
function sign(text: string, width = 2.2, bg = '#2d3142', fg = '#ffffff'): THREE.Group {
  const g = new THREE.Group()
  const c = document.createElement('canvas')
  c.width = Math.round(116 * width)
  c.height = 48
  const ctx = c.getContext('2d')!
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.fillStyle = fg
  ctx.font = 'bold 26px -apple-system, "Segoe UI", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  let label = text
  while (ctx.measureText(label).width > c.width - 24 && label.length > 4) label = label.slice(0, -2) + '…'
  ctx.fillText(label === text ? text : label, c.width / 2, c.height / 2 + 1)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const h = (width * c.height) / c.width
  box(g, width + 0.08, h + 0.08, 0.04, '#5f5a8c', 0, -0.04, 0, false)
  panel(g, width, h, tex, 0, h / 2, 0.025)
  return g
}
