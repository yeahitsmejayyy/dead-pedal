/**
 * M2 is done when "you can ram a second (stationary) car across the arena and
 * it feels like weight moved."
 *
 * "Feels like" is yours to judge. What is testable is everything that has to be
 * true before it can feel like anything: momentum actually transfers, the pair
 * never gains energy from nothing, contacts do not jitter, and a pile-up does
 * not explode.
 */
import { describe, expect, it } from 'vitest'
import { TICK_HZ } from '../../src/core/clock'
import { fromSeed, next } from '../../src/core/rng'
import * as V from '../../src/core/vec3'
import { PROVING_GROUND } from '../../src/content/arenas/proving-ground'
import { VEHICLES } from '../../src/content/vehicles'
import {
  NEUTRAL_INPUT,
  bodyCircles,
  createWorld,
  forwardOf,
  rectContact,
  step,
  type InputFrame,
  type Inputs,
  type Vehicle,
  type WorldState,
} from '../../src/sim'
import { resolveVehiclePairs } from '../../src/sim/contact'

const T = VEHICLES.roadster!

const OPEN = {
  ...PROVING_GROUND,
  blocks: [],
  ramps: [],
  spawns: [
    { pos: { x: 0, y: 0, z: -30 }, yaw: 0 },
    { pos: { x: 0, y: 0, z: 10 }, yaw: 0 },
    { pos: { x: 6, y: 0, z: 10 }, yaw: 0 },
  ],
}

const input = (partial: Partial<InputFrame>): InputFrame => ({ ...NEUTRAL_INPUT, ...partial })

/** Only car 0 gets input. Everything else is a stationary target. */
const rammerOnly = (frame: InputFrame): Inputs => new Map([[0, frame]])

function run(world: WorldState, frame: InputFrame, seconds: number): WorldState {
  const held = rammerOnly(frame)
  let next = world
  for (let i = 0; i < Math.round(seconds * TICK_HZ); i++) next = step(next, held)
  return next
}

const car = (world: WorldState, id: number): Vehicle => {
  const found = world.vehicles.find((v) => v.id === id)
  if (found === undefined) throw new Error(`no vehicle ${id}`)
  return found
}

const pair = (): WorldState => createWorld({ seed: 1, arena: OPEN, vehicles: 2 })

describe('the contact body matches the car you can see', () => {
  it('spans the body exactly: flanks at half-width, ends at half-length', () => {
    const circles = bodyCircles(T.halfExtents.x, T.halfExtents.z)

    expect(circles.length).toBeGreaterThan(1)
    for (const c of circles) {
      // Radius is the half-width, so two cars side by side stop touching, not
      // a half-metre apart.
      expect(c.radius).toBeCloseTo(T.halfExtents.x, 9)
    }

    const nose = circles[circles.length - 1]!
    const tail = circles[0]!
    expect(nose.offset + nose.radius).toBeCloseTo(T.halfExtents.z, 9)
    expect(tail.offset - tail.radius).toBeCloseTo(-T.halfExtents.z, 9)
  })

  it('leaves no gap between neighbouring circles', () => {
    const circles = bodyCircles(T.halfExtents.x, T.halfExtents.z)
    for (let i = 1; i < circles.length; i++) {
      const gap = circles[i]!.offset - circles[i - 1]!.offset
      expect(gap, 'a car could be threaded between two of its own circles').toBeLessThan(
        circles[i]!.radius + circles[i - 1]!.radius,
      )
    }
  })

  it('degrades to one circle for a body wider than it is long', () => {
    expect(bodyCircles(3, 1)).toHaveLength(1)
  })

  /** Closest the two centres ever get. Cars bounce apart, so the end state
   *  measures coasting; this measures the collision. */
  function closestApproach(
    world: WorldState,
    axis: 'x' | 'z',
    seconds: number,
  ): number {
    let current = world
    let closest = Number.POSITIVE_INFINITY
    for (let i = 0; i < Math.round(seconds * TICK_HZ); i++) {
      current = step(current, new Map())
      closest = Math.min(closest, Math.abs(car(current, 1).pos[axis] - car(current, 0).pos[axis]))
    }
    return closest
  }

  it('meets nose-to-tail at the body length, not at a radius', () => {
    // The bug this replaces: a 1.5m circle on a 4.2m body let the nose sink
    // 0.6m into the car in front, so centres closed to 3.0m on a 4.2m car.
    const base = createWorld({ seed: 1, arena: OPEN, vehicles: 2 })
    const world: WorldState = {
      ...base,
      vehicles: [
        { ...car(base, 0), pos: { x: 0, y: T.rideHeight, z: 2 }, vel: { x: 0, y: 0, z: 12 } },
        { ...car(base, 1), pos: { x: 0, y: T.rideHeight, z: 10 }, vel: { x: 0, y: 0, z: 0 } },
      ],
    }

    const closest = closestApproach(world, 'z', 3)
    const bodyLength = T.halfExtents.z * 2

    expect(closest, 'the nose still sinks into the car ahead').toBeGreaterThan(bodyLength - 0.15)
    expect(closest, 'stopping short of contact').toBeLessThan(bodyLength + 0.35)
  })

  it('separates side-by-side cars to exactly the body width', () => {
    // Driven through the resolver rather than through `step`: you cannot push a
    // car sideways into another one, because the tyres kill lateral velocity in
    // about seven ticks. This is a claim about the shape, so it is tested on the
    // shape.
    const base = createWorld({ seed: 1, arena: OPEN, vehicles: 2 })
    let vehicles: Vehicle[] = [
      { ...car(base, 0), pos: { x: -0.8, y: T.rideHeight, z: 10 }, vel: { x: 0, y: 0, z: 0 } },
      { ...car(base, 1), pos: { x: 0.8, y: T.rideHeight, z: 10 }, vel: { x: 0, y: 0, z: 0 } },
    ]

    for (let i = 0; i < 8; i++) vehicles = resolveVehiclePairs(vehicles).vehicles

    const gap = Math.abs(vehicles[1]!.pos.x - vehicles[0]!.pos.x)
    // The old single 1.5m circle settled these 3.0m apart — a 1.1m air gap
    // between two cars that look like they are touching.
    expect(gap).toBeCloseTo(T.halfExtents.x * 2, 1)
  })

  it('separates nose-to-tail cars to exactly the body length', () => {
    const base = createWorld({ seed: 1, arena: OPEN, vehicles: 2 })
    let vehicles: Vehicle[] = [
      { ...car(base, 0), pos: { x: 0, y: T.rideHeight, z: 8 }, vel: { x: 0, y: 0, z: 0 } },
      { ...car(base, 1), pos: { x: 0, y: T.rideHeight, z: 10 }, vel: { x: 0, y: 0, z: 0 } },
    ]

    for (let i = 0; i < 8; i++) vehicles = resolveVehiclePairs(vehicles).vehicles

    const gap = Math.abs(vehicles[1]!.pos.z - vehicles[0]!.pos.z)
    // The old shape settled these 3.0m apart on a 4.2m car — 1.2m of one car
    // buried in the other.
    expect(gap).toBeCloseTo(T.halfExtents.z * 2, 1)
  })

  it('never leaves two car rectangles overlapping once they settle', () => {
    // The check that matches what you actually see on screen.
    let rng = fromSeed(777)
    const roll = (): number => {
      const draw = next(rng)
      rng = draw.state
      return draw.value
    }

    for (let attempt = 0; attempt < 120; attempt++) {
      const base = createWorld({ seed: 1, arena: OPEN, vehicles: 2 })
      const yawA = (roll() - 0.5) * 8
      const fwd = forwardOf(yawA)
      const speed = 8 + roll() * 30

      let world: WorldState = {
        ...base,
        vehicles: [
          {
            ...car(base, 0),
            pos: { x: (roll() - 0.5) * 6, y: T.rideHeight, z: -6 },
            yaw: yawA,
            vel: { x: fwd.x * speed, y: 0, z: fwd.z * speed },
          },
          {
            ...car(base, 1),
            pos: { x: 0, y: T.rideHeight, z: 0 },
            yaw: (roll() - 0.5) * 8,
            vel: { x: 0, y: 0, z: 0 },
          },
        ],
      }

      world = run(world, NEUTRAL_INPUT, 6)

      const shape = (v: Vehicle) => ({
        x: v.pos.x,
        z: v.pos.z,
        halfX: T.halfExtents.x,
        halfZ: T.halfExtents.z,
        yaw: v.yaw,
      })
      const overlap = rectContact(shape(car(world, 0)), shape(car(world, 1)))

      // A chain of circles is a rounded rectangle, so the four corners are
      // undercut by (diagonal from the end circle's centre) − radius. Two cars
      // meeting corner-to-corner can overlap by twice that and no more. Derived
      // rather than hardcoded, so retuning the body cannot quietly loosen it.
      const cornerUndercut = Math.hypot(T.halfExtents.x, T.halfExtents.x) - T.halfExtents.x
      const depth = overlap?.depth ?? 0

      expect(
        depth,
        `attempt ${attempt}: cars settled ${depth.toFixed(2)}m inside each other`,
      ).toBeLessThanOrEqual(cornerUndercut * 2)
    }
  })
})

describe('ramming', () => {
  it('moves a stationary car a long way', () => {
    const world = run(pair(), input({ throttle: 1 }), 4)
    const target = car(world, 1)

    // Spawned at z = 10, rammed from behind at speed.
    expect(target.pos.z, 'the target barely moved').toBeGreaterThan(30)
    expect(V.isFinite(target.vel)).toBe(true)
  })

  it('transfers momentum from the rammer to the target', () => {
    let world = pair()
    // Get up to speed well before contact.
    world = run(world, input({ throttle: 1 }), 1.6)
    const before = { rammer: car(world, 0).vel.z, target: car(world, 1).vel.z }

    world = run(world, input({ throttle: 1 }), 1.2)
    const after = { rammer: car(world, 0).vel.z, target: car(world, 1).vel.z }

    expect(before.target).toBeCloseTo(0, 6)
    expect(after.target, 'the target gained no speed').toBeGreaterThan(8)
    expect(after.rammer, 'the rammer lost nothing').toBeLessThan(before.rammer)
  })

  it('never lets a contact create energy at all', () => {
    // Two cars, closing head-on, no throttle at all: whatever comes out of the
    // collision is entirely the collision's doing.
    const base = createWorld({ seed: 1, arena: OPEN, vehicles: 2 })
    let world: WorldState = {
      ...base,
      vehicles: [
        { ...car(base, 0), pos: { x: 0, y: T.rideHeight, z: -10 }, vel: { x: 0, y: 0, z: 30 } },
        {
          ...car(base, 1),
          pos: { x: 0, y: T.rideHeight, z: 10 },
          yaw: Math.PI,
          vel: { x: 0, y: 0, z: -30 },
        },
      ],
    }

    const energy = (w: WorldState): number =>
      w.vehicles.reduce((sum, v) => sum + 0.5 * T.mass * V.lengthSq(v.vel), 0)

    const before = energy(world)
    world = run(world, NEUTRAL_INPUT, 2)

    // With restitution as the only knob and it below 1, a collision can only
    // ever remove kinetic energy. No tolerance needed, and no way for a tuning
    // change to quietly reintroduce an energy pump.
    expect(energy(world)).toBeLessThan(before)
  })

  it('conserves momentum across the collision itself', () => {
    // Tested against `resolveVehiclePairs` rather than a whole `step`, because
    // a tick also runs the engine, rolling resistance and grip — all of which
    // legitimately change momentum. This is the collision's own contract.
    const base = createWorld({ seed: 1, arena: OPEN, vehicles: 2 })
    const before = [
      { ...car(base, 0), pos: { x: 0, y: T.rideHeight, z: 7.4 }, vel: { x: 3, y: 0, z: 24 } },
      { ...car(base, 1), pos: { x: 0, y: T.rideHeight, z: 10 }, vel: { x: 0, y: 0, z: 0 } },
    ]

    const result = resolveVehiclePairs(before)
    const sum = (vs: readonly Vehicle[], axis: 'x' | 'z'): number =>
      vs.reduce((total, v) => total + v.vel[axis] * VEHICLES[v.archetype]!.mass, 0)

    expect(result.events.some((e) => e.type === 'impact')).toBe(true)
    expect(sum(result.vehicles, 'z')).toBeCloseTo(sum(before, 'z'), 6)
    expect(sum(result.vehicles, 'x')).toBeCloseTo(sum(before, 'x'), 6)
  })

  it('spins a car hit off-centre, and not one hit through its centre', () => {
    // Torque now comes from the real contact offset, so what decides a spin is
    // *where* you hit, not how side-on you are. A T-bone dead through the
    // target's middle has zero lever arm and correctly produces no rotation —
    // catching it on a quarter panel is what sends it round.
    const base = createWorld({ seed: 1, arena: OPEN, vehicles: 2 })

    const sideOn = (aimZ: number): WorldState => ({
      ...base,
      vehicles: [
        {
          ...car(base, 0),
          pos: { x: -8, y: T.rideHeight, z: aimZ },
          yaw: -Math.PI / 2, // faces +X
          vel: { x: 30, y: 0, z: 0 },
        },
        { ...car(base, 1), pos: { x: 0, y: T.rideHeight, z: 10 }, vel: { x: 0, y: 0, z: 0 } },
      ],
    })

    const quarterPanel = Math.abs(car(run(sideOn(11.7), NEUTRAL_INPUT, 0.4), 1).yawRate)
    const throughTheMiddle = Math.abs(car(run(sideOn(10), NEUTRAL_INPUT, 0.4), 1).yawRate)

    expect(quarterPanel, 'a quarter-panel hit should spin the car').toBeGreaterThan(0.8)
    expect(throughTheMiddle, 'a centred hit has no lever arm').toBeLessThan(quarterPanel / 4)
  })

  it('keeps even a hard off-centre spin recoverable', () => {
    // A hit that pins yawRate at the clamp is unrecoverable rather than
    // dramatic, so the worst case has to stay inside the envelope the tyres can
    // actually fight back against.
    const base = createWorld({ seed: 1, arena: OPEN, vehicles: 2 })
    const worst: WorldState = {
      ...base,
      vehicles: [
        {
          ...car(base, 0),
          pos: { x: -8, y: T.rideHeight, z: 11.9 },
          yaw: -Math.PI / 2,
          vel: { x: T.maxSpeed, y: 0, z: 0 },
        },
        { ...car(base, 1), pos: { x: 0, y: T.rideHeight, z: 10 }, vel: { x: 0, y: 0, z: 0 } },
      ],
    }

    const peak = Math.abs(car(run(worst, NEUTRAL_INPUT, 0.3), 1).yawRate)
    expect(peak, 'a top-speed clip should not pin the spin clamp').toBeLessThan(7.9)

    // And it settles rather than spinning forever.
    const later = Math.abs(car(run(worst, NEUTRAL_INPUT, 4), 1).yawRate)
    expect(later).toBeLessThan(peak / 2)
  })

  it('reports an impact naming both cars', () => {
    let world = pair()
    let impacts: { id: number; against: number | null }[] = []
    for (let i = 0; i < 4 * TICK_HZ && impacts.length === 0; i++) {
      world = step(world, rammerOnly(input({ throttle: 1 })))
      // `filter` does not narrow a union for the following `map`, so narrow in
      // a loop instead of casting.
      impacts = []
      for (const e of world.events) {
        if (e.type === 'impact' && e.against !== null) impacts.push({ id: e.id, against: e.against })
      }
    }

    expect(impacts).toHaveLength(2)
    expect(impacts.map((i) => i.id).sort()).toEqual([0, 1])
    expect(impacts.every((i) => i.against !== null)).toBe(true)
  })

  it('does not jitter when cars rest against each other', () => {
    // Two touching cars with no input must go quiet, not buzz.
    const base = createWorld({ seed: 1, arena: OPEN, vehicles: 2 })
    let world: WorldState = {
      ...base,
      vehicles: [
        { ...car(base, 0), pos: { x: 0, y: T.rideHeight, z: 8.2 }, vel: { x: 0, y: 0, z: 0 } },
        { ...car(base, 1), pos: { x: 0, y: T.rideHeight, z: 10 }, vel: { x: 0, y: 0, z: 0 } },
      ],
    }

    world = run(world, NEUTRAL_INPUT, 4)
    for (const v of world.vehicles) {
      expect(V.length(v.vel), `car ${v.id} is still moving`).toBeLessThan(0.5)
    }
    // And they ended up apart, not overlapping.
    const gap = Math.abs(car(world, 0).pos.z - car(world, 1).pos.z)
    expect(gap).toBeGreaterThanOrEqual(T.bodyRadius * 2 - 0.01)
  })

  it('survives a three-car pile-up without exploding', () => {
    let world = createWorld({ seed: 1, arena: OPEN, vehicles: 3 })
    world = run(world, input({ throttle: 1 }), 6)

    for (const v of world.vehicles) {
      expect(V.isFinite(v.pos), `car ${v.id} position`).toBe(true)
      expect(V.isFinite(v.vel), `car ${v.id} velocity`).toBe(true)
      expect(V.length(v.vel), `car ${v.id} velocity ran away`).toBeLessThan(T.maxSpeed * 2)
      expect(Math.abs(v.yawRate)).toBeLessThanOrEqual(8.001)
    }
  })

  it('stays sane under 200 random two-car collisions', () => {
    let rng = fromSeed(31337)
    const roll = (): number => {
      const draw = next(rng)
      rng = draw.state
      return draw.value
    }

    for (let attempt = 0; attempt < 200; attempt++) {
      const base = createWorld({ seed: 1, arena: OPEN, vehicles: 2 })
      const yawA = (roll() - 0.5) * 8
      const yawB = (roll() - 0.5) * 8
      const speed = roll() * 90
      const fwd = forwardOf(yawA)

      let world: WorldState = {
        ...base,
        vehicles: [
          {
            ...car(base, 0),
            pos: { x: (roll() - 0.5) * 4, y: T.rideHeight, z: -4 },
            yaw: yawA,
            vel: { x: fwd.x * speed, y: 0, z: fwd.z * speed },
          },
          {
            ...car(base, 1),
            pos: { x: (roll() - 0.5) * 4, y: T.rideHeight, z: 0 },
            yaw: yawB,
            vel: { x: 0, y: 0, z: 0 },
          },
        ],
      }

      world = run(world, NEUTRAL_INPUT, 1.5)
      for (const v of world.vehicles) {
        expect(V.isFinite(v.pos), `attempt ${attempt}, car ${v.id}`).toBe(true)
        expect(V.isFinite(v.vel), `attempt ${attempt}, car ${v.id}`).toBe(true)
        expect(V.length(v.vel), `attempt ${attempt}, car ${v.id} ran away`).toBeLessThan(300)
      }
    }
  })
})
