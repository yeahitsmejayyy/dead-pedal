/**
 * M3's replay test: "fixed input file → target destroyed at exactly tick N".
 *
 * The tick is the point. A hash tells you *something* changed; a kill tick tells
 * you the weapon arithmetic changed, and by how much. If damage, fire rate, blast
 * radius or the RNG stream shifts by any amount, this moves.
 */
import { describe, expect, it } from 'vitest'
import { hashState } from '../../src/core/hash'
import { PROVING_GROUND } from '../../src/content/arenas/proving-ground'
import { createWorld, isAlive, step, type WorldState } from '../../src/sim'
import { FIREFIGHT_TICKS, firefightInputs } from '../../tools/circuit'
import fixture from './fixtures/firefight.json' with { type: 'json' }

const RANGE = {
  ...PROVING_GROUND,
  blocks: [],
  ramps: [],
  spawns: [
    { pos: { x: 0, y: 0, z: 0 }, yaw: 0 },
    { pos: { x: 0, y: 0, z: 25 }, yaw: 0 },
  ],
}

function runFirefight(): { world: WorldState; destroyedAt: number | null; kills: number } {
  let world = createWorld({ seed: fixture.seed, arena: RANGE, vehicles: 2 })
  let destroyedAt: number | null = null
  let kills = 0

  for (let i = 0; i < FIREFIGHT_TICKS; i++) {
    world = step(world, firefightInputs(world.tick))
    for (const event of world.events) {
      if (event.type !== 'vehicleDestroyed') continue
      kills++
      if (destroyedAt === null) destroyedAt = world.tick
    }
  }

  return { world, destroyedAt, kills }
}

describe('firefight replay', () => {
  it('destroys the target at exactly the recorded tick', () => {
    expect(runFirefight().destroyedAt).toBe(fixture.destroyedAtTick)
  })

  it('matches the recorded hash', () => {
    expect(hashState(runFirefight().world)).toBe(fixture.hash)
  })

  it('spends exactly the recorded ammo', () => {
    const shooter = runFirefight().world.vehicles[0]!
    expect(shooter.ammo).toEqual(fixture.shooterAmmo)
  })

  it('is reproducible run to run', () => {
    expect(hashState(runFirefight().world)).toBe(hashState(runFirefight().world))
  })

  it('actually kills something, so the fixture is not vacuous', () => {
    const { destroyedAt, kills } = runFirefight()
    expect(destroyedAt).not.toBeNull()
    expect(kills).toBeGreaterThan(0)
  })

  it('brings the target back, so the run covers respawn too', () => {
    const { world } = runFirefight()
    // The recording is long enough that the target dies and returns at least
    // once — if it did not, the respawn path would be untested by any replay.
    expect(world.vehicles).toHaveLength(2)
    expect(isAlive(world.vehicles[0]!)).toBe(true)
  })

  it('covers every weapon, so the fixture is replay coverage and not just a hash', () => {
    // PLAN.md M4 asks for "replay coverage per weapon". A recording that only
    // ever fires one of them pins one of them.
    expect(fixture.weaponsUsed).toEqual(['homingMissile', 'machineGun', 'mine', 'rocket'])

    let world = createWorld({ seed: fixture.seed, arena: RANGE, vehicles: 2 })
    const fired = new Set<string>()
    for (let i = 0; i < FIREFIGHT_TICKS; i++) {
      world = step(world, firefightInputs(world.tick))
      for (const event of world.events) {
        if (event.type === 'weaponFired') fired.add(event.weapon)
      }
    }
    expect([...fired].sort()).toEqual(fixture.weaponsUsed)
  })

  it('leaves the RNG untouched, because nothing in a firefight is random yet', () => {
    // Machine-gun spread was the sim's only consumer of randomness and it is
    // now zero, so `rngState` is carried but unspent. That is worth asserting
    // rather than assuming: the day M5 gives bots an aim error, this test goes
    // red and tells you the replay fixtures have to be re-recorded.
    const start = createWorld({ seed: fixture.seed, arena: RANGE, vehicles: 2 })
    expect(runFirefight().world.rngState).toBe(start.rngState)
  })
})
