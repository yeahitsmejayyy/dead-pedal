/**
 * L1 — what the world does to a car: ground height, walls, blocks.
 *
 * Split from `vehicle.ts` on purpose. Integration answers "where would the car
 * go"; this answers "where is it allowed to be", and the two have completely
 * different failure modes. Keeping them apart is what makes the fuzz test able
 * to say which one produced a NaN.
 */
import { clamp } from '../core/scalar'
import type { VehicleTuning } from '../content/vehicles'
import { type Contact, type Rect, radiusOn, rectContact, spansOverlap } from './collision'
import type { Arena, Ramp, SimEvent, Vehicle } from './types'

/**
 * Where the ridge sits along a ramp's local Z axis.
 *
 * Exported because the renderer builds the wedge mesh from it. The arena is
 * data and the mesh is built from that data, so there is no second source to
 * drift — but only as long as both sides ask the same question of it, and
 * nothing in the test suite can see a mesh to check that they do.
 */
export function apexOf(ramp: Ramp): number {
  return ramp.halfExtents.z - ramp.backRun
}

/** Where a point sits on a ramp's tented top, in the ramp's own frame. */
function rampHeightAt(ramp: Ramp, x: number, z: number): number | null {
  const dx = x - ramp.pos.x
  const dz = z - ramp.pos.z

  // Rotate into the ramp's frame. Compass convention, same as vehicles.
  const along = dx * -Math.sin(ramp.yaw) + dz * Math.cos(ramp.yaw)
  const across = dx * -Math.cos(ramp.yaw) + dz * -Math.sin(ramp.yaw)

  if (Math.abs(along) > ramp.halfExtents.z) return null
  if (Math.abs(across) > ramp.halfExtents.x) return null

  // Piecewise linear, with the two pieces meeting at the ridge. A `backRun` of
  // 0 puts the ridge on the front edge, so the second branch is unreachable and
  // the shape degrades to the plain wedge this used to be — no division by zero.
  const apex = apexOf(ramp)
  const climbed =
    along <= apex
      ? (along + ramp.halfExtents.z) / (apex + ramp.halfExtents.z)
      : (ramp.halfExtents.z - along) / ramp.backRun

  return ramp.pos.y + ramp.rise * climbed
}

/**
 * Height of the highest drivable surface under a point.
 *
 * Blocks are deliberately not drivable at M2 — they are obstacles you hit, not
 * platforms you land on. Driving on top of scenery is an M7 arena-authoring
 * question, and pretending otherwise here would mean solving step-up logic.
 */
export function groundHeightAt(arena: Arena, x: number, z: number): number {
  let height = arena.groundY
  for (const ramp of arena.ramps) {
    const rampY = rampHeightAt(ramp, x, z)
    if (rampY !== null && rampY > height) height = rampY
  }
  return height
}

export function rectOf(vehicle: Vehicle, tuning: VehicleTuning): Rect {
  return {
    x: vehicle.pos.x,
    z: vehicle.pos.z,
    halfX: tuning.halfExtents.x,
    halfZ: tuning.halfExtents.z,
    yaw: vehicle.yaw,
  }
}

/**
 * Push a car out of one contact and reflect the part of its velocity that was
 * heading into the surface.
 *
 * Tangential velocity survives with a friction scale — that is what "slide
 * along, don't stick" means, and it is why a glancing hit costs you speed but
 * not your line.
 */
function respond(
  vehicle: Vehicle,
  contact: Contact,
  tuning: VehicleTuning,
): { vehicle: Vehicle; closing: number } {
  const { nx, nz, depth } = contact

  const closing = -(vehicle.vel.x * nx + vehicle.vel.z * nz)
  if (closing <= 0) {
    // Already separating: depenetrate, but do not reflect. Reflecting here is
    // the classic way to trap a car vibrating inside a wall forever.
    return {
      vehicle: {
        ...vehicle,
        pos: { x: vehicle.pos.x + nx * depth, y: vehicle.pos.y, z: vehicle.pos.z + nz * depth },
      },
      closing: 0,
    }
  }

  const normalSpeed = vehicle.vel.x * nx + vehicle.vel.z * nz
  const tangentX = vehicle.vel.x - nx * normalSpeed
  const tangentZ = vehicle.vel.z - nz * normalSpeed

  const bounce = -normalSpeed * tuning.wallBounce
  const scrape = 1 - tuning.wallFriction

  return {
    vehicle: {
      ...vehicle,
      pos: { x: vehicle.pos.x + nx * depth, y: vehicle.pos.y, z: vehicle.pos.z + nz * depth },
      vel: {
        x: tangentX * scrape + nx * bounce,
        y: vehicle.vel.y,
        z: tangentZ * scrape + nz * bounce,
      },
    },
    closing,
  }
}

/**
 * Resolve a car against the arena bounds and every block.
 *
 * The outer bounds are a clamp rather than a collision test, and that is not
 * laziness: a clamp is an invariant that cannot be tunnelled through at any
 * speed, which is what lets the fuzz test assert containment unconditionally.
 */
export function resolveArena(
  vehicle: Vehicle,
  arena: Arena,
  tuning: VehicleTuning,
): { vehicle: Vehicle; events: SimEvent[] } {
  const events: SimEvent[] = []
  let current = vehicle

  // ── hard bounds ────────────────────────────────────────────────────────────
  // Measured from the car's actual footprint at its current heading, not from a
  // single radius: a 1.5m radius on a 4.2m body let the nose sink 0.6m into the
  // wall when square-on, and held the car 0.55m clear of it when side-on.
  const shape = rectOf(current, tuning)
  const limitX = arena.halfExtents.x - radiusOn(shape, 1, 0)
  const limitZ = arena.halfExtents.z - radiusOn(shape, 0, 1)

  if (current.pos.x < -limitX || current.pos.x > limitX) {
    const speed = Math.abs(current.vel.x)
    if (speed > IMPACT_THRESHOLD) {
      events.push({ type: 'impact', id: current.id, against: null, pos: current.pos, magnitude: speed })
    }
    current = {
      ...current,
      pos: { ...current.pos, x: clamp(current.pos.x, -limitX, limitX) },
      vel: {
        x: -current.vel.x * tuning.wallBounce,
        y: current.vel.y,
        z: current.vel.z * (1 - tuning.wallFriction),
      },
    }
  }

  if (current.pos.z < -limitZ || current.pos.z > limitZ) {
    const speed = Math.abs(current.vel.z)
    if (speed > IMPACT_THRESHOLD) {
      events.push({ type: 'impact', id: current.id, against: null, pos: current.pos, magnitude: speed })
    }
    current = {
      ...current,
      pos: { ...current.pos, z: clamp(current.pos.z, -limitZ, limitZ) },
      vel: {
        x: current.vel.x * (1 - tuning.wallFriction),
        y: current.vel.y,
        z: -current.vel.z * tuning.wallBounce,
      },
    }
  }

  // ── blocks ─────────────────────────────────────────────────────────────────
  const carSpan = {
    minY: current.pos.y - tuning.halfExtents.y,
    maxY: current.pos.y + tuning.halfExtents.y,
  }

  for (const block of arena.blocks) {
    const blockSpan = { minY: block.pos.y, maxY: block.pos.y + block.halfExtents.y * 2 }
    // Clear the roof and the block simply is not there. This is what lets a
    // ramp launch you over a crate.
    if (!spansOverlap(carSpan, blockSpan)) continue

    const contact = rectContact(rectOf(current, tuning), {
      x: block.pos.x,
      z: block.pos.z,
      halfX: block.halfExtents.x,
      halfZ: block.halfExtents.z,
      yaw: block.yaw,
    })
    if (contact === null) continue

    const result = respond(current, contact, tuning)
    current = result.vehicle
    if (result.closing > IMPACT_THRESHOLD) {
      events.push({
        type: 'impact',
        id: current.id,
        against: null,
        pos: current.pos,
        magnitude: result.closing,
      })
    }
  }

  return { vehicle: current, events }
}

/** Below this, a contact is a scrape rather than a hit worth hearing. */
export const IMPACT_THRESHOLD = 1.5
