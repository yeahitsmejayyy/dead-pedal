/**
 * L5 — the player's own readout.
 *
 * PLAN.md puts the HUD at M6: "health, ammo, current special, opponent radar,
 * round state". This is all five. The order on screen is the order you look at
 * them under pressure, not the order of that sentence: health and ammo sit in
 * the top-left corner your eye already parks in, the clock is centred because
 * everyone looks up for a clock, and the radar takes a bottom corner because
 * that is where a driver's peripheral vision already is.
 *
 * DATA IN, PIXELS OUT. Nothing here imports `WorldState` or reaches into the
 * sim — `main.ts` reduces the world to plain numbers and hands them over. That
 * is what makes this file readable, and testable, without a world to build.
 *
 * Deliberately DOM and a 2D canvas rather than WebGL. **Neither costs a draw
 * call**: `renderer.info.render.calls` counts three.js scene submissions and
 * nothing else, so an overlay of divs and a separate 2D context add exactly
 * zero to it. The budget in PLAN.md §6 is 100 and currently reads 70; the whole
 * M6 HUD leaves it reading 70.
 *
 * Every text field caches its last value and writes only on a change, because
 * at 60fps an unconditional write is 60 layout invalidations a second for a
 * number that changes once. The radar is the one thing that redraws — see
 * `setRadar` for the rate and what it costs.
 */
import { TAU, clamp } from '../core/scalar'
import { SPECIAL_IDS, WEAPONS, type WeaponId } from '../content/weapons'
import { healthCss, liveryCss, pickupCss } from '../view/palette'

/** Mirrors `MatchPhase`, redeclared so the HUD owes the sim nothing. */
export type HudPhase = 'countdown' | 'live' | 'roundOver' | 'matchOver'

/** Missile lock, as the three states worth drawing. */
export type HudLock = 'none' | 'locking' | 'locked'

/** One opponent, already reduced to what a blip needs. */
export type HudBlip = {
  readonly id: number
  readonly x: number
  readonly z: number
  /** Wrecks stay on the dial: knowing a corner is safe for three seconds is information. */
  readonly alive: boolean
  /** True for the car the player's missiles are currently holding. */
  readonly locked: boolean
}

export type HudOptions = {
  readonly playerId: number
  /** The arena's bounds, for the wall box the radar draws. */
  readonly arenaHalf: { readonly x: number; readonly z: number }
  /** Round length, so the clock can read 5:00 while the countdown is still running. */
  readonly roundSeconds: number
  /**
   * Start another match. Wired to the button on the result board.
   *
   * The keyboard R already does this, and the button is not a replacement for
   * it — it is for the person who has just finished a match, has a hand on the
   * mouse, and should not have to know a keybind to play again.
   */
  readonly onRestart: () => void
}

export type Hud = {
  setHealth(health: number, maxHealth: number): void
  setAlive(alive: boolean, respawnIn: number): void
  /** Machine gun rounds remaining. */
  setAmmo(rounds: number): void
  setSpecial(selected: WeaponId, ammo: Readonly<Record<WeaponId, number>>, lock: HudLock): void
  /** Player position and yaw in world space, plus every other car. */
  setRadar(x: number, z: number, yaw: number, blips: readonly HudBlip[]): void
  /**
   * `scores` is kill count indexed by entity id. `winner` is the outcome of the
   * phase being reported — `matchWinner` in `matchOver`, `roundWinner` in
   * `roundOver` — and `null` there means a **draw**, not "not decided yet".
   */
  setRound(
    phase: HudPhase,
    secondsLeft: number,
    scores: readonly number[],
    winner: number | null,
  ): void
}

// ── radar geometry ───────────────────────────────────────────────────────────

/** CSS px. Sized to the 260px HUD column, and square so the dial has no long axis. */
const RADAR_SIZE = 192
const CENTRE = RADAR_SIZE / 2
/** Where an out-of-range blip parks. Inside the bezel, so it is never half-drawn. */
const RIM = CENTRE - 8

/**
 * How far the dial reaches, metres.
 *
 * Read off the machine gun rather than chosen: 140m is the one *measured*
 * distance at which another car can hurt you, so the dial answers exactly one
 * question — who can shoot me, and from where — and anything pinned to the rim
 * is by definition out of range. Retune the gun and the radar follows.
 *
 * It also covers the missile: `lockRange` is 130 and `holdRange` 175, so you
 * see everyone who could acquire you, and lose only the tail of a lock someone
 * is already dragging behind them.
 *
 * The rejected alternative was "whole arena at a fixed scale". A player-centred
 * heading-up dial cannot do that: the guaranteed-coverage radius is the arena's
 * full **diagonal** (254m here), not its half-diagonal, because the player is
 * not standing at the arena's centre. At 254m the scale is 2.8 m/px and three
 * quarters of the dial is permanently empty. 140m gives 1.6 m/px — and since
 * the half-diagonal is 127m, the whole arena *is* on the dial whenever you are
 * near the middle. It degrades to clamped blips only as you push out to a wall.
 */
const RADAR_RANGE = WEAPONS.machineGun.range
const PX_PER_M = RIM / RADAR_RANGE

/** Last 30 seconds. Long enough to change what you do, short enough to mean it. */
const URGENT_SECONDS = 30
/** 15% of 600 rounds, which at 16 rounds/s is 5.6 seconds of trigger. */
const LOW_AMMO = 0.15

const DIAL_FILL = 'rgba(9, 12, 16, 0.66)'
const DIAL_EDGE = '#2b3440'
const DIAL_GRID = '#1b222b'
const WALL = '#39424f'
const LOCK_MARK = '#f8fafc'

const CORNERS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
] as const

export function createHud(root: HTMLElement, options: HudOptions): Hud {
  const { playerId, arenaHalf, roundSeconds } = options

  // Interpolated from `WEAPONS`, which is authored content and never user text.
  root.innerHTML = `
    <div class="hud-stack">
      <div class="hud-gauge">
        <div class="hud-label">HEALTH</div>
        <div class="hud-track"><div class="hud-fill" data-fill="health"></div></div>
        <div class="hud-value" data-value="health">100</div>
      </div>

      <div class="hud-gauge hud-gauge--ammo">
        <div class="hud-label">MACHINE GUN</div>
        <div class="hud-track"><div class="hud-fill hud-fill--ammo" data-fill="ammo"></div></div>
        <div class="hud-value" data-value="ammo">0</div>
      </div>

      <div class="hud-specials">
        <div class="hud-label">SPECIAL <b class="hud-key">L</b></div>
        ${SPECIAL_IDS.map(
          // The pip carries the crate's colour, not the selection state. That
          // is the whole point: the violet box on the far side of the arena is
          // the homing missile, and you should be able to know that without
          // driving through it first.
          (id) => `<div class="hud-special" data-special="${id}">
            <i class="hud-pip" style="background:${pickupCss(id)}"></i>
            <span class="hud-special-name">${WEAPONS[id].label}</span>
            <span class="hud-special-ammo">0</span>
          </div>`,
        ).join('')}
        <div class="hud-locked"></div>
      </div>

      <div class="hud-down">WRECKED &nbsp;·&nbsp; <span class="hud-respawn"></span></div>
    </div>

    <div class="hud-round">
      <div class="hud-clock">--:--</div>
      <div class="hud-kills"></div>
    </div>

    <div class="hud-count"></div>

    <div class="hud-board">
      <div class="hud-board-title"></div>
      <div class="hud-board-rows"></div>
      <button class="hud-again" type="button">PLAY AGAIN <b>R</b></button>
    </div>

    <div class="hud-radar"><canvas></canvas></div>
  `

  const pick = <T extends HTMLElement>(selector: string): T => {
    const found = root.querySelector<T>(selector)
    if (found === null) throw new Error(`hud: missing ${selector}`)
    return found
  }

  const healthFill = pick('[data-fill="health"]')
  const healthValue = pick('[data-value="health"]')
  const ammoFill = pick('[data-fill="ammo"]')
  const ammoValue = pick('[data-value="ammo"]')
  const lockLine = pick('.hud-locked')
  const respawn = pick('.hud-respawn')
  const clock = pick('.hud-clock')
  const kills = pick('.hud-kills')
  const count = pick('.hud-count')
  const board = pick('.hud-board')
  const boardTitle = pick('.hud-board-title')
  const boardBody = pick('.hud-board-rows')

  // The only interactive element on the overlay. #hud is pointer-events: none so
  // that a stray click always reaches the canvas; this one opts back in.
  const again = pick<HTMLButtonElement>('.hud-again')
  again.addEventListener('click', () => {
    // Deliberately not behind the wall-clock guard that swallows R for a moment
    // after the whistle. That guard exists so a trigger still held at the buzzer
    // cannot skip the scoreboard, and a mouse travelling to a button is not
    // something anyone does by accident.
    again.blur()
    options.onRestart()
  })

  const specialRows = new Map<WeaponId, { readonly row: HTMLElement; readonly ammo: HTMLElement }>()
  for (const id of SPECIAL_IDS) {
    specialRows.set(id, {
      row: pick<HTMLElement>(`[data-special="${id}"]`),
      ammo: pick<HTMLElement>(`[data-special="${id}"] .hud-special-ammo`),
    })
  }

  // ── radar surface ──────────────────────────────────────────────────────────
  const canvas = pick<HTMLCanvasElement>('.hud-radar canvas')
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('hud: no 2d context for the radar')
  // Rebound, because a narrowing done out here does not follow the original
  // binding into `drawRadar`'s body.
  const ctx = context

  // Backing store at device resolution, CSS box at RADAR_SIZE. Capped at 2:
  // past that the dial is a 3px blip costing nine times as much to fill.
  const dpr = Math.min(window.devicePixelRatio, 2) || 1
  canvas.width = Math.round(RADAR_SIZE * dpr)
  canvas.height = Math.round(RADAR_SIZE * dpr)
  canvas.style.width = `${RADAR_SIZE}px`
  canvas.style.height = `${RADAR_SIZE}px`

  let radarX = 0
  let radarZ = 0
  let sinYaw = 0
  let cosYaw = 1
  let radarBlips: readonly HudBlip[] = []

  /** Preallocated, in the style of `healthBars.ts` — no garbage per frame. */
  const dot = { x: 0, y: 0 }

  /**
   * World → dial, rotated into the player's frame.
   *
   * The compass is `forwardOf(yaw) = (-sin, 0, cos)`, and its perpendicular is
   * `rightOf(yaw) = (-cos, 0, -sin)`. So for a world delta `d` the two
   * components the dial wants are just dot products:
   *
   *     fwd = d · forwardOf(yaw) = -sin·dx + cos·dz
   *     rgt = d · rightOf(yaw)   = -(cos·dx + sin·dz)
   *
   * Canvas axes are +x right and +y **down**, and "ahead" has to be at the top,
   * so `x = CENTRE + rgt` and `y = CENTRE - fwd`.
   *
   * Note the determinant of that 2x2 is -1: the map is a *reflection*, not a
   * rotation. It has to be. The sim's compass turns right as yaw increases,
   * which is clockwise, while a naive plot of +X-right / +Z-up turns
   * anticlockwise. Dropping the minus sign on `rgt` — the obvious shortcut, and
   * the one that makes the algebra look like a rotation matrix — mirrors the
   * dial, so every car on your left draws on your right. That is the bug this
   * derivation exists to not have.
   *
   * Sanity check, yaw = +π/2 (a quarter turn to the right), player at the
   * origin, a car at (0, 0, 10): fwd = 0, rgt = -10. The car that was dead
   * ahead is now hard left, which is what turning right does to it.
   */
  function project(wx: number, wz: number): void {
    const dx = wx - radarX
    const dz = wz - radarZ
    dot.x = CENTRE - (cosYaw * dx + sinYaw * dz) * PX_PER_M
    dot.y = CENTRE - (cosYaw * dz - sinYaw * dx) * PX_PER_M
  }

  function drawRadar(): void {
    // Reset per draw rather than once at setup: it also undoes the clip, so a
    // half-finished frame can never leak state into the next one.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, RADAR_SIZE, RADAR_SIZE)
    ctx.lineWidth = 1

    ctx.beginPath()
    ctx.arc(CENTRE, CENTRE, RIM + 6, 0, TAU)
    ctx.fillStyle = DIAL_FILL
    ctx.fill()

    ctx.save()
    ctx.clip()

    // Half-range ring and the two body axes. One ring, not three: a dial you
    // have to read past its own furniture is slower than a dial with none.
    ctx.strokeStyle = DIAL_GRID
    ctx.beginPath()
    ctx.arc(CENTRE, CENTRE, RIM / 2, 0, TAU)
    ctx.moveTo(CENTRE, CENTRE - RIM)
    ctx.lineTo(CENTRE, CENTRE + RIM)
    ctx.moveTo(CENTRE - RIM, CENTRE)
    ctx.lineTo(CENTRE + RIM, CENTRE)
    ctx.stroke()

    // The arena walls, through the same projection. Worth four extra points:
    // the box is hard bounds, so which way the wall runs is where you can be
    // pinned — and it gives the dial something that moves when you steer even
    // while nobody else does, which is what stops a heading-up radar reading as
    // a still picture.
    ctx.beginPath()
    for (let i = 0; i < CORNERS.length; i++) {
      const corner = CORNERS[i]!
      project(corner[0] * arenaHalf.x, corner[1] * arenaHalf.z)
      if (i === 0) ctx.moveTo(dot.x, dot.y)
      else ctx.lineTo(dot.x, dot.y)
    }
    ctx.closePath()
    ctx.strokeStyle = WALL
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.lineWidth = 1

    for (const blip of radarBlips) {
      project(blip.x, blip.z)

      let ox = dot.x - CENTRE
      let oy = dot.y - CENTRE
      const distance = Math.hypot(ox, oy)
      const beyond = distance > RIM
      if (beyond && distance > 0) {
        ox = (ox / distance) * RIM
        oy = (oy / distance) * RIM
      }
      const bx = CENTRE + ox
      const by = CENTRE + oy

      // Three facts, encoded on three different properties, so none of them
      // depends on telling two colours apart:
      //   alive    → filled   ·  dead   → hollow, dimmed, crossed
      //   in range → disc     ·  beyond → chevron pointing off the dial
      //   locked   → a ring around whatever the first two drew
      ctx.globalAlpha = blip.alive ? 1 : 0.38
      ctx.strokeStyle = liveryCss(blip.id)
      ctx.fillStyle = liveryCss(blip.id)

      ctx.beginPath()
      if (beyond) {
        // Nose along the bearing, base across it: it points at where they are.
        const nx = ox / RIM
        const ny = oy / RIM
        ctx.moveTo(bx + nx * 5, by + ny * 5)
        ctx.lineTo(bx - nx * 3 - ny * 4.5, by - ny * 3 + nx * 4.5)
        ctx.lineTo(bx - nx * 3 + ny * 4.5, by - ny * 3 - nx * 4.5)
        ctx.closePath()
      } else {
        ctx.arc(bx, by, 4, 0, TAU)
      }

      if (blip.alive) {
        ctx.fill()
      } else {
        ctx.lineWidth = 1.5
        ctx.stroke()
        ctx.lineWidth = 1
        // A cross through the middle, so a wreck reads as a wreck at a glance
        // and not merely as a slightly darker car.
        ctx.beginPath()
        ctx.moveTo(bx - 2.6, by - 2.6)
        ctx.lineTo(bx + 2.6, by + 2.6)
        ctx.moveTo(bx + 2.6, by - 2.6)
        ctx.lineTo(bx - 2.6, by + 2.6)
        ctx.stroke()
      }

      if (blip.locked) {
        ctx.globalAlpha = 1
        ctx.strokeStyle = LOCK_MARK
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.arc(bx, by, 8, 0, TAU)
        ctx.stroke()
        ctx.lineWidth = 1
      }

      ctx.globalAlpha = 1
    }

    ctx.restore()

    // The player, last and outside the clip: a nose-up arrow at the centre, so
    // "up is your nose" is answered by the dial itself and not by a caption.
    ctx.fillStyle = liveryCss(playerId)
    ctx.beginPath()
    ctx.moveTo(CENTRE, CENTRE - 7)
    ctx.lineTo(CENTRE + 5, CENTRE + 5)
    ctx.lineTo(CENTRE, CENTRE + 2)
    ctx.lineTo(CENTRE - 5, CENTRE + 5)
    ctx.closePath()
    ctx.fill()

    ctx.strokeStyle = DIAL_EDGE
    ctx.beginPath()
    ctx.arc(CENTRE, CENTRE, RIM + 6, 0, TAU)
    ctx.stroke()
  }

  // ── scoreboard ─────────────────────────────────────────────────────────────
  const boardRows: { readonly row: HTMLElement; readonly kills: HTMLElement }[] = []

  function buildBoard(cars: number): void {
    boardBody.replaceChildren()
    boardRows.length = 0

    for (let id = 0; id < cars; id++) {
      const row = document.createElement('div')
      row.className = 'hud-board-row'

      const swatch = document.createElement('i')
      swatch.style.background = liveryCss(id)

      const name = document.createElement('span')
      name.textContent = id === playerId ? 'YOU' : `P${id}`

      const score = document.createElement('b')
      score.textContent = '0'

      row.append(swatch, name, score)
      boardBody.append(row)
      boardRows.push({ row, kills: score })
    }
  }

  function renderBoard(phase: HudPhase, scores: readonly number[], winner: number | null): void {
    if (boardRows.length !== scores.length) buildBoard(scores.length)

    let top = -Infinity
    for (const value of scores) if (value > top) top = value

    // A draw is a real outcome. In a terminal phase `winner === null` means
    // nobody took it, and every car level on top gets the same mark — the trap
    // here is falling back to `scores[0]` and crowning car 0 for the crime of
    // being first in an array.
    const drawn = winner === null
    boardTitle.textContent = drawn ? 'DRAW' : winner === playerId ? 'YOU WIN' : `P${winner} WINS`
    boardTitle.classList.toggle('is-draw', drawn)

    // Ties broken by id, so the order is stable rather than a property of the
    // sort. `order` reorders visually without moving a single node.
    const ranked = scores
      .map((value, id) => ({ id, value }))
      .sort((a, b) => b.value - a.value || a.id - b.id)

    for (let rank = 0; rank < ranked.length; rank++) {
      const entry = ranked[rank]!
      const target = boardRows[entry.id]
      if (target === undefined) continue
      target.kills.textContent = String(entry.value)
      target.row.style.order = String(rank)
      target.row.classList.toggle('is-top', entry.value === top)
    }

    board.classList.toggle('is-final', phase === 'matchOver')
  }

  /**
   * Replay a CSS animation on an element that never leaves the DOM.
   *
   * Reading layout is the thing the rest of this file exists to avoid, and it
   * is bought deliberately here: three times during a three-second countdown,
   * and once more for "GO".
   */
  function restart(element: HTMLElement, modifier: string): void {
    element.className = 'hud-count'
    element.getBoundingClientRect()
    element.className = `hud-count ${modifier}`
  }

  // ── cached state ───────────────────────────────────────────────────────────
  let lastPercent = -1
  let lastCritical: boolean | null = null
  let lastAlive: boolean | null = null
  let lastRespawn = ''
  let lastRounds = -1
  let lastLowAmmo: boolean | null = null
  let lastSelected: WeaponId | null = null
  let lastLock: HudLock | null = null
  const lastSpecialAmmo = new Map<WeaponId, number>()

  let lastPhase: HudPhase | null = null
  let lastClock = -1
  let lastUrgent: boolean | null = null
  let lastCount = -1
  let lastKills = ''

  /** Mirrors the last drawn frame, so a still radar costs nothing. */
  const painted: { id: number; x: number; z: number; alive: boolean; locked: boolean }[] = []

  return {
    setHealth(health, maxHealth) {
      const fraction = clamp(health / Math.max(1, maxHealth), 0, 1)
      const percent = Math.round(fraction * 100)

      if (percent === lastPercent) return
      lastPercent = percent

      healthFill.style.width = `${fraction * 100}%`
      healthFill.style.background = healthCss(fraction)
      healthValue.textContent = String(Math.ceil(health))

      const critical = fraction <= 0.25 && fraction > 0
      if (critical !== lastCritical) {
        lastCritical = critical
        root.classList.toggle('is-critical', critical)
      }
    },

    setAlive(alive, respawnIn) {
      // The old version wrote `display` unconditionally, every frame. Gated now
      // for the same reason every other field is: it changes twice a minute.
      if (alive !== lastAlive) {
        lastAlive = alive
        root.classList.toggle('is-down', !alive)
      }
      if (alive) return

      const text = `back in ${Math.max(0, respawnIn).toFixed(1)}s`
      if (text === lastRespawn) return
      lastRespawn = text
      respawn.textContent = text
    },

    setAmmo(rounds) {
      const whole = Math.max(0, Math.floor(rounds))
      if (whole === lastRounds) return
      lastRounds = whole

      const fraction = clamp(whole / WEAPONS.machineGun.capacity, 0, 1)
      ammoFill.style.width = `${fraction * 100}%`
      ammoValue.textContent = String(whole)

      const low = fraction <= LOW_AMMO
      if (low !== lastLowAmmo) {
        lastLowAmmo = low
        ammoFill.classList.toggle('is-low', low)
      }
    },

    setSpecial(selected, ammo, lock) {
      if (selected !== lastSelected) {
        const previous = lastSelected === null ? undefined : specialRows.get(lastSelected)
        if (previous !== undefined) previous.row.classList.remove('is-selected')
        specialRows.get(selected)?.row.classList.add('is-selected')
        lastSelected = selected
      }

      // All three counts, not only the selected one. Cycling onto an empty
      // weapon is a wasted press, and the only way to not make it is to see
      // what is in the other two before you press L.
      for (const [id, element] of specialRows) {
        const remaining = ammo[id]
        if (remaining === lastSpecialAmmo.get(id)) continue
        lastSpecialAmmo.set(id, remaining)
        element.ammo.textContent = String(remaining)
        element.row.classList.toggle('is-empty', remaining <= 0)
      }

      // Two words, never a percentage.
      //
      // The 3D lock ring already draws progress, *on the car being locked* —
      // higher fidelity than a number, and attached to the one thing a corner
      // readout cannot carry, which is who. Repeating it as "63%" splits
      // attention and adds nothing. What the ring genuinely cannot do is
      // survive its target driving off screen, and that gap is closed by the
      // radar marking the locked blip, not by more text.
      if (lock !== lastLock) {
        lastLock = lock
        lockLine.textContent = lock === 'locked' ? 'LOCKED' : lock === 'locking' ? 'LOCKING' : ''
        lockLine.classList.toggle('is-locked', lock === 'locked')
      }
    },

    setRadar(x, z, yaw, blips) {
      // Gated on the values, not on a frame counter. Everything here is sim
      // state that only moves on a 60Hz tick, so on a 144Hz display roughly
      // three frames in five find nothing changed and skip the draw outright,
      // and a frozen countdown draws exactly once. No interpolation, on
      // purpose: at 1.6 m/px one tick of travel at top speed (46 m/s) is 0.5px,
      // so smoothing it would cost per-frame work to move nothing.
      const sin = Math.sin(yaw)
      const cos = Math.cos(yaw)

      let dirty =
        x !== radarX ||
        z !== radarZ ||
        sin !== sinYaw ||
        cos !== cosYaw ||
        blips.length !== painted.length

      if (!dirty) {
        for (let i = 0; i < blips.length; i++) {
          const next = blips[i]!
          const last = painted[i]!
          if (
            last.id !== next.id ||
            last.x !== next.x ||
            last.z !== next.z ||
            last.alive !== next.alive ||
            last.locked !== next.locked
          ) {
            dirty = true
            break
          }
        }
      }
      if (!dirty) return

      radarX = x
      radarZ = z
      sinYaw = sin
      cosYaw = cos
      radarBlips = blips

      painted.length = 0
      for (const blip of blips) {
        painted.push({ id: blip.id, x: blip.x, z: blip.z, alive: blip.alive, locked: blip.locked })
      }

      // When it does run: one clearRect and about fourteen paths. Measured in
      // Chrome at 0.010ms a draw at DPR 1, against 0.0004ms for a skipped call —
      // so even at 60 draws a second, all of it, this is 0.06% of a second. It
      // is also entirely off the draw-call budget: nothing here goes near the
      // WebGL context.
      drawRadar()
    },

    setRound(phase, secondsLeft, scores, winner) {
      const changed = phase !== lastPhase

      // ── clock ──────────────────────────────────────────────────────────────
      if (phase === 'countdown' || phase === 'live') {
        // `ceil`, so the clock opens on 5:00 and shows 0:00 only in the final
        // second — the convention every broadcast clock uses.
        const whole = Math.max(0, Math.ceil(phase === 'countdown' ? roundSeconds : secondsLeft))
        if (whole !== lastClock) {
          lastClock = whole
          clock.textContent = `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`

          const urgent = phase === 'live' && whole <= URGENT_SECONDS
          if (urgent !== lastUrgent) {
            lastUrgent = urgent
            clock.classList.toggle('is-urgent', urgent)
          }
        }
      } else if (changed) {
        // The clock is a promise and it has to land on zero. The last live
        // frame is one tick short of it, which `ceil` renders as 0:01.
        lastClock = 0
        clock.textContent = '0:00'
      }

      // ── countdown ──────────────────────────────────────────────────────────
      if (phase === 'countdown') {
        const beat = Math.max(1, Math.ceil(secondsLeft))
        if (beat !== lastCount) {
          lastCount = beat
          count.textContent = String(beat)
          restart(count, 'is-beat')
        }
      } else if (changed) {
        lastCount = -1
        // "GO" belongs to the countdown→live edge and nothing else. Testing
        // this caught the loose version — `lastPhase === 'countdown'` alone
        // fires GO underneath the scoreboard if a match is ever cut short
        // during its own countdown.
        if (lastPhase === 'countdown' && phase === 'live') {
          count.textContent = 'GO'
          restart(count, 'is-go')
        } else {
          count.textContent = ''
          count.className = 'hud-count'
        }
      }

      // ── kills ──────────────────────────────────────────────────────────────
      if (phase === 'countdown' || phase === 'live') {
        const mine = scores[playerId] ?? 0

        let best = -1
        let bestId = -1
        for (let id = 0; id < scores.length; id++) {
          if (id === playerId) continue
          const value = scores[id]!
          if (value > best) {
            best = value
            bestId = id
          }
        }

        // The margin, not the leader's raw total. "P2 has five" is trivia;
        // "you are three down" is the number that changes how you drive.
        const line =
          best < 0 || mine === best
            ? `${mine} KILLS · LEVEL`
            : mine > best
              ? `${mine} KILLS · +${mine - best} AHEAD`
              : `${mine} KILLS · P${bestId} BY ${best - mine}`

        if (line !== lastKills) {
          lastKills = line
          kills.textContent = line
          kills.classList.toggle('is-behind', mine < best)
        }
      }

      // ── phase ──────────────────────────────────────────────────────────────
      if (changed) {
        const over = phase === 'roundOver' || phase === 'matchOver'
        root.classList.toggle('is-frozen', phase === 'countdown')
        board.classList.toggle('is-shown', over)
        // The clock stays — landing on 0:00 is the point — but the margin line
        // is a worse copy of a row the board is already showing.
        kills.classList.toggle('is-hidden', over)
        // Only on the transition: the scores are final by the time this fires,
        // and nothing on the board can change while it is up.
        if (over) renderBoard(phase, scores, winner)
        lastPhase = phase
      }
    },
  }
}