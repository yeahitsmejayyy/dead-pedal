/**
 * L5 — the player's own readout.
 *
 * PLAN.md puts the HUD at M6 ("health, ammo, current special, opponent radar,
 * round state"). This is the health slice only, brought forward alongside the
 * floating bars; the rest arrives with the match flow that gives it meaning.
 *
 * Deliberately DOM rather than WebGL. A health bar is two rectangles and some
 * text — rendering it in the scene would cost draw calls out of an already
 * tight budget, and would look worse.
 */
import { clamp } from '../core/scalar'
import { healthCss } from '../view/palette'

export type Hud = {
  setHealth(health: number, maxHealth: number): void
  setAlive(alive: boolean, respawnIn: number): void
}

export function createHud(root: HTMLElement): Hud {
  root.innerHTML = `
    <div class="hud-health">
      <div class="hud-label">HEALTH</div>
      <div class="hud-track"><div class="hud-fill"></div></div>
      <div class="hud-value">100</div>
    </div>
    <div class="hud-down">WRECKED &nbsp;·&nbsp; <span class="hud-respawn"></span></div>
  `

  const fill = root.querySelector<HTMLElement>('.hud-fill')!
  const value = root.querySelector<HTMLElement>('.hud-value')!
  const down = root.querySelector<HTMLElement>('.hud-down')!
  const respawn = root.querySelector<HTMLElement>('.hud-respawn')!

  let lastPercent = -1
  let lastCritical: boolean | null = null

  return {
    setHealth(health, maxHealth) {
      const fraction = clamp(health / Math.max(1, maxHealth), 0, 1)
      const percent = Math.round(fraction * 100)

      // Only touch the DOM when the number actually changes. At 60fps an
      // unconditional style write is 60 layout invalidations a second for a
      // bar that changes a few times a match.
      if (percent === lastPercent) return
      lastPercent = percent

      fill.style.width = `${fraction * 100}%`
      fill.style.background = healthCss(fraction)
      value.textContent = String(Math.ceil(health))

      const critical = fraction <= 0.25 && fraction > 0
      if (critical !== lastCritical) {
        lastCritical = critical
        root.classList.toggle('is-critical', critical)
      }
    },

    setAlive(alive, respawnIn) {
      down.style.display = alive ? 'none' : 'block'
      if (!alive) respawn.textContent = `back in ${Math.max(0, respawnIn).toFixed(1)}s`
    },
  }
}
