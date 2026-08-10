/**
 * PLAN.md §6's perf budget, asserted rather than assumed.
 *
 *   "16.6ms total frame. Sim under 2ms with eight vehicles."
 *
 * Eight is the number that matters and the one nothing else in the suite runs:
 * every other test drives the four the arena is authored for. Doubling the cars
 * doubles the vehicle pairs the contact solver has to consider and doubles the
 * bots doing the thinking, so it is the only configuration that can tell you
 * whether the sim scales.
 *
 * ASSERTED ON THE MEDIAN, and that is the whole design of this file.
 *
 * The first version asserted the p99 and went red the first time it ran inside
 * the full suite. Standalone it measures p99 226us; with nineteen other vitest
 * workers competing for cores it measured 2739us, with a 12.5ms max — while the
 * MEDIAN stayed at 66us. Nothing about the sim changed between those two runs.
 * A wall-clock tail under a parallel test runner is a measurement of the OS
 * scheduler, and asserting on it is how a perf test earns a reputation for
 * flaking and then gets deleted.
 *
 * The median is immune to descheduling: half the samples would have to slow
 * down before it moves, which is exactly the signature of a real regression and
 * not the signature of a busy machine.
 */
import { describe, expect, it } from 'vitest'
import { createWorld, step, type Inputs, type WorldState } from '../../src/sim'
import { DEATHMATCH } from '../../src/content/match'
import { botInputs, createRoster, rosterHealth } from '../../src/bots'
import { DEFAULT_VEHICLE, tuningFor } from '../../src/content/vehicles'
import { PROVING_GROUND } from '../../src/content/arenas/proving-ground'

/** PLAN.md §6. Microseconds, because milliseconds of a tick are all decimals. */
const BUDGET_US = 2000

type Sample = { mean: number; p50: number; p99: number; max: number; ticks: number }

function percentile(sorted: readonly number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0
}

/**
 * Time `step` plus `botInputs` over a real bot-vs-bot match.
 *
 * Both are timed together because both are in the frame. `botInputs` is L4 and
 * is not, strictly, the sim tick PLAN budgets — but a frame that misses 16.6ms
 * does not care which side of the layer boundary the time went.
 */
function measure(cars: number, seconds: number): Sample {
  const roster = createRoster(cars, { humans: [], difficulty: 'ultraInstinct', seed: 7 })
  let world: WorldState = createWorld({
    seed: 7,
    vehicles: cars,
    rules: DEATHMATCH,
    health: rosterHealth(roster, tuningFor(DEFAULT_VEHICLE).maxHealth),
  })

  // Warm up first and throw the samples away: the first few hundred ticks are
  // measuring the JIT, not the sim.
  for (let i = 0; i < 600; i++) world = step(world, botInputs(roster, world))

  const samples: number[] = []
  const ticks = Math.round(seconds * 60)
  for (let i = 0; i < ticks; i++) {
    const started = performance.now()
    const inputs: Inputs = botInputs(roster, world)
    world = step(world, inputs)
    samples.push((performance.now() - started) * 1000)
  }

  samples.sort((a, b) => a - b)
  return {
    // Trimmed: the top 1% is descheduling, not sim cost, and letting it into a
    // mean makes the mean useless for the same reason the p99 was.
    mean:
      samples.slice(0, Math.floor(samples.length * 0.99)).reduce((a, b) => a + b, 0) /
      Math.floor(samples.length * 0.99),
    p50: percentile(samples, 0.5),
    p99: percentile(samples, 0.99),
    max: samples[samples.length - 1] ?? 0,
    ticks,
  }
}

describe('the sim, against its frame budget', () => {
  it('carries eight vehicles well inside two milliseconds a tick', () => {
    const s = measure(8, 20)
    const detail = `mean ${s.mean.toFixed(0)}us  p50 ${s.p50.toFixed(0)}  p99 ${s.p99.toFixed(0)}  max ${s.max.toFixed(0)}  over ${s.ticks} ticks`

    // Measured at 66us median standalone and 66us median inside the full suite —
    // identical, which is the point. The bound is 30x that, which looks absurdly
    // loose and is deliberate: this guards against an algorithmic regression, an
    // O(n^2) creeping into contact or a bot re-scanning the arena every tick. It
    // has to survive a CI box ten times slower than a laptop and still catch a
    // real one.
    expect(s.p50, detail).toBeLessThan(BUDGET_US)
    // The trimmed mean too, so a regression that spikes half the ticks rather
    // than all of them still lands.
    expect(s.mean, detail).toBeLessThan(BUDGET_US)
  })

  it('scales with the cars rather than exploding', () => {
    /**
     * The assertion with actual teeth, and the only one here that is immune to
     * how fast the machine is — a slow box slows both measurements equally, so
     * the ratio holds where an absolute bound would have to be loosened until
     * it caught nothing.
     *
     * Calibrated by injecting a real O(n^2) pass over vehicle pairs into `step`
     * and measuring what it did:
     *
     *              p50      4->8 ratio
     *   clean      60us     2.0x
     *   O(n^2)    363us     3.9x
     *
     * So 3.0 sits between them with room on both sides. Note the budget
     * assertion above did NOT catch that regression: 363us is still a fifth of
     * PLAN's 2ms, which is what 30x of headroom buys you. The budget test
     * asserts the contract; this one is what would actually notice.
     */
    const four = measure(4, 10)
    const eight = measure(8, 10)
    const ratio = eight.p50 / four.p50

    expect(
      ratio,
      `4 cars ${four.p50.toFixed(0)}us -> 8 cars ${eight.p50.toFixed(0)}us = ${ratio.toFixed(1)}x`,
    ).toBeLessThan(3)
  })

  it('runs eight cars in an arena authored for four', () => {
    // Worth pinning, because it is the assumption the whole test rests on.
    // PROVING_GROUND has four spawns; asking for eight doubles cars up on them,
    // and the pair solver has to push them apart on the first tick rather than
    // leaving two cars inside each other for the rest of the match.
    expect(PROVING_GROUND.spawns).toHaveLength(4)

    const roster = createRoster(8, { humans: [], difficulty: 'ultraInstinct', seed: 7 })
    let world = createWorld({ seed: 7, vehicles: 8, rules: DEATHMATCH })
    expect(world.vehicles).toHaveLength(8)

    for (let i = 0; i < 120; i++) world = step(world, botInputs(roster, world))

    for (const a of world.vehicles) {
      expect(Number.isFinite(a.pos.x) && Number.isFinite(a.pos.z)).toBe(true)
      for (const b of world.vehicles) {
        if (a.id >= b.id) continue
        const gap = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z)
        expect(gap, `cars ${a.id} and ${b.id} are inside each other`).toBeGreaterThan(1)
      }
    }
  })
})
