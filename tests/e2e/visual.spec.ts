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
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'

/**
 * Resolved from this file, not the working directory, and suffixed by platform.
 *
 * SwiftShader is forced precisely so a laptop and CI rasterise the same, but
 * "should" is not "does", and a per-platform baseline costs one file and
 * removes the whole question.
 */
const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), `fixtures/arena-live-${process.platform}.png`)

/**
 * Compare two PNGs by pixel, returning the fraction that differ.
 *
 * Hand-rolled rather than `toHaveScreenshot`, which could not be made to work
 * here: its stability loop runs on requestAnimationFrame, and this test replaces
 * rAF to drive the clock by hand, so the assertion timed out during capture
 * without ever rendering anything wrong. The raw capture path is provably
 * deterministic — the second test in this file compares two of them byte for
 * byte on every run — so the comparison is the only part that needed writing.
 */
function differingFraction(a: Buffer, b: Buffer): number {
  const decode = (png: Buffer): Buffer =>
    execFileSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
      { input: png, maxBuffer: 1 << 28 })
  const [x, y] = [decode(a), decode(b)]
  if (x.length !== y.length) return 1
  let differing = 0
  for (let i = 0; i < x.length; i += 3) {
    // A tolerance per channel, not per pixel: a driver or three.js patch can
    // nudge an edge pixel by a value or two without anything being wrong.
    if (Math.abs(x[i]! - y[i]!) > 6 || Math.abs(x[i + 1]! - y[i + 1]!) > 6 || Math.abs(x[i + 2]! - y[i + 2]!) > 6) {
      differing++
    }
  }
  return differing / (x.length / 3)
}

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

    const nativeRaf = window.requestAnimationFrame.bind(window)
    performance.now = () => now
    window.requestAnimationFrame = (cb: FrameRequestCallback): number => pending.push(cb)
    window.cancelAnimationFrame = (): void => {}

    /**
     * Give the browser its own rAF back, without draining the queue.
     *
     * Playwright's `toHaveScreenshot` runs a stability loop on
     * requestAnimationFrame before it compares, and with rAF replaced that
     * callback never fires — the assertion times out having rendered nothing
     * wrong. Restoring it here lets Playwright work while the game's own loop
     * stays parked in `pending` forever, so the world is frozen on exactly the
     * frame that was driven.
     */
    ;(window as unknown as { __release: () => void }).__release = (): void => {
      window.requestAnimationFrame = nativeRaf
    }

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
  /**
   * A bigger budget than the 60s the rest of the suite runs on.
   *
   * This spec pays two costs nothing else does: it waits for EVERY asset — 2.7MB
   * of glTF and half a megabyte of texture — and then drives a couple of hundred
   * frames by hand through a software rasteriser. On a warm server it finishes
   * in about twenty seconds; on the first run after the dev server comes up,
   * vite is also transforming every module for the first time and it does not.
   *
   * Measured before raising it: one timeout in six runs, always the first of a
   * batch. Raising the inner `waitForFunction` alone did not fix it — the outer
   * test timeout then became the shorter of the two, which is a good reminder
   * that a timeout is only as useful as the smallest one enclosing it.
   */
  test.describe.configure({ timeout: 150_000 })

  test.beforeEach(async ({ page }) => {
    await pinTime(page)
    await page.goto('/?silent=1&nomenu=1')
    await page.waitForFunction(() => '__deadPedal' in window)
    /**
     * Wait for every asset, on real time, before the hand-driven clock starts.
     *
     * Car models and arena textures load over the network while the frames
     * below run on a clock this test drives itself. Without waiting, whether
     * the shot catches the glTF cars or the procedural boxes they replace comes
     * down to how fast the machine fetched 3.3MB — a flake that would have been
     * blamed on the renderer.
     *
     * 90 seconds, not the 30 this started with. That is not slack for a slow
     * render; it is a COLD START budget. On the first run after the dev server
     * comes up, vite is transforming modules for the first time AND the browser
     * is pulling 2.7MB of glTF plus half a megabyte of texture, and 30s was not
     * always enough — measured as one timeout in six runs, always the first of a
     * batch. A warm run finishes this in under two seconds, so the larger
     * number costs nothing when it is not needed.
     */
    await page.waitForFunction(
      () => (window as unknown as { __deadPedal: { modelsLoaded: () => boolean } })
        .__deadPedal.modelsLoaded(),
      undefined,
      { timeout: 90_000 },
    )
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

    // Freeze the world, THEN hand rAF back.
    //
    // Both halves are needed. Parking the loop entirely leaves the WebGL back
    // buffer with nothing repainting it, and a canvas without
    // preserveDrawingBuffer has nothing stable for Playwright to read — the
    // capture times out having rendered nothing wrong. Pause is the tool that
    // already exists for this: the sim stops, the renderer keeps drawing the
    // same held frame, so the canvas is both static and freshly painted.
    await page.keyboard.press('p')
    await page.evaluate(() => (window as unknown as { __release: () => void }).__release())
    await page.waitForTimeout(150)

    // Canvas only — and hiding the overlays is what makes that true.
    //
    // `#scene` IS the canvas, but an element screenshot captures that REGION of
    // the viewport, compositing whatever DOM is painted over it. The canvas is
    // full-viewport, so the shot arrived with the HUD, the key legend, the debug
    // panel and the pause scrim in it: font rasterisation in a test that
    // documents itself as excluding exactly that, and the scrim dimming the one
    // thing being measured.
    await page.addStyleTag({ content: '#hud, #keys, .tp-dfwv { display: none !important }' })
    const shot = await page.locator('#scene').screenshot()

    // Recording FAILS rather than passing quietly. A visual test that writes its
    // own baseline and goes green is a test that reports success on a machine
    // where it has never once compared anything — which is how the first version
    // of this passed while the models were silently not loading.
    if (!existsSync(FIXTURE)) {
      mkdirSync(dirname(FIXTURE), { recursive: true })
      writeFileSync(FIXTURE, shot)
      throw new Error(`No baseline. Recorded one at ${FIXTURE} — look at it, then re-run.`)
    }

    const drift = differingFraction(readFileSync(FIXTURE), shot)

    /**
     * 0.01%, which is 92 pixels of 921,600. Measured, not guessed:
     *
     *   unchanged, twice          0.000%   ← capture is deterministic
     *   wheels off their axles    0.036%   ← the bug this fixture caught
     *   livery tint 0.55 → 0.35   0.374%
     *   car scaled 10% long       0.616%
     *   models fail to load       0.896%   ← cars fall back to boxes
     *
     * The car is only ~1.3% of the frame, so no car-shaped regression can ever
     * be worth much more than that last figure. The previous threshold was 1%,
     * above every single one of these: it sat there going green while the cars
     * rendered as untextured boxes. Re-record deliberately (delete the file) —
     * do not widen this to make a failure go away.
     */
    expect(drift, `${(drift * 100).toFixed(3)}% of pixels differ from ${FIXTURE}`).toBeLessThan(0.0001)
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
