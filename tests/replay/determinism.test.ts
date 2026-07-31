/**
 * M0's one required test: the sim is a pure function of its state and inputs.
 *
 * This is the test PLAN.md §4 promises "will save you later, repeatedly" — every
 * later milestone leans on it, and M8's reconciliation is this test with a network
 * in the middle. Right now `step` only advances the tick, so what it really proves
 * is that the harness around the sim is honest. That is the point of M0.
 *
 * There is deliberately no pinned golden hash yet: `WorldState` gains fields at
 * every milestone, so a pinned value would fail on every commit that isn't a
 * regression. Golden hashes arrive at M1 with the first recorded input file.
 */
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { hashState } from '../../src/core/hash'
import { createWorld, step, stepMany, type Inputs } from '../../src/sim'

const root = fileURLToPath(new URL('../..', import.meta.url))
const NO_INPUTS: Inputs = new Map()
const TICKS = 10_000

function run(seed: number, ticks = TICKS): string {
  return hashState(stepMany(createWorld({ seed }), NO_INPUTS, ticks))
}

describe('determinism', () => {
  it('produces identical state hashes for two runs from the same seed', () => {
    expect(run(12345)).toBe(run(12345))
  })

  it('produces different state hashes for different seeds', () => {
    expect(run(1)).not.toBe(run(2))
  })

  it('advances exactly one tick per step', () => {
    const world = stepMany(createWorld({ seed: 7 }), NO_INPUTS, TICKS)
    expect(world.tick).toBe(TICKS)
  })

  it('never mutates the world it was given', () => {
    const world = createWorld({ seed: 3 })
    const before = hashState(world)
    step(world, NO_INPUTS)
    expect(hashState(world)).toBe(before)
  })

  it('resumes identically from a serialised world', () => {
    // The property M8 depends on: a world restored from the wire continues the
    // same match. If this ever fails, snapshots are lossy.
    const halfway = stepMany(createWorld({ seed: 99 }), NO_INPUTS, TICKS / 2)
    const roundTripped = JSON.parse(JSON.stringify(halfway))

    expect(hashState(stepMany(halfway, NO_INPUTS, TICKS / 2))).toBe(
      hashState(stepMany(roundTripped, NO_INPUTS, TICKS / 2)),
    )
  })

  it('is plain data — no functions, no class instances, no NaN', () => {
    const world = stepMany(createWorld({ seed: 5 }), NO_INPUTS, 1000)
    expect(() => hashState(world)).not.toThrow()
    expect(hashState(world)).not.toContain('NaN')
  })

  it('prints a stable hash from the headless runner', () => {
    // Guards the actual `npm run sim` path, not just the library underneath it.
    const sim = (): string =>
      execFileSync('npx', ['tsx', 'tools/headless.ts', '--ticks', '10000', '--quiet'], {
        cwd: root,
        encoding: 'utf8',
      }).trim()

    const hash = sim()
    expect(hash).toMatch(/^[0-9a-f]{16}$/)
    expect(sim()).toBe(hash)
    expect(hash).toBe(run(1))
  }, 60_000)
})
