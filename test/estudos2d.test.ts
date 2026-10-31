import { describe, expect, it } from 'vitest'
import estudosData from '../src/renderer/src/assets/pixel/estudos.json'
import atlasData from '../src/renderer/src/assets/pixel/atlas.json'
import { depthSort } from '../src/renderer/src/world2d/depth'
import {
  studyCycleView,
  studyPlan,
  studyZoneAt,
  teacherOfStage,
  TEACHERS,
  type EstudosLayout,
  type StudyAct,
} from '../src/renderer/src/world2d/estudos'
import { actAt } from '../src/renderer/src/world2d/hit'
import { artToScreen } from '../src/renderer/src/world2d/iso'
import { grid2d } from '../src/renderer/src/world2d/layout'
import { Walker } from '../src/renderer/src/world2d/walker'
import { emptyStudyCycleState, type StudyCycle, type StudyCycleState } from '@shared/study-cycle'
import { pngAlpha } from './png-alpha'

const EST = estudosData as unknown as EstudosLayout
const ATLAS = atlasData as unknown as { frames: Record<string, [number, number, number, number]> }
const ACTS: StudyAct[] = ['library', 'cycle', 'desk', 'questions', 'cards', 'schedule', 'trail', 'cora', 'bonnie']
const tileOf = (c: { x: number; z: number }): [number, number] => [Math.floor(c.x), Math.floor(c.z)]

describe('layout 2D do andar de estudos', () => {
  it('tem 24x18 tiles, o elevador no fundo do hall e as salas fechadas por vidro', () => {
    expect(EST.size).toEqual([24, 18])
    expect(EST.base).toBe('estudos-base.png')
    expect(EST.elevator.tile).toEqual([12, 1])
    expect(EST.walls.length).toBeGreaterThan(0)
    for (const s of EST.static) expect(ATLAS.frames[s.f], s.f).toBeDefined()
    for (const s of [EST.cora, EST.bonnie, EST.student.seat, EST.notes, ...EST.teachers, ...EST.visitors]) {
      expect(ATLAS.frames[s.seat.f], s.seat.f).toBeDefined()
      expect(ATLAS.frames[s.back.f], s.back.f).toBeDefined()
    }
  })

  it('tem as nove estantes da biblioteca e cada coisa clicável', () => {
    const acts = new Set([...EST.static.flatMap((s) => (s.act ? [s.act] : [])), ...EST.hot.map((h) => h.act)])
    expect([...acts].sort()).toEqual([...ACTS].sort())
    // nine topic shelves in the library, plus one in the classroom and one in the estudo individual
    expect(EST.static.filter((s) => s.act === 'library')).toHaveLength(11)
    expect(EST.static.filter((s) => s.act === 'library' && s.fp[1] < 104 && s.fp[0] < 168)).toHaveLength(9)
  })

  it('cinco cadeiras de professor, a carteira virada para o quadro e Cora e Bonnie viradas para a frente', () => {
    expect(EST.teachers).toHaveLength(TEACHERS.length)
    expect(EST.student.seat.dir).toBe('BR')
    expect(EST.cora.dir).toBe('FL')
    expect(EST.bonnie.dir).toBe('FL')
    // the teacher of the turn stands between the blackboard and the desk
    const [, cy] = EST.class.at
    expect(cy).toBeGreaterThan(156)
    expect(cy).toBeLessThan(EST.student.desk[1])
  })

  it('dá para chegar do elevador a toda cadeira e ao lugar da aula', () => {
    const grid = grid2d(EST)
    const plan = studyPlan(EST, grid)
    const [ex, ez] = plan.elevator.tile
    const goals = [plan.cora, plan.bonnie, plan.student, plan.notes, ...plan.teachers, ...plan.visitors].map(tileOf)
    goals.push(plan.classSpot.tile)
    for (const [x, z] of goals) {
      expect(grid.walkable(x, z), `${x},${z}`).toBe(true)
      expect(grid.findPath(ex, ez, x, z), `${x},${z}`).not.toBeNull()
    }
  })

  it('os vidros só deixam passar pelas portas, mesmo os que ficam no meio de um tile', () => {
    const grid = grid2d(EST)
    // biblioteca: the wall at z 6.5 blocks its row, but the door
    expect(grid.walkable(1, 6)).toBe(false)
    expect(grid.walkable(2, 6)).toBe(true)
    // sala de aula: from the hall only by its door
    expect(grid.canStep(10, 8, 10, 9)).toBe(false)
    expect(grid.canStep(11, 8, 11, 9)).toBe(true)
    // sala dos professores -> sala de aula through the inner door
    expect(grid.walkable(6, 12)).toBe(false)
    expect(grid.walkable(6, 14)).toBe(true)
  })

  it('diz o nome da sala sob o ponteiro', () => {
    expect(studyZoneAt(EST, 3, 3)).toBe('Biblioteca')
    expect(studyZoneAt(EST, 9, 12)).toBe('Sala de aula')
    expect(studyZoneAt(EST, 2, 12)).toBe('Sala dos professores')
    expect(studyZoneAt(EST, 18, 3)).toBe('Diretoria · Bonnie')
    expect(studyZoneAt(EST, 13, 4)).toBe('Corredor')
    expect(studyZoneAt(EST, 30, 30)).toBeNull()
  })
})

describe('professores e ciclo de estudo', () => {
  const cycle = (stage: StudyCycle['stage']): StudyCycleState => ({
    activeId: 'c1',
    cycles: [{ id: 'c1', topic: 'Frações', stage, startedAt: 0, updatedAt: 0, questions: [], practiceRounds: [], notes: [], retests: [] }],
  })

  it('o professor da vez segue a etapa do ciclo', () => {
    expect(teacherOfStage('diagnosis')).toBe('tutor')
    expect(teacherOfStage('review-required')).toBe('tutor')
    expect(teacherOfStage('practice')).toBe('curador')
    expect(teacherOfStage('retest-ready')).toBe('verificador')
    expect(teacherOfStage('retest')).toBe('verificador')
    expect(teacherOfStage('completed')).toBeNull()
    expect(teacherOfStage(null)).toBeNull()
  })

  it('lê o tópico e a etapa do ciclo ativo', () => {
    expect(studyCycleView(emptyStudyCycleState())).toBeNull()
    expect(studyCycleView(cycle('practice'))).toEqual({ stage: 'practice', topic: 'Frações', ready: false })
  })

  it('o professor anda pelo caminho até o lugar da aula e volta', () => {
    const grid = grid2d(EST)
    const plan = studyPlan(EST, grid)
    const chair = plan.teachers[TEACHERS.findIndex((t) => t.id === 'tutor')]
    const w = new Walker()
    w.place(chair.x, chair.z)
    const [sx, sz] = tileOf(chair)
    const path = grid.findPath(sx, sz, ...plan.classSpot.tile)
    expect(path).not.toBeNull()
    let arrived = false
    w.walk([...path!.map(([x, z]) => ({ x: x + 0.5, z: z + 0.5 })), plan.classSpot], () => (arrived = true))
    for (let i = 0; i < 600 && !arrived; i++) {
      w.update(1 / 30)
      // never inside a blocked tile
      expect(grid.walkable(Math.floor(w.x), Math.floor(w.z)), `${w.x},${w.z}`).toBe(true)
    }
    expect(arrived).toBe(true)
    expect([w.x, w.z]).toEqual([plan.classSpot.x, plan.classSpot.z])
    expect(w.walking).toBe(false)
  })
})

describe('clique no andar de estudos', () => {
  const png = pngAlpha('src/renderer/src/assets/pixel/atlas.png')
  const solid = (f: string, u: number, v: number) => {
    const r = ATLAS.frames[f]
    return !!r && u >= 0 && v >= 0 && u < r[2] && v < r[3] && png.alpha(r[0] + Math.floor(u), r[1] + Math.floor(v)) > 0
  }
  const items = depthSort(EST.static.map((s) => ({ fp: s.fp, sprites: [{ f: s.f, x: s.x, y: s.y }], act: s.act })))

  it('cada coisa clicável tem um ponto que responde por ela', () => {
    for (const act of ACTS) {
      const boxes = [
        ...EST.static.filter((s) => s.act === act).map((s) => [s.x, s.y, ATLAS.frames[s.f][2], ATLAS.frames[s.f][3]]),
        ...EST.hot.filter((h) => h.act === act).map((h) => h.box),
      ]
      let hit = false
      for (const [x, y, w, h] of boxes)
        for (let v = 0; v < h && !hit; v++)
          for (let u = 0; u < w && !hit; u++) hit = actAt(items, EST.hot, { x: x + u, y: y + v }, solid) === act
      expect(hit, act).toBe(true)
    }
  })

  it('o chão vazio e os móveis sem ação não abrem nada', () => {
    expect(actAt(items, EST.hot, artToScreen(EST.origin, 200, 230), solid)).toBeNull()
    const globe = EST.static.find((s) => s.fp[0] === 108 && s.fp[1] === 184)!
    expect(actAt(items, EST.hot, { x: globe.x + 6, y: globe.y + 6 }, solid)).toBeNull()
  })
})
