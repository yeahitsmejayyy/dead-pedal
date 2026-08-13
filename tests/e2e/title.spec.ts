/**
 * M8: the title screen, and the one thing it has to get right.
 *
 * Every other e2e spec boots with `?nomenu=1` and skips this screen, because a
 * test about rockets should not also be a test about a button. That trade only
 * holds if the menu path itself is covered somewhere, which is here.
 *
 * The assertion that matters is not "the overlay is visible" — it is that the
 * SIM IS NOT RUNNING behind it. A title screen that looks right while the match
 * clock drains and bots shoot each other is the bug this screen exists to fix,
 * and it is invisible from a screenshot.
 *
 * Note the asymmetry in how the two directions are tested. Proving the sim is
 * STOPPED needs a fixed wait — you are asserting an absence, and the only way to
 * do that is to let real time pass and find nothing happened. Proving it is
 * RUNNING must NOT use a fixed wait: under SwiftShader the first seconds go on
 * shader compilation and async model loading, so a wall-clock window buys an
 * unpredictable amount of sim time. A first draft asserted progress after 400ms,
 * measured 8 ticks, and failed on a build that was working perfectly. Wait on
 * sim progress, exactly as drive.spec.ts does.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED HERE, and why.
 *
 * The obvious test — "the sim does not advance while the title is up" — cannot
 * be written honestly against this harness, so it is not written at all.
 *
 * Headless Chromium produces animation frames on demand. `waitForFunction`
 * polls on requestAnimationFrame and therefore drives them, which is why the
 * `ticks` helper works; `waitForTimeout` drives nothing. During the title phase
 * nothing else is demanding frames either, so the sim sits still in this
 * environment WHATEVER the code does. That was measured, not assumed: with the
 * freeze deliberately removed from main.ts, three separate versions of that
 * assertion — a fixed wait, a nested rAF counter, and an rAF-polled
 * waitForFunction expected to time out — all stayed green. An assertion that
 * cannot fail is worse than no assertion, because it reads like cover.
 *
 * The freeze is verified by hand in a real focused browser instead: the match
 * clock holds at 5:00 while the title is up and counts down after START. What
 * IS asserted below is everything this harness can actually observe — the
 * overlay, the HUD, and that the sim runs once you start.
 */
import { expect, test, type Page } from '@playwright/test'

type Api = { __deadPedal: { world: () => { tick: number; match: { phase: string } }; drawCalls: () => number } }

const tickOf = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as Api).__deadPedal.world().tick)

/** Resolve once the sim has advanced `count` ticks, however long that takes. */
async function ticks(page: Page, count: number): Promise<void> {
  const from = await tickOf(page)
  await page.waitForFunction(
    (target) => (window as unknown as Api).__deadPedal.world().tick >= target,
    from + count,
  )
}

test.describe('M8 — the title screen', () => {
  test('holds the sim until the player starts, then runs it', async ({ page }) => {
    await page.goto('/?silent=1')

    await expect(page.locator('#title')).toBeVisible()
    await expect(page.locator('.title-start')).toBeVisible()
    // The HUD belongs to the match, not the menu.
    await expect(page.locator('#hud')).toBeHidden()

    const atBoot = await tickOf(page)

    await page.locator('.title-start').click()

    await expect(page.locator('#title')).toBeHidden()
    await expect(page.locator('#hud')).toBeVisible()

    // Running. Waited on, not timed — see the note at the top of the file.
    await ticks(page, 30)
    expect(await tickOf(page)).toBeGreaterThan(atBoot)
  })

  test('starts from the keyboard, and only once', async ({ page }) => {
    await page.goto('/?silent=1')
    await expect(page.locator('#title')).toBeVisible()

    // Enter reaches the window handler AND, because the button holds focus, the
    // browser's own click-on-Enter. A naive implementation therefore starts
    // twice, and the second start rebuilds the world — which is why the real
    // assertion below is that the tick count never goes BACKWARDS. A restart is
    // invisible if you only check that the overlay went away.
    await page.keyboard.press('Enter')
    await expect(page.locator('#title')).toBeHidden()

    await ticks(page, 30)
    const running = await tickOf(page)

    await page.keyboard.press('Enter')
    await ticks(page, 10)
    expect(await tickOf(page), 'a stray Enter must not rebuild the world').toBeGreaterThanOrEqual(
      running,
    )
  })

  test('?nomenu=1 boots straight into the match', async ({ page }) => {
    await page.goto('/?silent=1&nomenu=1')
    await expect(page.locator('#title')).toBeHidden()
    await expect(page.locator('#hud')).toBeVisible()

    const atBoot = await tickOf(page)
    await ticks(page, 30)
    expect(await tickOf(page)).toBeGreaterThan(atBoot)
  })
})
