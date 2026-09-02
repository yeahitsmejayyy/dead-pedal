/**
 * The fixed-rate loop.
 *
 * These are the claims that made it worth writing instead of using
 * `setInterval`: it holds the mean rate rather than drifting slow, it pays back
 * ticks it owes after a slow callback, and it refuses to pay back an unbounded
 * debt after the process was suspended.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startTickLoop } from '../../src/net/tickLoop'

/** A clock the test moves by hand, so nothing here waits on real time. */
function fakeClock(): { now: () => number; advance: (ms: number) => void } {
  let t = 0
  return {
    now: () => t,
    advance: (ms) => {
      t += ms
    },
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('the fixed-rate loop', () => {
  it('holds its rate over a long run instead of drifting slow', async () => {
    // The bug this exists to prevent: setInterval(1000/60) measured 16.92ms,
    // which is 59.1Hz — a match that runs 1.5% slow forever.
    const clock = fakeClock()
    const loop = startTickLoop(() => {}, { hz: 60, now: clock.now })

    // Ten seconds of clock, advanced in one-step slices.
    for (let i = 0; i < 600; i++) {
      clock.advance(1000 / 60)
      await vi.advanceTimersByTimeAsync(1000 / 60)
    }

    // Exactly 60Hz would be 600. Allow a tick either side for the phase the
    // loop starts on; what must not happen is a systematic shortfall.
    expect(loop.ticks).toBeGreaterThanOrEqual(599)
    expect(loop.ticks).toBeLessThanOrEqual(601)
    loop.stop()
  })

  it('pays back ticks it owes after a slow callback', async () => {
    const clock = fakeClock()
    const loop = startTickLoop(() => {}, { hz: 60, now: clock.now })

    // Three steps pass before the loop is next serviced.
    clock.advance(50)
    await vi.advanceTimersByTimeAsync(50)

    // Three deadlines elapsed, so three ticks are owed — not one.
    expect(loop.ticks).toBe(3)
    loop.stop()
  })

  it('refuses to pay back an unbounded debt after a long stall', async () => {
    // A process suspended for a minute must not wake and run 3600 ticks back to
    // back. That is not catching up, it is a freeze followed by teleporting cars.
    const clock = fakeClock()
    const lagged: number[] = []
    const loop = startTickLoop(() => {}, {
      hz: 60,
      maxCatchUp: 5,
      now: clock.now,
      onLag: (missed) => lagged.push(missed),
    })

    clock.advance(60_000)
    await vi.advanceTimersByTimeAsync(60_000)

    expect(loop.ticks).toBeLessThanOrEqual(5 + 5) // the ceiling, plus the steps after it resets
    expect(lagged.length, 'the lost time should be reported, not hidden').toBeGreaterThan(0)
    expect(lagged[0]).toBeGreaterThan(100)
    loop.stop()
  })

  it('stops when told, and runs nothing afterwards', async () => {
    const clock = fakeClock()
    const loop = startTickLoop(() => {}, { hz: 60, now: clock.now })

    clock.advance(100)
    await vi.advanceTimersByTimeAsync(100)
    const at = loop.ticks
    expect(at).toBeGreaterThan(0)

    loop.stop()
    clock.advance(1000)
    await vi.advanceTimersByTimeAsync(1000)
    expect(loop.ticks).toBe(at)
  })
})
