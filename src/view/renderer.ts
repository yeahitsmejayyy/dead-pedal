/**
 * L3 — the projection. `render(previous, current, alpha)` and nothing else.
 *
 * Contract 4: the view is a projection, not a source of truth. Nothing in here
 * writes to a `WorldState`, and nothing the sim needs is stored here.
 */
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  GridHelper,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
} from 'three'
import { lerp, lerpAngle } from '../core/scalar'
import { tuningFor } from '../content/vehicles'
import { apexOf, headingOf, isAlive, type Arena, type Ramp, type WorldState } from '../sim'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { ChaseCamera, type CameraTuning } from './camera'
import { Effects } from './effects'
import { HealthBars } from './healthBars'
import { VehicleView } from './vehicleView'
import { loadCarModels, modelsReady } from './carModels'
import { liveryOf } from './palette'

const GROUND = new MeshStandardMaterial({ color: 0x272d36, roughness: 1 })
const WALL = new MeshStandardMaterial({ color: 0x2a323c, roughness: 0.8 })
const BLOCK = new MeshStandardMaterial({ color: 0x4c5666, roughness: 0.75 })
const RAMP = new MeshStandardMaterial({ color: 0x6b5a3e, roughness: 0.85 })
/**
 * Boost chevrons, painted up a ramp's short back incline.
 *
 * These replace a hazard stripe that used to stand on the ramp's vertical back
 * face. That stripe was a warning about a wall; these are an instruction to
 * drive at it. Deliberately the same orange — the colour already means "this
 * end launches you", and only the shape needed to change.
 *
 * Emissive is about twice the old stripe's, because this is a centimetre of
 * paint lying flat where that was three and a half metres of wall standing up,
 * and a decal facing the sky washes out under the hemisphere light otherwise.
 */
const BOOST = new MeshStandardMaterial({
  color: 0xff8c1a,
  roughness: 0.45,
  emissive: 0x7a3200,
})

/** Metres the arrows float above the incline, measured along its normal. */
const CHEVRON_LIFT = 0.04
/** Arrows per incline. */
const CHEVRONS = 3
/** Fraction of each arrow's slot left empty, so that three read as three. */
const CHEVRON_GAP = 0.34

type Corner = readonly [number, number, number]

function triangles(vertices: number[]): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3))
  // Non-indexed, so no vertex is shared between faces and `computeVertexNormals`
  // gives flat shading — which is what puts a hard crease on the ridge.
  geometry.computeVertexNormals()
  return geometry
}

/**
 * A ramp's solid, in its own frame.
 *
 * Built from loose triangles rather than by shearing a box, because a box has
 * no vertex row at the ridge — and subdividing one to get a row would share it
 * between both slopes, averaging the crease away into a soft dome.
 *
 * Exact by construction rather than by a copied formula: `rampHeightAt` and
 * this are both piecewise linear in `along` with breakpoints at the same three
 * places, so agreeing at those three is agreeing everywhere. The ridge position
 * comes from `apexOf`, the same function the sim uses.
 */
function wedgeGeometry(ramp: Ramp): BufferGeometry {
  const { x: hx, z: hz } = ramp.halfExtents
  const apex = apexOf(ramp)

  const bl: Corner = [-hx, 0, -hz] // back edge, on the ground
  const br: Corner = [hx, 0, -hz]
  const al: Corner = [-hx, ramp.rise, apex] // the ridge
  const ar: Corner = [hx, ramp.rise, apex]
  const fl: Corner = [-hx, 0, hz] // the boost edge, back on the ground
  const fr: Corner = [hx, 0, hz]

  const v: number[] = []
  const tri = (a: Corner, b: Corner, c: Corner): void => void v.push(...a, ...b, ...c)
  const quad = (a: Corner, b: Corner, c: Corner, d: Corner): void => {
    tri(a, b, c)
    tri(a, c, d)
  }

  quad(bl, al, ar, br) // the long approach
  quad(al, fl, fr, ar) // the short boost incline
  quad(bl, br, fr, fl) // underside, so the solid closes
  // Both flanks are triangles, not pentagons: the profile is on the ground at
  // each end, so there is nothing left to close above them.
  tri(br, ar, fr)
  tri(bl, fl, al)

  return triangles(v)
}

/** One arrow, lying flat in XZ with its tip at the origin and arms toward +Z. */
function chevronGeometry(halfWidth: number, sweep: number, thickness: number): BufferGeometry {
  const tip: Corner = [0, 0, 0]
  const innerTip: Corner = [0, 0, thickness]
  const outerL: Corner = [-halfWidth, 0, sweep]
  const innerL: Corner = [-halfWidth, 0, sweep + thickness]
  const outerR: Corner = [halfWidth, 0, sweep]
  const innerR: Corner = [halfWidth, 0, sweep + thickness]

  const v: number[] = []
  const tri = (a: Corner, b: Corner, c: Corner): void => void v.push(...a, ...b, ...c)
  // Fanned from the tip as two convex halves. The outline is concave at
  // `innerTip`, so a naive triangulation would fill the notch back in.
  tri(tip, outerL, innerL)
  tri(tip, innerL, innerTip)
  tri(tip, innerTip, innerR)
  tri(tip, innerR, outerR)

  return triangles(v)
}

export class Renderer {
  readonly renderer: WebGLRenderer
  readonly scene: Scene
  readonly chase: ChaseCamera
  readonly effects: Effects
  readonly healthBars: HealthBars

  private readonly views = new Map<number, VehicleView>()
  private readonly canvas: HTMLCanvasElement

  constructor(canvas: HTMLCanvasElement, arena: Arena, cameraTuning?: CameraTuning) {
    this.canvas = canvas

    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    // PLAN.md §6: cap devicePixelRatio at 2.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true

    this.scene = new Scene()
    this.scene.background = new Color(0x0b0d10)

    this.chase = new ChaseCamera(canvas.clientWidth / canvas.clientHeight, cameraTuning)

    // Fire and forget. The game starts on its procedural boxes and each view
    // swaps itself the frame after its model lands — 2.7MB of geometry is not
    // worth a loading screen on a game that is playable without it.
    void loadCarModels()

    this.buildArena(arena)
    this.effects = new Effects(this.scene)
    this.healthBars = new HealthBars(this.scene)
    this.resize()
  }

  private buildArena(arena: Arena): void {
    // Two realtime lights, the budget in PLAN.md §6.
    this.scene.add(new HemisphereLight(0x9fb4cc, 0x1a1a20, 1.1))

    const sun = new DirectionalLight(0xfff2df, 1.5)
    sun.position.set(60, 120, 40)
    sun.castShadow = true
    sun.shadow.mapSize.set(1024, 1024)
    const span = 60
    sun.shadow.camera.left = -span
    sun.shadow.camera.right = span
    sun.shadow.camera.top = span
    sun.shadow.camera.bottom = -span
    sun.shadow.camera.far = 400
    this.scene.add(sun)

    const { x: hx, z: hz } = arena.halfExtents

    // Deliberately far larger than the arena. The camera sits outside the walls
    // whenever the car is against one, and a floor that stopped at the wall left
    // the near ground reading as a void.
    const floor = new Mesh(new PlaneGeometry(hx * 8, hz * 8), GROUND)
    floor.rotation.x = -Math.PI / 2
    floor.position.y = arena.groundY
    floor.receiveShadow = true
    this.scene.add(floor)

    // The grid is the speed reference. Without it a flat plane gives your eye
    // nothing to measure against and every handling judgement is guesswork —
    // which is why it covers more than the playable area.
    const grid = new GridHelper(hx * 4, Math.round((hx * 4) / 5), 0x76889d, 0x495566)
    grid.position.y = arena.groundY + 0.02
    this.scene.add(grid)

    // The arena's static geometry is merged per material rather than added
    // mesh by mesh. Fifteen boxes that never move and never change colour were
    // fifteen draw calls, doubled again for the ones that cast — and PLAN.md §6
    // budgets 100 for the whole frame, which the game was already exceeding at
    // 104 in ordinary play. Merging is worth 21 of those and changes nothing
    // you can see: same geometry, same material, same shadows.
    const wallParts: BufferGeometry[] = []
    for (const sx of [-1, 1]) {
      const side = new BoxGeometry(1, arena.wallHeight, hz * 2)
      side.translate(sx * hx, arena.groundY + arena.wallHeight / 2, 0)
      wallParts.push(side)
    }
    for (const sz of [-1, 1]) {
      const end = new BoxGeometry(hx * 2, arena.wallHeight, 1)
      end.translate(0, arena.groundY + arena.wallHeight / 2, sz * hz)
      wallParts.push(end)
    }
    const walls = mergeGeometries(wallParts, false)
    if (walls !== null) {
      const mesh = new Mesh(walls, WALL)
      mesh.receiveShadow = true
      this.scene.add(mesh)
    }

    // ── blocks and ramps, built from the collision data itself ───────────────
    // Not "kept in sync with" — built from. There is no second source that
    // could drift, which is the whole reason the arena is data and not a mesh.
    const blockParts: BufferGeometry[] = []
    for (const block of arena.blocks) {
      const box = new BoxGeometry(
        block.halfExtents.x * 2,
        block.halfExtents.y * 2,
        block.halfExtents.z * 2,
      )
      box.rotateY(-block.yaw)
      box.translate(block.pos.x, block.pos.y + block.halfExtents.y, block.pos.z)
      blockParts.push(box)
    }
    const blocks = mergeGeometries(blockParts, false)
    if (blocks !== null) {
      const mesh = new Mesh(blocks, BLOCK)
      mesh.castShadow = true
      mesh.receiveShadow = true
      this.scene.add(mesh)
    }

    // Every ramp's chevrons, merged into one mesh: one draw call for the lot.
    const chevronParts: BufferGeometry[] = []

    const rampParts: BufferGeometry[] = []

    for (const ramp of arena.ramps) {
      // Baked into world space and merged with the others rather than placed as
      // its own mesh, for the same reason as the walls and blocks above. Three
      // ramps that never move were six draw calls with the shadow pass.
      const wedge = wedgeGeometry(ramp)
      wedge.rotateY(-ramp.yaw)
      wedge.translate(ramp.pos.x, ramp.pos.y, ramp.pos.z)
      rampParts.push(wedge)

      // Arrows up the boost incline. This side used to be a wall you hit by
      // accident; it is a ramp you should want to aim for, and nothing about a
      // bare slope says so on its own.
      //
      // Up-slope is local -Z — the surface falls from the ridge toward +halfZ —
      // so the arrows point that way.
      const run = Math.hypot(ramp.backRun, ramp.rise) // on-slope length
      const pitch = Math.atan2(ramp.rise, ramp.backRun)

      // Sized from the slope rather than from constants, so a shorter incline
      // gets smaller arrows instead of arrows hanging off the end of it.
      const slot = run / CHEVRONS
      const length = slot * (1 - CHEVRON_GAP)
      const thickness = length * 0.38
      const sweep = length - thickness
      const halfWidth = Math.min(ramp.halfExtents.x * 0.55, sweep * 2.6)

      for (let i = 0; i < CHEVRONS; i++) {
        // Distance up the incline, from its bottom edge to this arrow's centre.
        const s = slot * (i + 0.5)

        const chevron = chevronGeometry(halfWidth, sweep, thickness)
        chevron.translate(0, 0, -length / 2) // centre it; the tip now leads
        // `rotateX(pitch)` carries the template's (0,1,0) onto the incline's own
        // normal, so the tilt and the lift below agree by construction.
        chevron.rotateX(pitch)
        chevron.translate(
          0,
          s * Math.sin(pitch) + CHEVRON_LIFT * Math.cos(pitch),
          ramp.halfExtents.z - s * Math.cos(pitch) + CHEVRON_LIFT * Math.sin(pitch),
        )
        // World space from here, same convention the wedge mesh is placed with.
        chevron.rotateY(-ramp.yaw)
        chevron.translate(ramp.pos.x, ramp.pos.y, ramp.pos.z)
        chevronParts.push(chevron)
      }
    }

    const ramps = mergeGeometries(rampParts, false)
    if (ramps !== null) {
      const mesh = new Mesh(ramps, RAMP)
      mesh.castShadow = true
      mesh.receiveShadow = true
      this.scene.add(mesh)
    }

    if (chevronParts.length > 0) {
      const chevrons = mergeGeometries(chevronParts, false)
      // No shadow: this is paint on a surface, and a coplanar caster is just
      // shadow acne on the thing it is painted on.
      if (chevrons !== null) this.scene.add(new Mesh(chevrons, BOOST))
    }
  }

  /** True once the car models have loaded. The visual test waits on this. */
  modelsLoaded(): boolean {
    return modelsReady()
  }

  /** Dev probe: how far the player's wheels have rotated. */
  wheelSpin(id: number): number {
    return this.views.get(id)?.spin() ?? 0
  }

  /**
   * Drop every cached vehicle view so they rebuild on the next frame.
   *
   * Views bake their livery at construction, and the arena is already rendering
   * behind the menus — so by the time the player picks a car, all four views
   * exist wearing the default mapping. Without this the choice would not take
   * effect until something else happened to rebuild them, which is to say
   * never.
   */
  /** Play the arrival shot. See `ChaseCamera.playIntro`. */
  playIntro(seconds: number): void {
    this.chase.playIntro(seconds)
  }

  restyle(): void {
    for (const view of this.views.values()) this.scene.remove(view.root)
    this.views.clear()
  }

  private viewFor(id: number, archetype: string): VehicleView {
    let view = this.views.get(id)
    if (view === undefined) {
      view = new VehicleView(tuningFor(archetype), liveryOf(id))
      this.views.set(id, view)
      this.scene.add(view.root)
    }
    return view
  }

  resize(): void {
    const width = this.canvas.clientWidth
    const height = this.canvas.clientHeight
    if (width === 0 || height === 0) return
    this.renderer.setSize(width, height, false)
    this.chase.resize(width / height)
  }

  /**
   * @param previous the state before the last sim step
   * @param current  the state after it
   * @param alpha    fraction between the two, from the fixed-step clock
   * @param dt       real seconds since the last frame — camera smoothing only
   */
  render(
    previous: WorldState,
    current: WorldState,
    alpha: number,
    dt: number,
    followId: number,
    lookBack: boolean,
  ): void {
    for (const vehicle of current.vehicles) {
      const before = previous.vehicles.find((v) => v.id === vehicle.id) ?? vehicle
      const view = this.viewFor(vehicle.id, vehicle.archetype)
      view.adoptModel()

      // A wreck is simply not drawn. Debris and a burning shell are M7 juice;
      // what M3 needs is for the destroyed car to stop being there.
      view.root.visible = isAlive(vehicle)
      if (!isAlive(vehicle)) continue

      const x = lerp(before.pos.x, vehicle.pos.x, alpha)
      const y = lerp(before.pos.y, vehicle.pos.y, alpha)
      const z = lerp(before.pos.z, vehicle.pos.z, alpha)
      const yaw = lerpAngle(before.yaw, vehicle.yaw, alpha)

      view.set(
        x,
        y,
        z,
        yaw,
        vehicle.forwardSpeed,
        vehicle.lateralSpeed,
        vehicle.vel.y,
        dt,
      )

      if (vehicle.id === followId) {
        const speed = Math.hypot(vehicle.vel.x, vehicle.vel.z)
        this.chase.update(
          {
            x,
            y,
            z,
            yaw,
            headingYaw: speed > 2 ? headingOf(vehicle.vel.x, vehicle.vel.z) : null,
            speed: vehicle.forwardSpeed,
            maxSpeed: tuningFor(vehicle.archetype).maxSpeed,
            lookBack,
          },
          dt,
        )
      }
    }

    this.healthBars.update(current.vehicles, this.chase.camera, followId)
    this.effects.syncSmoke(current.vehicles, dt)
    this.effects.syncProjectiles(current.projectiles)
    this.effects.syncPickups(current.pickups, current.tick, dt)
    this.effects.syncLock(
      current.vehicles.find((v) => v.id === followId),
      current.vehicles,
      dt,
    )
    this.effects.update(dt)

    this.renderer.render(this.scene, this.chase.camera)
  }

  get drawCalls(): number {
    return this.renderer.info.render.calls
  }
}
