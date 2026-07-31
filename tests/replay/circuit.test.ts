/**
 * The replay test M1 asks for: a fixed 30-second input program produces a known
 * final state.
 *
 * This is the regression net for every physics change from here on. When it goes
 * red, either you changed the car on purpose — `npm run record` — or you just
 * broke it. The point is that you find out either way.
 */
import { describe, expect, it } from 'vitest'
import { hashState } from '../../src/core/hash'
import { createWorld, stepScripted } from '../../src/sim'
import { CIRCUIT_TICKS, circuitInput, circuitInputs } from '../../tools/circuit'
import fixture from './fixtures/circuit.json' with { type: 'json' }

function runCircuit(seed = fixture.seed) {
  return stepScripted(createWorld({ seed }), circuitInputs, CIRCUIT_TICKS)
}

describe('circuit replay', () => {
  it('matches the recorded hash', () => {
    expect(hashState(runCircuit())).toBe(fixture.hash)
  })

  it('ends at the recorded position and heading', () => {
    const car = runCircuit().vehicles[0]!
    expect(car.pos.x).toBeCloseTo(fixture.final.x, 9)
    expect(car.pos.y).toBeCloseTo(fixture.final.y, 9)
    expect(car.pos.z).toBeCloseTo(fixture.final.z, 9)
    expect(car.yaw).toBeCloseTo(fixture.final.yaw, 9)
    expect(car.forwardSpeed).toBeCloseTo(fixture.final.forwardSpeed, 9)
    expect(car.lateralSpeed).toBeCloseTo(fixture.final.lateralSpeed, 9)
  })

  it('is reproducible run to run', () => {
    expect(hashState(runCircuit())).toBe(hashState(runCircuit()))
  })

  it('resumes identically from a serialised mid-circuit snapshot', () => {
    // The property M8's reconciliation depends on, now with real physics behind
    // it rather than an empty world.
    const half = Math.floor(CIRCUIT_TICKS / 2)
    const midway = stepScripted(createWorld({ seed: fixture.seed }), circuitInputs, half)
    const restored = JSON.parse(JSON.stringify(midway))

    const fromLive = stepScripted(midway, circuitInputs, CIRCUIT_TICKS - half)
    const fromWire = stepScripted(restored, circuitInputs, CIRCUIT_TICKS - half)

    expect(hashState(fromWire)).toBe(hashState(fromLive))
    expect(hashState(fromLive)).toBe(fixture.hash)
  })

  it('actually exercises the car — this fixture would be worthless otherwise', () => {
    const world = runCircuit()
    const car = world.vehicles[0]!

    // Moved a long way from spawn.
    expect(Math.hypot(car.pos.x, car.pos.z)).toBeGreaterThan(30)
    // Used the whole input surface.
    const throttles = new Set<number>()
    const steers = new Set<number>()
    let handbrakeTicks = 0
    for (let tick = 0; tick < CIRCUIT_TICKS; tick++) {
      const frame = circuitInput(tick)
      throttles.add(Math.sign(frame.throttle))
      steers.add(Math.sign(frame.steer))
      if (frame.handbrake) handbrakeTicks++
    }
    expect(throttles).toEqual(new Set([1, 0, -1]))
    expect(steers).toEqual(new Set([1, 0, -1]))
    expect(handbrakeTicks).toBeGreaterThan(100)
  })
})
