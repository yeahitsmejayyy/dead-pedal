/**
 * L0 — seeded PRNG (mulberry32).
 *
 * The state is a single int32, which is the whole point: it lives inside
 * `WorldState` as `rngState`, so it serialises, diffs and hashes like any other
 * field, and `step` stays pure.
 *
 * There is deliberately no stateful `Rng` object here. A closure that mutates
 * hidden state is exactly the thing that makes a replay diverge from the run it
 * was recorded from.
 */

export type RngState = number

export type Draw = {
  /** Uniform in [0, 1). */
  readonly value: number
  /** State to carry forward. Drop it and you have re-rolled the same number. */
  readonly state: RngState
}

/** Coerce any number into a valid, well-mixed starting state. */
export function fromSeed(seed: number): RngState {
  return Math.imul(seed | 0, 0x9e3779b1) | 0
}

export function next(state: RngState): Draw {
  const s = (state + 0x6d2b79f5) | 0
  let t = Math.imul(s ^ (s >>> 15), 1 | s)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, state: s }
}
