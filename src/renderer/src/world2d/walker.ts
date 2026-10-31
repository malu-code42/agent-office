// Someone who walks on a 2D floor without a three.js avatar: a position, a heading and a
// walk phase. The study floor's teachers use it. Pure, so the tests check it.

export class Walker {
  x = 0
  z = 0
  /** Radians, 0 = towards +z (as Avatar.face). */
  heading = 0
  /** Walk phase; the sprite steps on its sign. */
  stride = 0
  /** Sitting on the chair under it. */
  seated = false
  /** Tiles per second. */
  speed = 2.6
  private path: { x: number; z: number }[] = []
  private onArrive: (() => void) | null = null

  get walking(): boolean {
    return this.path.length > 0
  }

  place(x: number, z: number, heading = this.heading): void {
    this.x = x
    this.z = z
    this.heading = heading
    this.path = []
    this.onArrive = null
  }

  /** Walks through the points in order (tiles); `then` runs on arrival. */
  walk(points: { x: number; z: number }[], then?: () => void): void {
    this.seated = false
    this.path = points.slice()
    this.onArrive = then ?? null
    if (!this.path.length) this.arrive()
  }

  private arrive(): void {
    const cb = this.onArrive
    this.onArrive = null
    cb?.()
  }

  /** Moves dt seconds along the path. True while it moved. */
  update(dt: number): boolean {
    if (!this.path.length) return false
    let left = this.speed * dt
    while (left > 0 && this.path.length) {
      const to = this.path[0]
      const dx = to.x - this.x
      const dz = to.z - this.z
      const d = Math.hypot(dx, dz)
      if (d > 1e-6) this.heading = Math.atan2(dx, dz)
      if (d <= left) {
        this.x = to.x
        this.z = to.z
        this.path.shift()
        left -= d
      } else {
        this.x += (dx / d) * left
        this.z += (dz / d) * left
        left = 0
      }
    }
    this.stride += dt * this.speed * 3.2
    if (!this.path.length) this.arrive()
    return true
  }
}
