import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPixelatedPass } from 'three/addons/postprocessing/RenderPixelatedPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { H, W } from './layout'

// 2:1 pixel-art isometric: 45° around Y, 30° above the floor.
const AZIMUTH = Math.PI / 4
const ELEVATION = Math.PI / 6
const ZOOMS = [0.55, 0.7, 0.85, 1, 1.25, 1.5, 1.8]
const BASE_VIEW = 15 // world units visible vertically at zoom 1

/** Linear to sRGB, then a little less saturation and a warm lift: the cozy, slightly faded palette. */
const PASTEL_OUTPUT = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 c = linearToOutputTexel(texture2D(tDiffuse, vUv));
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(vec3(l), c.rgb, 0.82);
      c.rgb = mix(c.rgb, vec3(1.0, 0.95, 0.86), 0.05);
      gl_FragColor = c;
    }`,
}

export class Engine {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera: THREE.OrthographicCamera
  private composer: EffectComposer
  private pixelPass: RenderPixelatedPass
  private raycaster = new THREE.Raycaster()
  private dir = new THREE.Vector3(Math.cos(ELEVATION) * Math.sin(AZIMUTH), Math.sin(ELEVATION), Math.cos(ELEVATION) * Math.cos(AZIMUTH))
  private zoomIndex = 3
  private zoom = 1
  private width = 1
  private height = 1
  pixelSize: number
  /** Where the camera wants to look; `focus` eases towards it. */
  readonly target = new THREE.Vector3(W / 2, 0, H / 2)
  private focus = new THREE.Vector3(W / 2, 0, H / 2)
  private sun: THREE.DirectionalLight
  /** Something changed that the last drawn frame does not show (resize, zoom, shadows). */
  dirty = true

  constructor(
    private container: HTMLElement,
    pixelSize: number,
  ) {
    this.pixelSize = pixelSize
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'default' })
    this.renderer.setPixelRatio(1)
    // off by default: painted light and the avatars' contact blobs do the job (Vídeo → Sombras turns it on)
    this.renderer.shadowMap.enabled = false
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.toneMapping = THREE.NoToneMapping
    container.appendChild(this.renderer.domElement)
    this.renderer.domElement.classList.add('world-canvas')

    // a dark, warm frame so the light diorama stands out
    this.scene.background = new THREE.Color('#231f26')
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200)

    // painted pixel-art light: warm sky fill + a sun mostly from above, a bit more from the
    // left (+z) than the right (+x), so tops read lightest and the two side faces step darker
    const hemi = new THREE.HemisphereLight('#fff8ec', '#8a8078', 2.2)
    this.scene.add(hemi)
    const sun = new THREE.DirectionalLight('#fff4e2', 2.3)
    sun.position.set(W / 2 + 7, 22, H / 2 + 12)
    sun.target.position.set(W / 2, 0, H / 2)
    sun.shadow.mapSize.set(1024, 1024)
    const s = 24
    Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 70 })
    sun.shadow.bias = -0.0008
    sun.shadow.normalBias = 0.02
    this.scene.add(sun, sun.target)
    this.sun = sun

    this.composer = new EffectComposer(this.renderer)
    // strong depth edges = the dark outline around every object; soft normal edges keep the bevels
    this.pixelPass = new RenderPixelatedPass(pixelSize, this.scene, this.camera, { normalEdgeStrength: 0.2, depthEdgeStrength: 0.9 })
    this.composer.addPass(this.pixelPass)
    // replaces OutputPass (same single full-screen draw): sRGB out plus a soft pastel grade
    this.composer.addPass(new ShaderPass(PASTEL_OUTPUT))

    new ResizeObserver(() => this.resize()).observe(container)
    this.resize()
  }

  setPixelSize(n: number): void {
    this.pixelSize = n
    this.pixelPass.setPixelSize(n)
    this.resize()
  }

  /**
   * Shadows on or off and their resolution, applied live. Turning the light's castShadow
   * changes the lights' hash, so three.js rebuilds the shaders that read the shadow map.
   */
  setShadows(on: boolean, size: number): void {
    const sun = this.sun
    if (sun.shadow.mapSize.x !== size) {
      sun.shadow.mapSize.set(size, size)
      sun.shadow.map?.dispose()
      sun.shadow.map = null
    }
    this.renderer.shadowMap.enabled = on
    sun.castShadow = on
    this.renderer.shadowMap.needsUpdate = true
    this.dirty = true
  }

  resize(): void {
    this.width = Math.max(1, this.container.clientWidth)
    this.height = Math.max(1, this.container.clientHeight)
    this.renderer.setSize(this.width, this.height)
    this.composer.setSize(this.width, this.height)
    this.updateProjection()
  }

  private updateProjection(): void {
    // Keep a whole number of screen pixels per art pixel.
    const view = BASE_VIEW / this.zoom
    const aspect = this.width / this.height
    this.camera.top = view / 2
    this.camera.bottom = -view / 2
    this.camera.left = (-view * aspect) / 2
    this.camera.right = (view * aspect) / 2
    this.camera.updateProjectionMatrix()
    this.dirty = true
  }

  zoomStep(delta: number): void {
    this.zoomIndex = Math.max(0, Math.min(ZOOMS.length - 1, this.zoomIndex + delta))
    this.zoom = ZOOMS[this.zoomIndex]
    this.updateProjection()
  }

  /** World units per art pixel, used to snap the camera and avoid shimmering. */
  private texel(): number {
    return BASE_VIEW / this.zoom / (this.height / this.pixelSize)
  }

  jumpTo(x: number, z: number): void {
    this.target.set(x, 0, z)
    this.focus.copy(this.target)
  }

  /** True while the camera still eases towards its target. */
  get moving(): boolean {
    return this.focus.distanceToSquared(this.target) > 1e-6
  }

  /** Eases the camera towards its target; no drawing. */
  step(dt: number): void {
    this.focus.lerp(this.target, 1 - Math.exp(-dt * 6))
    if (!this.moving) this.focus.copy(this.target)
    const pos = this.focus.clone().addScaledVector(this.dir, 60)
    this.camera.position.copy(pos)
    this.camera.lookAt(this.focus)
    // snap the camera to the art-pixel grid in view space
    const q = this.camera.quaternion.clone()
    const local = pos.clone().applyQuaternion(q.clone().invert())
    const t = this.texel()
    local.x = Math.round(local.x / t) * t
    local.y = Math.round(local.y / t) * t
    this.camera.position.copy(local.applyQuaternion(q))
    this.camera.updateMatrixWorld()
  }

  /** Draws one frame (the pixel pass and the output pass). */
  render(dt: number): void {
    this.composer.render(dt)
    this.dirty = false
  }

  /** CSS pixel position of a world point inside the container. */
  project(v: THREE.Vector3): { x: number; y: number } {
    const p = v.clone().project(this.camera)
    return { x: Math.round((p.x * 0.5 + 0.5) * this.width), y: Math.round((-p.y * 0.5 + 0.5) * this.height) }
  }

  private ndc(clientX: number, clientY: number): THREE.Vector2 {
    const r = this.renderer.domElement.getBoundingClientRect()
    return new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1)
  }

  /** Floor point under the cursor (y = 0 plane). */
  pickFloor(clientX: number, clientY: number): THREE.Vector3 | null {
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera)
    const hit = new THREE.Vector3()
    return this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit) ? hit : null
  }

  pick(clientX: number, clientY: number, objects: THREE.Object3D[]): THREE.Intersection[] {
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera)
    return this.raycaster.intersectObjects(objects, true)
  }

  /** Moves the camera target by a screen-space drag in CSS pixels. */
  pan(dx: number, dy: number): void {
    const worldPerPx = BASE_VIEW / this.zoom / this.height
    const right = new THREE.Vector3(1, 0, -1).normalize()
    const up = new THREE.Vector3(-1, 0, -1).normalize()
    // vertical screen motion covers more floor because the floor is foreshortened
    this.target.addScaledVector(right, -dx * worldPerPx)
    this.target.addScaledVector(up, (dy * worldPerPx) / Math.sin(ELEVATION))
    this.target.x = Math.max(-2, Math.min(W + 2, this.target.x))
    this.target.z = Math.max(-2, Math.min(H + 2, this.target.z))
  }
}
