/**
 * M2's collision tests, straight from PLAN.md §4:
 *
 *   - car at 40 m/s into a wall at 15° exits along the wall, no penetration
 *   - high-speed head-on does not tunnel at any dt the game will ever see
 *   - 500 random spawn/velocity pairs produce no NaNs, no penetration, no
 *     unbounded velocity after 600 ticks
 */
import { describe, expect, it } from 'vitest'
import { TICK_HZ } from '../../src/core/clock'
import { fromSeed, next } from '../../src/core/rng'
import * as V from '../../src/core/vec3'
import { PROVING_GROUND } from '../../src/content/arenas/proving-ground'
import { VEHICLES } from '../../src/content/vehicles'
import {
  NEUTRAL_INPUT,
  apexOf,
  circleContact,
  createWorld,
  forwardOf,
  groundHeightAt,
  radiusOn,
  rectContact,
  step,
  type InputFrame,
  type Inputs,
  type Vehicle,
  type WorldState,
} from '../../src/sim'

const T = VEHICLES.roadster!

const input = (partial: Partial<InputFrame>): InputFrame => ({ ...NEUTRAL_INPUT, ...partial })
const inputs = (frame: InputFrame): Inputs => new Map([[0, frame]])

function drive(world: WorldState, frame: InputFrame, seconds: number): WorldState {
  const held = inputs(frame)
  let next = world
  for (let i = 0; i < Math.round(seconds * TICK_HZ); i++) next = step(next, held)
  return next
}

const car = (world: WorldState, id = 0): Vehicle => {
  const found = world.vehicles.find((v) => v.id === id)
  if (found === undefined) throw new Error(`no vehicle ${id}`)
  return found
}

describe('rectContact', () => {
  const unit = { x: 0, z: 0, halfX: 1, halfZ: 1, yaw: 0 }

  it('finds no contact between separated rectangles', () => {
    expect(rectContact(unit, { ...unit, x: 2.01 })).toBeNull()
    expect(rectContact(unit, { ...unit, z: 2.01 })).toBeNull()
  })

  it('finds contact on overlap and reports the shallower axis', () => {
    // Overlapping 0.2 in x and 1.5 in z — the minimum translation is in x.
    const contact = rectContact(unit, { ...unit, x: 1.8, z: 0.5 })
    expect(contact).not.toBeNull()
    expect(contact!.depth).toBeCloseTo(0.2, 9)
    expect(Math.abs(contact!.nx)).toBeCloseTo(1, 9)
  })

  it('points the normal so it pushes the first rectangle out', () => {
    const right = rectContact(unit, { ...unit, x: 1.5 })!
    const left = rectContact(unit, { ...unit, x: -1.5 })!
    expect(right.nx).toBeLessThan(0) // b is to the +x side, so push a to -x
    expect(left.nx).toBeGreaterThan(0)
  })

  it('detects rotation-only overlap that an AABB test would miss', () => {
    // Corner-to-corner at 45°: centres 2.6 apart, so axis-aligned boxes would
    // be clear on both axes, but the rotated diagonals reach 2.83.
    const a = { x: 0, z: 0, halfX: 1, halfZ: 1, yaw: Math.PI / 4 }
    const b = { x: 1.3, z: 1.3, halfX: 1, halfZ: 1, yaw: Math.PI / 4 }
    expect(rectContact(a, b)).not.toBeNull()
  })

  it('is symmetric in detection and opposite in normal', () => {
    const a = { x: 0, z: 0, halfX: 2, halfZ: 1, yaw: 0.3 }
    const b = { x: 1.5, z: 0.7, halfX: 1, halfZ: 3, yaw: -1.1 }
    const forward = rectContact(a, b)!
    const backward = rectContact(b, a)!
    expect(forward.depth).toBeCloseTo(backward.depth, 9)
    expect(forward.nx).toBeCloseTo(-backward.nx, 9)
    expect(forward.nz).toBeCloseTo(-backward.nz, 9)
  })
})

describe('circleContact', () => {
  it('misses when apart and hits when overlapping', () => {
    expect(circleContact(0, 0, 1, 2.01, 0, 1)).toBeNull()
    expect(circleContact(0, 0, 1, 1.5, 0, 1)!.depth).toBeCloseTo(0.5, 9)
  })

  it('stays deterministic for exactly co-located circles', () => {
    const a = circleContact(5, 5, 1, 5, 5, 1)!
    const b = circleContact(5, 5, 1, 5, 5, 1)!
    expect(a).toEqual(b)
    expect(Math.hypot(a.nx, a.nz)).toBeCloseTo(1, 9)
  })
})

describe('ground', () => {
  it('is flat away from ramps', () => {
    expect(groundHeightAt(PROVING_GROUND, 0, 0)).toBe(PROVING_GROUND.groundY)
  })

  // jump-w has yaw 0, so its local Z axis is the world Z axis and `along` reads
  // directly off the world coordinate. That is the only reason these tests can
  // talk about offsets instead of rotating first.
  const JUMP_W = PROVING_GROUND.ramps.find((r) => r.id === 'jump-w')!
  const surfaceAt = (along: number): number =>
    groundHeightAt(PROVING_GROUND, JUMP_W.pos.x, JUMP_W.pos.z + along)

  it('climbs to the ridge and falls away again', () => {
    const apex = apexOf(JUMP_W)
    expect(apex, 'the ridge should sit a backRun short of the front edge').toBe(
      JUMP_W.halfExtents.z - JUMP_W.backRun,
    )

    expect(surfaceAt(-JUMP_W.halfExtents.z + 0.01)).toBeCloseTo(JUMP_W.pos.y, 1)
    expect(surfaceAt(apex)).toBeCloseTo(JUMP_W.pos.y + JUMP_W.rise, 9)
    // Both ends are on the floor. This is the whole change: the far end used to
    // be a vertical face at full height.
    expect(surfaceAt(JUMP_W.halfExtents.z - 0.01)).toBeCloseTo(JUMP_W.pos.y, 1)
  })

  it('is level across its width', () => {
    const mid = surfaceAt(0)
    expect(groundHeightAt(PROVING_GROUND, JUMP_W.pos.x + 3, JUMP_W.pos.z)).toBeCloseTo(mid, 9)
    expect(groundHeightAt(PROVING_GROUND, JUMP_W.pos.x - 3, JUMP_W.pos.z)).toBeCloseTo(mid, 9)
  })

  it('makes the boost side steeper than the approach', () => {
    const apex = apexOf(JUMP_W)
    const approach = JUMP_W.rise / (apex + JUMP_W.halfExtents.z)
    const boost = JUMP_W.rise / JUMP_W.backRun

    // Not merely different: the short side has to be enough of a kick to be
    // worth aiming at, and the long side has to stay the gentle run-up it was.
    expect(boost).toBeGreaterThan(approach * 2)
    expect((Math.atan(approach) * 180) / Math.PI).toBeLessThan(12)
    expect((Math.atan(boost) * 180) / Math.PI).toBeLessThan(30)
  })

  it('has no cliff anywhere along its length', () => {
    // The bug this shape exists to kill: a step in the surface is a step the
    // car takes in a single tick, which reads as being flung off a wall. Walk
    // the whole ramp at 1cm and assert nothing ever jumps.
    const step = 0.01
    let worst = 0
    for (let along = -JUMP_W.halfExtents.z - 1; along <= JUMP_W.halfExtents.z + 1; along += step) {
      worst = Math.max(worst, Math.abs(surfaceAt(along + step) - surfaceAt(along)))
    }
    // 1cm of travel up the steepest face is 0.45cm of rise, and nothing on the
    // ramp is steeper than that face.
    expect(worst).toBeLessThan(0.006)
  })

  it('returns to the floor past the end of a ramp', () => {
    const past = surfaceAt(JUMP_W.halfExtents.z + 0.5)
    expect(past).toBe(PROVING_GROUND.groundY)
  })
})

describe('car versus wall', () => {
  it('exits along the wall at a 15° approach, with no penetration', () => {
    // 15° off the wall's plane, at 40 m/s, into the east wall. The east wall
    // runs along Z, so the approach is mostly +Z with a small +X bite — which
    // is yaw −15°, not 75°.
    const grazing = (15 * Math.PI) / 180
    const approach = -grazing
    const base = createWorld({ seed: 1 })
    const forward = forwardOf(approach)

    let world: WorldState = {
      ...base,
      vehicles: [
        {
          ...car(base),
          pos: { x: 70, y: T.rideHeight, z: -60 },
          yaw: approach,
          vel: { x: forward.x * 40, y: 0, z: forward.z * 40 },
        },
      ],
    }

    // The car stops where its own footprint meets the wall, which depends on
    // its heading — measure it rather than assuming a fixed radius.
    const footprintX = (c: Vehicle): number =>
      radiusOn({ x: c.pos.x, z: c.pos.z, halfX: T.halfExtents.x, halfZ: T.halfExtents.z, yaw: c.yaw }, 1, 0)

    let contacted = false
    let alongAfterContact = 0

    for (let i = 0; i < 3 * TICK_HZ; i++) {
      world = step(world, inputs(input({ throttle: 1 })))
      const c = car(world)
      expect(c.pos.x + footprintX(c), `tick ${i}: penetrated the wall`).toBeLessThanOrEqual(
        base.arena.halfExtents.x + 1e-9,
      )
      if (!contacted && world.events.some((e) => e.type === 'impact')) {
        contacted = true
        alongAfterContact = Math.abs(c.vel.z)
      }
    }

    expect(contacted, 'never reached the wall').toBe(true)
    // A glancing hit costs some speed but must not stop the car dead: most of
    // the along-wall component survives.
    expect(alongAfterContact).toBeGreaterThan(40 * Math.cos(grazing) * 0.7)
  })

  it('does not tunnel through a block at twice the top speed', () => {
    // Barrier 'barrier-e' is 2.8m thick. One tick at 92 m/s is 1.53m, and the
    // car's own 4.2m length covers the rest — but assert it rather than assume.
    const barrier = PROVING_GROUND.blocks.find((b) => b.id === 'barrier-e')!
    const base = createWorld({ seed: 1 })

    for (const speed of [46, 60, 80, 92]) {
      let world: WorldState = {
        ...base,
        vehicles: [
          {
            ...car(base),
            pos: { x: barrier.pos.x - 30, y: T.rideHeight, z: barrier.pos.z },
            yaw: -Math.PI / 2, // faces +X
            vel: { x: speed, y: 0, z: 0 },
          },
        ],
      }

      let crossed = false
      for (let i = 0; i < 2 * TICK_HZ; i++) {
        world = step(world, inputs(NEUTRAL_INPUT))
        if (car(world).pos.x > barrier.pos.x + barrier.halfExtents.x + T.halfExtents.z) {
          crossed = true
          break
        }
      }
      expect(crossed, `tunnelled through the barrier at ${speed} m/s`).toBe(false)
    }
  })
})

describe('fuzz — 500 random launches into the furnished arena', () => {
  it('produces no NaN, no escape, and no runaway velocity', () => {
    let rng = fromSeed(90210)
    const roll = (): number => {
      const draw = next(rng)
      rng = draw.state
      return draw.value
    }

    const limitX = PROVING_GROUND.halfExtents.x
    const limitZ = PROVING_GROUND.halfExtents.z

    for (let run = 0; run < 500; run++) {
      const base = createWorld({ seed: 1 })
      let world: WorldState = {
        ...base,
        vehicles: [
          {
            ...car(base),
            pos: {
              x: (roll() - 0.5) * 2 * (limitX - 5),
              y: T.rideHeight + roll() * 6,
              z: (roll() - 0.5) * 2 * (limitZ - 5),
            },
            yaw: (roll() - 0.5) * 8,
            vel: { x: (roll() - 0.5) * 160, y: (roll() - 0.5) * 40, z: (roll() - 0.5) * 160 },
            grounded: false,
          },
        ],
      }

      const frame = input({
        throttle: roll() * 2 - 1,
        steer: roll() * 2 - 1,
        handbrake: roll() > 0.7,
      })

      world = drive(world, frame, 600 / TICK_HZ)
      const final = car(world)
      const where = `run ${run}`

      expect(V.isFinite(final.pos), `${where}: position went non-finite`).toBe(true)
      expect(V.isFinite(final.vel), `${where}: velocity went non-finite`).toBe(true)
      expect(Number.isFinite(final.yaw), `${where}: yaw went non-finite`).toBe(true)
      expect(Number.isFinite(final.yawRate), `${where}: yawRate went non-finite`).toBe(true)

      expect(Math.abs(final.pos.x), `${where}: escaped in x`).toBeLessThanOrEqual(limitX)
      expect(Math.abs(final.pos.z), `${where}: escaped in z`).toBeLessThanOrEqual(limitZ)
      expect(final.pos.y, `${where}: fell through the floor`).toBeGreaterThanOrEqual(
        PROVING_GROUND.groundY,
      )

      expect(V.length(final.vel), `${where}: velocity ran away`).toBeLessThanOrEqual(T.maxSpeed * 2)
      expect(Math.abs(final.yawRate), `${where}: spin ran away`).toBeLessThanOrEqual(8.001)
    }
  })

  it('settles a car buried inside a block instead of ejecting it', () => {
    // Spawning inside geometry happens; it must resolve calmly.
    const pillar = PROVING_GROUND.blocks.find((b) => b.id === 'pillar-n')!
    const base = createWorld({ seed: 1 })
    let world: WorldState = {
      ...base,
      vehicles: [
        {
          ...car(base),
          pos: { x: pillar.pos.x, y: T.rideHeight, z: pillar.pos.z },
          vel: { x: 0, y: 0, z: 0 },
        },
      ],
    }

    world = drive(world, NEUTRAL_INPUT, 3)
    const final = car(world)
    expect(V.isFinite(final.pos)).toBe(true)
    expect(V.length(final.vel)).toBeLessThan(T.maxSpeed)
  })
})
