/**
 * L0 — fixed-step accumulator.
 *
 * The clock never asks the machine what time it is; it is *told* how much time
 * elapsed. That keeps it pure, testable, and legal inside `sim/`. Reading the
 * wall clock is the caller's job, and the caller lives above L1.
 */

export const TICK_HZ = 60
export const TICK_DT = 1 / TICK_HZ

export type Clock = {
  /** Seconds of simulated time per tick. Fixed for the life of the clock. */
  readonly dt: number
  /** Upper bound on ticks emitted from one frame — the spiral-of-death guard. */
  readonly maxStepsPerFrame: number
  /** Unconsumed real time, always in [0, dt). */
  readonly accumulator: number
}

export type Advance = {
  readonly clock: Clock
  /** How many times the caller should invoke `step`. */
  readonly steps: number
}

export function createClock(dt: number = TICK_DT, maxStepsPerFrame = 5): Clock {
  return { dt, maxStepsPerFrame, accumulator: 0 }
}

export function advance(clock: Clock, elapsedSeconds: number): Advance {
  const accumulated = clock.accumulator + Math.max(0, elapsedSeconds)
  const wanted = Math.floor(accumulated / clock.dt)
  const steps = Math.min(wanted, clock.maxStepsPerFrame)

  // Time beyond the cap is *dropped*, not banked. Banking it guarantees the next
  // frame starts even further behind, and the sim never catches up.
  const accumulator = accumulated - wanted * clock.dt

  return { clock: { ...clock, accumulator }, steps }
}

/**
 * Fraction of the way from the last simulated state to the next, in [0, 1).
 * This is the `alpha` the view interpolates with; the sim never sees it.
 */
export function alpha(clock: Clock): number {
  return clock.accumulator / clock.dt
}
