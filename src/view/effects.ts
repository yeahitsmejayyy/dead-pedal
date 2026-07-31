/**
 * L3 — tracers, rockets and explosions.
 *
 * Contract 4 in its purest form: the sim already decided what was hit and for
 * how much. Nothing here can change any of that, so all of it is free to be
 * non-deterministic, pooled, dropped under load, and tuned purely on looks.
 *
 * Everything is pooled and preallocated. Tracers share one `LineSegments`, so a
 * whole burst costs a single draw call, and no frame allocates a geometry.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  LineBasicMaterial,
  LineSegments,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  type Scene,
  SphereGeometry,
  TorusGeometry,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { clamp } from '../core/scalar'
import { fromSeed, next, type RngState } from '../core/rng'
import { pickupHex } from './palette'
import { weaponFor } from '../content/weapons'
import { tuningFor } from '../content/vehicles'
import type { Pickup, Projectile, SimEvent, Vehicle } from '../sim'

const MAX_TRACERS = 64
const MAX_BLASTS = 12
const MAX_ROCKETS = 24
const MAX_MINES = 24
const MAX_CRATES = 16
const MAX_SMOKE = 48
const MAX_SPARKS = 128
const MAX_DEBRIS = 64

/**
 * Fraction of `slipSaturation` at which a tyre starts to smoke.
 *
 * Measured on an open plate, roadster, `slipSaturation: 14`: a full-lock grip
 * turn at full throttle peaks at 13.39 m/s (0.96x) and a handbrake turn at
 * 33.80 (2.41x). Putting the threshold at saturation itself would therefore
 * miss a maximum-effort corner by four percent — a knife-edge that fires or
 * does not depending on the lap. At 0.7 a hard corner gives a wisp near its
 * limit, the handbrake gives a plume with three times the margin, and ordinary
 * driving stays clean.
 *
 * In the arena proper you cannot usually hold full lock long enough to reach
 * the peak, so cornering smoke is occasional rather than constant. That is the
 * intended reading: it marks the edge of grip, not the act of turning.
 */
const SMOKE_AT = 0.7

/**
 * Rounds per visible tracer.
 *
 * Real belts load one tracer every four or five rounds, and that ratio is the
 * whole reason tracer fire reads as *fire* rather than as a beam: you see the
 * gaps between them. Drawing every round produced a solid stream, which is what
 * made the old version look like a hose.
 *
 * Odd on purpose. Two barrels fire together, so an even cadence lands on the
 * same gun every single time and the tracers all come from one side of the
 * bonnet; an odd one walks between them.
 */
const TRACER_EVERY = 3

/** Metres of visible streak trailing the round. */
const TRACER_LENGTH = 6.5

/**
 * Metres per second the streak appears to travel.
 *
 * Purely cosmetic — the sim resolved the hit in the tick it was fired. A real
 * round is far too fast to see, so this is slowed to roughly what a tracer
 * looks like on film. It also sets how often one is on screen: at 1-in-3 and
 * 16 rounds a second, this leaves about 1.6 in flight at typical range, which
 * reads as continuous fire without collapsing back into a beam.
 */
const TRACER_SPEED = 180

const BLAST_LIFE = 0.34

type Tracer = {
  ox: number
  oy: number
  oz: number
  dx: number
  dy: number
  dz: number
  distance: number
  travelled: number
  active: boolean
}

type Blast = { mesh: Mesh; age: number; radius: number }

/** One puff, chip or shard. All three pools are the same shape of thing. */
type Particle = {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  age: number
  life: number
  size: number
  spin: number
}

function makeParticles(count: number): Particle[] {
  const out: Particle[] = []
  for (let i = 0; i < count; i++) {
    out.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: Infinity, life: 1, size: 1, spin: 0 })
  }
  return out
}

/**
 * Body, nose cone and three fins merged into one geometry: one draw call per
 * rocket rather than five.
 *
 * Deliberately oversized — about 1.2m for a car-mounted rocket. At a realistic
 * 0.8m it is a couple of pixels by the time it is far enough away to matter,
 * and a projectile you cannot see coming is not a projectile you can dodge.
 */
function missileGeometry(): BufferGeometry {
  const body = new CapsuleGeometry(0.18, 0.82, 4, 10)
  body.rotateX(Math.PI / 2)

  const nose = new ConeGeometry(0.19, 0.46, 10)
  nose.rotateX(Math.PI / 2)
  nose.translate(0, 0, 0.7)

  const parts: BufferGeometry[] = [body, nose]

  for (let i = 0; i < 3; i++) {
    const fin = new BoxGeometry(0.04, 0.32, 0.36)
    fin.translate(0, 0.22, -0.5)
    fin.rotateZ((i * Math.PI * 2) / 3)
    parts.push(fin)
  }

  const merged = mergeGeometries(parts, false)
  if (merged === null) throw new Error('failed to build the missile geometry')
  return merged
}

export class Effects {
  private readonly tracerGeometry: BufferGeometry
  private readonly tracerPositions: Float32Array
  private readonly tracers: Tracer[] = []
  private tracerCursor = 0

  /** Rounds seen per shooter, so the 1-in-N tracer cadence is per car. */
  private readonly roundCount = new Map<number, number>()

  private readonly blasts: Blast[] = []
  private readonly rockets: Mesh[] = []
  private readonly mines: Mesh[] = []
  private readonly crates: Mesh[] = []
  /** What each crate slot is currently painted as, so the colour is set once. */
  private readonly crateKeys: string[] = []
  private readonly lockRing: Mesh
  private spin = 0

  // ── smoke, sparks, debris ──────────────────────────────────────────────────
  private readonly smoke = makeParticles(MAX_SMOKE)
  private readonly sparks = makeParticles(MAX_SPARKS)
  private readonly debris = makeParticles(MAX_DEBRIS)
  private smokeCursor = 0
  private sparkCursor = 0
  private debrisCursor = 0
  private readonly smokeMesh: InstancedMesh
  private readonly sparkMesh: InstancedMesh
  private readonly debrisMesh: InstancedMesh
  private readonly placement = new Matrix4()

  /**
   * Randomness for the particles, seeded and owned here.
   *
   * `Math.random` would be the obvious choice — this is the view layer, nothing
   * here can reach the sim, and Contract 4 explicitly frees effects to be
   * non-deterministic. It is still the wrong choice, for a reason outside the
   * sim entirely: the visual-regression harness pins the seed, the tick,
   * `requestAnimationFrame` and `performance.now`, and a screenshot with
   * `Math.random` in it is still different every run. Measured on a prototype
   * of exactly these three effects: three failures in nine runs.
   *
   * So the same mulberry32 the sim uses, on its own stream. Determinism the
   * sim does not need, bought for a test that does.
   */
  private rng: RngState = fromSeed(0x5eed)

  /** A uniform draw in [lo, hi). Advances the stream. */
  private random(lo: number, hi: number): number {
    const draw = next(this.rng)
    this.rng = draw.state
    return lo + draw.value * (hi - lo)
  }

  constructor(scene: Scene) {
    // ── tracers ──────────────────────────────────────────────────────────────
    this.tracerPositions = new Float32Array(MAX_TRACERS * 6)
    this.tracerGeometry = new BufferGeometry()
    this.tracerGeometry.setAttribute('position', new BufferAttribute(this.tracerPositions, 3))

    for (let i = 0; i < MAX_TRACERS; i++) {
      this.tracers.push({
        ox: 0,
        oy: 0,
        oz: 0,
        dx: 0,
        dy: 0,
        dz: 0,
        distance: 0,
        travelled: 0,
        active: false,
      })
    }

    const tracerLines = new LineSegments(
      this.tracerGeometry,
      new LineBasicMaterial({
        color: 0xffc65a,
        transparent: true,
        opacity: 0.95,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    )
    tracerLines.frustumCulled = false
    scene.add(tracerLines)

    // ── blasts ───────────────────────────────────────────────────────────────
    const blastGeometry = new SphereGeometry(1, 12, 8)
    for (let i = 0; i < MAX_BLASTS; i++) {
      const mesh = new Mesh(
        blastGeometry,
        new MeshBasicMaterial({
          color: new Color(0xffa23a),
          transparent: true,
          blending: AdditiveBlending,
          depthWrite: false,
        }),
      )
      mesh.visible = false
      scene.add(mesh)
      this.blasts.push({ mesh, age: Number.POSITIVE_INFINITY, radius: 1 })
    }

    // ── rockets ──────────────────────────────────────────────────────────────
    const rocketGeometry = missileGeometry()
    const rocketMaterial = new MeshStandardMaterial({
      color: 0xd8d8d2,
      roughness: 0.5,
      metalness: 0.35,
    })
    for (let i = 0; i < MAX_ROCKETS; i++) {
      const mesh = new Mesh(rocketGeometry, rocketMaterial)
      mesh.visible = false
      mesh.castShadow = true
      scene.add(mesh)
      this.rockets.push(mesh)
    }

    // ── mines ────────────────────────────────────────────────────────────────
    // A squat disc. Deliberately dark and small: a mine you can see from across
    // the arena is a mine nobody ever drives over.
    const mineGeometry = new CylinderGeometry(0.55, 0.62, 0.24, 10)
    const mineMaterial = new MeshStandardMaterial({ color: 0x3d3226, roughness: 0.85 })
    for (let i = 0; i < MAX_MINES; i++) {
      const mesh = new Mesh(mineGeometry, mineMaterial)
      mesh.visible = false
      scene.add(mesh)
      this.mines.push(mesh)
    }

    // ── weapon crates ────────────────────────────────────────────────────────
    // A material each, not one shared: the colour is what says which weapon is
    // inside, so the crates cannot be allowed to agree on one.
    const crateGeometry = new BoxGeometry(1.5, 1.5, 1.5)
    for (let i = 0; i < MAX_CRATES; i++) {
      const mesh = new Mesh(
        crateGeometry,
        new MeshStandardMaterial({ color: 0x8a8f3c, roughness: 0.6, emissive: 0x1a1c08 }),
      )
      mesh.visible = false
      // No shadow: eight floating crates cost eight extra draw calls and
      // contribute a smudge nobody looks at. PLAN.md §6 budgets 100.
      scene.add(mesh)
      this.crates.push(mesh)
    }

    // ── smoke, sparks, debris ────────────────────────────────────────────────
    // One InstancedMesh each, so a hundred particles is one draw call. The
    // budget is 100 and the frame sits at 57, so three effects at one call each
    // is the only shape that fits — a mesh per particle would not.
    const puff = new SphereGeometry(1, 6, 4)
    this.smokeMesh = new InstancedMesh(
      puff,
      new MeshBasicMaterial({ color: 0xb9c2cc, transparent: true, opacity: 0.16, depthWrite: false }),
      MAX_SMOKE,
    )
    const chip = new BoxGeometry(1, 1, 1)
    this.sparkMesh = new InstancedMesh(
      chip,
      new MeshBasicMaterial({ color: 0xffd08a, blending: AdditiveBlending, depthWrite: false }),
      MAX_SPARKS,
    )
    this.debrisMesh = new InstancedMesh(
      chip,
      new MeshStandardMaterial({ color: 0x4a4f58, roughness: 0.7, metalness: 0.3 }),
      MAX_DEBRIS,
    )
    for (const mesh of [this.smokeMesh, this.sparkMesh, this.debrisMesh]) {
      // Particles are scattered across the arena and the bounding sphere of an
      // InstancedMesh is whatever its instances happen to span, so culling it
      // is both wrong and pointless.
      mesh.frustumCulled = false
      mesh.count = 0
      scene.add(mesh)
    }

    // ── lock ring ────────────────────────────────────────────────────────────
    // One ring, moved to whoever is currently locked. The player only ever has
    // one lock, so a pool would be a pool of one.
    const ring = new TorusGeometry(2.6, 0.13, 6, 24)
    ring.rotateX(Math.PI / 2)
    this.lockRing = new Mesh(
      ring,
      new MeshBasicMaterial({ color: 0xff5a3c, transparent: true, opacity: 0.9, depthWrite: false }),
    )
    this.lockRing.visible = false
    scene.add(this.lockRing)
  }

  /**
   * Show who the player has locked, and how far along the lock is.
   *
   * Purely a readout of sim state — the ring cannot change what gets locked.
   * It exists because a missile you had no warning of is the unfair kind, and
   * the warning has to be visible to the person being locked as well as the one
   * doing it.
   */
  syncLock(shooter: Vehicle | undefined, vehicles: readonly Vehicle[], dt: number): void {
    const homing = weaponFor('homingMissile')
    const needed = homing.kind === 'projectile' ? (homing.homing?.lockTime ?? 1) : 1

    const target =
      shooter === undefined || shooter.lockTarget === null
        ? undefined
        : vehicles.find((v) => v.id === shooter.lockTarget)

    if (target === undefined || shooter === undefined) {
      this.lockRing.visible = false
      return
    }

    const progress = clamp(shooter.lockTime / needed, 0, 1)
    this.spin += dt * (progress >= 1 ? 2.4 : 6.5)

    this.lockRing.visible = true
    this.lockRing.position.set(target.pos.x, target.pos.y + 0.1, target.pos.z)
    this.lockRing.rotation.y = this.spin
    // Closes in as the lock builds, then settles and turns solid once it takes.
    this.lockRing.scale.setScalar(progress >= 1 ? 1 : 2.2 - 1.2 * progress)

    const material = this.lockRing.material as MeshBasicMaterial
    material.opacity = progress >= 1 ? 0.95 : 0.3 + 0.4 * progress
    material.color.setRGB(1, progress >= 1 ? 0.25 : 0.72, 0.2)
  }

  /** Crates on the floor, hidden while they are on their respawn timer. */
  syncPickups(pickups: readonly Pickup[], tick: number, dt: number): void {
    this.spin += 0
    const inUse = Math.min(pickups.length, MAX_CRATES)

    for (let i = 0; i < inUse; i++) {
      const pickup = pickups[i]!
      const mesh = this.crates[i]!
      const available = tick >= pickup.availableAt
      mesh.visible = available
      if (!available) continue

      // What is in the crate, painted on the crate. Assigned here rather than at
      // construction because slot `i` is whatever pickup `i` happens to be, and
      // that mapping is only known once an arena is loaded. Guarded on a change
      // so a stable arena writes each material exactly once, not 60 times a
      // second — `Color.set` is cheap but it dirties the uniform either way.
      const key = pickup.kind === 'weapon' ? (pickup.weapon ?? '') : pickup.kind
      if (this.crateKeys[i] !== key) {
        this.crateKeys[i] = key
        const material = mesh.material as MeshStandardMaterial
        const hex = pickupHex(key)
        material.color.setHex(hex)
        // A tenth of the body colour, so a crate glows its own hue in shadow
        // instead of going grey and losing the one thing it is trying to say.
        material.emissive.setHex(hex).multiplyScalar(0.18)
      }

      // A slow bob and turn, so a crate reads as collectable rather than as
      // scenery you should be avoiding.
      mesh.position.set(pickup.pos.x, pickup.pos.y + 1.1 + Math.sin(tick * 0.04 + i) * 0.18, pickup.pos.z)
      mesh.rotation.y += dt * 0.8
    }
    for (let i = inUse; i < this.crates.length; i++) this.crates[i]!.visible = false
  }

  /** Drain one tick of sim events into visible effects. */
  /**
   * Drain one tick of sim events into visible effects.
   *
   * `vehicles` is needed because of a subtlety in the damage events: for a
   * hitscan round `event.pos` is the impact point on the car, but for blast
   * damage it is `detonateAt` — the centre of the explosion, which can be a
   * whole blast radius away. Sparks spawned at `event.pos` would therefore
   * appear inside the fireball for every car caught in a rocket, where
   * additive blending makes them invisible, and the "away from the panel"
   * direction would point at the explosion instead of away from the car.
   */
  consume(events: readonly SimEvent[], vehicles: readonly Vehicle[] = []): void {
    for (const event of events) {
      if (event.type === 'tracer') {
        const seen = (this.roundCount.get(event.id) ?? 0) + 1
        this.roundCount.set(event.id, seen)
        if (seen % TRACER_EVERY === 0) this.addTracer(event.from, event.to)
      } else if (event.type === 'explosion') {
        this.addBlast(event.pos, event.radius)
      } else if (event.type === 'damaged') {
        const car = vehicles.find((v) => v.id === event.id)
        if (car !== undefined) this.addSparks(car, event.pos, event.amount)
      } else if (event.type === 'vehicleDestroyed') {
        this.addDebris(event.pos)
      }
    }
  }

  /**
   * Sparks off a panel.
   *
   * Spawned at the car and thrown along the surface normal — away from wherever
   * the damage came from — rather than at the event's own position. See
   * `consume` for why those are not the same point.
   */
  private addSparks(car: Vehicle, from: { x: number; y: number; z: number }, amount: number): void {
    // Measured damage distribution over eight matches: median 2.8 (one round),
    // p90 37, max 65.7. So two sparks for a bullet and a dozen for a rocket.
    const count = Math.min(12, Math.round(1 + amount * 0.32))

    let nx = car.pos.x - from.x
    let nz = car.pos.z - from.z
    const length = Math.hypot(nx, nz)
    // A round that lands dead centre has no direction to bounce off; pick one
    // rather than dividing by zero.
    if (length < 0.01) {
      nx = this.random(-1, 1)
      nz = this.random(-1, 1)
    } else {
      nx /= length
      nz /= length
    }

    for (let i = 0; i < count; i++) {
      const p = this.sparks[this.sparkCursor]!
      this.sparkCursor = (this.sparkCursor + 1) % MAX_SPARKS

      p.x = car.pos.x + nx * 0.9
      p.y = car.pos.y + this.random(0.1, 0.8)
      p.z = car.pos.z + nz * 0.9
      const spread = 5
      p.vx = nx * this.random(2, 7) + this.random(-spread, spread)
      p.vy = this.random(1.5, 6)
      p.vz = nz * this.random(2, 7) + this.random(-spread, spread)
      p.age = 0
      p.life = this.random(0.22, 0.42)
      p.size = this.random(0.05, 0.12)
      p.spin = 0
    }
  }

  /** Shards where a car was. Gone well before the three-second respawn. */
  private addDebris(at: { x: number; y: number; z: number }): void {
    for (let i = 0; i < 14; i++) {
      const p = this.debris[this.debrisCursor]!
      this.debrisCursor = (this.debrisCursor + 1) % MAX_DEBRIS

      p.x = at.x + this.random(-0.6, 0.6)
      p.y = at.y + this.random(0.2, 1.2)
      p.z = at.z + this.random(-0.6, 0.6)
      p.vx = this.random(-7, 7)
      p.vy = this.random(3, 9)
      p.vz = this.random(-7, 7)
      p.age = 0
      // Under respawnDelay (3s), so the wreckage is gone before the car is back.
      p.life = this.random(1.9, 2.6)
      p.size = this.random(0.14, 0.34)
      p.spin = this.random(-9, 9)
    }
  }

  /**
   * Tyre smoke, for cars past the edge of grip.
   *
   * Driven off the sim's own `lateralSpeed` against `slipSaturation`, which is
   * documented as the speed at which the tyres are fully saturated — so this is
   * that sentence, scaled. Note the sim has no longitudinal wheelspin: a
   * standing start produces exactly 0.00 lateral, so there is no launch smoke
   * to be had and none is faked.
   */
  syncSmoke(vehicles: readonly Vehicle[], dt: number): void {
    for (const vehicle of vehicles) {
      if (!vehicle.grounded || vehicle.health <= 0) continue
      const tuning = tuningFor(vehicle.archetype)
      const ratio = Math.abs(vehicle.lateralSpeed) / tuning.slipSaturation
      if (ratio < SMOKE_AT) continue

      // Rate scales past the threshold, so a corner wisps and a handbrake turn
      // at 2.4x pours. Poisson-ish rather than one per tick, which would tie
      // the density to the frame rate.
      const wanted = clamp((ratio - SMOKE_AT) * 1.6, 0, 1.4) * dt * 60
      if (this.random(0, 1) > wanted) continue

      const p = this.smoke[this.smokeCursor]!
      this.smokeCursor = (this.smokeCursor + 1) % MAX_SMOKE
      // At the contact patch, not the middle of the car: smoke that starts at
      // the roofline reads as the car being on fire.
      p.x = vehicle.pos.x + this.random(-0.8, 0.8)
      p.y = vehicle.pos.y - 0.45
      p.z = vehicle.pos.z + this.random(-1.2, 1.2)
      p.vx = this.random(-0.4, 0.4)
      p.vy = this.random(0.3, 0.8)
      p.vz = this.random(-0.4, 0.4)
      p.age = 0
      p.life = this.random(0.35, 0.6)
      p.size = this.random(0.12, 0.26)
      p.spin = 0
    }
  }

  private addTracer(
    from: { x: number; y: number; z: number },
    to: { x: number; y: number; z: number },
  ): void {
    const dx = to.x - from.x
    const dy = to.y - from.y
    const dz = to.z - from.z
    const distance = Math.hypot(dx, dy, dz)
    if (distance < 0.01) return

    // Round-robin. Overwriting the oldest slot under sustained fire is
    // invisible; growing the buffer every frame is not.
    const slot = this.tracers[this.tracerCursor]!
    this.tracerCursor = (this.tracerCursor + 1) % MAX_TRACERS

    slot.ox = from.x
    slot.oy = from.y
    slot.oz = from.z
    slot.dx = dx / distance
    slot.dy = dy / distance
    slot.dz = dz / distance
    slot.distance = distance
    slot.travelled = 0
    slot.active = true
  }

  private addBlast(pos: { x: number; y: number; z: number }, radius: number): void {
    let slot = this.blasts.find((b) => b.age >= BLAST_LIFE)
    slot ??= this.blasts.reduce((a, b) => (a.age > b.age ? a : b))

    slot.age = 0
    slot.radius = radius
    slot.mesh.position.set(pos.x, pos.y + 0.6, pos.z)
    slot.mesh.visible = true
  }

  /** Position the rocket and mine meshes from live sim state. */
  syncProjectiles(projectiles: readonly Projectile[]): void {
    let flying = 0
    let laid = 0

    for (const projectile of projectiles) {
      if (weaponFor(projectile.weapon).kind === 'mine') {
        if (laid >= MAX_MINES) continue
        const mesh = this.mines[laid++]!
        mesh.visible = true
        mesh.position.set(projectile.pos.x, projectile.pos.y, projectile.pos.z)
        continue
      }

      if (flying >= MAX_ROCKETS) continue
      const mesh = this.rockets[flying++]!
      mesh.visible = true
      mesh.position.set(projectile.pos.x, projectile.pos.y, projectile.pos.z)
      // The merged geometry points along +Z, which is what `lookAt` aims.
      mesh.lookAt(
        projectile.pos.x + projectile.vel.x,
        projectile.pos.y + projectile.vel.y,
        projectile.pos.z + projectile.vel.z,
      )
    }

    for (let i = flying; i < this.rockets.length; i++) this.rockets[i]!.visible = false
    for (let i = laid; i < this.mines.length; i++) this.mines[i]!.visible = false
  }

  /**
   * Integrate one particle pool and write its live instances.
   *
   * `count` is set to how many are alive, so a pool with nothing in it costs
   * the GPU nothing even though the mesh stays in the scene. Dead slots are not
   * compacted — the pool is a ring buffer and the cursor overwrites the oldest,
   * which is what keeps this allocation-free.
   */
  private stepParticles(
    pool: Particle[],
    mesh: InstancedMesh,
    dt: number,
    gravity: number,
    drag: number,
    grow: number,
  ): void {
    let live = 0
    for (const p of pool) {
      if (p.age >= p.life) continue
      p.age += dt
      if (p.age >= p.life) continue

      p.vy -= gravity * dt
      const slow = Math.max(0, 1 - drag * dt)
      p.vx *= slow
      p.vz *= slow
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.z += p.vz * dt

      // Floor. Debris bounces once and settles; smoke and sparks just stop.
      if (p.y < 0.05) {
        p.y = 0.05
        p.vy = Math.abs(p.vy) > 1.5 ? -p.vy * 0.35 : 0
      }

      const t = p.age / p.life
      const scale = p.size * (1 + grow * t)
      this.placement.makeScale(scale, scale, scale)
      this.placement.setPosition(p.x, p.y, p.z)
      mesh.setMatrixAt(live, this.placement)
      live++
    }
    mesh.count = live
    if (live > 0) mesh.instanceMatrix.needsUpdate = true
  }

  /** Live particle counts, for the dev probe. Cheap and read-only. */
  particleCounts(): { smoke: number; sparks: number; debris: number } {
    return {
      smoke: this.smokeMesh.count,
      sparks: this.sparkMesh.count,
      debris: this.debrisMesh.count,
    }
  }

  update(dt: number): void {
    // Smoke swells and drifts, sparks fall fast and hard, debris tumbles under
    // full gravity. Same integrator, three sets of numbers.
    this.stepParticles(this.smoke, this.smokeMesh, dt, -0.7, 2.2, 1.9)
    this.stepParticles(this.sparks, this.sparkMesh, dt, 26, 2.2, -0.7)
    this.stepParticles(this.debris, this.debrisMesh, dt, 20, 0.7, 0)

    // ── tracers ──────────────────────────────────────────────────────────────
    // Each round is a short streak flying from the muzzle to where the sim
    // already said it landed. Drawing the whole line at once is what made the
    // old version read as a beam rather than as rounds in flight.
    for (let i = 0; i < MAX_TRACERS; i++) {
      const tracer = this.tracers[i]!
      const offset = i * 6

      if (tracer.active) {
        tracer.travelled += TRACER_SPEED * dt
        // Gone once the tail has passed the impact point.
        if (tracer.travelled - TRACER_LENGTH > tracer.distance) tracer.active = false
      }

      if (!tracer.active) {
        // Collapsed to a zero-length segment rather than removed, which keeps
        // the buffer contiguous and the draw range a single constant.
        for (let k = 0; k < 6; k++) this.tracerPositions[offset + k] = 0
        continue
      }

      const head = clamp(tracer.travelled, 0, tracer.distance)
      const tail = clamp(tracer.travelled - TRACER_LENGTH, 0, tracer.distance)

      this.tracerPositions[offset] = tracer.ox + tracer.dx * tail
      this.tracerPositions[offset + 1] = tracer.oy + tracer.dy * tail
      this.tracerPositions[offset + 2] = tracer.oz + tracer.dz * tail
      this.tracerPositions[offset + 3] = tracer.ox + tracer.dx * head
      this.tracerPositions[offset + 4] = tracer.oy + tracer.dy * head
      this.tracerPositions[offset + 5] = tracer.oz + tracer.dz * head
    }

    this.tracerGeometry.setDrawRange(0, MAX_TRACERS * 2)
    this.tracerGeometry.attributes.position!.needsUpdate = true

    // ── blasts ───────────────────────────────────────────────────────────────
    for (const blast of this.blasts) {
      if (blast.age >= BLAST_LIFE) {
        blast.mesh.visible = false
        continue
      }
      blast.age += dt

      const t = clamp(blast.age / BLAST_LIFE, 0, 1)
      // Fast out, slow stop: the first frames carry the punch. Drawn at about
      // half the blast radius on purpose — this is the fireball, not the damage
      // field, and a sphere spanning the true 7m radius reads as a pale balloon
      // covering the thing you just killed rather than as an explosion.
      blast.mesh.scale.setScalar(blast.radius * 0.55 * (0.15 + 0.85 * Math.sqrt(t)))

      const material = blast.mesh.material as MeshBasicMaterial
      // Additive blending over a dark scene saturates fast, so peak opacity has
      // to stay low. It should read as light, not as an object.
      material.opacity = (1 - t) * (1 - t) * 0.8
      material.color.setRGB(1, 0.93 - 0.55 * t, 0.78 - 0.68 * t)
    }
  }

  get objects(): readonly Object3D[] {
    return [...this.blasts.map((b) => b.mesh), ...this.rockets, ...this.mines, ...this.crates]
  }
}
