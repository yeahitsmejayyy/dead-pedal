/**
 * L3 — the chase camera.
 *
 * PLAN.md rates this 🟠 medium and warns that "bad camera reads as bad handling".
 * That is the whole reason this is a separate file with its own knobs: when the
 * car feels wrong, you need to be able to rule the camera out in ten seconds.
 *
 * Everything here is view-only state. Contract 4 says that's allowed to be
 * non-deterministic — the camera reads the world and never writes to it.
 */
import { PerspectiveCamera, Vector3 } from 'three'
import { angleDelta, clamp, lerp, wrapAngle } from '../core/scalar'
import { forwardOf } from '../sim'

export type CameraTuning = {
  /** Metres behind the car. */
  distance: number
  /** Metres above the car. */
  height: number
  /** Metres ahead of the car that the camera aims at. */
  lookAhead: number
  /** Height of the aim point relative to the car. Effectively pitch. */
  lookHeight: number
  /** How fast the camera catches up, 1/s. Low = floaty, high = welded on. */
  positionStiffness: number
  /** How fast the camera's own yaw catches the car's, 1/s. */
  yawStiffness: number
  /**
   * 0 follows the car's nose, 1 follows where it is actually travelling.
   * A little of this is what makes a drift readable instead of confusing.
   */
  velocityBlend: number
  baseFov: number
  /** Extra degrees of FOV at top speed. Borrowed from M7 because it is two
   *  lines and you cannot judge whether a car feels fast without it. */
  fovAtSpeed: number
  /** Impact shake, metres of displacement per m/s of impact. */
  shakeScale: number
  /** How fast shake dies off, 1/s. */
  shakeDecay: number
}

export const DEFAULT_CAMERA: CameraTuning = {
  distance: 9.5,
  height: 3.9,
  lookAhead: 8,
  lookHeight: 1.6,
  positionStiffness: 9,
  yawStiffness: 7,
  velocityBlend: 0.25,
  baseFov: 68,
  fovAtSpeed: 14,
  shakeScale: 0.05,
  shakeDecay: 6,
}

export type CameraTarget = {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly yaw: number
  /** World-space direction of travel, or null when effectively stationary. */
  readonly headingYaw: number | null
  readonly speed: number
  readonly maxSpeed: number
  readonly lookBack: boolean
}

export class ChaseCamera {
  readonly camera: PerspectiveCamera
  readonly tuning: CameraTuning

  private followYaw = 0
  private readonly position = new Vector3()
  private readonly lookAt = new Vector3()
  private shake = 0
  private shakePhase = 0
  private initialised = false
  private lookingBack = false

  constructor(aspect: number, tuning: CameraTuning = { ...DEFAULT_CAMERA }) {
    this.tuning = tuning
    this.camera = new PerspectiveCamera(tuning.baseFov, aspect, 0.1, 1200)
  }

  /** Register an impact. Magnitude is closing speed in m/s. */
  addShake(magnitude: number): void {
    this.shake = Math.min(1.2, this.shake + magnitude * this.tuning.shakeScale)
  }

  update(target: CameraTarget, dt: number): void {
    const t = this.tuning

    // Blend the car's heading toward its actual direction of travel so a drift
    // shows as the car sliding across the frame rather than the world lurching.
    let desiredYaw = target.yaw
    if (target.headingYaw !== null && t.velocityBlend > 0) {
      desiredYaw = wrapAngle(
        target.yaw + angleDelta(target.yaw, target.headingYaw) * t.velocityBlend,
      )
    }

    // `followYaw` only ever tracks the car. Look-back is a π offset applied at
    // the point of use, never smoothed into this value — smoothing across half
    // a turn is what made it swing round the car like an animation instead of
    // cutting. A shortest-arc lerp through exactly π is also ambiguous, so it
    // could pick either direction and flip mid-swing.
    const toggledLookBack = target.lookBack !== this.lookingBack
    this.lookingBack = target.lookBack

    // Both a first frame and a look-back toggle are cuts, not moves.
    const cut = !this.initialised || toggledLookBack

    if (cut) {
      this.followYaw = desiredYaw
    } else {
      // Frame-rate independent exponential smoothing.
      const k = 1 - Math.exp(-t.yawStiffness * dt)
      this.followYaw = wrapAngle(this.followYaw + angleDelta(this.followYaw, desiredYaw) * k)
    }

    // The direction the camera looks along. Reversed for look-back, which puts
    // the camera ahead of the car aiming backward — you want to see what is
    // behind you, with your own car in frame.
    const viewYaw = this.lookingBack ? wrapAngle(this.followYaw + Math.PI) : this.followYaw
    const forward = forwardOf(viewYaw)

    const desiredX = target.x - forward.x * t.distance
    const desiredY = target.y + t.height
    const desiredZ = target.z - forward.z * t.distance

    if (cut) {
      this.position.set(desiredX, desiredY, desiredZ)
      this.initialised = true
    } else {
      const k = 1 - Math.exp(-t.positionStiffness * dt)
      this.position.x = lerp(this.position.x, desiredX, k)
      this.position.y = lerp(this.position.y, desiredY, k)
      this.position.z = lerp(this.position.z, desiredZ, k)
    }

    // ── shake — view-only, deliberately non-deterministic in feel ────────────
    this.shakePhase += dt * 47
    this.shake = Math.max(0, this.shake - t.shakeDecay * this.shake * dt)
    const jolt = this.shake * this.shake
    const shakeX = Math.sin(this.shakePhase * 2.3) * jolt
    const shakeY = Math.sin(this.shakePhase * 3.7) * jolt

    this.camera.position.set(
      this.position.x + shakeX,
      this.position.y + shakeY,
      this.position.z,
    )

    this.lookAt.set(
      target.x + forward.x * t.lookAhead,
      target.y + t.lookHeight,
      target.z + forward.z * t.lookAhead,
    )
    this.camera.lookAt(this.lookAt)

    const speedRatio = clamp(Math.abs(target.speed) / target.maxSpeed, 0, 1)
    this.camera.fov = t.baseFov + t.fovAtSpeed * speedRatio * speedRatio
    this.camera.updateProjectionMatrix()
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect
    this.camera.updateProjectionMatrix()
  }
}
