import { emiAgentId } from '@shared/emi'
import { CASA_LAYOUT } from '../world2d/atlas'
import { zoneAt, type CasaAct } from '../world2d/casa'
import { studyZoneAt, type StudyAct } from '../world2d/estudos'
import type { HomeChair } from '../world2d/home-layout'
import { GameMovement } from './movement'
import type { Point } from './types'

/** What the pointer over a clickable thing of the Casa says. */
const CASA_TITLES: Record<CasaAct, string> = {
  agenda: 'Abrir Agenda',
  goals: 'Abrir Objetivos',
  'personal-routines': 'Abrir Rotinas pessoais',
  books: 'Abrir Livros',
  films: 'Abrir Filmes',
  games: 'Abrir Jogos',
  writing: 'Abrir Escrita',
  radio: 'Ligar ou desligar a Claude FM',
  skull: 'Caveira: dispensar um agente',
  totem: 'Rotinas de agentes',
  computer: 'Novo agente',
}

/** What the pointer over a clickable thing of the study floor says. */
const STUDY_TITLES: Record<StudyAct, string> = {
  library: 'Biblioteca: pesquisar com a Cora',
  cycle: 'Tópico atual: abrir o ciclo de estudo',
  desk: 'Sua carteira: sentar e estudar',
  questions: 'Banco de questões',
  cards: 'Notas e cartões',
  schedule: 'Horário de aula',
  trail: 'Trilha de estudos: escolher o tópico',
  cora: 'Cora · bibliotecária',
  bonnie: 'Bonnie · conversar sobre os estudos',
}

/** Camera and input: keys, drag to pan, wheel to zoom, clicks and the hover outline. */
export abstract class GameInput extends GameMovement {
  // ---------- input ----------

  protected bindInput(el: HTMLElement): void {
    const isTyping = () => {
      const a = document.activeElement
      return a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || a instanceof HTMLSelectElement
    }
    window.addEventListener('keydown', (e) => {
      if (isTyping() || e.metaKey || e.ctrlKey) return
      const k = e.key.toLowerCase()
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        this.keys.add(k)
        e.preventDefault()
      }
    })
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()))
    window.addEventListener('blur', () => this.keys.clear())

    // any touch on the scene draws at full rate for a moment (hover outline, drag, zoom)
    for (const type of ['pointermove', 'pointerdown', 'pointerup', 'pointerleave', 'wheel'] as const)
      el.addEventListener(type, () => this.wake(), { passive: true })
    window.addEventListener('keydown', () => this.wake())

    el.addEventListener('contextmenu', (e) => e.preventDefault())
    el.addEventListener('pointerdown', (e) => {
      this.dragging = { x: e.clientX, y: e.clientY, moved: false, button: e.button }
      el.setPointerCapture(e.pointerId)
    })
    el.addEventListener('pointermove', (e) => {
      if (this.dragging) {
        const dx = e.clientX - this.dragging.x
        const dy = e.clientY - this.dragging.y
        if (this.dragging.moved || Math.hypot(dx, dy) > 5) {
          this.dragging.moved = true
          this.follow = false
          this.watch = null
          this.pan(dx, dy)
          this.dragging.x = e.clientX
          this.dragging.y = e.clientY
        }
      }
      this.updateHover(e.clientX, e.clientY)
    })
    el.addEventListener('pointerup', (e) => {
      const d = this.dragging
      this.dragging = null
      if (!d || d.moved || d.button !== 0) return
      this.click(e.clientX, e.clientY)
    })
    el.addEventListener('pointerleave', () => {
      this.hover2d = null
      this.casaHot = null
      this.studyHot = null
      document.body.style.cursor = ''
    })
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault()
        this.wheelAcc += e.deltaY
        if (Math.abs(this.wheelAcc) > 40) {
          this.zoom(this.wheelAcc > 0 ? -1 : 1)
          this.wheelAcc = 0
        }
      },
      { passive: false },
    )
  }

  /** Helpers answer with their parent's id, plus their own in `helper`. */
  protected agentAt(x: number, y: number): { id: string; helper?: string } | null {
    const hit = this.flat2d.pick(x, y)
    if (hit?.kind !== 'person') return null
    if (hit.key.startsWith('helper:')) {
      const h = this.helpers.get(hit.key.slice('helper:'.length))
      return h ? { id: h.parentId, helper: h.id } : null
    }
    if (hit.key === 'emi') return this.currentProject ? { id: emiAgentId(this.currentProject.id) } : null
    return this.actors.has(hit.key) ? { id: hit.key } : null
  }

  protected click(x: number, y: number): void {
    if (this.player.floor === 0 && this.clickCasa(x, y)) return
    if (this.player.floor === this.studyFloor && this.clickStudy(x, y)) return
    const project = this.currentProject
    if (project) {
      const hit = this.flat2d.pick(x, y)
      if (hit?.kind === 'room') {
        const room = this.upperOf(this.player.floor)?.scene.plan.rooms[hit.room]
        if (room) this.hooks.onRoomClick?.(project, room)
        return
      }
      if (hit?.kind === 'meeting') return this.hooks.onMeetingRoomClick?.(project)
      if (hit?.kind === 'elevator') return this.toElevator()
      if (hit?.kind === 'person' && hit.key.startsWith('member:')) return this.memberClick(hit.key.slice('member:'.length))
    }
    const hit = this.agentAt(x, y)
    if (hit) {
      this.hooks.onAgentClick(hit.id, hit.helper)
      return
    }
    const p = this.flat2d.floorAt(x, y)
    if (!p) return
    const tile: [number, number] = [Math.floor(p.x), Math.floor(p.z)]
    if (!this.floorOf(this.player.floor).grid.inside(tile[0], tile[1])) return
    this.walkPlayerTo(tile)
  }

  /** The player walks to the elevator door of the floor it is on, and the Elevator panel takes the focus. */
  private toElevator(): void {
    const door = this.elevatorOf(this.player.floor)
    this.walkPlayerTo([door.tile[0], door.tile[1] + 1])
    this.hooks.onElevator?.()
  }

  /**
   * A click on the Casa: its furniture, Luna (her conversation, or the review of the day when
   * due) and the elevator door. False lets the click go on to the agents and the floor.
   */
  private clickCasa(x: number, y: number): boolean {
    const hit = this.flat2d.pick(x, y)
    if (hit?.kind === 'person' && hit.key === 'luna') {
      this.hooks.onLunaReview()
      return true
    }
    if (hit?.kind === 'elevator') {
      this.toElevator()
      return true
    }
    if (hit?.kind !== 'casa') return false
    const act = hit.act
    if (act === 'skull') this.hooks.onSkull()
    else if (act === 'totem') this.hooks.onRoutines()
    else if (act === 'computer') this.hooks.onComputer()
    else if (act === 'radio') this.hooks.onTv()
    else this.hooks.onHomeAction(act)
    return true
  }

  /**
   * A click on the study floor: Cora, Bonnie, a teacher (the study cycle), the furniture
   * (library, blackboard, the user's desk, question bank, notes and cards, class schedule)
   * and the elevator door. False lets the click go on to the agents and the floor.
   */
  private clickStudy(x: number, y: number): boolean {
    const hit = this.flat2d.pick(x, y)
    if (hit?.kind === 'person') {
      if (hit.key === 'cora' || hit.key === 'bonnie') {
        this.hooks.onStudy?.(hit.key)
        return true
      }
      const teacher = this.study.teacherOf(hit.key)
      if (teacher) {
        this.hooks.onStudy?.('cycle', teacher)
        return true
      }
      return false
    }
    if (hit?.kind === 'elevator') {
      this.toElevator()
      return true
    }
    if (hit?.kind !== 'study') return false
    // the user's desk: the player sits down to study, and the cycle opens
    if (hit.act === 'desk') this.sitPlayerOn(this.study.plan.student)
    this.hooks.onStudy?.(hit.act)
    return true
  }

  /** The player walks to a chair of the floor it is on and sits there. */
  protected sitPlayerOn(chair: HomeChair): void {
    const p = this.player
    this.follow = true
    this.route(p, [Math.floor(chair.x), Math.floor(chair.z)], chair, () => {
      p.placeAt(chair.x, chair.z)
      p.face(chair.face)
      p.pose = 'sit'
    })
  }

  /**
   * Where the Claude FM screen is on the page (top-left, top-right, bottom-left), or null
   * when the Casa is not on screen. Valid after the frame rendered.
   */
  tvCorners(): [Point, Point, Point] | null {
    if (this.player.floor !== 0) return null
    const [tl, tr, bl] = CASA_LAYOUT.tv.map(([ax, ay, h]) => this.flat2d.project(ax / 16, h / 16, ay / 16))
    return [tl, tr, bl]
  }

  /** Drags the camera, kept on the floor. */
  protected pan(dx: number, dy: number): void {
    const d = this.flat2d.panBy(dx, dy)
    const [w, h] = this.floorSize(this.player.floor)
    const t = this.target
    t.x = Math.max(0, Math.min(w, t.x + d.x))
    t.z = Math.max(0, Math.min(h, t.z + d.z))
  }

  protected updateHover(x: number, y: number): void {
    const flat = this.flat2d
    const grid = this.floorOf(this.player.floor).grid
    const p = flat.floorAt(x, y)
    const over = flat.pick(x, y)
    const tx = p ? Math.floor(p.x) : -1
    const tz = p ? Math.floor(p.z) : -1
    this.hover2d = !over && grid.inside(tx, tz) ? { x: tx, z: tz, ok: grid.walkable(tx, tz) } : null
    document.body.style.cursor = over ? 'pointer' : ''
    let title: string
    // the Casa has no plates on the floor: the name of the place (or what a click does) on hover
    if (this.player.floor === 0) {
      this.casaHot = over?.kind === 'casa' ? over.act : null
      title = this.casaHot
        ? CASA_TITLES[this.casaHot]
        : over?.kind === 'person' && over.key === 'luna'
          ? 'Luna'
          : over?.kind === 'elevator'
            ? 'Elevador'
            : over || !grid.inside(tx, tz)
              ? ''
              : (zoneAt(CASA_LAYOUT, tx, tz) ?? '')
    } else if (this.player.floor === this.studyFloor) {
      // the study floor has no plates either: names and what a click does on hover
      this.studyHot = over?.kind === 'study' ? over.act : null
      const teacher = over?.kind === 'person' ? this.study.teacherOf(over.key) : undefined
      title = this.studyHot
        ? STUDY_TITLES[this.studyHot]
        : teacher
          ? `${teacher.name} · ${teacher.role}`
          : over?.kind === 'person' && (over.key === 'cora' || over.key === 'bonnie')
            ? STUDY_TITLES[over.key]
            : over?.kind === 'elevator'
              ? 'Elevador'
              : over || !grid.inside(tx, tz)
                ? ''
                : (studyZoneAt(this.study.layout, tx, tz) ?? '')
    } else {
      // a project floor has no plates either: the room under the pointer names itself
      title = over?.kind === 'person' ? '' : (flat.roomAt(x, y) ?? '')
    }
    if (flat.canvas.title !== title) flat.canvas.title = title
  }

  // ---------- guided tour ----------

  /** Spots of the ground floor the tour shows (tiles, y = height); null for one that does not exist. */
  tourSpot(id: string): { x: number; y: number; z: number } | null {
    const at = (name: string) => {
      const t = CASA_LAYOUT.tags[name]
      return { x: t[0] / 16, y: 1, z: t[1] / 16 }
    }
    const home = this.home
    if (id === 'desk') return { x: home.boss.x, y: 1, z: home.boss.z }
    if (id === 'team') return { x: home.table.x, y: 1, z: home.table.z }
    if (id === 'skull') return at('Caveira')
    if (id === 'tv') return at('Claude FM')
    return null
  }

  /** The tour points the camera at a spot of the ground floor; `instant` jumps there (reduced motion). */
  lookAtSpot(id: string, instant: boolean): void {
    const p = this.tourSpot(id)
    if (!p) return
    this.goFloor(0)
    // after goFloor, which hands the camera back to the player
    this.follow = false
    this.watch = null
    if (instant) this.jumpTo(p.x, p.z)
    else this.target.set(p.x, 0, p.z)
    this.wake(1500)
  }

  /** Where a tour spot is on the page, or null when the ground floor is not on screen. */
  spotOnPage(id: string): Point | null {
    const p = this.player.floor === 0 ? this.tourSpot(id) : null
    return p ? this.flat2d.project(p.x, p.y, p.z) : null
  }

  /** The camera follows the player again (the tour ended). */
  followPlayer(): void {
    this.follow = true
    this.wake(1500)
  }

  zoom(delta: number): void {
    this.flat2d.zoomStep(delta)
  }
}
