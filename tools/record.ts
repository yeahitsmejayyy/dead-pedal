/**
 * Record the circuit replay fixture.
 *
 *   npm run record
 *
 * Run this whenever `WorldState` changes shape or the handling tuning in
 * `content/` moves on purpose. If the replay test goes red and you did *not*
 * mean to change the car, that is the regression the fixture exists to catch —
 * do not re-record to make it green.
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { hashState } from '../src/core/hash'
import { createWorld, step, stepScripted } from '../src/sim'
import { PROVING_GROUND } from '../src/content/arenas/proving-ground'
import {
  CIRCUIT_SECONDS,
  CIRCUIT_TICKS,
  FIREFIGHT_SECONDS,
  FIREFIGHT_TICKS,
  circuitInputs,
  firefightInputs,
} from './circuit'

const SEED = 1
const OUT = fileURLToPath(new URL('../tests/replay/fixtures/circuit.json', import.meta.url))

const world = stepScripted(createWorld({ seed: SEED }), circuitInputs, CIRCUIT_TICKS)
const car = world.vehicles[0]
if (car === undefined) throw new Error('circuit produced no vehicle')

const fixture = {
  note: 'Regenerate with `npm run record` only when a change to the car is intended.',
  seed: SEED,
  seconds: CIRCUIT_SECONDS,
  ticks: CIRCUIT_TICKS,
  hash: hashState(world),
  final: {
    x: car.pos.x,
    y: car.pos.y,
    z: car.pos.z,
    yaw: car.yaw,
    forwardSpeed: car.forwardSpeed,
    lateralSpeed: car.lateralSpeed,
  },
}

writeFileSync(OUT, `${JSON.stringify(fixture, null, 2)}\n`)

console.log(`recorded ${CIRCUIT_TICKS} ticks (${CIRCUIT_SECONDS}s)`)
console.log(`hash  ${fixture.hash}`)
console.log(`final x=${car.pos.x.toFixed(3)} z=${car.pos.z.toFixed(3)} yaw=${car.yaw.toFixed(4)}`)
console.log(`wrote ${OUT}`)

// ── the firefight ───────────────────────────────────────────────────────────
// A dedicated two-car range, so the recorded kill tick is a statement about
// weapon arithmetic rather than about where the arena furniture happens to be.
const RANGE = {
  ...PROVING_GROUND,
  blocks: [],
  ramps: [],
  spawns: [
    { pos: { x: 0, y: 0, z: 0 }, yaw: 0 },
    { pos: { x: 0, y: 0, z: 25 }, yaw: 0 },
  ],
}

const FIGHT_OUT = fileURLToPath(new URL('../tests/replay/fixtures/firefight.json', import.meta.url))

let fight = createWorld({ seed: SEED, arena: RANGE, vehicles: 2 })
let destroyedAt: number | null = null
const fired = new Set<string>()
for (let i = 0; i < FIREFIGHT_TICKS; i++) {
  fight = step(fight, firefightInputs(fight.tick))
  for (const event of fight.events) {
    if (event.type === 'weaponFired') fired.add(event.weapon)
    if (event.type === 'vehicleDestroyed' && destroyedAt === null) destroyedAt = fight.tick
  }
}
const usedWeapons = [...fired].sort()

const target = fight.vehicles[1]
if (target === undefined) throw new Error('firefight produced no target')

const firefight = {
  note: 'Regenerate with `npm run record` only when a change to the weapons is intended.',
  seed: SEED,
  seconds: FIREFIGHT_SECONDS,
  ticks: FIREFIGHT_TICKS,
  hash: hashState(fight),
  destroyedAtTick: destroyedAt,
  targetHealth: target.health,
  shooterAmmo: fight.vehicles[0]?.ammo,
  // Proof the recording actually walked every weapon rather than emptying one.
  weaponsUsed: usedWeapons,
}

writeFileSync(FIGHT_OUT, `${JSON.stringify(firefight, null, 2)}\n`)

console.log()
console.log(`firefight   ${FIREFIGHT_TICKS} ticks (${FIREFIGHT_SECONDS}s)`)
console.log(`hash        ${firefight.hash}`)
console.log(`destroyed   tick ${destroyedAt}`)
console.log(`weapons     ${usedWeapons.join(', ')}`)
console.log(`wrote ${FIGHT_OUT}`)
