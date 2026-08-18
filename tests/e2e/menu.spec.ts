/**
 * The in-game menu: pause, controls, restart, quit.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED HERE, and why.
 *
 * Not "the sim stops while the menu is open". That assertion cannot fail in
 * this harness. Headless Chromium produces animation frames on demand, so the
 * sim sits still with the menu open WHATEVER the code does — the long note at
 * the top of title.spec.ts records that being measured, with the freeze
 * deliberately removed, against three different phrasings of the same check.
 * Writing it again here would read like cover for something untested.
 *
 * What is asserted instead is the state the freeze is *derived* from. Opening
 * the menu sets `paused`, and `frozen = paused || !started` is one expression
 * in main — so the flag is the honest half of the claim, and the half a test
 * can actually observe. That the flag stops the world is verified by hand in a
 * focused browser, exactly as the title screen's freeze is.
 */
import { expect, test, type Page } from '@playwright/test'

type Api = {
  __deadPedal: {
    world: () => { tick: number }
    paused: () => boolean
  }
}

const tickOf = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as Api).__deadPedal.world().tick)

const pausedOf = (page: Page): Promise<boolean> =>
  page.evaluate(() => (window as unknown as Api).__deadPedal.paused())

/** Resolve once the sim has advanced `count` ticks, however long that takes. */
async function ticks(page: Page, count: number): Promise<void> {
  const from = await tickOf(page)
  await page.waitForFunction(
    (target) => (window as unknown as Api).__deadPedal.world().tick >= target,
    from + count,
  )
}

test.describe('the in-game menu', () => {
  test('opens on Escape, pauses, and resumes on Resume', async ({ page }) => {
    await page.goto('/?silent=1&nomenu=1')
    await expect(page.locator('#hud')).toBeVisible()
    await ticks(page, 10)

    expect(await pausedOf(page), 'a fresh match is not paused').toBe(false)

    await page.keyboard.press('Escape')
    await expect(page.locator('#menu')).toBeVisible()
    expect(await pausedOf(page), 'opening the menu pauses').toBe(true)

    await page.locator('[data-act="resume"]').click()
    await expect(page.locator('#menu')).toBeHidden()
    expect(await pausedOf(page), 'Resume unpauses').toBe(false)

    // Running again. Waited on rather than timed — see title.spec.ts.
    const atResume = await tickOf(page)
    await ticks(page, 20)
    expect(await tickOf(page)).toBeGreaterThan(atResume)
  })

  test('P opens the same menu, and Escape closes it again', async ({ page }) => {
    await page.goto('/?silent=1&nomenu=1')
    await ticks(page, 10)

    await page.keyboard.press('KeyP')
    await expect(page.locator('#menu')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.locator('#menu')).toBeHidden()
    expect(await pausedOf(page)).toBe(false)
  })

  test('lists the real bindings, not a copy of them', async ({ page }) => {
    await page.goto('/?silent=1&nomenu=1')
    await ticks(page, 10)
    await page.keyboard.press('Escape')

    await page.locator('[data-act="controls"]').click()
    const controls = page.locator('[data-view="controls"]')
    await expect(controls).toBeVisible()

    // Rendered from content/controls, so these are the codes the input layer
    // obeys — the point of the table. Spot-checked across all three groups.
    await expect(controls).toContainText('Throttle')
    await expect(controls).toContainText('Handbrake')
    await expect(controls).toContainText('Machine gun')
    await expect(controls).toContainText('Menu')

    // Key codes must never reach the screen raw.
    await expect(controls).not.toContainText('KeyW')
    await expect(controls).not.toContainText('ArrowUp')

    await page.locator('[data-act="back"]').click()
    await expect(page.locator('[data-view="root"]')).toBeVisible()
  })

  test('quit to title returns to the title screen with the sim held', async ({ page }) => {
    await page.goto('/?silent=1&nomenu=1')
    await expect(page.locator('#hud')).toBeVisible()
    await ticks(page, 20)

    await page.keyboard.press('Escape')
    await page.locator('[data-act="quit"]').click()

    await expect(page.locator('#menu')).toBeHidden()
    await expect(page.locator('#title')).toBeVisible()
    await expect(page.locator('.title-start')).toBeVisible()
    // The HUD belongs to the match, which no longer exists.
    await expect(page.locator('#hud')).toBeHidden()
    expect(await pausedOf(page), 'quitting must not leave the pause flag set').toBe(false)
  })

  test('restart puts the match back to the countdown', async ({ page }) => {
    await page.goto('/?silent=1&nomenu=1')
    await ticks(page, 40)
    const before = await tickOf(page)

    await page.keyboard.press('Escape')
    await page.locator('[data-act="restart"]').click()
    await expect(page.locator('#menu')).toBeHidden()

    // A fresh world starts its tick count again, so the restarted match is
    // behind where the old one had got to.
    await ticks(page, 5)
    expect(await tickOf(page), 'restart rebuilds the world').toBeLessThan(before)
  })

  test('the tuning panel is not part of the player-facing UI', async ({ page }) => {
    await page.goto('/?silent=1&nomenu=1')
    await ticks(page, 10)
    await page.keyboard.press('Escape')

    // The menu is above the debug panel's z-index, so nothing can sit over it.
    // (The panel itself only exists in dev, which is where this suite runs.)
    const menuZ = await page
      .locator('#menu')
      .evaluate((el) => Number(getComputedStyle(el).zIndex))
    const panel = page.locator('.tp-dfwv')
    if ((await panel.count()) > 0) {
      const panelZ = await panel.first().evaluate((el) => Number(getComputedStyle(el).zIndex))
      expect(menuZ).toBeGreaterThan(panelZ)
    }
  })
})
