import { describe, expect, it } from 'vitest'
import { fromSeed, next } from '../../src/core/rng'
import { hashString } from '../../src/core/hash'

function take(seed: number, count: number): number[] {
  let state = fromSeed(seed)
  const out: number[] = []
  for (let i = 0; i < count; i++) {
    const draw = next(state)
    out.push(draw.value)
    state = draw.state
  }
  return out
}

describe('rng', () => {
  it('is a pure function of state', () => {
    const state = fromSeed(42)
    expect(next(state)).toEqual(next(state))
  })

  it('produces the same sequence from the same seed', () => {
    expect(hashString(take(1234, 10_000).join(','))).toBe(
      hashString(take(1234, 10_000).join(',')),
    )
  })

  it('produces different sequences from different seeds', () => {
    expect(take(1, 32)).not.toEqual(take(2, 32))
  })

  it('stays in [0, 1)', () => {
    for (const value of take(99, 50_000)) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('keeps state as an int32 so it survives a JSON round trip', () => {
    let state = fromSeed(-7)
    for (let i = 0; i < 1000; i++) {
      expect(Number.isInteger(state)).toBe(true)
      expect(state).toBe(state | 0)
      state = next(state).state
    }
  })

  it('is roughly uniform — a smoke test, not a statistics suite', () => {
    const buckets = new Array<number>(10).fill(0)
    const samples = 100_000
    for (const value of take(2026, samples)) {
      const index = Math.floor(value * 10)
      buckets[index] = (buckets[index] ?? 0) + 1
    }
    for (const count of buckets) {
      expect(count).toBeGreaterThan(samples / 10 - samples / 100)
      expect(count).toBeLessThan(samples / 10 + samples / 100)
    }
  })
})
