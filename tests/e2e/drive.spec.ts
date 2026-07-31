/**
 * M1's end-to-end test: the page loads, the canvas renders, and the car
 * responds to the keys a person would actually press.
 *
 * This drives the real input → sim → view path in a real browser. The unit
 * tests prove the physics; this proves the wiring, which is the only thing they
 * cannot cover.
 */
import { expect, test, type Page } from '@playwright/test'

type Probe = {
  tick: number
  x: number
  z: number
  yaw: number
  speed: number
  slip: number
  health: number
  maxHealth: number
  bullets: number
  rockets: number
  special: string
  specialAmmo: number
  lockTarget: number | null
  lockTime: number
  manualTarget: boolean
  projectiles: number
  crates: number
  drawCalls: number
}

async function probe(page: Page, id = 0): Promise<Probe> {
  return page.evaluate((which) => {
    const api = (window as unknown as { __deadPedal: { world: () => unknown; drawCalls: () => number } })
      .__deadPedal
    const world = api.world() as {
      tick: number
      projectiles: unknown[]
      pickups: { availableAt: number }[]
      vehicles: {
        id: number
        pos: { x: number; z: number }
        yaw: number
        forwardSpeed: number
        lateralSpeed: number
        health: number
        maxHealth: number
        ammo: Record<string, number>
        selectedSpecial: string
        lockTarget: number | null
        lockTime: number
        manualTarget: boolean
      }[]
    }
    const car = world.vehicles.find((v) => v.id === which)!
    return {
      tick: world.tick,
      x: car.pos.x,
      z: car.pos.z,
      yaw: car.yaw,
      speed: car.forwardSpeed,
      slip: car.lateralSpeed,
      health: car.health,
      maxHealth: car.maxHealth,
      bullets: car.ammo.machineGun!,
      rockets: car.ammo.rocket!,
      special: car.selectedSpecial,
      specialAmmo: car.ammo[car.selectedSpecial]!,
      lockTarget: car.lockTarget,
      lockTime: car.lockTime,
      manualTarget: car.manualTarget,
      projectiles: world.projectiles.length,
      crates: world.pickups.filter((p) => p.availableAt <= world.tick).length,
      drawCalls: api.drawCalls(),
    }
  }, id)
}

/** Park the opposition, for tests about mechanics rather than about bots. */
async function stopBots(page: Page): Promise<void> {
  await page.evaluate(() => {
    ;(window as unknown as { __deadPedal: { setBots: (on: boolean) => void } }).__deadPedal.setBots(
      false,
    )
  })
}

/**
 * Wait until the sim has advanced `count` ticks.
 *
 * Wall-clock waiting is not a substitute, and this is the single sharpest edge
 * in the whole file. Input is only sampled on a rendered frame, and a frame
 * under SwiftShader can take longer than an entire key press — so `hold(…, 80)`
 * followed by an immediate read can land before the loop has run even once. The
 * key was delivered and latched; the sim simply had not looked yet. Every
 * assertion here is about sim progress, so wait on sim progress.
 */
async function ticks(page: Page, count: number): Promise<void> {
  type Clock = { __deadPedal: { world: () => { tick: number } } }
  const from = await page.evaluate(() => (window as unknown as Clock).__deadPedal.world().tick)
  await page.waitForFunction(
    (target) => (window as unknown as Clock).__deadPedal.world().tick >= target,
    from + count,
  )
}

/** Seconds of sim time, as ticks. The sim runs at a fixed 60Hz. */
const simSeconds = (value: number): number => Math.round(value * 60)

/**
 * Wait for the round to actually start.
 *
 * The browser runs a real deathmatch, which opens with a three-second countdown
 * where `step` substitutes `NO_INPUT` for everyone. Every test below that drives
 * or shoots has to be past that, and the failure it causes is nasty in both
 * directions: some tests go red because the car never moved, but others — the
 * ones asserting that something *does not* happen — go green while testing
 * nothing at all, because a frozen car trivially satisfies them.
 *
 * Waiting is deliberately how this is done. A sandbox back-door would make the
 * suite stop exercising the path the player actually gets, which is most of what
 * these tests are for. Three seconds a test is the honest price.
 */
async function live(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      (
        window as unknown as { __deadPedal: { world: () => { match: { phase: string } } } }
      ).__deadPedal.world().match.phase === 'live',
    undefined,
    { timeout: 15_000 },
  )
}

/** Start a fresh match and wait for it to go live. */
async function restart(page: Page): Promise<void> {
  await page.evaluate(() => {
    ;(window as unknown as { __deadPedal: { reset: () => void } }).__deadPedal.reset()
  })
  await live(page)
}

/** Hold a set of keys for `ms` of real time, and make sure the press lands. */
async function hold(page: Page, keys: string[], ms: number): Promise<void> {
  for (const key of keys) await page.keyboard.down(key)
  await page.waitForTimeout(ms)
  // Do not release until the loop has actually sampled. Latched keys (cycle,
  // target) survive the keyup, but a caller that reads straight afterwards can
  // still get there first.
  await ticks(page, 2)
  for (const key of keys) await page.keyboard.up(key)
}

test.describe('M1–M5 — driving, contact, weapons, lock-on and bots', () => {
  let errors: string[] = []

  test.beforeEach(async ({ page }) => {
    errors = []
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    page.on('pageerror', (error) => errors.push(error.message))

    // Silent: no AudioContext is constructed at all. Headless Chromium ignores
    // the autoplay policy, so without this every test would bake the buffers
    // and hold a render thread for a path no assertion here observes.
    await page.goto('/?silent=1')
    await page.waitForFunction(() => '__deadPedal' in window)
    // Let the loop settle, then wait out the countdown. Nothing below this line
    // can drive, shoot or steer until the round is live.
    await page.waitForTimeout(300)
    await live(page)
  })

  test('renders without console errors', async ({ page }) => {
    const canvas = page.locator('#scene')
    await expect(canvas).toBeVisible()

    const size = await canvas.evaluate((el) => {
      const c = el as HTMLCanvasElement
      return { w: c.width, h: c.height }
    })
    expect(size.w).toBeGreaterThan(0)
    expect(size.h).toBeGreaterThan(0)
    expect(errors).toEqual([])
  })

  test('advances the sim at roughly 60Hz', async ({ page }) => {
    const before = await probe(page)
    await page.waitForTimeout(1000)
    const after = await probe(page)

    const ticks = after.tick - before.tick
    // Allow for scheduler jitter and the accumulator's step cap, but a wildly
    // wrong number here means the fixed-step clock is not wired up.
    expect(ticks).toBeGreaterThan(45)
    expect(ticks).toBeLessThan(75)
  })

  test('drives forward when W is held', async ({ page }) => {
    const before = await probe(page)
    await hold(page, ['w'], 1500)
    const after = await probe(page)

    // Spawn yaw is 0, which faces +Z.
    expect(after.z - before.z).toBeGreaterThan(10)
    expect(after.speed).toBeGreaterThan(10)
  })

  test('steers, and the nose ends up pointing where it went', async ({ page }) => {
    await hold(page, ['w'], 1200)
    const before = await probe(page)
    await hold(page, ['w', 'd'], 1200)
    const after = await probe(page)

    expect(after.yaw).not.toBeCloseTo(before.yaw, 2)
    expect(Math.abs(after.x - before.x)).toBeGreaterThan(2)
  })

  test('D turns right and A turns left', async ({ page }) => {
    // The whole chain, key to car: the unit tests only prove `steer: +1` turns
    // right, not that the D key produces `steer: +1`.
    // Spawn faces +Z, and in a right-handed Y-up frame that puts the car's
    // right on world -X.
    await hold(page, ['w'], 1200)
    const start = await probe(page)
    await hold(page, ['w', 'd'], 900)
    const right = await probe(page)

    expect(right.x - start.x, 'D should move the car toward -X').toBeLessThan(-2)
    expect(right.yaw).toBeGreaterThan(start.yaw)

    await restart(page)
    await hold(page, ['w'], 1200)
    await hold(page, ['w', 'a'], 900)
    const left = await probe(page)

    expect(left.x - start.x, 'A should move the car toward +X').toBeGreaterThan(2)
    expect(left.yaw).toBeLessThan(start.yaw)
  })

  test('look back is a cut, not an animation', async ({ page }) => {
    const camera = async (): Promise<{ x: number; z: number }> =>
      page.evaluate(() => {
        const p = (
          window as unknown as { __deadPedal: { cameraPosition: () => { x: number; z: number } } }
        ).__deadPedal.cameraPosition()
        return { x: p.x, z: p.z }
      })

    await hold(page, ['w'], 1800)
    const before = await camera()

    await page.keyboard.down('c')
    await page.waitForTimeout(50) // ~3 frames
    const after = await camera()
    await page.keyboard.up('c')

    // The camera sits `distance` behind the car and must land `distance` in
    // front of it. Smoothed at the default stiffness, three frames would cover
    // barely a third of that; a cut covers all of it.
    const moved = Math.hypot(after.x - before.x, after.z - before.z)
    expect(moved).toBeGreaterThan(15)
  })

  test('the handbrake breaks traction', async ({ page }) => {
    await hold(page, ['w'], 2000)

    await hold(page, ['w', 'd'], 700)
    const gripped = await probe(page)

    await restart(page)
    await hold(page, ['w'], 2000)
    await hold(page, ['w', 'd', ' '], 700)
    const drifting = await probe(page)

    expect(Math.abs(drifting.slip)).toBeGreaterThan(Math.abs(gripped.slip) * 2)
  })

  test('brakes and reverses when S is held', async ({ page }) => {
    await hold(page, ['w'], 1500)
    expect((await probe(page)).speed).toBeGreaterThan(10)

    await hold(page, ['s'], 3000)
    expect((await probe(page)).speed).toBeLessThan(0)
  })

  test('stays inside the arena when driven at a wall', async ({ page }) => {
    // 90m half-extent; ten seconds at full throttle is more than enough.
    await hold(page, ['w'], 10_000)
    const final = await probe(page)
    expect(Math.abs(final.z)).toBeLessThanOrEqual(90)
    expect(Number.isFinite(final.x)).toBe(true)
  })

  test('rams the stationary car down the arena', async ({ page }) => {
    // M2's definition of done, as far as a machine can check it: the target is
    // parked 48m dead ahead, and holding W has to send it a long way. Bots off,
    // because "did I move it" is not a question you can ask about a car that is
    // driving itself.
    await stopBots(page)
    await restart(page)
    await page.waitForTimeout(200)
    await stopBots(page)

    const targetBefore = await probe(page, 1)
    expect(targetBefore.z).toBeCloseTo(6, 1)

    await hold(page, ['w'], 4000)

    const targetAfter = await probe(page, 1)
    const player = await probe(page, 0)

    expect(targetAfter.z - targetBefore.z, 'the target barely moved').toBeGreaterThan(20)
    // And the rammer drove out of the hit rather than stopping dead in it.
    expect(player.speed).toBeGreaterThan(5)
  })

  test('the machine gun fires, spends ammo and damages the target', async ({ page }) => {
    const before = await probe(page, 1)
    // Read the ceiling rather than assuming it: health is per-car now, and a
    // tougher difficulty tier does not start at the archetype's number.
    expect(before.health).toBe(before.maxHealth)

    // Straight down the lane at the parked car, no need to close the distance.
    await hold(page, ['j'], 1500)

    const target = await probe(page, 1)
    const player = await probe(page, 0)

    expect(player.bullets, 'no ammo was spent').toBeLessThan(600)
    // Two barrels, so a volley costs two rounds.
    expect((600 - player.bullets) % 2, 'rounds should come in pairs').toBe(0)
    expect(target.health, 'the target took no damage').toBeLessThan(before.maxHealth)
  })

  test('a rocket detonates and does more damage than a bullet', async ({ page }) => {
    const before = await probe(page, 1)
    await hold(page, ['k'], 100)
    await ticks(page, simSeconds(1.5))

    const target = await probe(page, 1)
    const player = await probe(page, 0)

    expect(player.rockets).toBe(5)
    // A rocket is tuned at about a sixth of a health bar; a single machine-gun
    // volley is 2.8. The margin is what makes the special special.
    const dealt = before.health - target.health
    expect(dealt).toBeGreaterThan(10)
    expect(dealt / before.maxHealth, 'a rocket should be a chunk, not a kill').toBeLessThan(0.3)
  })

  test('destroys the target and brings it back', async ({ page }) => {
    await stopBots(page)
    await restart(page)
    await page.waitForTimeout(200)
    await stopBots(page)

    // Everything, until it dies.
    await page.keyboard.down('j')
    await page.keyboard.down('k')

    await page.waitForFunction(
      () =>
        (window as unknown as { __deadPedal: { world: () => { vehicles: { health: number }[] } } })
          .__deadPedal.world().vehicles[1]!.health === 0,
      undefined,
      { timeout: 30_000 },
    )

    await page.keyboard.up('j')
    await page.keyboard.up('k')

    expect((await probe(page, 1)).health).toBe(0)

    // Respawn delay is 3s.
    await page.waitForTimeout(4000)
    const back = await probe(page, 1)
    expect(back.health, 'the target never came back').toBe(back.maxHealth)
  })

  test('cycles specials with L', async ({ page }) => {
    expect((await probe(page)).special).toBe('rocket')

    await hold(page, ['l'], 80)
    expect((await probe(page)).special).toBe('homingMissile')

    await hold(page, ['l'], 80)
    expect((await probe(page)).special).toBe('mine')

    // Wraps.
    await hold(page, ['l'], 80)
    expect((await probe(page)).special).toBe('rocket')
  })

  test('locks the best-placed car, which is not always the nearest', async ({ page }) => {
    // Locking only runs while the homing missile is the selected special — the
    // reticle is feedback for that mode, not a permanent HUD fixture.
    await hold(page, ['l'], 80)
    expect((await probe(page)).special).toBe('homingMissile')

    await ticks(page, simSeconds(1.2))
    const locked = await probe(page)

    expect(locked.lockTarget, 'never locked anything').not.toBeNull()
    expect(locked.lockTime).toBeGreaterThan(0.9)

    // Proximity *and* direction. Where a car sits is measured against where the
    // nose is pointing, so a car dead ahead outranks one that is a little
    // closer but well off to the side — which is what the driver means by "the
    // one I am aiming at".
    const me = await probe(page, 0)
    const bearing = async (id: number): Promise<{ distance: number; offNose: number }> => {
      const them = await probe(page, id)
      const dx = them.x - me.x
      const dz = them.z - me.z
      // Compass convention: forward is (-sin yaw, cos yaw).
      const ahead = -Math.sin(me.yaw) * dx + Math.cos(me.yaw) * dz
      const across = Math.cos(me.yaw) * dx + Math.sin(me.yaw) * dz
      return { distance: Math.hypot(dx, dz), offNose: Math.abs(Math.atan2(across, ahead)) }
    }

    const rivals = await Promise.all([1, 2, 3].map(bearing))
    const chosen = rivals[[1, 2, 3].indexOf(locked.lockTarget!)]!
    const nearest = rivals.reduce((a, b) => (b.distance < a.distance ? b : a))

    // The case is only interesting if the two rules disagree, so assert that
    // they do rather than trusting the spawn layout to stay put.
    expect(chosen.distance, 'nearest and best-placed happen to agree here').toBeGreaterThan(
      nearest.distance,
    )
    expect(chosen.offNose, 'locked onto something further AND wider').toBeLessThan(nearest.offNose)
  })

  test('loses the lock while swinging away from it', async ({ page }) => {
    await hold(page, ['l'], 80)
    await ticks(page, simSeconds(1.2))
    expect((await probe(page)).lockTarget).not.toBeNull()

    // Sampled through the turn rather than checked at the end: a full circle in
    // an arena with three other cars can easily come back round onto a fresh
    // target, and "still locked onto something" is not the claim.
    await page.keyboard.down('w')
    await page.keyboard.down('d')

    let broke = false
    for (let i = 0; i < 40 && !broke; i++) {
      if ((await probe(page)).lockTarget === null) broke = true
      await page.waitForTimeout(60)
    }

    await page.keyboard.up('d')
    await page.keyboard.up('w')

    expect(broke, 'the lock never dropped while turning away').toBe(true)
  })

  test('a locked homing missile finds its target', async ({ page }) => {
    await hold(page, ['l'], 80)
    expect((await probe(page)).special).toBe('homingMissile')

    await ticks(page, simSeconds(1.2))
    const shooter = await probe(page)
    expect(shooter.lockTime).toBeGreaterThan(0.9)
    expect(shooter.lockTarget).not.toBeNull()

    const target = shooter.lockTarget!
    const before = await probe(page, target)
    await hold(page, ['k'], 80)
    await ticks(page, simSeconds(2.5))

    expect((await probe(page, target)).health, 'the missile missed').toBeLessThan(before.health)
  })

  test('T does nothing unless the homing missile is selected', async ({ page }) => {
    await ticks(page, simSeconds(1.2))

    // The rocket is a dumb projectile, so there is nothing to target and no
    // reticle to move. Not merely "T is ignored" — there is no lock at all.
    const before = await probe(page)
    expect(before.special).toBe('rocket')
    expect(before.lockTarget, 'a dumb weapon should not be tracking anything').toBeNull()

    await hold(page, ['t'], 80)
    await ticks(page, simSeconds(0.2))

    const after = await probe(page)
    expect(after.lockTarget).toBeNull()
    expect(after.manualTarget).toBe(false)
  })

  test('T walks the lock through every enemy while in missile mode', async ({ page }) => {
    await hold(page, ['l'], 80)
    await page.waitForTimeout(900)
    expect((await probe(page)).special).toBe('homingMissile')

    const seen: (number | null)[] = []
    for (let i = 0; i < 4; i++) {
      await hold(page, ['t'], 80)
      await page.waitForTimeout(180)
      seen.push((await probe(page)).lockTarget)
    }

    // Three opponents, walked in a stable order, then back to the start.
    expect(new Set(seen.slice(0, 3))).toEqual(new Set([1, 2, 3]))
    expect(seen[3]).toBe(seen[0])
    expect((await probe(page)).manualTarget).toBe(true)
  })

  test('a hand-picked target does not drift back to the nearest', async ({ page }) => {
    await hold(page, ['l'], 80)
    await page.waitForTimeout(900)

    const auto = (await probe(page)).lockTarget
    let chosen = auto
    while (chosen === auto) {
      await hold(page, ['t'], 80)
      await page.waitForTimeout(180)
      chosen = (await probe(page)).lockTarget
    }

    await page.waitForTimeout(2500)
    expect((await probe(page)).lockTarget, 'the lock drifted back').toBe(chosen)
  })

  test('lays a mine behind the car', async ({ page }) => {
    await hold(page, ['l'], 80)
    await hold(page, ['l'], 80)
    expect((await probe(page)).special).toBe('mine')

    await hold(page, ['k'], 80)
    expect((await probe(page)).projectiles).toBeGreaterThan(0)
    expect((await probe(page)).specialAmmo).toBeLessThan(5)
  })

  test('lays out its weapon crates', async ({ page }) => {
    expect((await probe(page)).crates).toBeGreaterThan(0)
  })

  test('the bots drive themselves and fight back', async ({ page }) => {
    // M5's whole point, end to end: nobody is sending inputs to cars 1–3.
    const ids = [1, 2, 3]
    const before = await Promise.all(ids.map((id) => probe(page, id)))

    // Peak displacement, not endpoint. Bots settle at their standoff range and
    // circle there, so where a bot *ends up* understates how much it drove —
    // measured net movement plateaus around 5m while one of them covers 24m.
    const furthest = [0, 0, 0]
    for (let sample = 0; sample < 12; sample++) {
      await page.waitForTimeout(400)
      const now = await Promise.all(ids.map((id) => probe(page, id)))
      now.forEach((n, i) => {
        furthest[i] = Math.max(
          furthest[i]!,
          Math.hypot(n.x - before[i]!.x, n.z - before[i]!.z),
        )
      })
    }

    for (const [i, distance] of furthest.entries()) {
      expect(distance, `bot ${ids[i]} never went anywhere`).toBeGreaterThan(3)
    }

    // And they are shooting, not merely driving.
    const after = await Promise.all(ids.map((id) => probe(page, id)))
    const shooters = after.filter((a, i) => a.bullets < before[i]!.bullets)
    expect(shooters.length, 'no bot fired a shot').toBeGreaterThan(0)
  })

  test('the HUD tracks the player health', async ({ page }) => {
    const hud = async (): Promise<{ value: string; width: string; critical: boolean }> =>
      page.evaluate(() => ({
        value: document.querySelector('.hud-value')?.textContent ?? '',
        width: (document.querySelector('.hud-fill') as HTMLElement | null)?.style.width ?? '',
        critical: document.getElementById('hud')?.classList.contains('is-critical') ?? false,
      }))

    const full = await hud()
    expect(Number(full.value)).toBe((await probe(page)).maxHealth)
    expect(full.width).toBe('100%')
    expect(full.critical).toBe(false)

    // Rocket the wall in front of us and eat the splash.
    await page.evaluate(() => {
      const w = (
        window as unknown as {
          __deadPedal: { world: () => { vehicles: { health: number; maxHealth: number }[] } }
        }
      ).__deadPedal.world()
      w.vehicles[0]!.health = w.vehicles[0]!.maxHealth * 0.09
    })
    await page.waitForTimeout(300)

    const hurt = await hud()
    expect(Number(hurt.value)).toBeLessThan((await probe(page)).maxHealth * 0.2)
    expect(hurt.width).not.toBe('100%')
    expect(hurt.critical, 'a quarter health should read as critical').toBe(true)
  })

  test('offers the three named difficulty tiers', async ({ page }) => {
    const labels = await page.evaluate(() =>
      [...document.querySelectorAll('select option')].map((o) => o.textContent),
    )
    expect(labels).toContain('Base Form')
    expect(labels).toContain('Super Saiyan')
    expect(labels).toContain('Ultra Instinct')
  })

  test('a match ends on the clock, shows a result, and another one starts', async ({ page }) => {
    // PLAN.md's done-when for M6, verbatim: "you can start a match, lose it, and
    // immediately start another without reloading the page."
    const match = () =>
      page.evaluate(() => {
        const w = (
          window as unknown as {
            __deadPedal: {
              world: () => {
                tick: number
                match: { phase: string; scores: number[]; matchWinner: number | null }
              }
            }
          }
        ).__deadPedal.world()
        const board = document.querySelector('.hud-board')
        const title = document.querySelector('.hud-board-title')
        return {
          tick: w.tick,
          phase: w.match.phase,
          scores: w.match.scores,
          winner: w.match.matchWinner,
          boardShown: board?.classList.contains('is-shown') ?? false,
          verdict: title?.textContent ?? '',
        }
      })

    const playing = await match()
    expect(playing.phase, 'the match never went live').toBe('live')

    // Only the clock is skipped. Everything about the ending is the real path.
    await page.evaluate(() => {
      ;(window as unknown as { __deadPedal: { endRound: () => void } }).__deadPedal.endRound()
    })
    await page.waitForFunction(
      () =>
        (
          window as unknown as { __deadPedal: { world: () => { match: { phase: string } } } }
        ).__deadPedal.world().match.phase === 'matchOver',
      undefined,
      { timeout: 10_000 },
    )

    const over = await match()
    expect(over.boardShown, 'no result card at the end of the match').toBe(true)
    // A draw is a real outcome here and reads as one — the board must never
    // crown car 0 for being first in an array.
    expect(over.verdict).toMatch(/YOU WIN|P[0-9] WINS|DRAW/)
    if (over.winner === null) expect(over.verdict).toBe('DRAW')

    // The world is frozen on the board: no phase can follow matchOver.
    await page.waitForTimeout(500)
    expect((await match()).phase).toBe('matchOver')

    // R, past the 1.5s guard that stops a shot on the buzzer skipping the board.
    await page.waitForTimeout(1600)
    await page.keyboard.press('r')
    await live(page)

    const again = await match()
    expect(again.phase).toBe('live')
    expect(again.scores, 'the new match kept the old scores').toEqual([0, 0, 0, 0])
    expect(again.tick, 'the world was not rebuilt').toBeLessThan(over.tick)
    expect((await match()).boardShown, 'the result card outlived its match').toBe(false)
  })

  test('stays inside the draw-call budget, at its worst frame', async ({ page }) => {
    // PLAN.md §6: under 100 draw calls. The assertion this replaces took ONE
    // sample while standing still and read 94 against a limit of 100 — six
    // calls of headroom, reported as clear. Free play was reaching 104-106,
    // with 2.7% of frames over budget, and the test never saw a single one of
    // them. A budget you only measure at rest is not a budget.
    //
    // So: sample every rendered frame through an actual fight and assert the
    // PEAK. `renderer.info.render.calls` includes the shadow pass, which was
    // itself a third of the frame and the reason the old number looked fine.
    await page.evaluate(() => {
      type Probe = { __deadPedal: { drawCalls: () => number }; __peak: number; __frames: number }
      const w = window as unknown as Probe
      w.__peak = 0
      w.__frames = 0
      const sample = (): void => {
        const calls = w.__deadPedal.drawCalls()
        if (calls > w.__peak) w.__peak = calls
        w.__frames++
        requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })

    // Everything on screen at once: driving, firing, and sweeping the camera so
    // the whole arena passes through the frustum.
    await page.keyboard.down('w')
    await page.keyboard.down('j')
    for (const key of ['d', 'a', 'd']) {
      await page.keyboard.down(key)
      await page.waitForTimeout(2500)
      await page.keyboard.up(key)
    }
    await page.keyboard.up('j')
    await page.keyboard.up('w')

    const { peak, frames } = await page.evaluate(() => {
      const w = window as unknown as { __peak: number; __frames: number }
      return { peak: w.__peak, frames: w.__frames }
    })

    // Guard against the whole thing passing because nothing rendered.
    expect(frames, 'no frames were sampled').toBeGreaterThan(120)
    expect(peak, `peak was ${peak} draw calls over ${frames} frames`).toBeLessThan(100)
  })
})
