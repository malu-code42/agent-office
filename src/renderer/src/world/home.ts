import * as THREE from 'three'
import type { Look } from '@shared/types'
import { Avatar } from './avatar'
import * as F from './furniture'
import { box } from './kit'
import { animated, mergeStatic } from './merge'
import { WALL_H } from './layout'
import { buildShell, type GroundFloor } from './office'
import { HOME_INTERACTIONS, HOME_PARTITIONS, HOME_ROOMS, HOME_TABLE_AT, HOME_TABLE_SEATS, LUNA_SEAT, type HomeAction } from './home-layout'
import { Grid } from './pathfinding'
import { homeBoardTexture, homeFloorTexture, rugTexture, WindowSky } from './textures'
import { LoopScreen, arcadePainter } from './screens'
import { beacon, costBoard } from './props'

const WOOD = '#a36f46'
const DARK_WOOD = '#67432e'
const LIGHT_WOOD = '#c99a68'
const WALL = '#e8d6bb'
const CAP = '#d4bb95'
const WAINSCOT = '#9a714e'
const BASEBOARD = '#5f4937'

export interface HomeTag {
  action?: HomeAction
  label: string
  x: number
  z: number
  y: number
}

export interface HomeFloor extends GroundFloor {
  interactions: { action: HomeAction; root: THREE.Object3D; highlight: THREE.Mesh }[]
  homeTags: HomeTag[]
  luna: Avatar
  roomLabels: { label: string; x: number; z: number }[]
}

function bed(wood: string, blanket: string): THREE.Group {
  const g = new THREE.Group()
  box(g, 2.3, 0.28, 1.7, wood, 0, 0, 0)
  box(g, 2.2, 0.22, 1.6, '#eee2cc', 0, 0.28, 0)
  box(g, 1.5, 0.08, 1.64, blanket, 0.35, 0.5, 0)
  box(g, 0.45, 0.14, 0.7, '#fffaf0', -0.85, 0.5, -0.4)
  box(g, 0.45, 0.14, 0.7, '#fffaf0', -0.85, 0.5, 0.4)
  box(g, 0.12, 1, 1.8, DARK_WOOD, -1.2, 0, 0)
  box(g, 0.16, 0.06, 1.86, LIGHT_WOOD, -1.2, 1, 0)
  return g
}

function drawer(width: number, color: string, height = 0.8): THREE.Group {
  const g = new THREE.Group()
  box(g, width - 0.06, height, 0.5, color, 0, 0, 0)
  const count = Math.max(1, Math.round(height / 0.27))
  for (let i = 0; i < count; i++) {
    box(g, width - 0.18, 0.02, 0.01, DARK_WOOD, 0, 0.2 + i * 0.25, 0.255, false)
    box(g, 0.12, 0.03, 0.02, '#d9b86a', 0, 0.12 + i * 0.25, 0.26, false)
  }
  return g
}

function wardrobe(width: number): THREE.Group {
  const g = new THREE.Group()
  box(g, width, 2, 0.6, WOOD, 0, 0, 0)
  box(g, width + 0.06, 0.08, 0.66, DARK_WOOD, 0, 2, 0)
  box(g, 0.02, 1.86, 0.01, DARK_WOOD, 0, 0.08, 0.305, false)
  for (const x of [-0.12, 0.12]) box(g, 0.04, 0.22, 0.03, '#d9b86a', x, 1, 0.31, false)
  return g
}

function sideTable(color = LIGHT_WOOD): THREE.Group {
  const g = new THREE.Group()
  box(g, 0.65, 0.05, 0.55, color, 0, 0.42, 0)
  for (const x of [-0.25, 0.25]) for (const z of [-0.2, 0.2]) box(g, 0.05, 0.42, 0.05, DARK_WOOD, x, 0, z)
  box(g, 0.1, 0.22, 0.1, '#e9d8a0', 0.05, 0.48, 0, false)
  return g
}

function coatRack(): THREE.Group {
  const g = new THREE.Group()
  box(g, 0.4, 0.04, 0.4, DARK_WOOD, 0, 0, 0)
  box(g, 0.06, 1.75, 0.06, WOOD, 0, 0.04, 0)
  box(g, 0.34, 0.5, 0.18, '#bb624b', 0.1, 1.05, 0.08)
  box(g, 0.28, 0.4, 0.16, '#3d6470', -0.1, 1.15, -0.06)
  box(g, 0.2, 0.08, 0.2, '#d9b86a', 0, 1.78, 0)
  return g
}

function shoeBench(): THREE.Group {
  const g = new THREE.Group()
  box(g, 1.2, 0.42, 0.42, WOOD, 0, 0, 0)
  box(g, 1.16, 0.08, 0.38, '#72895b', 0, 0.42, 0)
  box(g, 0.24, 0.1, 0.12, '#3a2b20', -0.25, 0, 0.27, false)
  box(g, 0.24, 0.1, 0.12, '#e9dcc4', 0.25, 0, 0.27, false)
  return g
}

function roundDiningTable(): THREE.Group {
  const g = new THREE.Group()
  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(1.35, 1.35, 0.12, 12),
    new THREE.MeshLambertMaterial({ color: LIGHT_WOOD, flatShading: true }),
  )
  top.position.y = 0.76
  g.add(top)
  box(g, 0.24, 0.7, 0.24, DARK_WOOD, 0, 0.02, 0)
  return g
}

function fireplace(): THREE.Group {
  const g = new THREE.Group()
  box(g, 1.5, 1.15, 0.5, '#a65a3f', 0, 0, 0)
  for (let y = 0.12; y < 1.1; y += 0.16) box(g, 1.5, 0.015, 0.01, '#8c4a33', 0, y, 0.255, false)
  box(g, 0.8, 0.6, 0.02, '#2a1a14', 0, 0.12, 0.25, false)
  box(g, 0.5, 0.22, 0.02, new THREE.MeshBasicMaterial({ color: '#f39c3d' }), 0, 0.14, 0.26, false)
  box(g, 0.3, 0.12, 0.02, new THREE.MeshBasicMaterial({ color: '#ffd76a' }), 0, 0.16, 0.27, false)
  box(g, 1.7, 0.1, 0.65, DARK_WOOD, 0, 1.15, 0)
  return g
}

function tree(): THREE.Group {
  const g = new THREE.Group()
  box(g, 0.28, 1.8, 0.28, '#775237', 0, 0, 0)
  for (const [x, y, z, color] of [
    [0, 1.5, 0, '#4f8b49'],
    [0.35, 1.8, 0.1, '#6caa51'],
    [-0.3, 2, 0.15, '#4e8045'],
    [0.05, 2.3, -0.15, '#78b85a'],
  ] as const) {
    const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(0.65, 0), new THREE.MeshLambertMaterial({ color, flatShading: true }))
    leaves.position.set(x, y, z)
    g.add(leaves)
  }
  return g
}

function flowerBed(width: number): THREE.Group {
  const g = new THREE.Group()
  box(g, width, 0.35, 0.75, '#97683e', 0, 0, 0)
  box(g, width - 0.1, 0.08, 0.62, '#463521', 0, 0.35, 0)
  for (let x = -width / 2 + 0.3; x < width / 2; x += 0.45) {
    box(g, 0.035, 0.5, 0.035, '#417d46', x, 0.4, 0)
    box(g, 0.14, 0.12, 0.14, ['#d95f5f', '#e4bd55', '#ba7190'][Math.floor((x + width) * 4) % 3], x, 0.85, 0)
  }
  return g
}

function gardenBench(): THREE.Group {
  const g = new THREE.Group()
  box(g, 1.7, 0.12, 0.5, WOOD, 0, 0.48, 0)
  box(g, 1.7, 0.65, 0.1, WOOD, 0, 0.72, -0.2)
  for (const x of [-0.68, 0.68]) box(g, 0.12, 0.48, 0.12, DARK_WOOD, x, 0, 0)
  return g
}

function typewriter(): THREE.Group {
  const g = new THREE.Group()
  box(g, 0.7, 0.18, 0.48, '#43535a', 0, 0, 0)
  box(g, 0.48, 0.16, 0.12, '#b7c0bd', 0, 0.17, -0.12)
  box(g, 0.5, 0.02, 0.24, '#ddd7c9', 0, 0.19, -0.4)
  for (let i = 0; i < 5; i++) box(g, 0.045, 0.025, 0.035, '#e9ddc4', -0.2 + i * 0.1, 0.2, 0.12, false)
  return g
}

/** A console stand under a TV: solid body on two legs, a back strip, one console box and a green LED. */
function tvConsole(w: number): THREE.Group {
  const g = new THREE.Group()
  box(g, w, 0.42, 0.5, WOOD, 0, 0.06, 0)
  for (const x of [-w / 2 + 0.08, w / 2 - 0.08]) box(g, 0.08, 0.06, 0.4, DARK_WOOD, x, 0, 0)
  box(g, w - 0.2, 0.02, 0.01, DARK_WOOD, 0, 0.27, 0.255, false)
  box(g, 0.34, 0.08, 0.24, '#2d3436', -w / 4, 0.48, 0)
  box(g, 0.05, 0.02, 0.02, '#55efc4', -w / 4 + 0.1, 0.53, 0.12, false)
  return g
}

/** A low open-front wooden shelf: book spines visible in the bay, boxes and jars can rest on the top cap. */
function lowShelf(w: number): THREE.Group {
  const g = new THREE.Group()
  // Open-front frame (bottom-center origins): bottom board, two side boards, back panel, overhanging dark top cap.
  box(g, w, 0.05, 0.42, WOOD, 0, 0, 0)
  for (const x of [-w / 2 + 0.03, w / 2 - 0.03]) box(g, 0.06, 0.6, 0.42, WOOD, x, 0.05, 0)
  box(g, w - 0.12, 0.6, 0.05, WOOD, 0, 0.05, -0.185)
  box(g, w + 0.06, 0.05, 0.46, DARK_WOOD, 0, 0.65, 0)
  for (let i = 0; i < Math.floor(w * 5); i++)
    box(g, 0.06, 0.26, 0.28, ['#b95f3f', '#2f7f86', '#d0a34f', '#3d4a6b', '#c96a8a', '#788c61'][i % 6], -w / 2 + 0.12 + i * 0.13, 0.05, 0, false)
  return g
}

/** A small art cart: two shelves with paint jars, brushes in a cup and a sketchbook. */
function artCart(): THREE.Group {
  const g = new THREE.Group()
  for (const [x, z] of [[-0.25, -0.18], [0.25, -0.18], [-0.25, 0.18], [0.25, 0.18]] as const) box(g, 0.04, 0.7, 0.04, DARK_WOOD, x, 0, z)
  box(g, 0.6, 0.04, 0.44, WOOD, 0, 0.3, 0)
  box(g, 0.6, 0.04, 0.44, WOOD, 0, 0.7, 0)
  for (const [x, c] of [[-0.2, '#b95f3f'], [-0.08, '#2f7f86'], [0.04, '#d0a34f'], [0.16, '#788c61']] as const)
    box(g, 0.09, 0.11, 0.09, c, x, 0.74, -0.08, false)
  box(g, 0.1, 0.12, 0.1, '#f6efe3', 0.14, 0.74, 0.12, false)
  for (const x of [0.11, 0.14, 0.17]) box(g, 0.015, 0.14, 0.015, DARK_WOOD, x, 0.86, 0.12, false)
  box(g, 0.34, 0.04, 0.26, '#3d4a6b', -0.06, 0.34, 0, false)
  return g
}

/** A music stand with a sheet on it, next to the guitar. */
function musicStand(): THREE.Group {
  const g = new THREE.Group()
  box(g, 0.36, 0.03, 0.36, '#2d3142', 0, 0, 0)
  box(g, 0.04, 1.05, 0.04, '#2d3142', 0, 0.03, 0)
  const desk = new THREE.Group()
  desk.position.set(0, 1.05, 0.02)
  desk.rotation.x = -0.35
  box(desk, 0.5, 0.34, 0.03, '#2d3142', 0, 0, 0)
  box(desk, 0.4, 0.28, 0.01, '#fdfbf4', 0, 0.03, 0.02, false)
  for (const y of [0.08, 0.14, 0.2, 0.26]) box(desk, 0.34, 0.008, 0.01, '#3b3a40', 0, y, 0.026, false)
  g.add(desk)
  return g
}

/** An A-frame easel: three leaning legs under a clamp, a ledge and a leaning canvas with a painting. */
function easelModel(): THREE.Group {
  const g = new THREE.Group()
  const leg = (x: number, z: number, tilt: number) => {
    const l = new THREE.Group()
    box(l, 0.05, 1.78, 0.05, WOOD, 0, 0, 0)
    l.position.set(x, 0, z)
    l.rotation.x = tilt
    g.add(l)
  }
  leg(-0.36, 0.14, -0.12)
  leg(0.36, 0.14, -0.12)
  leg(0, -0.42, 0.2)
  box(g, 0.98, 0.05, 0.18, DARK_WOOD, 0, 0.78, 0.1) // ledge
  // the canvas rests on the ledge, leaning with the front legs; a painting (sky, hills, sun) on its face
  const cv = new THREE.Group()
  cv.position.set(0, 0.83, 0.08)
  cv.rotation.x = -0.12
  box(cv, 0.9, 0.72, 0.04, '#fdfbf4', 0, 0, 0)
  box(cv, 0.8, 0.34, 0.01, '#9fd3e6', 0, 0.32, 0.025, false)
  box(cv, 0.8, 0.26, 0.01, '#788c61', 0, 0.06, 0.025, false)
  box(cv, 0.42, 0.12, 0.01, '#6f9a4a', 0.16, 0.26, 0.026, false)
  box(cv, 0.12, 0.12, 0.01, '#d0a34f', -0.24, 0.5, 0.026, false)
  g.add(cv)
  box(g, 0.14, 0.08, 0.08, DARK_WOOD, 0, 1.6, -0.08) // top clamp
  return g
}

function lowWall(group: THREE.Group, grid: Grid, wall: (typeof HOME_PARTITIONS)[number]): void {
  const fence = wall.fence === true
  const h = fence ? 0.85 : 1.05
  for (let i = wall.from; i < wall.to; i++) {
    if (wall.doors.includes(i)) continue
    const x = wall.axis === 'x' ? wall.at : i + 0.5
    const z = wall.axis === 'x' ? i + 0.5 : wall.at
    if (fence) {
      for (const offset of [-0.36, -0.12, 0.12, 0.36])
        box(
          group,
          wall.axis === 'x' ? 0.06 : 0.12,
          h,
          wall.axis === 'x' ? 0.12 : 0.06,
          '#efe3cf',
          wall.axis === 'x' ? x : x + offset,
          0,
          wall.axis === 'x' ? z + offset : z,
        )
      const rail = (y: number) =>
        wall.axis === 'x' ? box(group, 0.1, 0.06, 1, '#e3d4bb', x, y, z) : box(group, 1, 0.06, 0.1, '#e3d4bb', x, y, z)
      rail(0.25)
      rail(0.62)
    } else {
      const segment = (width: number, height: number, depth: number, material: string, y: number) =>
        wall.axis === 'x' ? box(group, depth, height, width, material, x, y, z) : box(group, width, height, depth, material, x, y, z)
      segment(1, h, 0.14, WAINSCOT, 0)
      segment(1, 0.07, 0.22, CAP, h)
      segment(1, 0.12, 0.17, DARK_WOOD, 0)
    }
    if (wall.axis === 'x') grid.blockEdgeX(wall.at, i)
    else grid.blockEdgeZ(wall.at, i)
  }
  for (let i = wall.from; i <= wall.to; i++) {
    const jamb = i === wall.from || i === wall.to || wall.doors.includes(i) !== wall.doors.includes(i - 1)
    if (jamb)
      box(group, 0.2, h + 0.18, 0.2, fence ? '#e3d4bb' : DARK_WOOD, wall.axis === 'x' ? wall.at : i, 0, wall.axis === 'x' ? i : wall.at)
  }
}

export function buildHome(): HomeFloor {
  const group = new THREE.Group()
  group.name = 'home-ground-floor'
  const grid = new Grid(32, 24)
  const loops: LoopScreen[] = []
  const interactions: HomeFloor['interactions'] = []
  const homeTags: HomeTag[] = []
  const roomLabels = HOME_ROOMS.map(({ label, rect: [x0, _z0, x1, z1] }) => ({ label, x: (x0 + x1) / 2, z: z1 - 0.5 }))
  const skies: WindowSky[] = []
  const place = (object: THREE.Object3D, x: number, z: number, rotation = 0, y = 0) => {
    object.position.set(x, y, z)
    object.rotation.y = rotation
    group.add(object)
    return object
  }
  const floor = buildShell(
    group,
    HOME_ROOMS.map(({ rect }) => ({ id: 'lounge' as const, label: '', rect })),
  )
  if (Array.isArray(floor.material)) {
    const oldFloor = floor.material[2] as THREE.MeshLambertMaterial
    oldFloor.map?.dispose()
    oldFloor.dispose()
    floor.material[2] = new THREE.MeshLambertMaterial({ map: homeFloorTexture() })
  }
  group.traverse((object) => {
    const mesh = object as THREE.Mesh
    const material = mesh.material as THREE.MeshLambertMaterial | undefined
    if (!material?.color || Array.isArray(mesh.material)) return
    const replacements: Record<string, string> = {
      aaa6d6: WALL.slice(1),
      '8f8ac2': WAINSCOT.slice(1),
      c9c5ea: CAP.slice(1),
      '5f5a8c': BASEBOARD.slice(1),
      '4a4366': '4a2f20',
      '36304f': '3a2418',
    }
    const replacement = replacements[material.color.getHexString()]
    if (replacement) mesh.material = new THREE.MeshLambertMaterial({ color: `#${replacement}` })
  })
  for (const wall of HOME_PARTITIONS) lowWall(group, grid, wall)

  const sky = (seed: number) => {
    const view = new WindowSky(seed)
    skies.push(view)
    return view
  }
  const tag = (action: HomeAction | undefined, label: string, x: number, z: number, y = 2.4) => homeTags.push({ action, label, x, z, y })
  const clickable = (action: HomeAction, root: THREE.Object3D) => {
    if (!HOME_INTERACTIONS.some((interaction) => interaction.id === action)) return
    animated(root)
    root.updateMatrixWorld(true)
    const bounds = new THREE.Box3().setFromObject(root)
    const size = bounds.getSize(new THREE.Vector3())
    const highlight = new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(size.x, 0.35) + 0.14, Math.max(size.y, 0.35) + 0.14, Math.max(size.z, 0.35) + 0.14),
      new THREE.MeshBasicMaterial({ color: '#ffd76a', transparent: true, opacity: 0.26, depthWrite: false }),
    )
    highlight.position.copy(bounds.getCenter(new THREE.Vector3()))
    highlight.visible = false
    animated(highlight)
    group.add(highlight)
    interactions.push({ action, root, highlight })
  }
  const rug = (w: number, d: number, x: number, z: number, base: string, border: string, accent: string) =>
    place(F.rug(w, d, rugTexture(w, d, base, border, accent)), x, z)

  // House wallpapers above the wainscot. The east-facing partitions are kept low, so they do not hide the room.
  const wallpaper = (x0: number, x1: number, color: string, pattern: 'stripe' | 'brick' | 'tile' = 'stripe') => {
    const width = Math.max(8, Math.round((x1 - x0) * 16))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = 28
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingEnabled = false
    ctx.fillStyle = color
    ctx.fillRect(0, 0, width, 28)
    if (pattern === 'stripe')
      for (let x = 0; x < width; x += 8) {
        ctx.fillStyle = '#c3cfa9'
        ctx.fillRect(x + 4, 0, 1, 28)
        ctx.fillStyle = 'rgba(74,80,53,0.12)'
        ctx.fillRect(x, 0, 2, 28)
      }
    if (pattern === 'brick') {
      ctx.fillStyle = '#a3896a'
      for (let y = 0; y < 28; y += 4) {
        ctx.fillRect(0, y, width, 1)
        for (let x = (y / 4) % 2 ? 4 : 0; x < width; x += 8) ctx.fillRect(x, y, 1, 4)
      }
      for (let i = 0; i < width; i += 7) {
        ctx.fillStyle = i % 2 ? '#4f7d3a' : '#5f9445'
        ctx.fillRect(i, 18 + (i % 5), 3, 4)
      }
    }
    if (pattern === 'tile') {
      ctx.fillStyle = '#d6cdbd'
      for (let y = 0; y < 28; y += 4) {
        ctx.fillRect(0, y, width, 1)
        for (let x = (y / 4) % 2 ? 4 : 0; x < width; x += 8) ctx.fillRect(x, y, 1, 4)
      }
      ctx.fillStyle = '#b95f3f'
      ctx.fillRect(0, 15, width, 2)
    }
    const texture = new THREE.CanvasTexture(canvas)
    texture.magFilter = THREE.NearestFilter
    texture.minFilter = THREE.NearestFilter
    texture.colorSpace = THREE.SRGBColorSpace
    const material = new THREE.MeshLambertMaterial({ map: texture })
    const north = (x: number, len: number) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.62), material)
      mesh.position.set(x + len / 2, 1.8, 0.01)
      group.add(mesh)
    }
    north(x0, x1 - x0)
  }
  wallpaper(0, 10, '#a9b98f')
  wallpaper(10, 17, '#ecd9b8')
  wallpaper(17, 25, '#f3eee5', 'tile')
  wallpaper(25, 32, '#b9a07e', 'brick')
  // West wall wallpaper panels are planes turned to face into the rooms.
  const westPaper = (z0: number, z1: number, color: string, pattern: 'stripe' | 'flower') => {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(8, Math.round((z1 - z0) * 16))
    canvas.height = 28
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingEnabled = false
    ctx.fillStyle = color
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    if (pattern === 'stripe')
      for (let x = 0; x < canvas.width; x += 8) {
        ctx.fillStyle = '#c3cfa9'
        ctx.fillRect(x + 4, 0, 1, 28)
      }
    else
      for (let x = 3; x < canvas.width; x += 12)
        for (let y = 3; y < 28; y += 12) {
          ctx.fillStyle = '#f6e9e1'
          ctx.fillRect(x, y, 3, 3)
          ctx.fillStyle = '#2f7f86'
          ctx.fillRect(x + 4, y + 3, 1, 2)
        }
    const texture = new THREE.CanvasTexture(canvas)
    texture.magFilter = THREE.NearestFilter
    texture.minFilter = THREE.NearestFilter
    texture.colorSpace = THREE.SRGBColorSpace
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.62, z1 - z0), new THREE.MeshLambertMaterial({ map: texture }))
    mesh.position.set(0.01, 1.8, (z0 + z1) / 2)
    mesh.rotation.y = -Math.PI / 2
    group.add(mesh)
  }
  westPaper(0, 10, '#a9b98f', 'stripe')
  westPaper(10, 14, '#ecd9b8', 'stripe')
  westPaper(14, 24, '#8fc7c4', 'flower')

  // Entry and elevator: preserve floor selection at its approved central location.
  const elevator = F.elevator()
  place(elevator.group, 13.5, 0.04)
  elevator.buttons[1].visible = false
  place(F.plant('tall', '#bd9070'), 11.9, 0.6)
  place(F.plant('tall', '#bd9070'), 14.85, 0.6)
  rug(2.6, 1.8, 13.5, 2, '#ead8b7', '#8a5b3c', '#b95f3f')
  rug(1.8, 5.6, 13.5, 6.4, '#8f3f2a', '#5e2a1c', '#d0a34f')
  place(coatRack(), 10.6, 1)
  place(shoeBench(), 16.4, 2.2, -Math.PI / 2)
  grid.block(10, 1)
  grid.block(16, 2)

  // Personal office: round table, wall objects, Luna and the user's existing radio.
  const personalSky = sky(11)
  place(F.wallWindow(2.4, 1.3, personalSky), 0.02, 1.4, Math.PI / 2, 1.6)
  const boards = [
    { action: 'goals' as const, label: 'Objetivos', z: 4.725, width: 2.6, height: 1.42 },
    { action: 'personal-routines' as const, label: 'Rotinas pessoais', z: 6.975, width: 1.5, height: 1.42 },
    { action: 'agenda' as const, label: 'Agenda', z: 8.5, width: 1.15, height: 1.32 },
  ]
  for (const board of boards) {
    const texture = homeBoardTexture(board.action === 'goals' ? 'goals' : board.action === 'agenda' ? 'agenda' : 'routines')
    const frame = place(F.wallFrame(board.width, board.height, texture, DARK_WOOD), 0.04, board.z, Math.PI / 2, 1.35)
    clickable(board.action, frame)
    tag(board.action, board.label, 0.35, board.z)
  }
  place(F.bookshelf(2, 1.9, 7), 1.5, 0.3)
  place(F.clock(), 9.4, 0.04, 0, 2.3)
  const tableAt = HOME_TABLE_AT
  rug(5.6, 5, tableAt.x, tableAt.z, '#eee0c4', '#85916a', '#d0a34f')
  place(roundDiningTable(), tableAt.x, tableAt.z)
  grid.blockRect(4, 5, 2, 2)
  const seats = HOME_TABLE_SEATS
  for (const { x, z, face } of seats) place(F.simpleChair('#c9a879'), x, z, face)
  for (const index of [0, 1]) {
    const seat = seats[index]
    place(F.laptop(), seat.x + (tableAt.x - seat.x) * 0.4, seat.z + (tableAt.z - seat.z) * 0.4, seat.face + Math.PI, 0.78)
  }
  const lunaLook: Look = { skin: '#edc2a1', hair: '#54392d', hairStyle: 1, shirt: '#347c7b', pants: '#3d4a6b', shoes: '#2d3436' }
  const luna = new Avatar(lunaLook, 'luna')
  animated(luna.root)
  luna.placeAt(seats[LUNA_SEAT].x, seats[LUNA_SEAT].z)
  luna.faceTowards(tableAt.x, tableAt.z)
  luna.pose = 'sit'
  group.add(luna.root)
  const lunaAt: [number, number, number] = [luna.position.x, 1.2, luna.position.z]
  tag(undefined, 'Luna', lunaAt[0], lunaAt[2], 1.7)
  place(F.paperStack(), tableAt.x - 0.45, tableAt.z + 0.35, 0.4, 0.78)
  place(F.mug('#b95f3f'), tableAt.x + 0.65, tableAt.z + 0.2, 0, 0.78)
  place(F.mug('#788c61'), tableAt.x - 0.65, tableAt.z + 0.2, 0, 0.78)
  const radio = F.monitorTv()
  place(radio.group, 7.6, 0.35)
  place(F.plant('flower', '#bd9070'), 6.65, 0.35, 0, 0.55)
  clickable('radio', radio.group)
  tag('radio', 'Claude FM', 7.6, 0.35, 2.5)
  place(drawer(1.4, WOOD, 0.55), 3.7, 0.3)
  place(F.plant('fern', '#bd9070'), 3.4, 0.3, 0, 0.55)
  place(F.art('mountains', 1, 0.75), 5, 0.04, 0, 1.75)
  place(F.art('plant', 0.6, 0.8), 3, 0.04, 0, 2.05)
  place(F.plant('tall'), 9.3, 0.7)
  place(F.plant('fern'), 0.6, 9.3)
  place(F.plant('bush'), 0.6, 6.8)
  place(F.armchair('#d0a34f'), 8.9, 8.6, -Math.PI / 2)
  place(sideTable('#eee0c4'), 8.9, 7.5)
  place(F.floorLamp(), 9.4, 9.4)
  grid.block(8, 8)
  grid.block(9, 2)
  grid.block(3, 0)

  // Kitchen, wood cabinetry, island and two-person table.
  const counter = place(F.kitchenCounter(5), 19.6, 0.35)
  const cabinets = place(F.wallCabinets(5), 19.6, 0.19)
  for (const root of [counter, cabinets])
    root.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh || Array.isArray(mesh.material)) return
      const original = mesh.material as THREE.MeshLambertMaterial
      const colors: Record<string, string> = { f2efe8: '#c9a879', e4dfd4: '#d8bd92', '5b6074': '#d9b07a', '8d93a3': DARK_WOOD }
      const next = colors[original.color.getHexString()]
      if (next) mesh.material = new THREE.MeshLambertMaterial({ color: next })
    })
  place(F.coffeeMachine(), 17.8, 0.4, 0, 0.91)
  place(F.microwave(), 19, 0.4, 0, 0.91)
  place(F.fridge(), 23.5, 0.45)
  place(F.barTable(), 20.2, 4.8)
  for (const [dx, dz, color] of [
    [-0.8, 0, '#b95f3f'],
    [0.8, 0, '#788c61'],
    [0, 0.8, '#d0a34f'],
  ] as const)
    place(F.stool(color), 20.2 + dx, 4.8 + dz)
  rug(2.6, 2, 22.8, 7.6, '#ead8b7', '#b95f3f', '#d0a34f')
  place(F.roundTable(0.45), 22.8, 7.6)
  place(F.simpleChair('#c9a879'), 21.9, 7.6, Math.PI / 2)
  place(F.simpleChair('#c9a879'), 23.7, 7.6, -Math.PI / 2)
  place(F.trash(), 24.4, 2.2)
  grid.blockRect(17, 0, 5, 1)

  // Garden with tree, raised flowers, bench and stone path.
  place(tree(), 30.4, 2.6)
  place(flowerBed(3), 27.6, 0.55)
  place(flowerBed(2), 31.4, 6.6, Math.PI / 2)
  place(gardenBench(), 28.6, 6.9)
  place(F.plant('flower'), 26, 8.9)
  place(F.plant('fern'), 27, 9.2)
  place(F.plant('bush'), 31.3, 9.2)
  place(F.floorLamp(), 25.6, 1.2)
  grid.block(30, 2)
  grid.block(28, 6)

  // Reading nook and the only entry to the private bedroom.
  for (const [z, seed] of [
    [11, 9],
    [13.05, 10],
  ] as const) {
    const shelf = place(F.bookshelf(2, 1.9, seed), 0.35, z, Math.PI / 2)
    clickable('books', shelf)
    grid.blockRect(0, Math.floor(z), 1, 2)
  }
  tag('books', 'Livros', 0.45, 12, 2.5)
  place(F.armchair('#347c7b'), 1.95, 12, Math.PI / 2)
  place(F.floorLamp(), 1.3, 10.5)
  place(F.lowTable(0.3), 3.2, 12.9)
  place(F.plant('tall'), 9.4, 10.6)
  grid.block(1, 11)
  grid.block(9, 10)

  rug(3.6, 3.2, 2.8, 19, '#e6f4f2', '#2f7f86', '#d0a34f')
  place(bed(WOOD, '#2f7f86'), 1.65, 19)
  for (const z of [17.5, 20.5]) {
    place(drawer(0.7, WOOD, 0.55), 0.5, z, Math.PI / 2)
    place(F.deskLamp('#9fd3cf'), 0.5, z, -0.6, 0.55)
  }
  place(drawer(1.4, DARK_WOOD, 0.45), 3.25, 19, Math.PI / 2)
  place(F.art('sunset', 1.2, 0.9), 0.04, 19, Math.PI / 2, 2.1)
  place(drawer(0.8, WOOD, 0.75), 0.4, 15.4, Math.PI / 2)
  place(F.wallFrame(0.45, 0.55, homeBoardTexture('goals'), DARK_WOOD), 0.04, 15.4, Math.PI / 2, 1.5)
  place(F.stool('#9fd3cf'), 1.2, 15.4)
  place(wardrobe(2), 5.4, 14.45)
  place(F.bookshelf(1.1, 1.4, 14), 7.35, 14.35)
  const bedroomSky = sky(22)
  place(F.wallWindow(2.2, 1.3, bedroomSky), 0.02, 22.6, Math.PI / 2, 1.6)
  rug(2.6, 2.2, 6.2, 21.6, '#e6f4f2', '#9fd3cf', '#2f7f86')
  place(F.armchair('#2f7f86'), 6.9, 21.8, -Math.PI / 2)
  place(sideTable('#9fd3cf'), 6.9, 20.6)
  place(F.beanBag('#9fd3cf'), 5.2, 21.2, Math.PI / 2)
  place(F.floorLamp(), 7.3, 23.3)
  place(F.plant('flower'), 4.4, 23.4)
  place(F.plant('fern'), 2.6, 23.4)
  for (let z = 14; z < 24; z++) grid.blockEdgeX(8, z)

  // Living room with film-library TV, hearth/tea area, music corner and piano.
  rug(5, 5, 11.4, 18.5, '#eee0c4', '#b95f3f', '#788c61')
  const tvStand = new THREE.Group()
  box(tvStand, 2, 0.42, 0.5, WOOD, 0, 0.06, 0)
  box(tvStand, 1.8, 0.02, 0.01, DARK_WOOD, 0, 0.27, 0.255, false)
  place(tvStand, 8.45, 18.5, Math.PI / 2)
  const filmTv = F.monitorTv()
  place(filmTv.group, 8.55, 18.5, Math.PI / 2, 0.48)
  clickable('films', filmTv.group)
  tag('films', 'Filmes', 8.7, 18.5, 2.3)
  place(F.coffeeTable(2, 0.7), 10.9, 18.5, Math.PI / 2)
  place(F.sofa(3, '#b95f3f'), 13.1, 18.5, -Math.PI / 2)
  place(F.armchair('#788c61'), 10.9, 16.3)
  place(F.armchair('#d0a34f'), 10.9, 20.7, Math.PI)
  place(sideTable('#eee0c4'), 13.1, 16.4)
  place(sideTable('#d0a34f'), 13.1, 20.6)
  place(fireplace(), 19, 13.4)
  rug(3.6, 2.4, 19, 15.2, '#eee0c4', '#d0a34f', '#b95f3f')
  place(drawer(1, DARK_WOOD, 0.4), 19, 14.6)
  place(F.mug('#eee0c4'), 18.8, 14.6, 0, 0.42)
  place(F.sofa(2, '#788c61'), 19, 15.9, Math.PI)
  place(F.roundTable(0.45), 22, 14.2)
  place(F.simpleChair('#c9a879'), 22, 15.2, Math.PI)
  place(F.plant('flower'), 22, 14.2, 0, 0.75)
  // Piano is a decorative sprite; clicking it does not imply audio playback.
  const piano = new THREE.Group()
  box(piano, 1.5, 0.9, 0.55, DARK_WOOD, 0, 0, 0)
  box(piano, 1.38, 0.04, 0.48, '#292b32', 0, 0.92, 0)
  for (let i = 0; i < 9; i++) box(piano, 0.12, 0.04, 0.2, i % 3 ? '#f5f0e4' : '#ddd4c4', -0.55 + i * 0.14, 0.96, 0.14, false)
  place(piano, 16.4, 14)
  place(F.floorLamp(), 22.6, 17.4)
  place(F.lowTable(0.38), 17.4, 19)
  place(F.beanBag('#788c61'), 17.4, 17.5)
  place(F.beanBag('#9fc7c3'), 18.9, 19.2, -Math.PI / 2)
  place(F.beanBag('#347c7b'), 16, 19.6, Math.PI / 2)
  place(F.plant('flower'), 11, 23.55)
  place(F.bookshelf(2, 1.3, 12), 11.6, 23.55, Math.PI)
  place(F.floorLamp(), 14.2, 23.4)
  place(F.armchair('#ad7590'), 20.6, 22.4, Math.PI)
  place(sideTable('#eee0c4'), 21.8, 22.6)
  place(F.plant('tall'), 22.4, 23.3)
  place(F.plant('fern'), 18.6, 23.3)
  rug(13, 1.6, 15.5, 11.5, '#8f3f2a', '#5e2a1c', '#d0a34f')
  place(F.plant('tall'), 9, 10.6)
  place(F.plant('bush'), 17.6, 10.6)
  place(F.plant('tall'), 22.4, 10.6)
  for (let z = 13; z < 24; z++) grid.blockEdgeZ(13, 8 + z - 13)

  // Games room beyond the living-room opening; the garden fence remains closed.
  for (const [x, seed] of [
    [24.3, 8],
    [25.3, 7],
  ] as const) {
    const screen = new LoopScreen(24, 20, arcadePainter, seed)
    loops.push(screen)
    const machine = place(F.arcade(screen.texture), x, 10.5)
    clickable('games', machine)
    grid.block(Math.floor(x), 10)
  }
  const gamesScreen = F.monitorTv()
  place(gamesScreen.group, 29, 10.55, 0, 0.48)
  clickable('games', gamesScreen.group)
  tag(undefined, 'Jogos', 26.6, 10.6)
  place(tvConsole(1.8), 29, 10.45)
  rug(5, 3, 29, 12.9, '#eee0c4', '#347c7b', '#d0a34f')
  place(F.sofa(2, '#788c61'), 30, 14.8, Math.PI)
  place(F.beanBag('#347c7b'), 26.6, 13.2, Math.PI / 2)
  place(lowShelf(1.4), 27, 10.35)
  for (let i = 0; i < 6; i++)
    box(group, 0.1, 0.26, 0.18, ['#b95f3f', '#347c7b', '#d0a34f', '#788c61', '#3d4a6b', '#c96a8a'][i], 26.55 + i * 0.18, 0.7, 10.35, false)
  place(F.floorLamp(), 24, 15.2)
  place(F.plant('fern', '#b8643f'), 31.4, 15.3)
  grid.blockRect(28, 10, 2, 1)
  grid.blockRect(26, 10, 2, 1)
  place(F.beanBag('#b95f3f'), 28.2, 13.2, Math.PI)
  place(F.beanBag('#d0a34f'), 29.8, 13.2, Math.PI)
  place(F.lowTable(0.35), 29, 12.2)
  place(F.plant('tall'), 31.4, 10.7)

  // Creative nook: writing is connected; drawing and guitar remain decoration.
  rug(3.4, 2.6, 27.4, 19.2, '#eee0c4', '#347c7b', '#b95f3f')
  place(F.bookshelf(2, 1.6, 12), 25, 16.45)
  const easel = easelModel()
  place(easel, 27.4, 18.6)
  place(F.stool('#d0a34f'), 27.4, 19.7)
  place(artCart(), 26, 19.2, Math.PI / 2)
  for (const [i, c] of ['#e7d9bd', '#9fd3e6', '#f2d37a'].entries()) box(group, 0.6 - i * 0.08, 0.7 - i * 0.1, 0.05, c, 26.2, 0, 17 + i * 0.08)
  place(lowShelf(1.6), 23.4, 18.2, Math.PI / 2)
  for (const [i, c] of ['#b95f3f', '#347c7b', '#d0a34f', '#788c61'].entries()) box(group, 0.16, 0.18, 0.16, c, 23.4, 0.7, 17.6 + i * 0.36, false)
  place(musicStand(), 30.2, 17.7, Math.PI)
  place(sideTable('#d0a34f'), 31, 20.9)
  place(F.simpleChair('#c9a879'), 29.6, 21.6)
  place(F.beanBag('#b95f3f'), 28.9, 20, -Math.PI / 2)
  place(F.floorLamp(), 24, 23.2)
  place(F.plant('tall', '#b8643f'), 31.5, 23.4)
  place(F.plant('flower', '#b8643f'), 23.6, 23.4)
  grid.blockRect(23, 17, 1, 2)
  grid.block(26, 19)
  grid.block(30, 17)
  const guitar = new THREE.Group()
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.24, 0.3, 0.1, 8),
    new THREE.MeshLambertMaterial({ color: '#b56a4e', flatShading: true }),
  )
  body.rotation.x = Math.PI / 2
  body.position.y = 0.5
  guitar.add(body)
  box(guitar, 0.1, 0.9, 0.08, '#8f5c3b', 0, 1.05, 0)
  place(guitar, 31.2, 17.4)
  place(F.armchair('#788c61'), 31, 19.6, -Math.PI / 2)
  const writingDesk = place(F.desk(3, '#c9a879', DARK_WOOD), 29.6, 22.6, Math.PI)
  place(typewriter(), 29.55, 22.6, Math.PI, 0.76)
  place(F.paperStack(), 28.4, 22.6, 0.2, 0.76)
  place(F.mug('#b95f3f'), 30.4, 22.7, 0, 0.76)
  place(F.deskLamp('#d0a34f'), 30.9, 22.75, 0.6, 0.76)
  clickable('writing', writingDesk)
  tag('writing', 'Escrita', 29.6, 22.6, 2.3)
  grid.blockRect(28, 22, 3, 1)

  // Separate agent scheduler access: its old totem remains on the entry edge, not the personal Rotinas board.
  const loopsScreens: LoopScreen[] = loops
  const money = costBoard('Casa', 1.05)
  place(money.group, 15.8, 0.06, 0, WALL_H / 2 - (1.05 * 72) / 160 / 2)
  const alarm = beacon()
  place(alarm.group, 9.9, 6.1, -Math.PI / 2, 1.4)
  grid.block(9, 6)
  grid.block(10, 8)
  mergeStatic(group)
  let doorOpen = 0
  let doorTimer = 0
  const [doorL, doorR] = elevator.doors
  return {
    group,
    grid,
    floor,
    deskScreens: [],
    tv: radio,
    money,
    alarm,
    interactions,
    homeTags,
    luna,
    roomLabels,
    reducedMotion: false,
    update(dt: number) {
      luna.update(dt)
      money.update(dt)
      alarm.update(this.reducedMotion ? dt * 0.15 : dt)
      for (const screen of loopsScreens) screen.update(dt)
      for (const view of skies) view.update()
      doorTimer = Math.max(0, doorTimer - dt)
      doorOpen += ((doorTimer > 0 ? 1 : 0) - doorOpen) * Math.min(1, dt * 5)
      const width = 0.72 * (1 - doorOpen * 0.9)
      doorL.scale.x = doorR.scale.x = width
      doorL.position.x = -0.72 + width / 2
      doorR.position.x = 0.72 - width / 2
    },
    ding() {
      doorTimer = 2.2
    },
    setFloors(count: number) {
      elevator.buttons.forEach((button, index) => (button.visible = index < count))
    },
  }
}
