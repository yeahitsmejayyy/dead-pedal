/**
 * PLAN.md M7: "Playwright visual regression on a fixed camera and seeded state."
 *
 * Visual tests are infamous for flaking, and the reason is almost always that
 * something in the frame is not actually pinned. So the list of what had to be
 * held still is worth writing down, because each one is a bug this test would
 * otherwise have reported once a week:
 *
 *   sim seed          `createWorld({ seed })`, already fixed.
 *   which tick        Wall clock decides how many ticks elapse before the shot,
 *                     so two runs land on different frames. Fixed by driving
 *                     the loop by hand — see `runFrames`.
 *   performance.now   Feeds `elapsed`, which drives camera smoothing, shake
 *                     decay and particle integration. Replaced with a counter.
 *   rAF scheduling    Same problem. Replaced with a queue we drain ourselves.
 *   particle random   Smoke, sparks and debris used to call `Math.random` per
 *                     particle. A prototype of exactly this test failed three
 *                     runs in nine because of it; they now draw from the same
 *                     seeded mulberry32 the sim uses.
 *   audio             `?silent=1`, so no AudioContext and no decode timing.
 *   device pixels     Viewport and scale set explicitly by the project config.
 *   GL backend        SwiftShader, forced in playwright.config.ts, so CI and a
 *                     laptop rasterise identically.
 *
 * And one thing deliberately NOT in frame: the HUD. The shot is the canvas
 * alone, because the HUD is DOM text and font rasterisation differs across
 * machines in ways no tolerance survives. What the HUD does is already asserted
 * behaviourally in drive.spec.ts; what it looks like is not worth a flaky test.
 */
import { expect, test, type Page } from '@playwright/test'

/**
 * Replace the two clocks the frame loop reads, before any app code runs.
 *
 * `addInitScript` lands before the module graph evaluates, which is the only
 * point at which this can be done — `main.ts` captures `performance.now()` on
 * its first line.
 */
async function pinTime(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let now = 0
    const pending: FrameRequestCallback[] = []

    performance.now = () => now
    window.requestAnimationFrame = (cb: FrameRequestCallback): number => pending.push(cb)
    window.cancelAnimationFrame = (): void => {}

    // Drain exactly one frame's worth of callbacks, having advanced the clock by
    // exactly one frame. Nothing here is scheduled by the browser, so the sim
    // sees a perfect 60Hz however slow the machine actually is.
    ;(window as unknown as { __frame: (n: number) => void }).__frame = (n: number): void => {
      for (let i = 0; i < n; i++) {
        now += 1000 / 60
        for (const cb of pending.splice(0)) cb(now)
      }
    }
  })
}

async function runFrames(page: Page, frames: number): Promise<void> {
  await page.evaluate(
    (n) => (window as unknown as { __frame: (count: number) => void }).__frame(n),
    frames,
  )
}

test.describe('M7 — the same seed draws the same frame', () => {
  test.beforeEach(async ({ page }) => {
    await pinTime(page)
    await page.goto('/?silent=1')
    await page.waitForFunction(() => '__deadPedal' in window)
  })

  test('renders an identical frame from a pinned clock and a fixed seed', async ({ page }) => {
    // The car has to be DRIVING, and this is the difference between a test and
    // a decoration. A first version shot a stationary car and passed happily
    // when `fovAtSpeed` was moved 14 -> 19, because a parked car has a speed
    // ratio of zero and the speed-scaled FOV therefore does nothing to the
    // frame. Holding the throttle puts the camera in motion, opens the FOV, and
    // brings the chase spring, the shake decay and the tyre smoke into shot.
    await runFrames(page, Math.round(3.2 * 60)) // out of the countdown
    await page.keyboard.down('w')
    await runFrames(page, Math.round(3.0 * 60)) // long enough to be near top speed
    await page.keyboard.down('d')
    await runFrames(page, Math.round(1.4 * 60)) // and turning, so the arena sweeps

    const at = await page.evaluate(() => {
      const w = (
        window as unknown as {
          __deadPedal: {
            world: () => {
              tick: number
              match: { phase: string }
              vehicles: { forwardSpeed: number }[]
            }
          }
        }
      ).__deadPedal.world()
      return { tick: w.tick, phase: w.match.phase, speed: w.vehicles[0]?.forwardSpeed ?? 0 }
    })

    // The shot is only worth anything if it is the frame we think it is.
    // One short of the frame count because the accumulator needs the first
    // frame to fill before it can step — repeatable, which is all this cares
    // about. The speed assertion is the load-bearing one: without it the shot
    // silently degrades to a parked car the day something breaks the throttle.
    expect(at.tick, 'the pinned clock did not advance the sim as expected').toBe(456)
    expect(at.phase).toBe('live')
    // 27.5 m/s measured — 60% of top speed, which puts the speed-scaled FOV at
    // about 73 degrees rather than its 68 resting value. That matters: at 35%
    // the FOV term is worth 0.6 degrees and a change to it is invisible, which
    // is how an earlier version of this test passed while `fovAtSpeed` moved
    // 14 -> 19. The turn scrubs some speed off, hence 25 rather than 30.
    expect(at.speed, 'the car should be at real speed in the pinned frame').toBeGreaterThan(25)

    // Canvas only. See the header for why the HUD is excluded.
    await expect(page.locator('#scene')).toHaveScreenshot('arena-live.png', {
      // Not zero. SwiftShader is deterministic within a machine but a driver or
      // three.js patch release can move a handful of pixels on an edge without
      // anything being wrong. This is loose enough to survive that and tight
      // enough that a car in the wrong place is still a failure.
      maxDiffPixelRatio: 0.01,
    })
  })

  test('draws the same frame twice from the same start', async ({ page }) => {
    // The cheap half of the guarantee, and the one that does not need a stored
    // fixture: run the same number of frames twice in two contexts and compare
    // the two images to each other. If this fails, something is unpinned and
    // the recorded-fixture test above is about to start flaking for real.
    const shoot = async (): Promise<Buffer> => {
      await runFrames(page, 200)
      await page.keyboard.down('w')
      await runFrames(page, 80)
      await page.keyboard.up('w')
      return page.locator('#scene').screenshot()
    }

    const first = await shoot()
    await page.reload()
    await page.waitForFunction(() => '__deadPedal' in window)
    const second = await shoot()

    expect(
      Buffer.compare(first, second),
      'two runs from the same seed and clock produced different pixels',
    ).toBe(0)
  })
})
