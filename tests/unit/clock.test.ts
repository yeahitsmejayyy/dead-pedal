import { describe, expect, it } from 'vitest'
import { TICK_DT, advance, alpha, createClock } from '../../src/core/clock'

describe('clock', () => {
  it('emits no steps until a full dt has elapsed', () => {
    const clock = createClock()
    expect(advance(clock, TICK_DT * 0.9).steps).toBe(0)
  })

  it('emits exactly one step per dt', () => {
    let clock = createClock()
    let total = 0
    // 120 frames of exactly one tick each.
    for (let i = 0; i < 120; i++) {
      const result = advance(clock, TICK_DT)
      clock = result.clock
      total += result.steps
    }
    expect(total).toBe(120)
  })

  it('does not drift over a long run of ragged frame times', () => {
    // 10 seconds of frames that never line up with the tick rate.
    let clock = createClock()
    let steps = 0
    const frame = 1 / 143.7
    const frames = Math.round(10 / frame)
    for (let i = 0; i < frames; i++) {
      const result = advance(clock, frame)
      clock = result.clock
      steps += result.steps
    }
    // 10 seconds at 60Hz, give or take the partial tick still in the accumulator.
    expect(steps).toBeGreaterThanOrEqual(599)
    expect(steps).toBeLessThanOrEqual(600)
  })

  it('caps steps and drops the excess rather than banking it', () => {
    const clock = createClock(TICK_DT, 5)
    // A five-second stall — a tab that went to the background.
    const result = advance(clock, 5)
    expect(result.steps).toBe(5)
    // The unconsumed 4.9s is gone. If it were banked, the next frame would owe
    // another 294 ticks and the sim would never catch up.
    expect(result.clock.accumulator).toBeLessThan(TICK_DT)
  })

  it('keeps the accumulator in [0, dt)', () => {
    let clock = createClock()
    for (const elapsed of [0, 0.001, 0.016, 0.1, 1, -5, TICK_DT, TICK_DT * 3.5]) {
      clock = advance(clock, elapsed).clock
      expect(clock.accumulator).toBeGreaterThanOrEqual(0)
      expect(clock.accumulator).toBeLessThan(clock.dt)
    }
  })

  it('ignores negative elapsed time', () => {
    const clock = createClock()
    const result = advance(clock, -1)
    expect(result.steps).toBe(0)
    expect(result.clock.accumulator).toBe(0)
  })

  it('reports alpha as the fraction into the next tick', () => {
    const { clock } = advance(createClock(), TICK_DT * 1.5)
    expect(alpha(clock)).toBeCloseTo(0.5, 6)
  })

  it('never mutates the clock it was given', () => {
    const clock = createClock()
    advance(clock, 10)
    expect(clock.accumulator).toBe(0)
  })
})
