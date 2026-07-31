/**
 * M1's handling tests. Every one asserts a *designed* property with a tolerance,
 * not a recorded number — retuning inside the design intent must not turn these
 * red, and stepping outside it must.
 */
import { describe, expect, it } from 'vitest'
import { TICK_DT, TICK_HZ } from '../../src/core/clock'
import { fromSeed, next } from '../../src/core/rng'
import * as V from '../../src/core/vec3'
import { PROVING_GROUND } from '../../src/content/arenas/proving-ground'
import { VEHICLES } from '../../src/content/vehicles'
import {
  NEUTRAL_INPUT,
  createWorld,
  forwardOf,
  headingOf,
  rightOf,
  step,
  steerAuthority,
  type InputFrame,
  type Inputs,
  type Vehicle,
  type WorldState,
} from '../../src/sim'

const T = VEHICLES.roadster!

function input(partial: Partial<InputFrame>): InputFrame {
  return { ...NEUTRAL_INPUT, ...partial }
}

function inputs(frame: InputFrame): Inputs {
  return new Map([[0, frame]])
}

/** Drive car 0 with one held input for `seconds`, returning the final world. */
function drive(world: WorldState, frame: InputFrame, seconds: number): WorldState {
  const held = inputs(frame)
  let next = world
  for (let i = 0; i < Math.round(seconds * TICK_HZ); i++) next = step(next, held)
  return next
}

function car(world: WorldState): Vehicle {
  const vehicle = world.vehicles[0]
  if (vehicle === undefined) throw new Error('no vehicle')
  return vehicle
}

/**
 * Handling tests run on an empty arena, huge and unfurnished.
 *
 * A car at full throttle covers 60m in three seconds, so the real arena would
 * quietly turn "brakes harder than it coasts" into "hit the north pillar".
 * Stripping the blocks and ramps as well as widening the bounds is the point:
 * these tests are about the car, and anything the arena contributes is noise
 * that `collision.test.ts` and the fuzz run are responsible for instead.
 */
const OPEN = {
  ...PROVING_GROUND,
  halfExtents: { x: 5000, z: 5000 },
  blocks: [],
  ramps: [],
  spawns: [{ pos: { x: 0, y: 0, z: 0 }, yaw: 0 }],
}

const fresh = (): WorldState => createWorld({ seed: 1, arena: OPEN })
const enclosed = (): WorldState => createWorld({ seed: 1, arena: PROVING_GROUND })

describe('the car frame', () => {
  it('faces +Z at yaw 0', () => {
    expect(V.equals(forwardOf(0), V.vec3(0, 0, 1))).toBe(true)
  })

  it('puts right on -X when facing +Z', () => {
    // three.js is right-handed with +Y up, so an object facing +Z has +X on its
    // *left*. Getting this backwards inverted the steering and flipped the sign
    // of every slip readout.
    expect(V.equals(rightOf(0), V.vec3(-1, 0, 0))).toBe(true)
  })

  it('is a right-handed basis at every heading', () => {
    // The one invariant that pins the whole convention: right × forward = up.
    for (let yaw = -Math.PI; yaw <= Math.PI; yaw += 0.05) {
      const basis = V.cross(rightOf(yaw), forwardOf(yaw))
      expect(V.equals(basis, V.UP, 1e-12), `yaw ${yaw.toFixed(2)}`).toBe(true)
      expect(V.dot(forwardOf(yaw), rightOf(yaw))).toBeCloseTo(0, 12)
      expect(V.length(forwardOf(yaw))).toBeCloseTo(1, 12)
    }
  })

  it('increases yaw when turning toward the right', () => {
    // A small positive yaw step must rotate `forward` toward `right`.
    const step = 1e-4
    for (const yaw of [-2, -0.5, 0, 0.5, 2, 3]) {
      const swept = V.sub(forwardOf(yaw + step), forwardOf(yaw))
      expect(V.dot(swept, rightOf(yaw))).toBeGreaterThan(0)
    }
  })

  it('headingOf inverts forwardOf', () => {
    for (let yaw = -3; yaw <= 3; yaw += 0.25) {
      const f = forwardOf(yaw)
      expect(headingOf(f.x, f.z)).toBeCloseTo(yaw, 9)
    }
  })
})

describe('steerAuthority', () => {
  it('is zero when parked — a stationary car does not pirouette', () => {
    expect(steerAuthority(0, T)).toBe(0)
  })

  it('reaches full authority by the speed floor', () => {
    expect(steerAuthority(T.steerSpeedFloor, T)).toBeCloseTo(1, 6)
  })

  it('inverts when reversing, the way a real car does', () => {
    expect(steerAuthority(-10, T)).toBeLessThan(0)
    expect(steerAuthority(-10, T)).toBeCloseTo(-steerAuthority(10, T), 6)
  })

  it('washes out at speed, down to the designed fraction', () => {
    expect(steerAuthority(T.steerSpeedOptimal, T)).toBeCloseTo(1, 6)
    expect(steerAuthority(T.maxSpeed, T)).toBeCloseTo(T.highSpeedSteerScale, 6)
    expect(steerAuthority(30, T)).toBeLessThan(1)
    expect(steerAuthority(30, T)).toBeGreaterThan(T.highSpeedSteerScale)
  })

  it('never exceeds full authority at any speed', () => {
    for (let speed = -60; speed <= 60; speed += 0.5) {
      expect(Math.abs(steerAuthority(speed, T))).toBeLessThanOrEqual(1 + 1e-9)
    }
  })
})

describe('acceleration', () => {
  it('reaches the expected speed after three seconds at full throttle', () => {
    // Self-limiting accel a = A(1 - v/vmax) integrates to v(t) = vmax(1 - e^(-At/vmax)).
    // A=20, vmax=46, t=3  ->  33.5 m/s. Euler at 60Hz lands just under.
    const expected = T.maxSpeed * (1 - Math.exp((-T.engineAccel * 3) / T.maxSpeed))
    const speed = car(drive(fresh(), input({ throttle: 1 }), 3)).forwardSpeed

    expect(expected).toBeCloseTo(33.5, 1)
    expect(speed).toBeGreaterThan(expected - 1)
    expect(speed).toBeLessThan(expected + 1)
  })

  it('converges on the top speed in content and never passes it', () => {
    const speed = car(drive(fresh(), input({ throttle: 1 }), 30)).forwardSpeed
    expect(speed).toBeLessThanOrEqual(T.maxSpeed + 1e-9)
    expect(speed).toBeGreaterThan(T.maxSpeed * 0.99)
  })

  it('reverses more slowly than it drives forward', () => {
    const back = car(drive(fresh(), input({ throttle: -1 }), 20)).forwardSpeed
    expect(back).toBeLessThan(0)
    expect(Math.abs(back)).toBeGreaterThan(T.maxReverseSpeed * 0.95)
    expect(Math.abs(back)).toBeLessThanOrEqual(T.maxReverseSpeed + 1e-9)
  })

  it('coasts to a standstill', () => {
    const rolling = drive(fresh(), input({ throttle: 1 }), 3)
    const stopped = car(drive(rolling, NEUTRAL_INPUT, 20))
    expect(Math.abs(stopped.forwardSpeed)).toBeLessThan(0.01)
  })

  it('brakes harder than it coasts', () => {
    const rolling = drive(fresh(), input({ throttle: 1 }), 3)
    const coasted = car(drive(rolling, NEUTRAL_INPUT, 1)).forwardSpeed
    const braked = car(drive(rolling, input({ throttle: -1 }), 1)).forwardSpeed
    expect(braked).toBeLessThan(coasted)
  })
})

describe('steering', () => {
  it('does not rotate a parked car at full lock', () => {
    const parked = car(drive(fresh(), input({ steer: 1 }), 2))
    expect(parked.yaw).toBe(0)
    expect(parked.yawRate).toBe(0)
  })

  it('turns toward the side the player steered', () => {
    // The D-goes-left bug. Assert against the car's own right axis rather than
    // a world axis, so this stays true whatever heading the car starts from.
    for (const startYaw of [0, 1.2, -2.4, 3.0]) {
      const base = fresh()
      const aimed: WorldState = { ...base, vehicles: [{ ...car(base), yaw: startYaw }] }
      const rolling = drive(aimed, input({ throttle: 1 }), 2)

      const right = car(drive(rolling, input({ throttle: 1, steer: 1 }), 0.6))
      const left = car(drive(rolling, input({ throttle: 1, steer: -1 }), 0.6))

      // Steering right must move the car toward where its right axis pointed.
      const startRight = rightOf(startYaw)
      const drift = (v: typeof right): number =>
        V.dot(V.sub(v.pos, car(rolling).pos), startRight)

      expect(drift(right), `yaw ${startYaw}: steer right went left`).toBeGreaterThan(0)
      expect(drift(left), `yaw ${startYaw}: steer left went right`).toBeLessThan(0)
      expect(right.yawRate).toBeGreaterThan(0)
      expect(left.yawRate).toBeLessThan(0)
    }
  })

  it('holds yaw rate inside the designed envelope at 30 m/s', () => {
    // Get to ~30 m/s, then apply full lock and let yaw rate settle.
    let world = fresh()
    while (car(world).forwardSpeed < 30) world = step(world, inputs(input({ throttle: 1 })))

    const turning = car(drive(world, input({ throttle: 1, steer: 1 }), 0.25))
    const fraction = turning.yawRate / T.maxYawRate

    expect(turning.yawRate).toBeGreaterThan(0)
    // Washed out from full lock, but still most of the car's authority.
    expect(fraction).toBeGreaterThan(0.65)
    expect(fraction).toBeLessThan(0.85)
  })

  it('never exceeds the maximum yaw rate, at any speed or input', () => {
    let world = fresh()
    let peak = 0
    for (let i = 0; i < 60 * TICK_HZ; i++) {
      const steer = i % 90 < 45 ? 1 : -1
      world = step(world, inputs(input({ throttle: 1, steer, handbrake: i % 300 < 40 })))
      peak = Math.max(peak, Math.abs(car(world).yawRate))
    }
    expect(peak).toBeLessThanOrEqual(T.maxYawRate + 1e-9)
  })

  it('steers the opposite way in reverse', () => {
    const reversing = drive(fresh(), input({ throttle: -1 }), 3)
    const turned = car(drive(reversing, input({ throttle: -1, steer: 1 }), 0.5))

    const forwards = drive(fresh(), input({ throttle: 1 }), 3)
    const turnedForwards = car(drive(forwards, input({ throttle: 1, steer: 1 }), 0.5))

    expect(turned.yawRate).toBeLessThan(0)
    expect(turnedForwards.yawRate).toBeGreaterThan(0)
  })

  it('stops steering once airborne', () => {
    // Launch the car upward, then try to steer. Yaw rate must not change.
    const rolling = drive(fresh(), input({ throttle: 1 }), 2)
    const airborne: WorldState = {
      ...rolling,
      vehicles: [
        {
          ...car(rolling),
          pos: { ...car(rolling).pos, y: 20 },
          vel: { ...car(rolling).vel, y: 5 },
          yawRate: 1.1,
          grounded: false,
        },
      ],
    }
    expect(car(drive(airborne, input({ steer: 1 }), 0.5)).yawRate).toBe(1.1)
  })
})

describe('grip and drift', () => {
  it('slides much further sideways with the handbrake down', () => {
    let world = fresh()
    while (car(world).forwardSpeed < 30) world = step(world, inputs(input({ throttle: 1 })))

    const gripped = car(drive(world, input({ throttle: 1, steer: 1 }), 0.5))
    const drifting = car(drive(world, input({ throttle: 1, steer: 1, handbrake: true }), 0.5))

    expect(Math.abs(drifting.lateralSpeed)).toBeGreaterThan(Math.abs(gripped.lateralSpeed) * 3)
  })

  it('recovers grip when the handbrake is released', () => {
    let world = fresh()
    while (car(world).forwardSpeed < 30) world = step(world, inputs(input({ throttle: 1 })))

    const sliding = drive(world, input({ throttle: 1, steer: 1, handbrake: true }), 0.6)
    expect(Math.abs(car(sliding).lateralSpeed)).toBeGreaterThan(2)

    const recovered = car(drive(sliding, input({ throttle: 1 }), 1))
    expect(Math.abs(recovered.lateralSpeed)).toBeLessThan(0.5)
  })

  it('points the car where it is going once the slide ends', () => {
    let world = fresh()
    while (car(world).forwardSpeed < 25) world = step(world, inputs(input({ throttle: 1 })))
    const settled = car(drive(drive(world, input({ throttle: 1, steer: 1 }), 1), input({ throttle: 1 }), 2))

    const heading = headingOf(settled.vel.x, settled.vel.z)
    expect(Math.abs(heading - settled.yaw)).toBeLessThan(0.05)
  })
})

describe('the arena contains the car', () => {
  it('bounces off a wall and reports the impact', () => {
    // Yaw π/2 faces +X, straight at the east wall.
    const base = enclosed()
    const facingWall: WorldState = {
      ...base,
      vehicles: [{ ...car(base), yaw: Math.PI / 2 }],
    }

    let world = facingWall
    let impacts = 0
    for (let i = 0; i < 20 * TICK_HZ; i++) {
      world = step(world, inputs(input({ throttle: 1 })))
      impacts += world.events.length
    }

    expect(impacts).toBeGreaterThan(0)
    expect(car(world).pos.x).toBeLessThanOrEqual(base.arena.halfExtents.x)
  })

  it('keeps every car inside the bounds under 500 random runs', () => {
    let rng = fromSeed(4242)
    const roll = (): number => {
      const draw = next(rng)
      rng = draw.state
      return draw.value
    }

    for (let run = 0; run < 500; run++) {
      const base = enclosed()
      let world: WorldState = {
        ...base,
        vehicles: [
          {
            ...car(base),
            yaw: roll() * Math.PI * 2,
            vel: { x: (roll() - 0.5) * 120, y: 0, z: (roll() - 0.5) * 120 },
          },
        ],
      }

      const frame = input({
        throttle: roll() * 2 - 1,
        steer: roll() * 2 - 1,
        handbrake: roll() > 0.7,
      })

      world = drive(world, frame, 600 * TICK_DT)
      const final = car(world)

      expect(V.isFinite(final.pos), `run ${run}: position went non-finite`).toBe(true)
      expect(V.isFinite(final.vel), `run ${run}: velocity went non-finite`).toBe(true)
      expect(Number.isFinite(final.yaw)).toBe(true)
      expect(Math.abs(final.pos.x)).toBeLessThanOrEqual(base.arena.halfExtents.x)
      expect(Math.abs(final.pos.z)).toBeLessThanOrEqual(base.arena.halfExtents.z)
      expect(V.length(final.vel)).toBeLessThanOrEqual(T.maxSpeed * 2)
    }
  })

  it('lands on the ground and stays there', () => {
    const base = enclosed()
    const dropped: WorldState = {
      ...base,
      vehicles: [{ ...car(base), pos: { x: 0, y: 40, z: 0 }, grounded: false }],
    }
    const landed = car(drive(dropped, NEUTRAL_INPUT, 5))
    expect(landed.grounded).toBe(true)
    expect(landed.pos.y).toBeCloseTo(base.arena.groundY + T.rideHeight, 9)
  })
})

/**
 * The ramp read wrong from behind, and the reason was measurable.
 *
 * The far end used to be a vertical face, so `groundHeightAt` stepped from the
 * floor to the full rise across a single point and the car was placed on top of
 * it in one tick — 3.6m of position in 16ms. It launched, but it launched off a
 * flat wall, at the same height whether you were crawling or flat out.
 *
 * The shape now falls back to the ground over a short steep incline, so the far
 * side is something you drive up. These are the two properties that difference
 * consists of, and neither of them is about how the ramp is drawn.
 */
describe('the ramp seen from behind', () => {
  /** Coast into jump-w from the far side, heading south down its boost incline. */
  function chargeTheBoostSide(speed: number): { steps: number[]; apex: number } {
    const base = createWorld({ seed: 1 })
    const ramp = base.arena.ramps.find((r) => r.id === 'jump-w')!
    // yaw π faces −Z, which is up the incline from the front edge.
    const heading = Math.PI
    const forward = forwardOf(heading)

    let world: WorldState = {
      ...base,
      vehicles: [
        {
          ...car(base),
          pos: { x: ramp.pos.x, y: T.rideHeight, z: ramp.pos.z + ramp.halfExtents.z + 12 },
          yaw: heading,
          vel: { x: forward.x * speed, y: 0, z: forward.z * speed },
          forwardSpeed: speed,
        },
      ],
    }

    const steps: number[] = []
    let apex = 0
    let previous = car(world).pos.y
    for (let i = 0; i < 240; i++) {
      world = step(world, new Map([[0, NEUTRAL_INPUT]]))
      const now = car(world).pos.y
      steps.push(now - previous)
      apex = Math.max(apex, now)
      previous = now
    }
    return { steps, apex }
  }

  it('is climbed, not teleported up', () => {
    const { steps } = chargeTheBoostSide(30)
    const worst = Math.max(...steps)

    // A tick is 16.7ms. Even at 30 m/s the car covers half a metre in one, so
    // anything approaching a metre of *vertical* in a single tick is the car
    // being placed on top of a wall rather than driving up a slope.
    expect(worst, 'the car jumped up the ramp in a single tick').toBeLessThan(0.4)
  })

  it('rewards speed, which a wall did not', () => {
    // The old face gave the same launch at any speed above about 20 m/s,
    // because the climb rate was pinned by the step height rather than set by
    // how fast you hit it. A slope cannot do that.
    const slow = chargeTheBoostSide(15).apex
    const fast = chargeTheBoostSide(40).apex

    expect(fast).toBeGreaterThan(slow * 1.4)
  })
})
