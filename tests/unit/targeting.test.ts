/**
 * M4's target-selection tests, from PLAN.md §4: "target selection given N
 * candidates and a cone — deterministic and correct".
 *
 * Every case here is really a question about the *other* half of M4's done
 * criterion. A homing missile is only fair to be hit by if the rules for who
 * can be locked are ones a driver can play around, so each test is one of those
 * escapes: leave the cone, break the line of sight, or open the range.
 */
import { describe, expect, it } from 'vitest'
import { PROVING_GROUND } from '../../src/content/arenas/proving-ground'
import { VEHICLES } from '../../src/content/vehicles'
import { WEAPONS } from '../../src/content/weapons'
import {
  createWorld,
  hasLineOfSight,
  selectTarget,
  spawnVehicle,
  type Arena,
  type LockRules,
  type Vehicle,
} from '../../src/sim'

const T = VEHICLES.roadster!
const HOMING = WEAPONS.homingMissile.homing!

const EMPTY: Arena = { ...PROVING_GROUND, blocks: [], ramps: [], pickups: [] }

const RULES: LockRules = { cone: HOMING.lockCone, range: HOMING.lockRange }

/** A car at a position, facing +Z unless told otherwise. */
function at(id: number, x: number, z: number, yaw = 0): Vehicle {
  const base = spawnVehicle(id, EMPTY)
  return { ...base, pos: { x, y: T.rideHeight, z }, yaw }
}

describe('selectTarget', () => {
  const shooter = at(0, 0, 0)

  it('finds nothing when there is nobody else', () => {
    expect(selectTarget(shooter, [shooter], EMPTY, RULES)).toBeNull()
  })

  it('locks a car dead ahead', () => {
    expect(selectTarget(shooter, [shooter, at(1, 0, 40)], EMPTY, RULES)).toBe(1)
  })

  it('never locks the shooter itself', () => {
    expect(selectTarget(shooter, [shooter], EMPTY, RULES)).toBeNull()
  })

  it('ignores a car behind', () => {
    expect(selectTarget(shooter, [shooter, at(1, 0, -40)], EMPTY, RULES)).toBeNull()
  })

  it('ignores a car outside the cone, and locks it once it comes inside', () => {
    // Just outside the ~29° half-angle, then just inside.
    const outside = 40 * Math.tan(HOMING.lockCone + 0.08)
    const inside = 40 * Math.tan(HOMING.lockCone - 0.08)

    expect(selectTarget(shooter, [shooter, at(1, outside, 40)], EMPTY, RULES)).toBeNull()
    expect(selectTarget(shooter, [shooter, at(1, inside, 40)], EMPTY, RULES)).toBe(1)
  })

  it('honours the cone relative to where the car is pointing', () => {
    // Same target, shooter turned to face it.
    const target = at(1, 60, 0)
    expect(selectTarget(at(0, 0, 0, 0), [shooter, target], EMPTY, RULES)).toBeNull()
    // Yaw −π/2 faces +X.
    expect(selectTarget(at(0, 0, 0, -Math.PI / 2), [shooter, target], EMPTY, RULES)).toBe(1)
  })

  it('ignores a car beyond the range, and locks it once it closes', () => {
    expect(selectTarget(shooter, [shooter, at(1, 0, HOMING.lockRange + 5)], EMPTY, RULES)).toBeNull()
    expect(selectTarget(shooter, [shooter, at(1, 0, HOMING.lockRange - 5)], EMPTY, RULES)).toBe(1)
  })

  it('ignores a wreck', () => {
    const dead = { ...at(1, 0, 40), health: 0 }
    expect(selectTarget(shooter, [shooter, dead], EMPTY, RULES)).toBeNull()
  })

  it('picks the nearest of several candidates', () => {
    const candidates = [shooter, at(1, 0, 80), at(2, 5, 30), at(3, -8, 55)]
    expect(selectTarget(shooter, candidates, EMPTY, RULES)).toBe(2)
  })

  it('is deterministic when two candidates tie exactly', () => {
    // Mirrored either side of the nose, identical distance. Whichever it picks,
    // it has to pick the same one every time and on every machine.
    const tied = [shooter, at(2, 6, 40), at(1, -6, 40)]
    const first = selectTarget(shooter, tied, EMPTY, RULES)
    expect(first).toBe(selectTarget(shooter, [...tied].reverse(), EMPTY, RULES))
    expect(first).toBe(1)
  })

  it('will not lock through a wall', () => {
    const walled: Arena = {
      ...EMPTY,
      blocks: [
        // 8m wide, so a car 12m off the centreline at 40m is past its edge —
        // and still well inside the 29° cone.
        { id: 'shield', pos: { x: 0, y: 0, z: 20 }, halfExtents: { x: 4, y: 4, z: 1 }, yaw: 0 },
      ],
    }
    expect(selectTarget(shooter, [shooter, at(1, 0, 40)], walled, RULES)).toBe(null)
    // …but the car behind the wall is not immune, just covered: step aside and
    // the lock returns.
    expect(selectTarget(shooter, [shooter, at(1, 12, 40)], walled, RULES)).toBe(1)
  })

  it('prefers a visible far car over a hidden near one', () => {
    const walled: Arena = {
      ...EMPTY,
      blocks: [
        { id: 'shield', pos: { x: 0, y: 0, z: 14 }, halfExtents: { x: 4, y: 4, z: 1 }, yaw: 0 },
      ],
    }
    // Car 1 is nearer but behind the block; car 2 is further and in the open.
    expect(selectTarget(shooter, [shooter, at(1, 0, 25), at(2, 14, 45)], walled, RULES)).toBe(2)
  })
})

describe('hasLineOfSight', () => {
  const walled: Arena = {
    ...EMPTY,
    blocks: [
      { id: 'wall', pos: { x: 0, y: 0, z: 20 }, halfExtents: { x: 6, y: 3, z: 1 }, yaw: 0 },
    ],
  }

  it('is clear across open ground', () => {
    expect(hasLineOfSight(EMPTY, 0, 0, 0, 40, 1)).toBe(true)
  })

  it('is blocked straight through a wall', () => {
    expect(hasLineOfSight(walled, 0, 0, 0, 40, 1)).toBe(false)
  })

  it('is clear around the end of a wall', () => {
    expect(hasLineOfSight(walled, 0, 0, 30, 40, 1)).toBe(true)
  })

  it('is clear over the top of a wall', () => {
    // An airborne car looking down on it.
    expect(hasLineOfSight(walled, 0, 0, 0, 40, 8)).toBe(true)
  })

  it('is symmetric', () => {
    expect(hasLineOfSight(walled, 0, 0, 0, 40, 1)).toBe(hasLineOfSight(walled, 0, 40, 0, 0, 1))
  })
})

describe('the arena declares its own crates', () => {
  it('gives every pickup a unique id', () => {
    const ids = PROVING_GROUND.pickups.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('starts every crate available', () => {
    const world = createWorld({ seed: 1 })
    expect(world.pickups).toHaveLength(PROVING_GROUND.pickups.length)
    expect(world.pickups.every((p) => p.availableAt === 0)).toBe(true)
  })

  it('keeps crates inside the arena', () => {
    for (const pickup of PROVING_GROUND.pickups) {
      expect(Math.abs(pickup.pos.x)).toBeLessThan(PROVING_GROUND.halfExtents.x)
      expect(Math.abs(pickup.pos.z)).toBeLessThan(PROVING_GROUND.halfExtents.z)
    }
  })
})
