import * as THREE from 'three'
import { emiAgentId } from '@shared/emi'
import { CASA_LAYOUT } from '../world2d/atlas'
import { zoneAt, type CasaAct } from '../world2d/casa'
import { studyZoneAt, type StudyAct } from '../world2d/estudos'
import type { HomeChair } from '../world/home-layout'
import { GameMovement } from './movement'
import { SKULL_HOME, type Point } from './types'

/** What the pointer over a clickable thing of the 2D Casa says. */
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
  cora: 'Cora · bibliotecária',
  bonnie: 'Bonnie · ciclo de estudo',
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
      this.hover.visible = false
      this.hover2d = null
      this.casaHot = null
      this.studyHot = null
      for (const interaction of this.office.interactions) interaction.highlight.visible = false
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
    const flat = this.flat
    if (flat) {
      const hit = flat.pick(x, y)
      if (hit?.kind !== 'person') return null
      if (hit.key.startsWith('helper:')) {
        const h = this.helpers.get(hit.key.slice('helper:'.length))
        return h ? { id: h.parentId, helper: h.id } : null
      }
      if (hit.key === 'emi') return this.currentProject ? { id: emiAgentId(this.currentProject.id) } : null
      if (hit.key === 'luna' || hit.key === 'cora' || hit.key === 'bonnie' || hit.key.startsWith('teacher:')) return null
      return this.actors.has(hit.key) ? { id: hit.key } : null
    }
    const view = this.player.floor
    const roots = [...this.actors.values()]
      .filter((a) => a.goal !== 'leave' && !a.down && a.avatar.floor === view)
      .map((a) => a.avatar.root)
    const helpers = [...this.helpers.values()].filter((h) => !h.gone && h.avatar.floor === view)
    for (const h of helpers) roots.push(h.avatar.root)
    for (const hit of this.engine.pick(x, y, roots)) {
      const id = hit.object.userData.avatarId as string | undefined
      if (!id) continue
      let o: THREE.Object3D | null = hit.object
      while (o && !helpers.some((h) => h.avatar.root === o)) o = o.parent
      const helper = o ? helpers.find((h) => h.avatar.root === o) : undefined
      return helper ? { id, helper: helper.id } : { id }
    }
    return null
  }

  protected click(x: number, y: number): void {
    if (this.flat && this.player.floor === 0 && this.clickCasa2d(x, y)) return
    if (this.flat && this.player.floor === this.studyFloor && this.clickStudy2d(x, y)) return
    if (this.onSkull(x, y)) {
      this.hooks.onSkull()
      return
    }
    if (this.onTv(x, y)) {
      this.hooks.onTv()
      return
    }
    const homeAction = this.homeActionAt(x, y)
    if (homeAction) {
      this.hooks.onHomeAction(homeAction)
      return
    }
    if (this.onTotem(x, y)) {
      this.hooks.onRoutines()
      return
    }
    const flat = this.flat
    const project = this.currentProject
    if (flat && project) {
      const hit = flat.pick(x, y)
      if (hit?.kind === 'room') {
        const room = this.upperOf(this.player.floor)?.scene.plan.rooms[hit.room]
        if (room) this.hooks.onRoomClick?.(project, room)
        return
      }
      if (hit?.kind === 'meeting') return this.hooks.onMeetingRoomClick?.(project)
      if (hit?.kind === 'elevator') {
        const door = this.elevatorOf(this.player.floor)
        this.walkPlayerTo([door.tile[0], door.tile[1] + 1])
        this.hooks.onElevator?.()
        return
      }
      if (hit?.kind === 'person' && hit.key.startsWith('member:')) return this.memberClick(hit.key.slice('member:'.length))
    } else if (this.player.floor > 0) {
      const roots = [...this.members.values()]
        .filter((m) => m.phase !== 'leaving' && m.avatar.floor === this.player.floor)
        .map((m) => m.avatar.root)
      const hit = this.engine.pick(x, y, roots).find((h) => String(h.object.userData.avatarId ?? '').startsWith('member:'))
      if (hit) return this.memberClick(String(hit.object.userData.avatarId).slice('member:'.length))
    }
    const hit = this.agentAt(x, y)
    if (hit) {
      this.hooks.onAgentClick(hit.id, hit.helper)
      return
    }
    const p = this.floorPoint(x, y)
    if (!p) return
    const tile: [number, number] = [Math.floor(p.x), Math.floor(p.z)]
    if (!this.floorOf(this.player.floor).grid.inside(tile[0], tile[1])) return
    this.walkPlayerTo(tile)
  }

  /**
   * A click on the 2D Casa: its furniture (the same flows as the 3D objects), Luna (her
   * conversation, or the review of the day when due) and the elevator door. False lets the
   * click go on to the agents and the floor.
   */
  private clickCasa2d(x: number, y: number): boolean {
    const hit = this.flat2d.pick(x, y)
    if (hit?.kind === 'person' && hit.key === 'luna') {
      this.hooks.onLunaReview()
      return true
    }
    if (hit?.kind === 'elevator') {
      const door = this.elevatorOf(0)
      this.walkPlayerTo([door.tile[0], door.tile[1] + 1])
      this.hooks.onElevator?.()
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
  private clickStudy2d(x: number, y: number): boolean {
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
      const door = this.elevatorOf(this.player.floor)
      this.walkPlayerTo([door.tile[0], door.tile[1] + 1])
      this.hooks.onElevator?.()
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
      p.face(chair.face, true, true)
      p.pose = 'sit'
    })
  }

  protected onTv(x: number, y: number): boolean {
    return !this.flat && this.player.floor === 0 && this.engine.pick(x, y, [this.office.tv.group]).length > 0
  }

  protected onTotem(x: number, y: number): boolean {
    return !this.flat && this.player.floor === 0 && this.engine.pick(x, y, [this.totem.view.group]).length > 0
  }

  /** Interactive furniture in the home routes to the matching existing app flow. */
  protected homeInteractionAt(x: number, y: number) {
    if (this.player.floor !== 0 || this.flat) return undefined
    const hit = this.engine.pick(
      x,
      y,
      this.office.interactions.map((item) => item.root),
    )[0]
    if (!hit) return undefined
    let root: THREE.Object3D | null = hit.object
    while (root && !this.office.interactions.some((item) => item.root === root)) root = root.parent
    return this.office.interactions.find((item) => item.root === root)
  }

  protected homeActionAt(x: number, y: number) {
    return this.homeInteractionAt(x, y)?.action
  }

  protected onSkull(x: number, y: number): boolean {
    return !this.flat && this.player.floor === 0 && this.engine.pick(x, y, [this.skull.root]).length > 0
  }

  setTvOn(on: boolean): void {
    this.office.tv.setOn(on)
  }

  /**
   * Where the TV screen is on the page (top-left, top-right, bottom-left), or null
   * when its floor is not on screen. Valid after the frame rendered.
   */
  tvCorners(): [Point, Point, Point] | null {
    if (this.player.floor !== 0) return null
    const flat = this.flat
    if (flat) {
      const [tl, tr, bl] = CASA_LAYOUT.tv.map(([ax, ay, h]) => flat.project(ax / 16, h / 16, ay / 16))
      return [tl, tr, bl]
    }
    const { screen, size } = this.office.tv
    const at = (x: number, y: number) => this.engine.project(screen.localToWorld(new THREE.Vector3(x, y, 0)))
    return [at(-size.w / 2, size.h / 2), at(size.w / 2, size.h / 2), at(-size.w / 2, -size.h / 2)]
  }

  /** The floor point under the pointer, in tiles, in the world on screen. */
  protected floorPoint(x: number, y: number): { x: number; z: number } | null {
    const flat = this.flat
    return flat ? flat.floorAt(x, y) : this.engine.pickFloor(x, y)
  }

  /** Drags the camera: the 3D one, or the 2D floor's (kept on the floor). */
  protected pan(dx: number, dy: number): void {
    const flat = this.flat
    if (!flat) return this.engine.pan(dx, dy)
    const d = flat.panBy(dx, dy)
    const [w, h] = this.floorSize(this.player.floor)
    const t = this.engine.target
    t.x = Math.max(0, Math.min(w, t.x + d.x))
    t.z = Math.max(0, Math.min(h, t.z + d.z))
  }

  protected updateHover(x: number, y: number): void {
    const flat = this.flat
    if (flat) {
      const grid = this.floorOf(this.player.floor).grid
      const p = flat.floorAt(x, y)
      const over = flat.pick(x, y)
      const tx = p ? Math.floor(p.x) : -1
      const tz = p ? Math.floor(p.z) : -1
      this.hover2d = !over && grid.inside(tx, tz) ? { x: tx, z: tz, ok: grid.walkable(tx, tz) } : null
      document.body.style.cursor = over ? 'pointer' : ''
      // the Casa has no plates on the floor: the name of the place (or what a click does) on hover
      if (this.player.floor === 0) {
        this.casaHot = over?.kind === 'casa' ? over.act : null
        const title = this.casaHot
          ? CASA_TITLES[this.casaHot]
          : over?.kind === 'person' && over.key === 'luna'
            ? 'Luna'
            : over?.kind === 'elevator'
              ? 'Elevador'
              : over || !grid.inside(tx, tz)
                ? ''
                : (zoneAt(CASA_LAYOUT, tx, tz) ?? '')
        if (flat.canvas.title !== title) flat.canvas.title = title
      } else if (this.player.floor === this.studyFloor) {
        // the study floor has no plates either: names and what a click does on hover
        this.studyHot = over?.kind === 'study' ? over.act : null
        const teacher = over?.kind === 'person' ? this.study.teacherOf(over.key) : undefined
        const title = this.studyHot
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
        if (flat.canvas.title !== title) flat.canvas.title = title
      } else if (flat.canvas.title) flat.canvas.title = ''
      return
    }
    const homeInteraction = this.homeInteractionAt(x, y)
    for (const interaction of this.office.interactions) interaction.highlight.visible = interaction === homeInteraction
    const p = this.engine.pickFloor(x, y)
    const grid = this.floorOf(this.player.floor).grid
    if (!p || !grid.inside(Math.floor(p.x), Math.floor(p.z)) || this.agentAt(x, y)) {
      this.hover.visible = false
      document.body.style.cursor = this.agentAt(x, y) ? 'pointer' : ''
      return
    }
    if (homeInteraction || this.onSkull(x, y) || this.onTotem(x, y)) {
      this.hover.visible = false
      document.body.style.cursor = 'pointer'
      return
    }
    document.body.style.cursor = ''
    const tx = Math.floor(p.x)
    const tz = Math.floor(p.z)
    this.hover.visible = true
    this.hover.position.set(tx, 0, tz)
    ;(this.hover.material as THREE.LineBasicMaterial).color.set(grid.walkable(tx, tz) ? '#ffffff' : '#ff8a80')
  }

  // ---------- guided tour ----------

  /** Spots of the ground floor the tour shows; null for one that does not exist (yet). */
  tourSpot(id: string): THREE.Vector3 | null {
    if (this.visual === '2d') {
      const at = (name: string) => {
        const t = CASA_LAYOUT.tags[name]
        return new THREE.Vector3(t[0] / 16, 1, t[1] / 16)
      }
      const home = this.home
      if (id === 'desk') return new THREE.Vector3(home.boss.x, 1, home.boss.z)
      if (id === 'team') return new THREE.Vector3(home.table.x, 1, home.table.z)
      if (id === 'skull') return at('Caveira')
      if (id === 'tv') return at('Claude FM')
      return null
    }
    switch (id) {
      case 'desk':
        return new THREE.Vector3(5, 1, 5.6)
      case 'team':
        return new THREE.Vector3(13.1, 1, 18.5)
      case 'skull':
        return new THREE.Vector3(SKULL_HOME.x, 1, SKULL_HOME.z)
      case 'tv':
        return this.office.tv.screen.getWorldPosition(new THREE.Vector3())
      default:
        return null
    }
  }

  /** The tour points the camera at a spot of the ground floor; `instant` jumps there (reduced motion). */
  lookAtSpot(id: string, instant: boolean): void {
    const p = this.tourSpot(id)
    if (!p) return
    this.goFloor(0)
    // after goFloor, which hands the camera back to the player
    this.follow = false
    this.watch = null
    if (instant) this.engine.jumpTo(p.x, p.z)
    else this.engine.target.set(p.x, 0, p.z)
    this.wake(1500)
  }

  /** Where a tour spot is on the page, or null when the ground floor is not on screen. */
  spotOnPage(id: string): Point | null {
    const p = this.player.floor === 0 ? this.tourSpot(id) : null
    if (!p) return null
    return this.flat ? this.flat.project(p.x, p.y, p.z) : this.engine.project(p)
  }

  /** The camera follows the player again (the tour ended). */
  followPlayer(): void {
    this.follow = true
    this.wake(1500)
  }

  setPixelSize(n: number): void {
    this.engine.setPixelSize(n)
  }

  zoom(delta: number): void {
    const flat = this.flat
    if (flat) flat.zoomStep(delta)
    else this.engine.zoomStep(delta)
  }
}
