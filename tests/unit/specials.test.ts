/**
 * M4's special-weapon tests, from PLAN.md §4:
 *
 *   - missile turn rate bounded; missile expires; missile can be outrun at the
 *     designed speed differential
 *
 * The done criterion is "dangerous to be hit by and fair to be hit by", and the
 * two halves pull against each other. Everything below pins the *fair* half,
 * because that is the one a homing weapon loses first: a missile that turns
 * without limit, never expires, or cannot be outrun is not a threat, it is a
 * delayed announcement.
 */
import { describe, expect, it } from 'vitest'
import { TICK_DT, TICK_HZ } from '../../src/core/clock'
import * as V from '../../src/core/vec3'
import { angleDelta } from '../../src/core/scalar'
import { PROVING_GROUND } from '../../src/content/arenas/proving-ground'
import { VEHICLES } from '../../src/content/vehicles'
import { SPECIAL_IDS, WEAPONS } from '../../src/content/weapons'
import {
  NEUTRAL_INPUT,
  PICKUP_RADIUS,
  PICKUP_RESPAWN,
  createWorld,
  forwardOf,
  headingOf,
  isAlive,
  step,
  type InputFrame,
  type Inputs,
  type SimEvent,
  type Vehicle,
  type WorldState,
} from '../../src/sim'

const T = VEHICLES.roadster!
const MISSILE = WEAPONS.homingMissile
const HOMING = MISSILE.homing!
const MINE = WEAPONS.mine

const ARENA = {
  ...PROVING_GROUND,
  blocks: [],
  ramps: [],
  pickups: [],
  spawns: [
    { pos: { x: 0, y: 0, z: 0 }, yaw: 0 },
    { pos: { x: 0, y: 0, z: 45 }, yaw: 0 },
  ],
}

const input = (partial: Partial<InputFrame>): InputFrame => ({ ...NEUTRAL_INPUT, ...partial })
const only = (id: number, frame: InputFrame): Inputs => new Map([[id, frame]])

const car = (world: WorldState, id: number): Vehicle => {
  const found = world.vehicles.find((v) => v.id === id)
  if (found === undefined) throw new Error(`no vehicle ${id}`)
  return found
}

const pick = <K extends SimEvent['type']>(
  events: readonly SimEvent[],
  type: K,
): Extract<SimEvent, { type: K }>[] =>
  events.filter((e): e is Extract<SimEvent, { type: K }> => e.type === type)

function drive(world: WorldState, frames: Inputs, ticks: number): WorldState {
  let next = world
  for (let i = 0; i < ticks; i++) next = step(next, frames)
  return next
}

/** Select the missile, hold the lock long enough, then fire one. */
function launch(world: WorldState, extra: Partial<InputFrame> = {}): WorldState {
  // Specials start on the rocket, so cycle once.
  let next = step(world, only(0, input({ ...extra, cycleWeapon: true })))
  const holding = Math.ceil(HOMING.lockTime / TICK_DT) + 2
  next = drive(next, only(0, input(extra)), holding)
  return step(next, only(0, input({ ...extra, special: true })))
}

/**
 * A missile already in the air, locked on, without going through acquisition.
 *
 * Used for the escape tests on purpose: at top speed a runner leaves the
 * 110m lock range during the 0.9s the lock takes, so routing those cases
 * through acquisition would test the lock range instead of the thing they are
 * about — the speed differential.
 */
function missileAt(world: WorldState, target: number): WorldState {
  const shooter = car(world, 0)
  const nose = forwardOf(shooter.yaw)
  return {
    ...world,
    projectiles: [
      {
        id: 9000,
        owner: shooter.id,
        weapon: 'homingMissile',
        pos: { x: shooter.pos.x, y: shooter.pos.y + 0.42, z: shooter.pos.z },
        vel: { x: nose.x * MISSILE.speed, y: 0, z: nose.z * MISSILE.speed },
        target,
        armsAt: world.tick,
        expiresAt: world.tick + Math.round(MISSILE.lifetime / TICK_DT),
      },
    ],
  }
}

/** Two cars on an unbounded strip, the runner already at top speed. */
function chase(headStart: number): WorldState {
  const base = createWorld({
    seed: 1,
    arena: {
      ...ARENA,
      halfExtents: { x: 4000, z: 4000 },
      spawns: [
        { pos: { x: 0, y: 0, z: 0 }, yaw: 0 },
        { pos: { x: 0, y: 0, z: headStart }, yaw: 0 },
      ],
    },
    vehicles: 2,
  })
  return {
    ...base,
    vehicles: base.vehicles.map((v) =>
      v.id === 1
        ? { ...v, vel: { x: 0, y: 0, z: T.maxSpeed }, forwardSpeed: T.maxSpeed }
        : v,
    ),
  }
}

const pair = (): WorldState => createWorld({ seed: 1, arena: ARENA, vehicles: 2 })

/**
 * Select the homing missile.
 *
 * Every lock test goes through this now: targeting is gated on the weapon being
 * selected, so a car holding a rocket has no lock to build. That gate is the
 * point — the reticle appearing is how you know you switched.
 */
const missileMode = (world: WorldState): WorldState =>
  step(world, only(0, input({ cycleWeapon: true })))

describe('weapon selection', () => {
  it('starts on the first special', () => {
    expect(car(pair(), 0).selectedSpecial).toBe(SPECIAL_IDS[0])
  })

  it('cycles through every special and wraps', () => {
    let world = pair()
    const seen = [car(world, 0).selectedSpecial]

    for (let i = 0; i < SPECIAL_IDS.length; i++) {
      world = step(world, only(0, input({ cycleWeapon: true })))
      seen.push(car(world, 0).selectedSpecial)
    }

    expect(seen.slice(0, SPECIAL_IDS.length)).toEqual([...SPECIAL_IDS])
    // Wrapped back to where it started.
    expect(seen[SPECIAL_IDS.length]).toBe(SPECIAL_IDS[0])
  })

  it('fires whichever special is selected, and only that one', () => {
    let world = step(pair(), only(0, input({ cycleWeapon: true })))
    expect(car(world, 0).selectedSpecial).toBe('homingMissile')

    world = drive(world, only(0, input({ special: true })), 4)
    const shooter = car(world, 0)
    expect(shooter.ammo.homingMissile).toBeLessThan(MISSILE.capacity)
    expect(shooter.ammo.rocket).toBe(WEAPONS.rocket.capacity)
  })
})

describe('manual target cycling', () => {
  /** Shooter at the origin with three cars fanned out in front of it. */
  function crowd(): WorldState {
    return createWorld({
      seed: 1,
      arena: {
        ...ARENA,
        spawns: [
          { pos: { x: 0, y: 0, z: 0 }, yaw: 0 },
          { pos: { x: -18, y: 0, z: 34 }, yaw: 0 },
          { pos: { x: 2, y: 0, z: 22 }, yaw: 0 },
          { pos: { x: 20, y: 0, z: 40 }, yaw: 0 },
        ],
      },
      vehicles: 4,
    })
  }

  it('does nothing unless the homing missile is selected', () => {
    // Rocket selected: pressing the key must not move the lock.
    let world = drive(crowd(), only(0, NEUTRAL_INPUT), 30)
    expect(car(world, 0).selectedSpecial).toBe('rocket')

    const before = car(world, 0).lockTarget
    world = step(world, only(0, input({ cycleTarget: true })))

    expect(car(world, 0).lockTarget).toBe(before)
    expect(car(world, 0).manualTarget).toBe(false)
  })

  it('advances through every candidate and wraps', () => {
    let world = drive(missileMode(crowd()), only(0, NEUTRAL_INPUT), 30)

    const seen: (number | null)[] = []
    for (let i = 0; i < 4; i++) {
      world = step(world, only(0, input({ cycleTarget: true })))
      seen.push(car(world, 0).lockTarget)
      // Let the lock settle so stickiness does not fight the next press.
      world = drive(world, only(0, NEUTRAL_INPUT), 3)
    }

    // Three other cars, all in front: it walks them in id order and comes back.
    expect(seen.slice(0, 3).sort()).toEqual([1, 2, 3])
    expect(seen[3]).toBe(seen[0])
  })

  it('marks the choice as manual, and restarts the lock clock', () => {
    let world = drive(missileMode(crowd()), only(0, NEUTRAL_INPUT), 60)
    const auto = car(world, 0)
    expect(auto.manualTarget).toBe(false)
    expect(auto.lockTime).toBeGreaterThan(HOMING.lockTime)

    world = step(world, only(0, input({ cycleTarget: true })))
    const manual = car(world, 0)

    expect(manual.manualTarget).toBe(true)
    expect(manual.lockTarget).not.toBe(auto.lockTarget)
    // Picking a new victim is not free.
    expect(manual.lockTime).toBeLessThan(HOMING.lockTime)
  })

  it('keeps the hand-picked target instead of drifting back to the nearest', () => {
    let world = drive(missileMode(crowd()), only(0, NEUTRAL_INPUT), 30)
    // Auto picks the nearest, which is car 2 at ~22m.
    expect(car(world, 0).lockTarget).toBe(2)

    // Cycle away from it, then let plenty of time pass.
    let chosen = car(world, 0).lockTarget
    while (chosen === 2) {
      world = step(world, only(0, input({ cycleTarget: true })))
      world = drive(world, only(0, NEUTRAL_INPUT), 3)
      chosen = car(world, 0).lockTarget
    }

    world = drive(world, only(0, NEUTRAL_INPUT), 3 * TICK_HZ)
    expect(car(world, 0).lockTarget, 'the lock drifted back to the nearest car').toBe(chosen)
  })

  it('fires at the hand-picked target rather than the nearest', () => {
    let world = drive(missileMode(crowd()), only(0, NEUTRAL_INPUT), 30)
    while (car(world, 0).lockTarget === 2) {
      world = step(world, only(0, input({ cycleTarget: true })))
      world = drive(world, only(0, NEUTRAL_INPUT), 3)
    }
    const chosen = car(world, 0).lockTarget!
    expect(chosen).not.toBe(2)

    world = drive(world, only(0, NEUTRAL_INPUT), Math.ceil(HOMING.lockTime / TICK_DT) + 2)
    world = step(world, only(0, input({ special: true })))

    expect(world.projectiles[0]!.target).toBe(chosen)
  })

  it('falls back to automatic when the chosen target dies', () => {
    let world = drive(missileMode(crowd()), only(0, NEUTRAL_INPUT), 30)
    world = step(world, only(0, input({ cycleTarget: true })))
    const chosen = car(world, 0).lockTarget!
    expect(car(world, 0).manualTarget).toBe(true)

    world = {
      ...world,
      vehicles: world.vehicles.map((v) => (v.id === chosen ? { ...v, health: 0 } : v)),
    }
    world = drive(world, only(0, NEUTRAL_INPUT), 4)

    expect(car(world, 0).lockTarget).not.toBe(chosen)
    expect(car(world, 0).manualTarget, 'a dead choice should not stay the choice').toBe(false)
  })

  it('does nothing when there is nobody to cycle to', () => {
    const solo = missileMode(createWorld({ seed: 1, arena: ARENA, vehicles: 1 }))
    const world = step(solo, only(0, input({ cycleTarget: true })))

    expect(car(world, 0).lockTarget).toBeNull()
    expect(car(world, 0).manualTarget).toBe(false)
  })
})

describe('lock', () => {
  it('does not exist outside missile mode', () => {
    // Rockets and mines fly where the nose points, so a reticle while holding
    // one would be a promise the weapon cannot keep.
    const world = drive(pair(), only(0, NEUTRAL_INPUT), 60)
    expect(car(world, 0).selectedSpecial).toBe('rocket')
    expect(car(world, 0).lockTarget).toBeNull()
    expect(car(world, 0).lockTime).toBe(0)
  })

  it('is dropped when you switch away from the missile', () => {
    let world = drive(missileMode(pair()), only(0, NEUTRAL_INPUT), 60)
    expect(car(world, 0).lockTarget).toBe(1)

    // -> mine
    world = step(world, only(0, input({ cycleWeapon: true })))
    expect(car(world, 0).lockTarget).toBeNull()
    expect(car(world, 0).lockTime).toBe(0)
  })

  it('builds while a target is held and reports when it completes', () => {
    let world = missileMode(pair())
    let acquired: number | null = null

    for (let i = 0; i < 3 * TICK_HZ && acquired === null; i++) {
      world = step(world, only(0, NEUTRAL_INPUT))
      if (pick(world.events, 'lockAcquired').length > 0) acquired = world.tick
    }

    expect(acquired, 'never acquired a lock on a car dead ahead').not.toBeNull()
    expect(car(world, 0).lockTarget).toBe(1)
    // Within a tick or two of the designed time, allowing for the tick spent
    // switching weapon. This is the warning the target gets.
    expect(acquired! * TICK_DT).toBeCloseTo(HOMING.lockTime, 1)
  })

  it('resets when the target changes', () => {
    const base = createWorld({ seed: 1, arena: { ...ARENA, spawns: [
      { pos: { x: 0, y: 0, z: 0 }, yaw: 0 },
      { pos: { x: 4, y: 0, z: 50 }, yaw: 0 },
      { pos: { x: -4, y: 0, z: 20 }, yaw: 0 },
    ] }, vehicles: 3 })

    let world = drive(missileMode(base), only(0, NEUTRAL_INPUT), 30)
    // Nearest and most in front wins, so it should be on car 2.
    expect(car(world, 0).lockTarget).toBe(2)
    const held = car(world, 0).lockTime

    // Kill car 2; the lock has to move and start over, not inherit progress.
    world = {
      ...world,
      vehicles: world.vehicles.map((v) => (v.id === 2 ? { ...v, health: 0 } : v)),
    }
    world = step(world, only(0, NEUTRAL_INPUT))

    expect(car(world, 0).lockTarget).toBe(1)
    expect(car(world, 0).lockTime).toBeLessThan(held)
  })

  it('survives a brief turn away, then drops', () => {
    let world = drive(missileMode(pair()), only(0, NEUTRAL_INPUT), 30)
    expect(car(world, 0).lockTarget).toBe(1)

    // Spin the shooter to face directly away.
    const turned = {
      ...world,
      vehicles: world.vehicles.map((v) => (v.id === 0 ? { ...v, yaw: Math.PI } : v)),
    }

    // Inside the grace window the lock is still there. Dropping it on the first
    // tick out of the cone is what made it unholdable through a corner.
    world = drive(turned, only(0, NEUTRAL_INPUT), 2)
    expect(car(world, 0).lockTarget).toBe(1)

    // Past the grace, it goes.
    world = drive(turned, only(0, NEUTRAL_INPUT), Math.ceil(HOMING.holdGrace / TICK_DT) + 4)
    expect(car(world, 0).lockTarget).toBeNull()
    expect(pick(world.events, 'lockLost').length + 1).toBeGreaterThan(0)
  })

  it('moves to a clearly better target as the field changes', () => {
    // The lock follows proximity and direction rather than sitting on whoever
    // it happened to see first. Car 1 is 60m out; car 2 turns up at 20m and is
    // decisively the better shot, so the lock should go to it.
    const base = createWorld({ seed: 1, arena: { ...ARENA, spawns: [
      { pos: { x: 0, y: 0, z: 0 }, yaw: 0 },
      { pos: { x: 0, y: 0, z: 60 }, yaw: 0 },
      { pos: { x: 3, y: 0, z: 20 }, yaw: 0 },
    ] }, vehicles: 3 })

    // Only cars 0 and 1 exist at first. Sliced from the *stepped* world, not
    // from `base` — the latter still has the pre-cycle weapon selection, and
    // without the missile selected there is no lock to test.
    const armed = missileMode(base)
    let world: WorldState = { ...armed, vehicles: armed.vehicles.slice(0, 2) }
    world = drive(world, only(0, NEUTRAL_INPUT), 30)
    expect(car(world, 0).lockTarget).toBe(1)

    world = { ...world, vehicles: [...world.vehicles, armed.vehicles[2]!] }
    world = drive(world, only(0, NEUTRAL_INPUT), 30)

    expect(car(world, 0).lockTarget, 'the lock ignored a much better target').toBe(2)
  })

  it('does not chatter between two near-identical targets', () => {
    // The reason a switch needs a margin at all: two candidates a hair apart
    // would otherwise trade the lock every tick and it would never finish.
    const base = createWorld({ seed: 1, arena: { ...ARENA, spawns: [
      { pos: { x: 0, y: 0, z: 0 }, yaw: 0 },
      { pos: { x: -3, y: 0, z: 40 }, yaw: 0 },
      { pos: { x: 3.2, y: 0, z: 40.5 }, yaw: 0 },
    ] }, vehicles: 3 })

    let world = missileMode(base)
    const seen = new Set<number | null>()
    for (let i = 0; i < 3 * TICK_HZ; i++) {
      world = step(world, only(0, NEUTRAL_INPUT))
      seen.add(car(world, 0).lockTarget)
    }

    expect(seen.size, 'the lock flip-flopped').toBe(1)
    expect(car(world, 0).lockTime).toBeGreaterThan(HOMING.lockTime)
  })

  it('is cleared by death', () => {
    let world = drive(missileMode(pair()), only(0, NEUTRAL_INPUT), 30)
    world = {
      ...world,
      vehicles: world.vehicles.map((v) => (v.id === 0 ? { ...v, health: 0 } : v)),
    }
    world = step(world, only(0, NEUTRAL_INPUT))
    expect(car(world, 0).lockTarget).toBeNull()
  })
})

describe('the homing missile', () => {
  it('tracks a locked target', () => {
    let world = launch(pair())
    expect(world.projectiles).toHaveLength(1)
    expect(world.projectiles[0]!.target).toBe(1)

    let hit = false
    for (let i = 0; i < 6 * TICK_HZ && !hit; i++) {
      world = step(world, only(0, NEUTRAL_INPUT))
      if (pick(world.events, 'damaged').some((e) => e.id === 1)) hit = true
    }
    expect(hit, 'a locked missile missed a stationary target').toBe(true)
  })

  it('homes even when fired before the lock completes', () => {
    // The contract the name promises. It used to come out dumb without a
    // finished lock, which in ordinary driving meant always — so the weapon was
    // a worse rocket wearing a better name.
    const world = step(pair(), only(0, input({ special: true, cycleWeapon: true })))
    const early = step(world, only(0, input({ special: true })))

    const missile = early.projectiles.find((p) => p.weapon === 'homingMissile')
    expect(missile, 'no missile was fired').toBeDefined()
    expect(missile!.target, 'a homing missile has to home').toBe(1)
    expect(car(early, 0).lockTime).toBeLessThan(HOMING.lockTime)
  })

  it('goes dumb only when there is genuinely nothing to home at', () => {
    const solo = createWorld({ seed: 1, arena: ARENA, vehicles: 1 })
    let world = step(solo, only(0, input({ cycleWeapon: true })))
    world = step(world, only(0, input({ special: true })))

    const missile = world.projectiles.find((p) => p.weapon === 'homingMissile')
    expect(missile).toBeDefined()
    expect(missile!.target).toBeNull()
  })

  it('takes whatever is ahead at launch when no lock was held', () => {
    // Target off to the side, inside the launch cone but never locked because
    // the shooter only just turned toward it.
    const base = createWorld({ seed: 1, arena: { ...ARENA, spawns: [
      { pos: { x: 0, y: 0, z: 0 }, yaw: 0 },
      { pos: { x: 26, y: 0, z: 30 }, yaw: 0 },
    ] }, vehicles: 2 })

    let world = step(base, only(0, input({ cycleWeapon: true })))
    world = step(world, only(0, input({ special: true })))

    const missile = world.projectiles.find((p) => p.weapon === 'homingMissile')
    expect(missile!.target).toBe(1)
  })

  it('never turns faster than its designed rate', () => {
    // Off to one side so the missile has to work to come round, but inside the
    // ~29° lock cone — at 20/30 it would be 33.7° off the nose, there would be
    // no lock at all, and this would quietly become a test of a dumb rocket.
    const base = createWorld({ seed: 1, arena: { ...ARENA, spawns: [
      { pos: { x: 0, y: 0, z: 0 }, yaw: 0 },
      { pos: { x: 12, y: 0, z: 30 }, yaw: 0 },
    ] }, vehicles: 2 })

    let world = launch(base)
    let previous = headingOf(world.projectiles[0]!.vel.x, world.projectiles[0]!.vel.z)
    let peak = 0

    for (let i = 0; i < 6 * TICK_HZ && world.projectiles.length > 0; i++) {
      world = step(world, only(0, NEUTRAL_INPUT))
      const missile = world.projectiles[0]
      if (missile === undefined) break
      const heading = headingOf(missile.vel.x, missile.vel.z)
      peak = Math.max(peak, Math.abs(angleDelta(previous, heading)) / TICK_DT)
      previous = heading
    }

    expect(peak).toBeGreaterThan(0)
    expect(peak, 'the missile out-turned its own limit').toBeLessThanOrEqual(HOMING.turnRate + 1e-6)
  })

  it('expires rather than chasing forever', () => {
    // Fire at a target, then remove it — nothing left to hit.
    let world = launch(pair())
    world = { ...world, vehicles: [car(world, 0)] }

    const lifetimeTicks = Math.round(MISSILE.lifetime / TICK_DT)
    world = drive(world, only(0, NEUTRAL_INPUT), lifetimeTicks + 10)
    expect(world.projectiles).toHaveLength(0)
  })

  it('goes dumb when its target dies mid-flight', () => {
    let world = launch(pair())
    expect(world.projectiles[0]!.target).toBe(1)

    world = {
      ...world,
      vehicles: world.vehicles.map((v) => (v.id === 1 ? { ...v, health: 0 } : v)),
    }
    world = step(world, only(0, NEUTRAL_INPUT))

    const missile = world.projectiles[0]
    if (missile !== undefined) expect(missile.target).toBeNull()
  })

  it('can be outrun at the designed speed differential', () => {
    // The whole balance of the weapon, stated as arithmetic. The missile is
    // `speed - maxSpeed` faster than a car flat out, so over its lifetime it
    // can only ever close that much gap. Both sides of the line are asserted,
    // because "can be outrun" is worthless without "and otherwise it gets you".
    const closable = (MISSILE.speed - T.maxSpeed) * MISSILE.lifetime
    expect(closable).toBeCloseTo(60, 0)

    const chased = (headStart: number): boolean => {
      let world = missileAt(chase(headStart), 1)
      const running: Inputs = new Map([[1, input({ throttle: 1 })]])
      let struck = false
      for (let i = 0; i < (MISSILE.lifetime + 2) * TICK_HZ; i++) {
        world = step(world, running)
        if (pick(world.events, 'damaged').some((e) => e.id === 1)) struck = true
      }
      return struck
    }

    expect(chased(closable + 25), 'a big head start should get away').toBe(false)
    expect(chased(closable - 35), 'a small head start should not').toBe(true)
  })

  it('catches a target that is not running', () => {
    // The other half: the same missile has to be genuinely dangerous.
    let world = launch(pair())
    let struck = false
    for (let i = 0; i < MISSILE.lifetime * TICK_HZ && !struck; i++) {
      world = step(world, only(0, NEUTRAL_INPUT))
      if (pick(world.events, 'damaged').some((e) => e.id === 1)) struck = true
    }
    expect(struck).toBe(true)
  })
})

describe('mines', () => {
  /** Select mines, then lay one. */
  function layMine(world: WorldState): WorldState {
    let next = world
    // rocket → homingMissile → mine
    next = step(next, only(0, input({ cycleWeapon: true })))
    next = step(next, only(0, input({ cycleWeapon: true })))
    expect(car(next, 0).selectedSpecial).toBe('mine')
    return step(next, only(0, input({ special: true })))
  }

  it('drops behind the car and sits still', () => {
    const world = layMine(pair())
    const mine = world.projectiles.find((p) => p.weapon === 'mine')

    expect(mine, 'no mine was laid').toBeDefined()
    expect(V.length(mine!.vel)).toBe(0)
    // Spawn faces +Z, so it lands behind.
    expect(mine!.pos.z).toBeLessThan(car(world, 0).pos.z)
  })

  it('does not go off before it arms', () => {
    let world = layMine(pair())
    const armTicks = Math.round(MINE.armDelay / TICK_DT)

    // The car is sitting right on top of it the whole time.
    world = drive(world, only(0, NEUTRAL_INPUT), armTicks - 2)
    expect(car(world, 0).health).toBe(T.maxHealth)
    expect(world.projectiles.some((p) => p.weapon === 'mine')).toBe(true)
  })

  it('triggers on proximity once armed, and does not care who laid it', () => {
    let world = layMine(pair())
    const armTicks = Math.round(MINE.armDelay / TICK_DT)

    world = drive(world, only(0, NEUTRAL_INPUT), armTicks + 4)

    expect(car(world, 0).health).toBeLessThan(T.maxHealth)
    expect(world.projectiles.some((p) => p.weapon === 'mine')).toBe(false)
  })

  it('reports arming, so the view can show it going live', () => {
    let world = layMine(pair())
    const armTicks = Math.round(MINE.armDelay / TICK_DT)

    let armed = 0
    for (let i = 0; i < armTicks + 2; i++) {
      world = step(world, only(0, NEUTRAL_INPUT))
      armed += pick(world.events, 'mineArmed').length
    }
    expect(armed).toBe(1)
  })

  it('fizzles out at the end of its life without a blast', () => {
    // Laid far from anyone: nothing to trigger it.
    const solo = createWorld({ seed: 1, arena: ARENA, vehicles: 1 })
    let world = layMine(solo)

    // Drive the layer well clear.
    world = {
      ...world,
      vehicles: world.vehicles.map((v) => ({ ...v, pos: { ...v.pos, x: 200 } })),
    }

    let explosions = 0
    const lifetimeTicks = Math.round(MINE.lifetime / TICK_DT)
    for (let i = 0; i < lifetimeTicks + 10; i++) {
      world = step(world, only(0, NEUTRAL_INPUT))
      explosions += pick(world.events, 'explosion').length
    }

    expect(world.projectiles).toHaveLength(0)
    expect(explosions, 'an untouched mine should just expire').toBe(0)
  })
})

describe('pickups', () => {
  const CRATE = { id: 0, kind: 'weapon' as const, weapon: 'rocket' as const, pos: { x: 0, y: 0, z: 12 } }
  const STOCKED = { ...ARENA, pickups: [CRATE] }

  function emptied(): WorldState {
    const base = createWorld({ seed: 1, arena: STOCKED, vehicles: 1 })
    return {
      ...base,
      vehicles: base.vehicles.map((v) => ({ ...v, ammo: { ...v.ammo, rocket: 0 } })),
    }
  }

  it('refills the weapon when a car drives over it', () => {
    const world = drive(emptied(), only(0, input({ throttle: 1 })), 3 * TICK_HZ)
    expect(car(world, 0).ammo.rocket).toBe(WEAPONS.rocket.capacity)
  })

  it('reports what was taken', () => {
    let world = emptied()
    let taken: Extract<SimEvent, { type: 'pickedUp' }>[] = []
    for (let i = 0; i < 3 * TICK_HZ && taken.length === 0; i++) {
      world = step(world, only(0, input({ throttle: 1 })))
      taken = pick(world.events, 'pickedUp')
    }

    expect(taken).toHaveLength(1)
    expect(taken[0]!.weapon).toBe('rocket')
    expect(taken[0]!.id).toBe(0)
    expect(taken[0]!.pickup).toBe(CRATE.id)
  })

  it('goes away and comes back on its timer', () => {
    let world = drive(emptied(), only(0, input({ throttle: 1 })), 3 * TICK_HZ)
    const crate = world.pickups[0]!

    expect(crate.availableAt).toBeGreaterThan(world.tick)
    expect(crate.availableAt - world.tick).toBeLessThanOrEqual(
      Math.round(PICKUP_RESPAWN / TICK_DT) + 1,
    )

    world = drive(world, only(0, NEUTRAL_INPUT), Math.round(PICKUP_RESPAWN / TICK_DT) + 2)
    expect(world.pickups[0]!.availableAt).toBeLessThanOrEqual(world.tick)
  })

  it('is left alone by a car that is already full', () => {
    // Full ammo: the crate should still be there for someone who needs it.
    const world = drive(
      createWorld({ seed: 1, arena: STOCKED, vehicles: 1 }),
      only(0, input({ throttle: 1 })),
      3 * TICK_HZ,
    )
    expect(world.pickups[0]!.availableAt).toBe(0)
  })

  it('is not collected by a wreck', () => {
    const base = emptied()
    const dead: WorldState = {
      ...base,
      vehicles: base.vehicles.map((v) => ({
        ...v,
        health: 0,
        respawnAt: 100000,
        pos: { ...CRATE.pos, y: T.rideHeight },
      })),
    }
    const world = drive(dead, only(0, NEUTRAL_INPUT), 30)
    expect(world.pickups[0]!.availableAt).toBe(0)
    expect(isAlive(car(world, 0))).toBe(false)
  })

  it('only reaches as far as its radius', () => {
    const base = emptied()
    const parked: WorldState = {
      ...base,
      vehicles: base.vehicles.map((v) => ({
        ...v,
        pos: { x: CRATE.pos.x, y: T.rideHeight, z: CRATE.pos.z + PICKUP_RADIUS + 1 },
      })),
    }
    const world = drive(parked, only(0, NEUTRAL_INPUT), 30)
    expect(car(world, 0).ammo.rocket).toBe(0)
  })
})

describe('the missile still respects the world', () => {
  it('is stopped by scenery', () => {
    const walled = {
      ...ARENA,
      blocks: [
        { id: 'wall', pos: { x: 0, y: 0, z: 20 }, halfExtents: { x: 12, y: 4, z: 1 }, yaw: 0 },
      ],
    }
    const base = createWorld({ seed: 1, arena: walled, vehicles: 2 })

    // No lock through the wall, so this is a dumb shot into it.
    let world = step(base, only(0, input({ special: true, cycleWeapon: true })))
    world = step(world, only(0, input({ special: true })))

    let world2 = world
    let hitWall = false
    for (let i = 0; i < 3 * TICK_HZ && !hitWall; i++) {
      world2 = step(world2, only(0, NEUTRAL_INPUT))
      if (pick(world2.events, 'explosion').length > 0) hitWall = true
    }

    expect(hitWall).toBe(true)
    expect(car(world2, 1).health).toBe(T.maxHealth)
  })

  it('leaves the forward direction unchanged when it has no target', () => {
    const solo = createWorld({ seed: 1, arena: ARENA, vehicles: 1 })
    let world = step(solo, only(0, input({ cycleWeapon: true })))
    world = step(world, only(0, input({ special: true })))

    const launched = world.projectiles[0]!
    const heading = headingOf(launched.vel.x, launched.vel.z)
    const nose = forwardOf(car(world, 0).yaw)

    expect(heading).toBeCloseTo(headingOf(nose.x, nose.z), 6)
  })
})
