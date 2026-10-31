// Someone the game moves around: the player, an agent, a helper, a squad member. A Walker
// (position, heading, walk phase) plus what the 2D renderer draws of it: the pose, the
// floor it is on, its colours and its size; the renderer reads it each frame.

import type { Look } from '@shared/types'
import { Walker } from './walker'

export type Pose = 'stand' | 'sit' | 'type' | 'wave' | 'talk' | 'relax' | 'play'
export type Prop = 'none' | 'paper' | 'redPaper' | 'mug'

/** Company uniform: the shirt in the brand color. */
export interface Uniform {
  color: string
}

const SNAP = Math.PI / 4
/** Height of the name tag over the feet (tiles). */
const TAG_Y = 1.55

/** Where the name tag of an avatar floats: over its head, low while it is knocked out. */
class TagAnchor {
  constructor(private av: Avatar) {}
  get x(): number {
    return this.av.x
  }
  get y(): number {
    return this.av.isDown ? 0.4 : TAG_Y * this.av.scale
  }
  get z(): number {
    return this.av.z
  }
}

export class Avatar extends Walker {
  pose: Pose = 'stand'
  prop: Prop = 'none'
  /** 0 = the Casa, n = the nth project floor (or the study floor); it only shows on the floor on screen. */
  floor = 0
  /** Drawn at all (the floor on screen decides). */
  visible = true
  /** Drawn size: helpers are smaller, a leaving agent shrinks away. */
  scale = 1
  /** Where the name tag floats: over the head, low while knocked out. */
  readonly anchor = new TagAnchor(this)
  private uniform: Uniform | null = null
  /** Seconds of walk animation left from keyboard steering. */
  private steer = 0
  private hurt = 0
  /** Seconds since being knocked down, or -1 when standing. */
  private downT = -1

  constructor(
    public look: Look,
    readonly id: string,
  ) {
    super()
    this.speed = 3
  }

  /** Where it stands (tiles); writable, the keyboard steers the player through it. */
  get position(): { x: number; z: number } {
    return this
  }

  /** The colours it wears now: its look, with the company's shirt while in uniform. */
  get worn(): Look {
    return this.uniform ? { ...this.look, shirt: this.uniform.color } : this.look
  }

  setLook(look: Look): void {
    this.look = look
  }

  /** Dresses it in a company uniform; null puts its own clothes back. */
  setUniform(u: Uniform | null): void {
    this.uniform = u
  }

  setProp(prop: Prop): void {
    this.prop = prop
  }

  get isWalking(): boolean {
    return this.walking
  }

  /** Walking, or steered by the keys a moment ago. */
  get isStepping(): boolean {
    return this.walking || this.steer > 0
  }

  /** Walking, flinching or falling: the scene should draw at full rate (AO-29). */
  get isMoving(): boolean {
    return this.walking || this.steer > 0 || this.hurt > 0 || (this.downT >= 0 && this.downT < 0.4)
  }

  get isDown(): boolean {
    return this.downT >= 0
  }

  /** Flinches after being hit (the sprite shakes for a moment). */
  hitReact(): void {
    this.hurt = 0.3
  }

  /** A sideways shake (tiles) while it flinches. */
  get shake(): number {
    return this.hurt > 0 ? Math.sin(this.hurt * 60) * 0.06 : 0
  }

  /** Falls flat on the floor. */
  knockDown(): void {
    this.stop()
    this.downT = 0
  }

  getUp(): void {
    this.downT = -1
    this.pose = 'stand'
  }

  /** Animates walking while something else (keyboard) moves it. */
  phaseStep(dt: number): void {
    this.steer = 0.08
    this.stride += dt * this.speed * 3.2
  }

  placeAt(x: number, z: number): void {
    this.place(x, z)
  }

  stop(): void {
    this.place(this.x, this.z)
  }

  /** Points in tiles; it walks through them in order. */
  walk(points: { x: number; z: number }[], onArrive?: () => void): void {
    if (this.pose !== 'stand' && this.pose !== 'wave' && this.pose !== 'talk') this.pose = 'stand'
    super.walk(points, onArrive)
  }

  /** Faces a direction (0 = +z), snapped to 8 directions like Habbo. */
  face(angle: number, snap = true): void {
    this.heading = snap ? Math.round(angle / SNAP) * SNAP : angle
  }

  faceTowards(x: number, z: number, snap = true): void {
    const dx = x - this.x
    const dz = z - this.z
    if (Math.abs(dx) + Math.abs(dz) < 1e-4) return
    this.face(Math.atan2(dx, dz), snap)
  }

  update(dt: number): boolean {
    this.steer = Math.max(0, this.steer - dt)
    this.hurt = Math.max(0, this.hurt - dt)
    if (this.downT >= 0) this.downT += dt
    return super.update(dt)
  }
}
