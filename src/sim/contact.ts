/**
 * L1 — car versus car.
 *
 * PLAN.md rates this the hard half of M2: "car-vs-car ramming that feels weighty
 * and doesn't explode into jitter is the hard part." Four things keep it calm:
 *
 * 1. **Circles, not boxes.** Every contact normal is a line of centres, so it
 *    varies smoothly as cars slide past each other. A box corner can flip its
 *    normal ninety degrees between two ticks, and that is what jitter is. The
 *    chain of them in `bodyCircles` is what makes that shape match the car.
 * 2. **Sequential resolution.** Each sub-contact is re-measured against
 *    already-updated positions and velocities, so several circles touching at
 *    once cannot each apply a full shove.
 * 3. **Separating pairs are skipped.** Two circles already moving apart never
 *    get another impulse, which is what stops a contact pumping energy.
 * 4. **Torque comes from the contact offset**, not a fudge. A hit away from the
 *    centre of mass spins the car because that is what an off-centre impulse
 *    does — no separate rule that has to be kept consistent with the first one.
 *
 * There used to be a second knob here, `ramBoost`, meant to make hits punchier
 * than physics. It was redundant: the impulse is a single scalar, so scaling it
 * and raising restitution are the same operation, and having both meant the
 * number labelled "restitution" produced (1 + e) × boost − 1 instead of e.
 * Momentum conservation leaves no room for "shove harder without bouncing
 * more" between two equal masses — the lever for a heavy-feeling hit that does
 * not ping-pong is feedback (shake, hit-stop), which is M7.
 */
import { tuningFor, type VehicleTuning } from '../content/vehicles'
import { bodyCircles, circleContact, yawInertia, type BodyCircle } from './collision'
import { forwardOf, rightOf } from './vehicle'
import type { SimEvent, Vehicle } from './types'

/** Below this closing speed a touch is a nudge, not a ram. */
const RAM_THRESHOLD = 1.5

/** Overlap we do not bother correcting. Stops resting cars micro-jittering. */
const SLOP = 0.004

type Body = {
  x: number
  z: number
  vx: number
  vy: number
  vz: number
  yaw: number
  yawRate: number
  readonly invMass: number
  readonly invInertia: number
  readonly circles: readonly BodyCircle[]
  readonly forwardX: number
  readonly forwardZ: number
}

function makeBody(vehicle: Vehicle, t: VehicleTuning): Body {
  const forward = forwardOf(vehicle.yaw)
  // `spinFromImpact` scales how readily the car rotates by pretending it is
  // lighter about its own axis. Scaling the inertia rather than the resulting
  // spin keeps the impulse solve self-consistent: the same number appears in
  // the effective mass and in the response, so energy cannot appear from a
  // mismatch between them.
  const inertia = yawInertia(t.mass, t.halfExtents.x, t.halfExtents.z) / t.spinFromImpact

  return {
    x: vehicle.pos.x,
    z: vehicle.pos.z,
    vx: vehicle.vel.x,
    vy: vehicle.vel.y,
    vz: vehicle.vel.z,
    yaw: vehicle.yaw,
    yawRate: vehicle.yawRate,
    invMass: 1 / t.mass,
    invInertia: 1 / inertia,
    circles: bodyCircles(t.halfExtents.x, t.halfExtents.z),
    forwardX: forward.x,
    forwardZ: forward.z,
  }
}

/**
 * Velocity of the point `r` (relative to the centre) on a yawing body.
 *
 * The sim's yaw is a compass heading, so a positive `yawRate` is a rotation of
 * `-yawRate` about world +Y. Getting that sign wrong makes cars spin *into*
 * each other on contact, so it is spelled out rather than inlined.
 */
function pointVelocityX(body: Body, rz: number): number {
  return body.vx - body.yawRate * rz
}
function pointVelocityZ(body: Body, rx: number): number {
  return body.vz + body.yawRate * rx
}

/** Yaw change from an impulse `(jx, jz)` applied at offset `(rx, rz)`. */
function yawFromImpulse(body: Body, rx: number, rz: number, jx: number, jz: number): number {
  return (rx * jz - rz * jx) * body.invInertia
}

/** How much of a unit normal at `r` resists rotation. Used in the effective mass. */
function angularTerm(body: Body, rx: number, rz: number, nx: number, nz: number): number {
  const lever = rx * nz - rz * nx
  return lever * lever * body.invInertia
}

export function resolveVehiclePairs(vehicles: readonly Vehicle[]): {
  vehicles: Vehicle[]
  events: SimEvent[]
} {
  const events: SimEvent[] = []
  const tunings = vehicles.map((v) => tuningFor(v.archetype))
  const bodies = vehicles.map((v, i) => makeBody(v, tunings[i]!))

  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i]!
      const b = bodies[j]!

      const restitution = Math.max(tunings[i]!.restitution, tunings[j]!.restitution)

      let hardest = 0
      let hitX = 0
      let hitZ = 0

      for (const ca of a.circles) {
        for (const cb of b.circles) {
          // Re-read positions every sub-contact: an earlier one may already have
          // pushed these two apart, and then there is nothing left to solve.
          const ax = a.x + a.forwardX * ca.offset
          const az = a.z + a.forwardZ * ca.offset
          const bx = b.x + b.forwardX * cb.offset
          const bz = b.z + b.forwardZ * cb.offset

          const contact = circleContact(ax, az, ca.radius, bx, bz, cb.radius)
          if (contact === null) continue

          const { nx, nz, depth } = contact

          // ── separate, in proportion to how immovable each one is ───────────
          if (depth > SLOP) {
            const totalInv = a.invMass + b.invMass
            const push = depth - SLOP
            a.x += (nx * push * a.invMass) / totalInv
            a.z += (nz * push * a.invMass) / totalInv
            b.x -= (nx * push * b.invMass) / totalInv
            b.z -= (nz * push * b.invMass) / totalInv
          }

          // ── impulse at the contact point ───────────────────────────────────
          // Halfway between the two surfaces along the normal.
          const px = ax - nx * (ca.radius - depth / 2)
          const pz = az - nz * (ca.radius - depth / 2)

          const rax = px - a.x
          const raz = pz - a.z
          const rbx = px - b.x
          const rbz = pz - b.z

          const relX = pointVelocityX(a, raz) - pointVelocityX(b, rbz)
          const relZ = pointVelocityZ(a, rax) - pointVelocityZ(b, rbx)
          const normalSpeed = relX * nx + relZ * nz

          // `n` points from b to a, so a negative projection means closing.
          if (normalSpeed > 0) continue

          const effectiveMass =
            a.invMass +
            b.invMass +
            angularTerm(a, rax, raz, nx, nz) +
            angularTerm(b, rbx, rbz, nx, nz)

          const magnitude = (-(1 + restitution) * normalSpeed) / effectiveMass
          const jx = nx * magnitude
          const jz = nz * magnitude

          // Equal and opposite, so linear momentum is conserved exactly.
          a.vx += jx * a.invMass
          a.vz += jz * a.invMass
          b.vx -= jx * b.invMass
          b.vz -= jz * b.invMass

          a.yawRate += yawFromImpulse(a, rax, raz, jx, jz)
          b.yawRate -= yawFromImpulse(b, rbx, rbz, jx, jz)

          const speed = -normalSpeed
          if (speed > hardest) {
            hardest = speed
            hitX = px
            hitZ = pz
          }
        }
      }

      if (hardest > RAM_THRESHOLD) {
        const pos = { x: hitX, y: (vehicles[i]!.pos.y + vehicles[j]!.pos.y) / 2, z: hitZ }
        events.push({
          type: 'impact',
          id: vehicles[i]!.id,
          against: vehicles[j]!.id,
          pos,
          magnitude: hardest,
        })
        events.push({
          type: 'impact',
          id: vehicles[j]!.id,
          against: vehicles[i]!.id,
          pos,
          magnitude: hardest,
        })
      }
    }
  }

  const resolved = vehicles.map((v, index) => {
    const body = bodies[index]!
    const forward = forwardOf(v.yaw)
    const right = rightOf(v.yaw)
    // Spin has to stay inside what the rest of the sim expects; a hit that sent
    // a car past this would be unrecoverable rather than dramatic.
    const yawRate = Math.max(-8, Math.min(8, body.yawRate))

    return {
      ...v,
      pos: { x: body.x, y: v.pos.y, z: body.z },
      vel: { x: body.vx, y: body.vy, z: body.vz },
      yawRate,
      forwardSpeed: body.vx * forward.x + body.vz * forward.z,
      lateralSpeed: body.vx * right.x + body.vz * right.z,
    }
  })

  return { vehicles: resolved, events }
}
