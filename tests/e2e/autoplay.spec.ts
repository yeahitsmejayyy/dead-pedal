/**
 * Audio has to survive the autoplay policy.
 *
 * A browser will not let a page make noise until the user has done something.
 * An AudioContext built before that comes up `suspended`, and `resume()` only
 * succeeds from inside a real user activation.
 *
 * THE BUG THIS EXISTS FOR. `arm()` used to latch on being CALLED rather than on
 * succeeding. A speculative call at boot — added so menu music could start as
 * early as the browser allowed — set the flag, had its `resume()` rejected by
 * the policy, and swallowed the rejection. Every later gesture then
 * early-returned without retrying, so clicking START armed nothing and the game
 * stayed silent for the whole session with no way back.
 *
 * WHY THE POLICY IS SIMULATED RATHER THAN SWITCHED ON. It cannot be switched
 * on. Playwright's Chromium reports a fresh AudioContext as `running` with no
 * gesture, and that was measured four ways before giving up on it: default
 * args, `--autoplay-policy=document-user-activation-required`, that flag with
 * Playwright's own permissive default stripped via `ignoreDefaultArgs`, and all
 * of the above headed rather than headless. Every one came back `running`.
 *
 * So the rule is modelled here instead: AudioContext is wrapped so that it
 * starts suspended and refuses to resume until a real pointerdown or keydown
 * has reached the page. That is the behaviour players get, it is deterministic,
 * and it does not depend on browser defaults that can change underneath us.
 * The first test below asserts the wrapper is actually in force, because a
 * simulation that quietly stops simulating is worse than no test.
 */
import { expect, test, type Page } from '@playwright/test'

type Api = {
  __deadPedal: { audio: () => { armed: boolean; muted: boolean; music: string } }
}

const audioOf = (page: Page): Promise<{ armed: boolean; muted: boolean; music: string }> =>
  page.evaluate(() => (window as unknown as Api).__deadPedal.audio())

/**
 * Make this page obey the autoplay policy, the way a real browser does.
 *
 * The activation listeners are registered in the CAPTURE phase so they run
 * before the application's own handlers. A gesture therefore counts as having
 * happened by the time the game reacts to it — which is exactly the ordering a
 * browser provides, and getting it backwards would make every arm attempt fail.
 */
async function enforceAutoplayPolicy(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let activated = false
    const mark = (): void => {
      activated = true
    }
    for (const kind of ['pointerdown', 'keydown', 'touchstart']) {
      window.addEventListener(kind, mark, { capture: true })
    }

    const Real = window.AudioContext
    class Policed extends Real {
      constructor(...args: ConstructorParameters<typeof AudioContext>) {
        super(...args)
        if (!activated) void Real.prototype.suspend.call(this)
      }
      override resume(): Promise<void> {
        if (!activated) return Promise.reject(new DOMException('blocked', 'NotAllowedError'))
        return Real.prototype.resume.call(this)
      }
    }
    window.AudioContext = Policed as unknown as typeof AudioContext
  })
}

test.describe('audio under the autoplay policy', () => {
  test.beforeEach(async ({ page }) => {
    await enforceAutoplayPolicy(page)
  })

  test('the policy is actually in force', async ({ page }) => {
    await page.goto('/')
    const state = await page.evaluate(async () => {
      const probe = new AudioContext()
      await new Promise((r) => setTimeout(r, 50))
      const s = probe.state
      await probe.close()
      return s
    })
    expect(state, 'a context built without a gesture must be suspended').toBe('suspended')
  })

  test('boots unarmed, and the first gesture arms it', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('#title')).toBeVisible()

    expect((await audioOf(page)).armed, 'nothing is permitted before a gesture').toBe(false)

    // Any gesture will do for ARMING — that is the context becoming legal, and
    // it is separate from whether the mixer is turned up. See the sound-switch
    // tests below for audibility.
    await page.locator('.title-start').click()

    await expect
      .poll(async () => (await audioOf(page)).armed, {
        message: 'clicking START must arm the audio — it is the user activation',
        timeout: 5000,
      })
      .toBe(true)
  })

  test('a gesture that lands late still arms it', async ({ page }) => {
    await page.goto('/')
    // Sit unarmed for a while first. The old implementation burned its one
    // attempt at boot, so a gesture arriving later had nothing left to retry.
    await page.waitForTimeout(1000)
    expect((await audioOf(page)).armed).toBe(false)

    await page.keyboard.press('Enter')

    await expect
      .poll(async () => (await audioOf(page)).armed, {
        message: 'a keypress is a user activation too',
        timeout: 5000,
      })
      .toBe(true)
  })

  test('makes no sound at all until the switch is thrown', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('#title')).toBeVisible()

    const atBoot = await audioOf(page)
    expect(atBoot.muted, 'muted on arrival').toBe(true)
    // Not merely inaudible — not even fetched. 3.7MB of music is not something
    // to spend on a player who never turns sound on.
    // The readout is "<track> duck <n>%", so match the track rather than the
            // whole string.
    expect(atBoot.music, 'and no track loaded').toMatch(/^off/)

    // Clicking through the menus must not sneak sound on either.
    await page.locator('.title-start').click()
    await expect(page.locator('#select')).toBeVisible()
    expect((await audioOf(page)).muted, 'still silent after playing the menus').toBe(true)
  })

  test('the switch turns it on, and the icon agrees', async ({ page }) => {
    await page.goto('/')
    const toggle = page.locator('[data-sound]')
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')

    await toggle.click()

    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(async () => (await audioOf(page)).music, { timeout: 10_000 }).toMatch(/music-1/)

    /**
     * Polled, not read once.
     *
     * `arm()` calls `ctx.resume()` and sets the flag in the promise's callback,
     * so `armed` is asynchronous by construction. Reading it a single time
     * happened to work only because the `music` poll above usually took long
     * enough to cover the gap — an incidental delay, not a guarantee, and one
     * that shrinks whenever the dev server is warm from an earlier test in this
     * file. The claim is unchanged: the click must arm the mixer. This just
     * stops the claim resting on how fast the previous assertion returned.
     */
    await expect
      .poll(async () => (await audioOf(page)).armed, {
        timeout: 5_000,
        message: 'the click that enables sound is itself the user gesture',
      })
      .toBe(true)
    expect((await audioOf(page)).muted).toBe(false)

    // And back off again.
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect((await audioOf(page)).muted).toBe(true)
  })

  test('the N key and the icon can never disagree', async ({ page }) => {
    await page.goto('/')
    const toggle = page.locator('[data-sound]')

    // Both routes go through one switch, so the control cannot end up showing
    // a state the mixer is not in — which is the failure mode of every UI that
    // duplicates a keyboard shortcut.
    await page.keyboard.press('KeyN')
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect((await audioOf(page)).muted).toBe(false)

    await page.keyboard.press('KeyN')
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect((await audioOf(page)).muted).toBe(true)
  })
})
