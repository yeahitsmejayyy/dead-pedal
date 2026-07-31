/**
 * L3 — a car, as three boxes and four cylinders.
 *
 * PLAN.md M1 asks for "a box for the car". This is a box for the car plus a
 * cabin and wheels, because you cannot judge rotation on a featureless box and
 * judging rotation is the entire job of M1.
 *
 * Pitch and roll live here rather than in the sim. Contract 4: the sim only
 * yaws, so a car leaning into a drift or nosing over a ramp affects nothing
 * that decides the game, and is therefore free to be approximated and smoothed
 * however it looks best.
 */
import {
  BoxGeometry,
  type BufferGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { clamp, lerp } from '../core/scalar'
import type { VehicleTuning } from '../content/vehicles'
import { WEAPONS } from '../content/weapons'
import { LIVERIES } from './palette'

const BODIES = LIVERIES.map(
  (color) => new MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.15 }),
)
const CABIN = new MeshStandardMaterial({ color: 0x1b2026, roughness: 0.25, metalness: 0.3 })
const RUBBER = new MeshStandardMaterial({ color: 0x14161a, roughness: 0.9 })
const GUNMETAL = new MeshStandardMaterial({ color: 0x3a4048, roughness: 0.35, metalness: 0.8 })

const MAX_PITCH = 0.5
const MAX_ROLL = 0.13

export class VehicleView {
  /** Position and yaw. */
  readonly root: Group
  /** Pitch and roll, so they compose with yaw instead of fighting it. */
  private readonly body: Group
  private readonly wheels: Object3D[] = []
  private readonly wheelRadius: number

  private pitch = 0
  private roll = 0

  constructor(tuning: VehicleTuning, livery = 0) {
    const paint = BODIES[livery % BODIES.length]!
    const { x: hw, y: hh, z: hl } = tuning.halfExtents

    this.wheelRadius = tuning.rideHeight * 0.65
    // Root sits at rideHeight, so this puts the contact patch exactly on y=0.
    const wheelY = this.wheelRadius - tuning.rideHeight

    this.root = new Group()
    this.body = new Group()
    this.root.add(this.body)

    const chassis = new Mesh(new BoxGeometry(hw * 2, hh * 1.15, hl * 2), paint)
    chassis.position.y = hh * 0.15
    chassis.castShadow = true
    this.body.add(chassis)

    const cabin = new Mesh(new BoxGeometry(hw * 1.6, hh * 0.9, hl * 0.95), CABIN)
    cabin.position.set(0, hh * 0.95, -hl * 0.1)
    // No shadow. A cabin's shadow lands inside the chassis's own, so it is four
    // draw calls a frame (one per car) spent on something nobody can see.
    this.body.add(cabin)

    // A nose stripe, so which end is the front is never in doubt.
    const nose = new Mesh(new BoxGeometry(hw * 0.5, hh * 0.3, hl * 0.25), CABIN)
    nose.position.set(0, hh * 0.75, hl * 0.86)
    this.body.add(nose)

    // ── hood guns ────────────────────────────────────────────────────────
    // Positioned from `WEAPONS.machineGun.muzzles` rather than from numbers
    // repeated here, so the barrels you can see are the barrels the rays come
    // out of. Moving a muzzle in content moves the model with it.
    //
    // Both guns are merged into a single geometry and cast no shadow. As four
    // separate shadow-casting meshes they cost seven draw calls per car, which
    // put a four-car scene over the 100-call budget in PLAN.md §6 — and two
    // 6cm barrels contribute nothing to a shadow you can see.
    const barrelLength = 0.85
    const gunParts: BufferGeometry[] = []

    for (const muzzle of WEAPONS.machineGun.muzzles) {
      // Muzzle offsets are relative to the car's centre, and `root` is already
      // at the car's centre — so this is the offset as written. Subtracting
      // `rideHeight` here buried both guns inside the chassis box.
      const y = muzzle.y

      const barrel = new CylinderGeometry(0.055, 0.07, barrelLength, 7)
      barrel.rotateX(Math.PI / 2)
      // `muzzle.z` is the tip, so the body sits behind it.
      barrel.translate(muzzle.x, y, muzzle.z - barrelLength / 2)
      gunParts.push(barrel)

      const breech = new BoxGeometry(0.2, 0.16, 0.42)
      breech.translate(muzzle.x, y, muzzle.z - barrelLength - 0.18)
      gunParts.push(breech)
    }

    const guns = mergeGeometries(gunParts, false)
    if (guns !== null) this.body.add(new Mesh(guns, GUNMETAL))

    const wheelGeometry = new CylinderGeometry(this.wheelRadius, this.wheelRadius, 0.34, 12)
    wheelGeometry.rotateZ(Math.PI / 2)

    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const wheel = new Mesh(wheelGeometry, RUBBER)
        wheel.position.set(sx * hw, wheelY, sz * hl * 0.68)
        // No shadow either, and this one is the expensive case: sixteen wheels
        // across four cars is sixteen extra shadow draws, measured at -16 calls.
        // A wheel at speed under a 1024px map spanning 120m is about eight
        // pixels of shadow, entirely inside the chassis's.
        this.body.add(wheel)
        this.wheels.push(wheel)
      }
    }
  }

  set(
    x: number,
    y: number,
    z: number,
    yaw: number,
    forwardSpeed: number,
    lateralSpeed: number,
    verticalSpeed: number,
    dt: number,
  ): void {
    this.root.position.set(x, y, z)
    // The one place the sim's compass yaw (right-positive) meets three.js's
    // right-handed rotation (left-positive). See `forwardOf` in sim/vehicle.ts.
    this.root.rotation.y = -yaw

    // Nose follows the climb or the fall; body leans out of a slide. Both are
    // smoothed at a fixed rate so a single violent tick cannot snap the model.
    const horizontal = Math.max(2, Math.abs(forwardSpeed))
    const targetPitch = clamp(-Math.atan2(verticalSpeed, horizontal), -MAX_PITCH, MAX_PITCH)
    const targetRoll = clamp(lateralSpeed * 0.012, -MAX_ROLL, MAX_ROLL)

    const k = clamp(dt * 9, 0, 1)
    this.pitch = lerp(this.pitch, targetPitch, k)
    this.roll = lerp(this.roll, targetRoll, k)

    this.body.rotation.x = this.pitch
    this.body.rotation.z = this.roll

    const spin = (forwardSpeed / this.wheelRadius) * dt
    for (const wheel of this.wheels) wheel.rotation.x -= spin
  }
}
