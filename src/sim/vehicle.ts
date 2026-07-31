/**
 * L1 — arcade vehicle handling.
 *
 * PLAN.md §3: "Twisted Metal handling is not a simulation. It's a box that
 * accelerates, turns at a speed-dependent rate, slides when you handbrake, and
 * bounces off things." That is exactly what this is, and nothing more.
 *
 * The model works in the car's own frame: velocity is decomposed into forward
 * and lateral components, each is treated separately, and the result is composed
 * back into world space. Grip is a *deceleration applied to the lateral
 * component* — the whole drift mechanic is that one number getting smaller when
 * the handbrake is down.
 *
 * Determinism note: this uses `Math.sin`/`Math.cos`, which IEEE-754 does not
 * pin to the last bit across engines. Same engine, same result — so replays and
 * tests are exact. Cross-platform lockstep (M8) would need table-based or
 * fixed-point trig; that is an M8 problem and is called out again in the netcode
 * milestone rather than solved speculatively here.
 */
import { clamp, decay, moveToward, wrapAngle } from '../core/scalar'
import type { Vec3 } from '../core/vec3'
import type { VehicleTuning } from '../content/vehicles'
import { tuningFor } from '../content/vehicles'
import { groundHeightAt } from './arena'
import type { Arena, InputFrame, SimEvent, Vehicle } from './types'

/**
 * Yaw is a compass heading: 0 faces +Z, and **increasing yaw turns right**.
 *
 * That is worth stating loudly because it is the opposite of what you get for
 * free. three.js is right-handed with +Y up, so an object facing +Z has +X on
 * its *left*, and `Object3D.rotation.y = yaw` therefore rotates left as yaw
 * increases. Adopting the engine's sign here would mean every piece of gameplay
 * code that steers toward something — the player, M5's bots, M4's missiles —
 * carries a negation. So the sim owns the intuitive convention and the view
 * flips it once, in `vehicleView.ts`, where it meets three.
 *
 * Invariant, asserted in the tests: `cross(right, forward) === UP`.
 */
export function forwardOf(yaw: number): Vec3 {
  return { x: -Math.sin(yaw), y: 0, z: Math.cos(yaw) }
}

/** The car's right axis in world space, perpendicular to `forwardOf`. */
export function rightOf(yaw: number): Vec3 {
  return { x: -Math.cos(yaw), y: 0, z: -Math.sin(yaw) }
}

/** The compass heading a velocity is travelling along. Inverse of `forwardOf`. */
export function headingOf(x: number, z: number): number {
  return Math.atan2(-x, z)
}

/**
 * How much of the car's steering is available right now.
 *
 * Signed on purpose. The sign comes from the direction of travel, so one
 * expression gives three behaviours: a parked car cannot pirouette, a slow car
 * turns lazily, and a reversing car steers backwards the way a real one does.
 */
export function steerAuthority(forwardSpeed: number, t: VehicleTuning): number {
  const directional = clamp(forwardSpeed / t.steerSpeedFloor, -1, 1)
  const speed = Math.abs(forwardSpeed)
  const overshoot = clamp(
    (speed - t.steerSpeedOptimal) / Math.max(1e-6, t.maxSpeed - t.steerSpeedOptimal),
    0,
    1,
  )
  const washout = 1 - overshoot * (1 - t.highSpeedSteerScale)
  return directional * washout
}

function longitudinalAccel(forwardSpeed: number, input: InputFrame, t: VehicleTuning): number {
  const throttle = clamp(input.throttle, -1, 1)

  if (throttle > 0) {
    // Self-limiting: acceleration decays to nothing at maxSpeed, so top speed is
    // the number in content and not an emergent surprise.
    const headroom = 1 - clamp(forwardSpeed / t.maxSpeed, 0, 1)
    return t.engineAccel * throttle * headroom
  }

  if (throttle < 0) {
    // Reversing the throttle brakes first and only reverses once nearly stopped.
    if (forwardSpeed > 0.5) return t.brakeAccel * throttle
    const headroom = 1 - clamp(-forwardSpeed / t.maxReverseSpeed, 0, 1)
    return t.reverseAccel * throttle * headroom
  }

  return 0
}

export type VehicleStep = {
  readonly vehicle: Vehicle
  readonly events: readonly SimEvent[]
}

/**
 * Integrate one car for one tick. Steering, engine, grip, gravity, ground.
 *
 * Deliberately knows nothing about walls, blocks or other cars — that is
 * `arena.ts` and `contact.ts`, run after every car has moved. Mixing the two
 * means a car resolved against a wall before its neighbour has even moved.
 */
export function integrateVehicle(
  vehicle: Vehicle,
  input: InputFrame,
  arena: Arena,
  dt: number,
): VehicleStep {
  const t = tuningFor(vehicle.archetype)

  // ── steering ───────────────────────────────────────────────────────────────
  const entryForward = forwardOf(vehicle.yaw)
  const entrySpeed = vehicle.vel.x * entryForward.x + vehicle.vel.z * entryForward.z

  const steer = clamp(input.steer, -1, 1)
  const targetYawRate = steer * t.maxYawRate * steerAuthority(entrySpeed, t)

  // Sliding tyres cannot correct the car's rotation. This is the same
  // saturation that makes the handbrake work, applied to yaw authority, and it
  // is what lets a T-bone actually spin you out: without it, the steering
  // system drags any impact-induced spin back to zero inside a third of a
  // second and a hit leaves no trace at all.
  const slip = clamp(Math.abs(vehicle.lateralSpeed) / t.slipSaturation, 0, 1)
  const authority = 1 - slip * (1 - t.slidingYawAuthority)

  // Airborne cars keep spinning at whatever rate they left the ground with;
  // you have no tyres to steer with.
  const yawRate = vehicle.grounded
    ? moveToward(vehicle.yawRate, targetYawRate, t.yawAccel * authority * dt)
    : vehicle.yawRate
  const yaw = wrapAngle(vehicle.yaw + yawRate * dt)

  // ── decompose onto the car's *new* frame ───────────────────────────────────
  // Rotate the car first, then measure its velocity against the heading it now
  // has. This ordering is the whole handling model: the body turns, momentum
  // does not follow, and the difference between the two is the slip that grip
  // then has to fight. Decomposing before the rotation would carry the velocity
  // round with the car, and no amount of tuning would ever produce a slide.
  const forward = forwardOf(yaw)
  const right = rightOf(yaw)

  let forwardSpeed = vehicle.vel.x * forward.x + vehicle.vel.z * forward.z
  let lateralSpeed = vehicle.vel.x * right.x + vehicle.vel.z * right.z

  // ── longitudinal ───────────────────────────────────────────────────────────
  if (vehicle.grounded) {
    forwardSpeed += longitudinalAccel(forwardSpeed, input, t) * dt

    // Rolling resistance is a coasting force. Applying it under throttle would
    // silently move the real top speed away from the one in content.
    if (Math.abs(input.throttle) < 0.05) {
      forwardSpeed = decay(forwardSpeed, t.rollingResistance * dt)
    }
    if (input.handbrake) {
      forwardSpeed = decay(forwardSpeed, t.handbrakeDecel * dt)
    }

    forwardSpeed = clamp(forwardSpeed, -t.maxReverseSpeed, t.maxSpeed)

    // ── grip ─────────────────────────────────────────────────────────────────
    // A constant sideways deceleration. Drop it and the car slides; that is the
    // entire drift model, and it is deterministic (no exp, no pow).
    const grip = input.handbrake ? t.handbrakeLateralGrip : t.lateralGrip
    lateralSpeed = decay(lateralSpeed, grip * dt)
  }

  // ── recompose ──────────────────────────────────────────────────────────────
  let vel: Vec3 = {
    x: forward.x * forwardSpeed + right.x * lateralSpeed,
    y: vehicle.vel.y - t.gravity * dt,
    z: forward.z * forwardSpeed + right.z * lateralSpeed,
  }

  let pos: Vec3 = {
    x: vehicle.pos.x + vel.x * dt,
    y: vehicle.pos.y + vel.y * dt,
    z: vehicle.pos.z + vel.z * dt,
  }

  // ── ground ─────────────────────────────────────────────────────────────────
  // One rule covers flat ground, climbing a ramp, and launching off the end of
  // one. The car falls ballistically; if that puts it below the surface it is
  // placed on the surface and given the vertical speed it actually travelled.
  // On the flat that is zero. On a ramp it is the climb rate — which is still
  // in `vel.y` when the ramp runs out, and that is the jump.
  const events: SimEvent[] = []
  const restY = groundHeightAt(arena, pos.x, pos.z) + t.rideHeight
  let grounded = false

  if (pos.y <= restY) {
    // A car cannot climb steeper than its own speed, and never faster than
    // `maxLaunchSpeed`. The first stops a ramp flank firing the car into orbit;
    // the second is what keeps the kicker at the tall end of a ramp a stunt
    // rather than an ejection seat.
    const horizontal = Math.hypot(vel.x, vel.z)
    const ceiling = Math.min(horizontal, t.maxLaunchSpeed)
    const climbRate = clamp((restY - vehicle.pos.y) / dt, -horizontal, ceiling)

    if (!vehicle.grounded && vel.y < -t.landingThreshold) {
      events.push({ type: 'landed', id: vehicle.id, pos, magnitude: -vel.y })
    }

    pos = { x: pos.x, y: restY, z: pos.z }
    vel = { x: vel.x, y: climbRate, z: vel.z }
    grounded = true
  }

  return {
    vehicle: {
      ...vehicle,
      pos,
      vel,
      yaw,
      yawRate,
      grounded,
      // Re-derived from the velocity we are actually storing, so a wall bounce
      // is reflected here too rather than only in `vel`.
      forwardSpeed: vel.x * forward.x + vel.z * forward.z,
      lateralSpeed: vel.x * right.x + vel.z * right.z,
    },
    events,
  }
}
