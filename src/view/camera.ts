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
  /**
   * How fast the FOV follows the speed it is derived from, 1/s.
   *
   * Not optional, and it fixes a measured defect. `fov` used to be written
   * straight from `forwardSpeed`, which is a sim value that can move a very
   * long way in one tick: a top-speed head-on stepped the FOV 12.1 degrees in
   * a single frame, and dying stepped it 14.0, because main.ts passes speed 0
   * for a wreck. A 12-degree zoom on the exact frame of the crash reads as the
   * renderer glitching rather than as impact.
   *
   * It is also what makes hit-stop legible: a held camera whose field of view
   * is snapping underneath it is not a held frame.
   */
  fovStiffness: number
}

/**
 * Where the arrival shot begins: wide, low, and off the car's front quarter.
 *
 * 18m out against the 9.5m the chase camera settles at, and 0.85m up against
 * 3.9m — low enough that you are looking slightly UP at the car with the arena
 * floor filling the bottom of the frame, which is what makes it read as a
 * establishing shot rather than a menu transition.
 *
 * 18m is chosen against the arena, not picked for feel alone. The player spawns
 * at z -42 in a plate that runs to -90, so the camera has 48m of clearance
 * behind the car and cannot end up outside the wall looking in at one metre off
 * the deck.
 */
const INTRO_DISTANCE = 18
const INTRO_HEIGHT = 0.85

/**
 * How far round the car the shot travels, starting from the front quarter.
 *
 * 150°, not 180°. Dead ahead is a weaker opening — the car reads as a flat
 * front elevation with no length to it — whereas a front three-quarter shows
 * the nose and one whole flank at once, which is how every car has been
 * photographed for a century. It still crosses most of a half circle.
 */
const INTRO_ARC = (150 * Math.PI) / 180

/** Extra degrees of lens at the start, closing to zero. A dolly and a zoom. */
const INTRO_FOV_BOOST = 12

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
  fovStiffness: 6,
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
  /** Smoothed FOV, so a one-tick speed change cannot snap the lens. */
  private fov: number
  /** Seconds of camera freeze left. See `hitStop`. */
  private frozen = 0
  private initialised = false
  private lookingBack = false
  /** Seconds left of the arrival shot, and its full length. See `playIntro`. */
  private intro = 0
  private introLength = 0
  /** True on frames the intro owns the lens, so the speed-FOV cannot fight it. */
  private introFov = false

  constructor(aspect: number, tuning: CameraTuning = { ...DEFAULT_CAMERA }) {
    this.tuning = tuning
    this.camera = new PerspectiveCamera(tuning.baseFov, aspect, 0.1, 1200)
    // Starts where the lens starts, so the first frame does not ease in from 0.
    this.fov = tuning.baseFov
  }

  /**
   * The arrival shot: swing in from in front of the car and settle behind it.
   *
   * Purely a camera move. The sim is untouched, nothing is delayed, and if this
   * were deleted tomorrow the match would play identically — which is the test
   * for whether something belongs in here at all.
   *
   * It is timed to run inside the countdown, so it costs no play time. The path
   * starts low and close, roughly where a driver's eyeline is, in front of the
   * car looking back at it, then orbits round to the normal chase pose while
   * rising and pulling out.
   *
   * The important property is that the path ENDS on the ordinary chase pose
   * exactly, rather than near it. The orbit is parameterised so that at
   * progress 1 the offset angle is zero, the radius is `tuning.distance` and
   * the height is `tuning.height` — which is the definition of where the camera
   * belongs. So the handoff back to normal smoothing has nothing to correct and
   * cannot pop.
   */
  playIntro(seconds: number): void {
    this.intro = seconds
    this.introLength = seconds
  }

  /** True while the arrival shot is still running. */
  get introducing(): boolean {
    return this.intro > 0
  }

  /** Register an impact. Magnitude is closing speed in m/s. */
  addShake(magnitude: number): void {
    this.shake = Math.min(1.2, this.shake + magnitude * this.tuning.shakeScale)
  }

  /**
   * Hold the camera still for a moment, without touching the sim.
   *
   * The sim has no timestep to slow: `step(world, inputs)` takes no `dt` at
   * all, so the only way to freeze the world is to stop calling it — and
   * `advance()` DROPS accumulated time past its cap rather than banking it, so
   * a frozen accumulator loses those ticks permanently, deletes the steering
   * integrated during them, and in a networked future puts the client behind
   * the server by exactly the amount of the biggest hit. None of the replay
   * fixtures would notice, because they never run the frame loop.
   *
   * So the freeze is the camera's alone. The world keeps ticking at 60Hz and
   * the hash never moves; what stops is the smoothing that follows it, which is
   * the part you actually see.
   */
  hitStop(seconds: number): void {
    this.frozen = Math.max(this.frozen, seconds)
  }

  update(target: CameraTarget, dt: number): void {
    const t = this.tuning

    // The camera's own clock. Everything below smooths against this rather than
    // the frame's dt, so a freeze holds the pose without stopping the world.
    if (this.frozen > 0) {
      this.frozen = Math.max(0, this.frozen - dt)
      dt = 0
    }

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

    if (this.intro > 0) {
      this.intro = Math.max(0, this.intro - dt)
      const p = this.introLength > 0 ? 1 - this.intro / this.introLength : 1
      /**
       * Smootherstep: slow out of the gate, quick through the middle, slow into
       * place.
       *
       * The first version used a hard ease-out, which front-loads everything —
       * the camera did most of its travelling in the first half second and then
       * crawled, so a two-and-a-half second shot felt like it was over almost
       * immediately. Symmetric easing spends the whole duration moving and
       * still arrives decelerating, which is the part that matters for the
       * handoff.
       */
      const e = p * p * p * (p * (p * 6 - 15) + 10)

      // Offset around the car: the front quarter down to zero, which is behind.
      const orbit = wrapAngle(viewYaw + INTRO_ARC * (1 - e))
      const arm = forwardOf(orbit)
      const radius = lerp(INTRO_DISTANCE, t.distance, e)
      const height = lerp(INTRO_HEIGHT, t.height, e)

      this.position.set(
        target.x - arm.x * radius,
        target.y + height,
        target.z - arm.z * radius,
      )
      // The lens closes as the camera comes in, so the move is a dolly and a
      // zoom rather than only a dolly. Set outright rather than smoothed: the
      // path is already eased, and running it through the FOV spring as well
      // would lag it behind the position and land wide.
      this.fov = t.baseFov + INTRO_FOV_BOOST * (1 - e)
      this.introFov = true
      this.initialised = true
    } else if (cut) {
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
    const wantedFov = t.baseFov + t.fovAtSpeed * speedRatio * speedRatio
    // Skipped while the intro owns the lens. It hands back at exactly
    // `baseFov`, which is where the speed curve starts from at a standstill, so
    // there is nothing to catch up on.
    if (this.introFov) this.introFov = false
    else this.fov += (wantedFov - this.fov) * Math.min(1, t.fovStiffness * dt)
    this.camera.fov = this.fov
    this.camera.updateProjectionMatrix()
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect
    this.camera.updateProjectionMatrix()
  }
}
