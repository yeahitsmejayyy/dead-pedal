/**
 * Tick the sim N times and print a state hash.
 *
 *   npm run sim -- --ticks 10000
 *   npm run sim -- --circuit
 *   npm run sim -- --ticks 10000 --cars 8      # the PLAN.md §6 perf budget
 *   npm run sim -- --ticks 10000 --seed 7 --quiet
 *
 * `--circuit` drives the recorded 30-second input program instead of leaving the
 * car parked, which is the only version of this that means anything now that the
 * sim has physics in it. `--quiet` prints the bare hash, for shell comparison.
 */
import { parseArgs } from 'node:util'
import { hashState } from '../src/core/hash'
import { createWorld, stepScripted, type Inputs } from '../src/sim'
import { CIRCUIT_TICKS, circuitInputs } from './circuit'

const { values } = parseArgs({
  options: {
    ticks: { type: 'string' },
    seed: { type: 'string', default: '1' },
    circuit: { type: 'boolean', default: false },
    cars: { type: 'string', default: '1' },
    quiet: { type: 'boolean', default: false },
  },
})

function requireInt(raw: string, flag: string): number {
  const n = Number(raw)
  if (!Number.isInteger(n)) {
    console.error(`--${flag} must be an integer, got ${JSON.stringify(raw)}`)
    process.exit(1)
  }
  return n
}

const seed = requireInt(values.seed, 'seed')
const cars = requireInt(values.cars, 'cars')
const ticks = values.ticks !== undefined
  ? requireInt(values.ticks, 'ticks')
  : values.circuit
    ? CIRCUIT_TICKS
    : 600

if (ticks < 0) {
  console.error('--ticks must not be negative')
  process.exit(1)
}

const PARKED: Inputs = new Map()
const source = values.circuit ? circuitInputs : (): Inputs => PARKED

const startedAt = performance.now()
const world = stepScripted(createWorld({ seed, vehicles: cars }), source, ticks)
const elapsedMs = performance.now() - startedAt

const hash = hashState(world)

if (values.quiet) {
  console.log(hash)
} else {
  const car = world.vehicles[0]
  const perTick = ticks > 0 ? elapsedMs / ticks : 0
  console.log(`seed        ${seed}`)
  console.log(`inputs      ${values.circuit ? 'circuit' : 'parked'}`)
  console.log(`cars        ${cars}`)
  console.log(`ticks       ${ticks}`)
  console.log(`final tick  ${world.tick}`)
  console.log(`hash        ${hash}`)
  if (car !== undefined) {
    console.log(
      `car         x=${car.pos.x.toFixed(2)} z=${car.pos.z.toFixed(2)} ` +
        `yaw=${car.yaw.toFixed(3)} fwd=${car.forwardSpeed.toFixed(2)}m/s`,
    )
  }
  console.log(`sim time    ${elapsedMs.toFixed(2)} ms  (${(perTick * 1000).toFixed(3)} µs/tick)`)
}
