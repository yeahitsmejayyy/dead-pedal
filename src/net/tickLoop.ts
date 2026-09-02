/**
 * L3 — a fixed-rate loop that does not drift.
 *
 * `setInterval(1000 / 60)` was measured at a mean of 16.92ms rather than
 * 16.67ms — see `docs/multiplayer-spike.md`. That is 59.1 ticks per second
 * instead of 60: a match runs 1.5% slow, and a client rendering at a true 60Hz
 * slides against it forever.
 *
 * The fix is to sleep to the next DEADLINE rather than for a fixed duration, so
 * a tick that arrives late does not push every tick after it late as well. The
 * deadline advances by exactly one step regardless of when the callback
 * actually ran.
 *
 * This will not make a client immune to the mismatch and is not meant to. The
 * spike found the visible artefact came from a 120Hz display drawing a 60Hz
 * world, which no server-side correction can touch — that is interpolation's
 * job. This is hygiene: the rate should be the rate it claims to be.
 */

export type TickLoop = {
  /** Ticks the loop has run. */
  readonly ticks: number
  stop(): void
}

export type TickLoopOptions = {
  readonly hz?: number
  /**
   * How far behind the loop may fall before it stops trying to catch up.
   *
   * Without a ceiling, a process suspended for a minute wakes and runs three
   * thousand ticks back to back, which is not a catch-up, it is a freeze
   * followed by teleporting cars. Past this many missed steps the loop admits
   * the time is gone and resets its deadline to now.
   */
  readonly maxCatchUp?: number
  readonly onLag?: (missedTicks: number) => void
  /**
   * The clock, injectable so the loop can be tested without waiting.
   *
   * A drift-correcting loop that can only be observed in real time is a loop
   * whose correction is asserted by hope.
   */
  readonly now?: () => number
}

export function startTickLoop(
  onTick: () => void,
  options: TickLoopOptions = {},
): TickLoop {
  const hz = options.hz ?? 60
  const step = 1000 / hz
  const maxCatchUp = options.maxCatchUp ?? 5
  const now = options.now ?? defaultNow

  let stopped = false
  let ticks = 0
  let next = now() + step
  let timer: ReturnType<typeof setTimeout> | null = null

  const run = (): void => {
    if (stopped) return

    // Run every step whose deadline has passed, not just one: a callback that
    // overran by two steps owes two ticks, and a fixed-step sim must not
    // silently skip them.
    let ran = 0
    while (now() >= next && ran < maxCatchUp) {
      onTick()
      ticks++
      next += step
      ran++
    }

    if (now() >= next) {
      // Still behind after the ceiling. The lost time is lost; say so rather
      // than accumulating a debt that can never be paid.
      const missed = Math.floor((now() - next) / step) + 1
      options.onLag?.(missed)
      next = now() + step
    }

    timer = setTimeout(run, Math.max(0, next - now()))
  }

  timer = setTimeout(run, step)

  return {
    get ticks() {
      return ticks
    },
    stop() {
      stopped = true
      if (timer !== null) clearTimeout(timer)
    },
  }
}

/**
 * Monotonic-ish current time in milliseconds.
 *
 * `performance.now` where it exists — it is monotonic, so a clock adjustment
 * cannot make the loop believe it has travelled backwards — and `Date.now` as
 * the fallback.
 */
function defaultNow(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}
