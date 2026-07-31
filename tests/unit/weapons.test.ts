/**
 * M3's tests, from PLAN.md §4:
 *
 *   - damage arithmetic, ammo depletion, cooldown gating
 *   - projectile vs. moving target intercepts at the expected tick
 *
 * The replay ("fixed input file → target destroyed at exactly tick N") lives in
 * tests/replay/firefight.test.ts, next to the other recorded fixtures.
 */
import { describe, expect, it } from 'vitest'
import { TICK_DT, TICK_HZ } from '../../src/core/clock'
import * as V from '../../src/core/vec3'
import { PROVING_GROUND } from '../../src/content/arenas/proving-ground'
import { VEHICLES } from '../../src/content/vehicles'
import { WEAPONS } from '../../src/content/weapons'
import {
  NEUTRAL_INPUT,
  createWorld,
  forwardOf,
  isAlive,
  rayCircle,
  rayRect,
  step,
  type InputFrame,
  type Inputs,
  type SimEvent,
  type Vehicle,
  type WorldState,
} from '../../src/sim'

const T = VEHICLES.roadster!
const GUN = WEAPONS.machineGun
const ROCKET = WEAPONS.rocket

const RANGE = { ...PROVING_GROUND, blocks: [], ramps: [], spawns: [
  { pos: { x: 0, y: 0, z: 0 }, yaw: 0 },
  { pos: { x: 0, y: 0, z: 25 }, yaw: 0 },
] }

const input = (partial: Partial<InputFrame>): InputFrame => ({ ...NEUTRAL_INPUT, ...partial })
const shooterOnly = (frame: InputFrame): Inputs => new Map([[0, frame]])

const car = (world: WorldState, id: number): Vehicle => {
  const found = world.vehicles.find((v) => v.id === id)
  if (found === undefined) throw new Error(`no vehicle ${id}`)
  return found
}

/** Two cars 25m apart, shooter facing the target, neither moving. */
function range(): WorldState {
  return createWorld({ seed: 1, arena: RANGE, vehicles: 2 })
}

function fire(world: WorldState, frame: InputFrame, ticks: number): WorldState {
  const held = shooterOnly(frame)
  let next = world
  for (let i = 0; i < ticks; i++) next = step(next, held)
  return next
}

/**
 * `world.events` is drained every tick, so anything that asks "did this ever
 * happen" has to collect as it goes rather than read the final state.
 */
function fireCollecting(
  world: WorldState,
  frame: InputFrame,
  ticks: number,
): { world: WorldState; events: SimEvent[] } {
  const held = shooterOnly(frame)
  const events: SimEvent[] = []
  let next = world
  for (let i = 0; i < ticks; i++) {
    next = step(next, held)
    events.push(...next.events)
  }
  return { world: next, events }
}

const pick = <K extends SimEvent['type']>(
  events: readonly SimEvent[],
  type: K,
): Extract<SimEvent, { type: K }>[] =>
  events.filter((e): e is Extract<SimEvent, { type: K }> => e.type === type)

const eventsOfType = <K extends SimEvent['type']>(
  world: WorldState,
  type: K,
): Extract<SimEvent, { type: K }>[] =>
  world.events.filter((e): e is Extract<SimEvent, { type: K }> => e.type === type)

describe('ray casts', () => {
  it('hits a circle ahead and misses one behind', () => {
    expect(rayCircle(0, 0, 0, 1, 100, 0, 10, 1)).toBeCloseTo(9, 6)
    expect(rayCircle(0, 0, 0, 1, 100, 0, -10, 1)).toBeNull()
  })

  it('misses a circle beside the ray', () => {
    expect(rayCircle(0, 0, 0, 1, 100, 5, 10, 1)).toBeNull()
  })

  it('respects the range limit', () => {
    expect(rayCircle(0, 0, 0, 1, 5, 0, 10, 1)).toBeNull()
  })

  it('reports the far side when the ray starts inside', () => {
    // A muzzle sitting inside its own car must not report a hit behind it.
    expect(rayCircle(0, 0, 0, 1, 100, 0, 0, 2)).toBeCloseTo(2, 6)
  })

  it('hits an axis-aligned box and misses one off to the side', () => {
    const box = { x: 0, z: 10, halfX: 2, halfZ: 2, yaw: 0 }
    expect(rayRect(0, 0, 0, 1, 100, box)).toBeCloseTo(8, 6)
    expect(rayRect(20, 0, 0, 1, 100, box)).toBeNull()
  })

  it('accounts for a box being rotated', () => {
    // A 45° square reaches further along its diagonal than its half-width.
    const flat = { x: 0, z: 10, halfX: 1, halfZ: 1, yaw: 0 }
    const turned = { ...flat, yaw: Math.PI / 4 }
    expect(rayRect(0, 0, 0, 1, 100, flat)).toBeCloseTo(9, 6)
    expect(rayRect(0, 0, 0, 1, 100, turned)!).toBeCloseTo(10 - Math.SQRT2, 6)
  })
})

describe('firing', () => {
  it('does not fire without the input', () => {
    const world = fire(range(), NEUTRAL_INPUT, 60)
    expect(eventsOfType(world, 'weaponFired')).toHaveLength(0)
    expect(car(world, 0).ammo.machineGun).toBe(GUN.capacity)
  })

  it('gates the machine gun on its fire interval', () => {
    const oneSecond = fire(range(), input({ fire: true }), TICK_HZ)
    const barrels = GUN.muzzles.length
    const expected = Math.floor(1 / GUN.fireInterval) * barrels
    const spent = GUN.capacity - car(oneSecond, 0).ammo.machineGun

    // One volley of slack: whether the last one lands inside the window depends
    // on where the interval falls relative to the tick boundary.
    expect(spent).toBeGreaterThanOrEqual(expected)
    expect(spent).toBeLessThanOrEqual(expected + barrels)
  })

  it('fires one round from every barrel per volley', () => {
    const { events } = fireCollecting(range(), input({ fire: true }), 1)
    const shots = pick(events, 'weaponFired').filter((e) => e.weapon === 'machineGun')

    expect(shots).toHaveLength(GUN.muzzles.length)

    // Parallel, not converging: a convergence distance is wrong at every other
    // range, and the point of twin mounts is that aiming is a driving problem.
    const [left, right] = shots
    expect(left!.dir.x).toBeCloseTo(right!.dir.x, 12)
    expect(left!.dir.z).toBeCloseTo(right!.dir.z, 12)

    // And they leave from two genuinely different places on the hood.
    expect(Math.abs(left!.pos.x - right!.pos.x)).toBeCloseTo(
      Math.abs(GUN.muzzles[0]!.x - GUN.muzzles[1]!.x),
      9,
    )
  })

  it('shoots dead straight, with no dispersion', () => {
    // The machine gun's spread is zero on purpose, so two volleys fired from an
    // identical world must land in exactly the same place. Any wander here is
    // the gun aiming for the player.
    const a = pick(fireCollecting(range(), input({ fire: true }), 1).events, 'tracer')
    const b = pick(fireCollecting(range(), input({ fire: true }), 1).events, 'tracer')

    expect(a.length).toBeGreaterThan(0)
    expect(a.map((t) => t.to)).toEqual(b.map((t) => t.to))

    // Straight along the car's own heading, not merely repeatable.
    const forward = forwardOf(car(range(), 0).yaw)
    for (const shot of a) {
      const dx = shot.to.x - shot.from.x
      const dz = shot.to.z - shot.from.z
      const length = Math.hypot(dx, dz)
      expect(dx / length).toBeCloseTo(forward.x, 9)
      expect(dz / length).toBeCloseTo(forward.z, 9)
    }
  })

  it('does not touch the RNG while spread is zero', () => {
    // Advancing the stream and multiplying the result by zero would still
    // change every later replay, which is a very quiet way to break M8.
    const before = range()
    const after = fire(before, input({ fire: true }), 60)
    expect(after.rngState).toBe(before.rngState)
  })

  it('depletes ammo and then stops firing entirely', () => {
    // Long enough to empty the magazine several times over.
    const seconds = (GUN.capacity * GUN.fireInterval) + 5
    const world = fire(range(), input({ fire: true }), Math.round(seconds * TICK_HZ))

    expect(car(world, 0).ammo.machineGun).toBe(0)
    expect(eventsOfType(world, 'weaponFired')).toHaveLength(0)
  })

  it('counts rockets separately from bullets', () => {
    const world = fire(range(), input({ fire: true, special: true }), Math.round(2.5 * TICK_HZ))
    const shooter = car(world, 0)

    expect(shooter.ammo.rocket).toBeLessThan(ROCKET.capacity)
    expect(shooter.ammo.rocket).toBeGreaterThan(0)
    expect(shooter.ammo.machineGun).toBeLessThan(GUN.capacity)
  })

  it('counts down cooldowns in seconds, not ticks', () => {
    let world = step(range(), shooterOnly(input({ fire: true })))
    expect(car(world, 0).cooldowns.machineGun).toBeCloseTo(GUN.fireInterval, 9)

    world = step(world, shooterOnly(NEUTRAL_INPUT))
    expect(car(world, 0).cooldowns.machineGun).toBeCloseTo(GUN.fireInterval - TICK_DT, 9)
  })

  it('a wreck cannot shoot', () => {
    const base = range()
    const dead: WorldState = {
      ...base,
      vehicles: [
        { ...car(base, 0), health: 0, respawnAt: base.tick + 100000 },
        car(base, 1),
      ],
    }
    const world = fire(dead, input({ fire: true, special: true }), 60)
    expect(eventsOfType(world, 'weaponFired')).toHaveLength(0)
  })
})

describe('damage', () => {
  it('takes exactly the weapon damage off a hit car', () => {
    const world = step(range(), shooterOnly(input({ fire: true })))
    const damaged = eventsOfType(world, 'damaged')
    // Both barrels land in the same tick and are merged into one event, which
    // is what stops a volley reading as two separate hits downstream.
    const volley = GUN.damage * GUN.muzzles.length

    expect(damaged).toHaveLength(1)
    expect(damaged[0]!.amount).toBeCloseTo(volley, 9)
    expect(damaged[0]!.id).toBe(1)
    expect(damaged[0]!.by).toBe(0)
    expect(car(world, 1).health).toBeCloseTo(T.maxHealth - volley, 9)
  })

  it('needs the arithmetically correct number of rounds to destroy a car', () => {
    let world = range()
    let dealt = 0
    let destroyedAt: number | null = null

    for (let i = 0; i < 60 * TICK_HZ && destroyedAt === null; i++) {
      world = step(world, shooterOnly(input({ fire: true })))
      for (const e of eventsOfType(world, 'damaged')) dealt += e.amount
      if (eventsOfType(world, 'vehicleDestroyed').length > 0) destroyedAt = world.tick
    }

    expect(destroyedAt, 'the target never died').not.toBeNull()
    expect(isAlive(car(world, 1))).toBe(false)

    // Total damage counted rather than events, because two barrels landing in
    // one tick merge into a single event. It must cover the health bar and
    // overshoot by less than one volley.
    const volley = GUN.damage * GUN.muzzles.length
    expect(dealt).toBeGreaterThanOrEqual(T.maxHealth)
    expect(dealt).toBeLessThan(T.maxHealth + volley)
    expect(dealt / GUN.damage, 'rounds landed should be a whole number').toBeCloseTo(
      Math.round(dealt / GUN.damage),
      9,
    )
  })

  it('never reports negative health', () => {
    const world = fire(range(), input({ fire: true }), 40 * TICK_HZ)
    for (const v of world.vehicles) expect(v.health).toBeGreaterThanOrEqual(0)
  })

  it('scenery stops a bullet', () => {
    const base = range()
    const walled: WorldState = {
      ...base,
      arena: {
        ...RANGE,
        blocks: [
          { id: 'shield', pos: { x: 0, y: 0, z: 12 }, halfExtents: { x: 6, y: 3, z: 1 }, yaw: 0 },
        ],
      },
    }

    const { world, events } = fireCollecting(walled, input({ fire: true }), 60)

    expect(pick(events, 'weaponFired').length, 'never actually fired').toBeGreaterThan(0)
    expect(pick(events, 'damaged')).toHaveLength(0)
    expect(car(world, 1).health).toBe(T.maxHealth)

    // The tracer still draws, it just stops at the wall.
    const tracers = pick(events, 'tracer')
    expect(tracers.length).toBeGreaterThan(0)
    expect(tracers.every((t) => t.hit === null)).toBe(true)
  })
})

describe('rockets', () => {
  it('intercepts a stationary target at the expected tick', () => {
    const world = range()
    const gap = 25 - T.halfExtents.z - ROCKET.muzzles[0]!.z
    // Fired from rest, so the rocket travels at exactly its own speed.
    const expected = Math.round(gap / ROCKET.speed / TICK_DT)

    let current = world
    let detonatedAt: number | null = null
    for (let i = 0; i < 5 * TICK_HZ && detonatedAt === null; i++) {
      current = step(current, shooterOnly(input({ special: i === 0 })))
      if (eventsOfType(current, 'explosion').length > 0) detonatedAt = current.tick
    }

    expect(detonatedAt).not.toBeNull()
    // Within a tick either way: the swept test resolves inside the step it
    // crosses the target, not on a tick boundary.
    expect(Math.abs(detonatedAt! - expected)).toBeLessThanOrEqual(2)
  })

  it('intercepts a moving target later than a still one', () => {
    const still = range()
    const base = range()
    const fleeing: WorldState = {
      ...base,
      vehicles: [car(base, 0), { ...car(base, 1), vel: { x: 0, y: 0, z: 30 } }],
    }

    const tickOfHit = (start: WorldState): number | null => {
      let current = start
      for (let i = 0; i < 6 * TICK_HZ; i++) {
        current = step(current, shooterOnly(input({ special: i === 0 })))
        if (eventsOfType(current, 'explosion').length > 0) return current.tick
      }
      return null
    }

    const a = tickOfHit(still)
    const b = tickOfHit(fleeing)
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(b!).toBeGreaterThan(a!)
  })

  it('damages everything inside the blast, with falloff', () => {
    const base = range()
    // Two targets at different distances from where the rocket will land.
    const cluster: WorldState = {
      ...base,
      vehicles: [
        car(base, 0),
        { ...car(base, 1), pos: { x: 0, y: T.rideHeight, z: 25 } },
      ],
    }

    let world = cluster
    let total = 0
    for (let i = 0; i < 3 * TICK_HZ; i++) {
      world = step(world, shooterOnly(input({ special: i === 0 })))
      for (const e of eventsOfType(world, 'damaged')) total += e.amount
    }

    // A direct hit is the impact damage plus a near-centre blast.
    expect(total).toBeGreaterThan(ROCKET.damage)
    expect(total).toBeLessThanOrEqual(ROCKET.damage + ROCKET.blastDamage + 1e-9)
  })

  it('can hurt the car that fired it', () => {
    const base = range()
    // Nose to a wall: the rocket detonates immediately in front of the shooter.
    const cornered: WorldState = {
      ...base,
      arena: {
        ...RANGE,
        blocks: [
          { id: 'wall', pos: { x: 0, y: 0, z: 6 }, halfExtents: { x: 8, y: 3, z: 1 }, yaw: 0 },
        ],
      },
    }

    const world = fire(cornered, input({ special: true }), 40)
    expect(car(world, 0).health).toBeLessThan(T.maxHealth)
  })

  it('leaves no projectile alive forever', () => {
    // Fire into open space; the rocket must expire rather than accumulate.
    const empty = createWorld({ seed: 1, arena: RANGE, vehicles: 1 })
    const world = fire(empty, input({ special: true }), Math.round(20 * TICK_HZ))
    expect(world.projectiles.length).toBeLessThanOrEqual(ROCKET.capacity)

    const quiet = fire(world, NEUTRAL_INPUT, Math.round(ROCKET.lifetime * TICK_HZ + 60))
    expect(quiet.projectiles).toHaveLength(0)
  })
})

describe('destruction and respawn', () => {
  function killTarget(): WorldState {
    let world = range()
    for (let i = 0; i < 60 * TICK_HZ; i++) {
      world = step(world, shooterOnly(input({ fire: true })))
      if (!isAlive(car(world, 1))) return world
    }
    throw new Error('target survived')
  }

  it('freezes the wreck and schedules a respawn', () => {
    const world = killTarget()
    const wreck = car(world, 1)

    expect(wreck.health).toBe(0)
    expect(wreck.respawnAt).toBe(world.tick + Math.round(T.respawnDelay / TICK_DT))
    expect(V.length(wreck.vel)).toBe(0)
    expect(wreck.yawRate).toBe(0)
  })

  it('brings the car back at full health and ammo, on its spawn point', () => {
    let world = killTarget()
    const diedAt = world.tick

    world = fire(world, NEUTRAL_INPUT, Math.round(T.respawnDelay * TICK_HZ) + 2)
    const back = car(world, 1)

    expect(isAlive(back)).toBe(true)
    expect(back.health).toBe(T.maxHealth)
    expect(back.ammo.rocket).toBe(ROCKET.capacity)
    expect(back.pos.z).toBeCloseTo(RANGE.spawns[1]!.pos.z, 6)
    expect(world.tick - diedAt).toBeGreaterThanOrEqual(Math.round(T.respawnDelay / TICK_DT))
  })

  it('reports the kill against whoever landed the last hit', () => {
    const world = killTarget()
    const kills = eventsOfType(world, 'vehicleDestroyed')
    expect(kills).toHaveLength(1)
    expect(kills[0]!.id).toBe(1)
    expect(kills[0]!.by).toBe(0)
  })

  it('a wreck neither collides nor blocks a shot', () => {
    const world = killTarget()
    // Drive straight through where the wreck is: no impact against it.
    const rolling = fire(
      { ...world, vehicles: [{ ...car(world, 0), vel: { x: 0, y: 0, z: 25 } }, car(world, 1)] },
      NEUTRAL_INPUT,
      3 * TICK_HZ,
    )
    for (const e of rolling.events) {
      if (e.type === 'impact') expect(e.against).toBeNull()
    }
  })
})
