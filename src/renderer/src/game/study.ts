import type { HomeChair } from '../world2d/home-layout'
import { Overlays, Point3, Tag } from '../world2d/overlays'
import { ESTUDOS_LAYOUT } from '../world2d/atlas'
import {
  BONNIE_VARIANT,
  CORA_VARIANT,
  studyPlan,
  teacherOfStage,
  TEACHERS,
  type EstudosFlat,
  type StudyAct,
  type StudyCycleView,
  type StudyPlan,
  type Teacher,
} from '../world2d/estudos'
import { buildEstudos2d, type Floor2d } from '../world2d/floor'
import type { Person2d } from '../world2d/renderer'
import { Walker } from '../world2d/walker'
import { TAG_LIFT } from './types'

/** Height (tiles) of a standing teacher's tag anchor, as an Avatar's. */
const STAND_TAG_Y = 1.55

/** The tags over the study floor's clickable things, by the name estudos.json gives their spot. */
const OBJECT_TAGS: [string, StudyAct][] = [
  ['Biblioteca', 'library'],
  ['Tópico atual', 'cycle'],
  ['Horário de aula', 'schedule'],
  ['Questões', 'questions'],
  ['Sua carteira', 'desk'],
  ['Notas e cartões', 'cards'],
  ['Trilha de estudos', 'trail'],
]

/**
 * The people of the study floor (2D only): Cora at the library desk, Bonnie in the
 * diretoria and the five teachers in their room. The teacher whose turn it is in the
 * study cycle (Tutor, Curador or Verificador) walks to the classroom and stands in front
 * of the user's desk; when the turn passes, it walks back to its chair.
 */
export class StudyFloor {
  readonly layout = ESTUDOS_LAYOUT
  readonly scene: Floor2d<EstudosFlat> = buildEstudos2d(ESTUDOS_LAYOUT)
  readonly plan: StudyPlan = studyPlan(ESTUDOS_LAYOUT, this.scene.grid)
  readonly walkers = new Map<Teacher['id'], Walker>()
  /** The teacher standing in (or walking to) the classroom. */
  inClass: Teacher['id'] | null = null
  cycle: StudyCycleView | null = null
  private tags: Tag[] = []
  private teacherTags = new Map<Teacher['id'], Tag>()
  private topicTag: Tag | null = null
  private shown = false

  constructor(overlays: Overlays, onAct: (act: StudyAct, teacher?: Teacher) => void) {
    TEACHERS.forEach((t, i) => {
      const w = new Walker()
      const chair = this.plan.teachers[i]
      w.place(chair.x, chair.z, chair.face)
      w.seated = true
      this.walkers.set(t.id, w)
    })
    const at = (x: number, y: number, z: number) => new Point3(x, y, z)
    const person = (anchor: Point3, name: string, click: () => void) => {
      const tag = overlays.add(new Tag(anchor, name, false, click))
      tag.setDot('idle')
      this.tags.push(tag)
      return tag
    }
    // a sitter's tag sits as low as Luna's (the 2D projection lifts every tag by TAG_LIFT)
    person(at(this.plan.cora.x, 0.35, this.plan.cora.z), 'Cora · bibliotecária', () => onAct('cora'))
    person(at(this.plan.bonnie.x, 0.35, this.plan.bonnie.z), 'Bonnie · diretora de estudos', () => onAct('bonnie'))
    // Every teacher wears a tag with its role name (Tutor, Curador, Verificador, the cards pair);
    // the role it plays in the cycle shows on hover.
    for (const t of TEACHERS) {
      const w = this.walkers.get(t.id)!
      const tag = overlays.add(new Tag(at(w.x, 0.35, w.z), t.name, false, () => onAct('cycle', t)))
      tag.setDot('idle')
      tag.el.classList.add('tag-mini')
      tag.el.title = `${t.name} · ${t.role}`
      this.teacherTags.set(t.id, tag)
    }
    for (const [name, act] of OBJECT_TAGS) {
      const spot = this.layout.tags[name]
      if (!spot) continue
      const tag = overlays.add(new Tag(at(spot[0] / 16, spot[2] / 16 - TAG_LIFT, spot[1] / 16), name, false, () => onAct(act)))
      tag.el.classList.add('tag-mini')
      tag.el.title = name
      this.tags.push(tag)
      if (act === 'cycle') this.topicTag = tag
    }
    this.show(false)
  }

  /** The tags show only while the study floor is on screen; the teacher giving the class has a working dot. */
  show(on: boolean): void {
    this.shown = on
    for (const t of this.tags) t.hidden = !on
    for (const [id, t] of this.teacherTags) {
      t.hidden = !on
      t.setDot(id === this.inClass ? 'working' : 'idle')
    }
  }

  /**
   * The cycle changed: the topic on the blackboard, Bonnie's bubble and the teacher of the
   * turn (who walks to the classroom, or is put there at once with `instant`).
   */
  setCycle(cycle: StudyCycleView | null, instant: boolean): void {
    this.cycle = cycle
    this.topicTag?.setName(cycle?.topic ? `Tópico atual · ${cycle.topic}` : 'Tópico atual')
    const next = teacherOfStage(cycle?.stage)
    if (next === this.inClass) return
    const was = this.inClass
    this.inClass = next
    if (was) this.toChair(was, instant)
    if (next) this.toClass(next, instant)
    this.placeTags()
    this.show(this.shown)
  }

  /** A teacher's tag over its head: low while it sits, higher while it stands (over the pixel bubble). */
  private placeTags(): void {
    for (const [id, w] of this.walkers) {
      const anchor = this.teacherTags.get(id)?.anchor
      if (anchor instanceof Point3) anchor.set(w.x, w.seated ? 0.35 : STAND_TAG_Y, w.z)
    }
  }

  private toChair(id: Teacher['id'], instant: boolean): void {
    const w = this.walkers.get(id)!
    const chair = this.plan.teachers[TEACHERS.findIndex((t) => t.id === id)]
    const sit = () => {
      w.place(chair.x, chair.z, chair.face)
      w.seated = true
    }
    if (instant) return sit()
    this.walk(w, [Math.floor(chair.x), Math.floor(chair.z)], chair, () => {
      if (this.inClass !== id) sit()
    })
  }

  private toClass(id: Teacher['id'], instant: boolean): void {
    const w = this.walkers.get(id)!
    const spot = this.plan.classSpot
    if (instant) return w.place(spot.x, spot.z, spot.face)
    this.walk(w, spot.tile, spot, () => {
      if (this.inClass === id) w.heading = spot.face
    })
  }

  /** Walks a teacher along the grid to a tile, then to the exact point. */
  private walk(w: Walker, tile: [number, number], end: { x: number; z: number }, then: () => void): void {
    const grid = this.scene.grid
    const path = grid.findPath(Math.floor(w.x), Math.floor(w.z), tile[0], tile[1]) ?? []
    w.walk([...path.map(([x, z]) => ({ x: x + 0.5, z: z + 0.5 })), { x: end.x, z: end.z }], then)
  }

  /** Moves the teachers; true while one walks. */
  update(dt: number): boolean {
    let moved = false
    for (const w of this.walkers.values()) moved = w.update(dt) || moved
    if (moved) this.placeTags()
    return moved
  }

  /** The people of the floor as the 2D renderer draws them. */
  people(): Person2d[] {
    const sitter = (key: string, variant: number, chair: HomeChair, bubble: Person2d['bubble'] = null): Person2d => ({
      key,
      variant,
      x: chair.x,
      z: chair.z,
      heading: chair.face,
      stride: null,
      seated: true,
      bubble,
    })
    const out = [
      sitter('cora', CORA_VARIANT, this.plan.cora),
      sitter('bonnie', BONNIE_VARIANT, this.plan.bonnie, this.cycle?.ready ? 'ok' : null),
    ]
    for (const t of TEACHERS) {
      const w = this.walkers.get(t.id)!
      out.push({
        key: `teacher:${t.id}`,
        variant: t.variant,
        x: w.x,
        z: w.z,
        heading: w.heading,
        stride: w.walking ? w.stride : null,
        seated: w.seated,
        // the teacher of the turn, in front of the class, waits for the user's answers
        bubble: t.id === this.inClass && !w.walking ? 'ask' : null,
      })
    }
    return out
  }

  /** The teacher of a person key (`teacher:<id>`). */
  teacherOf(key: string): Teacher | undefined {
    return key.startsWith('teacher:') ? TEACHERS.find((t) => `teacher:${t.id}` === key) : undefined
  }
}
