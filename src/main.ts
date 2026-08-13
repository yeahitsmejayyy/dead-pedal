/**
 * L6 — the only file that wires layers together.
 *
 * Read the wall clock, hand the elapsed time to the fixed-step accumulator, run
 * the sim that many times at exactly 60Hz, then draw an interpolation between
 * the last two states. The sim below this file has no idea a browser exists.
 */
import { TICK_DT, advance, alpha as alphaOf, createClock } from './core/clock'
import { DEFAULT_VEHICLE, tuningFor } from './content/vehicles'
import { DEATHMATCH } from './content/match'
import { WEAPONS } from './content/weapons'
import { InputSource } from './input'
import { botInputs, createRoster, rosterHealth, type Bot } from './bots'
import { DEFAULT_DIFFICULTY } from './content/bots'
import {
  acceptsInput,
  createWorld,
  headingOf,
  isAlive,
  lockableTargets,
  step,
  type EntityId,
  type InputFrame,
  type Inputs,
  type WorldState,
} from './sim'
import { DEFAULT_CAMERA } from './view/camera'
import { Renderer } from './view/renderer'
import { createDebugPanel } from './ui/debug'
import { createHud, type HudBlip, type HudLock } from './ui/hud'
import { createTitle } from './ui/title'
import { createAudio } from './audio'

const PLAYER = 0
const LOCK_TIME = WEAPONS.homingMissile.homing?.lockTime ?? 1
const HOLD_RULES = {
  cone: WEAPONS.homingMissile.homing?.holdCone ?? 1,
  range: WEAPONS.homingMissile.homing?.holdRange ?? 1,
}

const canvas = document.getElementById('scene')
if (!(canvas instanceof HTMLCanvasElement)) throw new Error('missing #scene canvas')

const cameraTuning = { ...DEFAULT_CAMERA }
const vehicleTuning = tuningFor(DEFAULT_VEHICLE)

// Four cars: you, plus three bots.
const CARS = 4

const botSettings = { difficulty: DEFAULT_DIFFICULTY as string, enabled: true }
let roster: Bot[] = createRoster(CARS, { difficulty: botSettings.difficulty })

function rebuildRoster(): void {
  roster = botSettings.enabled ? createRoster(CARS, { difficulty: botSettings.difficulty }) : []
}

/** Changing tier changes how tough they are, so the match has to start over. */
function onDifficultyChanged(): void {
  reset()
}

/**
 * Seconds after the match ends before R is accepted.
 *
 * `DEATHMATCH.intermission` cannot do this job: `stepMatch`'s matchOver branch
 * returns before it decrements the timer, so in a one-round match that timer is
 * written once and then frozen. This is a wall clock, held here, and short on
 * purpose — long enough that a trigger still held at the buzzer cannot skip the
 * scoreboard, short enough that nobody waits on a screen they have read.
 */
const RESULT_GUARD = 1.5

/** Bumped every restart, so a rematch is a new match rather than a replay. */
let matchSeed = 1

function freshWorld(): WorldState {
  return createWorld({
    seed: matchSeed,
    vehicles: CARS,
    health: rosterHealth(roster, vehicleTuning.maxHealth),
    // The line that turns the sandbox into the mode. Everything else in this
    // file is downstream of it: input is gated for the first three seconds, the
    // clock picks the winner, and the world freezes on the scoreboard.
    rules: DEATHMATCH,
  })
}

let current: WorldState = freshWorld()
let previous: WorldState = current

const input = new InputSource(window)
const renderer = new Renderer(canvas, current.arena, cameraTuning)
const hudRoot = document.getElementById('hud')
if (hudRoot === null) throw new Error('missing #hud')
const hud = createHud(hudRoot, {
  playerId: PLAYER,
  arenaHalf: current.arena.halfExtents,
  roundSeconds: current.rules.roundSeconds,
  onRestart: () => reset(),
})

/**
 * Sound, and the gesture that starts it.
 *
 * `?silent=1` builds no AudioContext at all — the e2e suite runs with it, so 27
 * tests do not each bake ten buffers and hold a render thread for a path no
 * assertion observes. Worth knowing that headless Chromium ignores the autoplay
 * policy entirely (a fresh context comes back `running` with no gesture), so
 * the suite would survive without this; it is here for the CI core and because
 * the player needs a real off switch regardless.
 */
const audio = createAudio({ silent: new URLSearchParams(location.search).has('silent') })

// No modal, no speaker button to hunt for: the W that starts the car is the
// gesture. `arm` is idempotent, so firing it on every key and click is fine.
for (const kind of ['keydown', 'pointerdown'] as const) {
  window.addEventListener(kind, () => audio.arm(), { passive: true })
}

/**
 * Menu music, requested at boot and audible whenever the browser allows it.
 *
 * A page that has had no user gesture cannot start an AudioContext — that is
 * policy, not a bug, and no amount of wanting it changes the answer. So this
 * asks immediately and accepts being deferred: the fetch and decode happen now,
 * the source starts now, and if the context is suspended it simply produces no
 * sound until the first click or keypress resumes it. On a page the player has
 * touched before, it plays on load. Otherwise it comes in on the gesture that
 * was going to press START anyway.
 */
audio.arm()
audio.startMusic()
/**
 * The title screen, and the two reasons the sim does not run behind it.
 *
 * First, honesty: a countdown running while nobody has pressed anything means
 * the match you eventually play is not the match that started. Second, the
 * player's car would be sitting in the arena being shot at.
 *
 * `?nomenu=1` boots straight into the match. The e2e suite uses it — 28 of those
 * tests are about driving, weapons and rendering, and making each one click
 * through a menu tests the menu 28 times and nothing else. One test covers the
 * title path properly, which is where a broken START button should be caught.
 */
let started = new URLSearchParams(location.search).has('nomenu')

const titleRoot = document.getElementById('title')
if (titleRoot === null) throw new Error('missing #title')
const title = createTitle(titleRoot, {
  onHover: () => audio.playUi('menuHover'),
  // Fires the instant START is pressed, while the outro runs. The engine note
  // is the transition's clock, so it has to begin now, not when it ends.
  onCommit: () => {
    audio.arm()
    audio.playUi('menuStart')
  },
  onStart: () => {
    started = true
    document.body.classList.remove('is-title')
  },
})
if (started) title.hide()
else document.body.classList.add('is-title')

/**
 * Paused, by the player.
 *
 * Distinct from the match's own frozen phases: a countdown still ticks and a
 * scoreboard still counts down its guard, whereas this stops the world dead.
 * Implemented by simply not stepping — the accumulator is never fed, so no
 * ticks are banked and nothing catches up in a rush on resume.
 */
let paused = false

window.addEventListener('keydown', (event) => {
  // The menu owns the keyboard while it is up. Pausing a game that has not
  // begun leaves you on a paused title screen with no way to read that state.
  if (!started) return
  if (event.code === 'KeyP') {
    paused = !paused
    audio.setPaused(paused)
    hud.setPaused(paused)
  }
  // M cycles the soundtrack: track 1 -> 2 -> 3 -> off. Mute moved to N to make
  // room for it, because one key covering "different song" and "no song" is
  // most of what anyone wants from game music.
  if (event.code === 'KeyM') audio.cycleMusic()
  if (event.code === 'KeyN') audio.toggleMute()
  // E swaps the recorded engine loops for the oscillator bank. Both keep
  // running, so the switch lands at the revs you were already at.
  if (event.code === 'KeyE') audio.toggleEngine()
})
// rAF stops when the tab is backgrounded, so `update` stops with it and the
// engine would otherwise drone on at whatever revs the last frame left.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && !audio.muted()) audio.toggleMute()
})

const panel = createDebugPanel(
  vehicleTuning,
  cameraTuning,
  input.tuning,
  reset,
  botSettings,
  onDifficultyChanged,
  rebuildRoster,
)

/** Who last wrecked the player. Aims the death camera; cleared on respawn. */
let killer: EntityId | null = null
/** `performance.now()` at the final whistle, or null while a match is running. */
let resultAt: number | null = null

function reset(): void {
  // Roster first: the world's health ceilings are read off it.
  rebuildRoster()
  matchSeed++
  current = freshWorld()
  previous = current
  killer = null
  resultAt = null
}

window.addEventListener('resize', () => renderer.resize())

// Dev-only probe so the e2e suite can assert on real sim state instead of
// screenshot-diffing a car. Stripped from production builds by Vite.
if (import.meta.env.DEV) {
  Object.defineProperty(window, '__deadPedal', {
    value: {
      world: (): WorldState => current,
      drawCalls: (): number => renderer.drawCalls,
      cameraPosition: () => renderer.chase.camera.position.clone(),
      fov: (): number => renderer.chase.camera.fov,
      particles: () => renderer.effects.particleCounts(),
      wheelSpin: () => renderer.wheelSpin(PLAYER),
      modelsLoaded: (): boolean => renderer.modelsLoaded(),
      audio: () => ({ ...audio.state(), armed: audio.armed(), muted: audio.muted() }),
      // Lets the e2e suite park the opposition. Tests about ramming and
      // destruction are about those mechanics, not about whether a bot will
      // hold still for them.
      setBots: (enabled: boolean): void => {
        botSettings.enabled = enabled
        rebuildRoster()
      },
      /**
       * Run the round clock down to its last tick.
       *
       * Only the clock is touched — the match still ends through the real path,
       * tallying the real kills, picking the winner with `leaderOnKills` and
       * raising a real `matchEnded`. The alternative to this affordance is not
       * testing the end of a match in a browser at all, because the round is
       * five minutes long and no e2e suite is going to sit through one.
       */
      endRound: (): void => {
        current = { ...current, match: { ...current.match, timer: 1 } }
        previous = current
      },
      reset,
    },
  })
}

let clock = createClock()
let lastFrame = performance.now()
let fps = 0
let refreshCountdown = 0
let lookBack = false
/** Last sampled throttle, for the engine voice. Load, not speed. */
let throttleAxis = 0

/** Reused every frame rather than reallocated: this runs at 60fps. */
const blips: HudBlip[] = []

let heldCycle = false
let heldTarget = false

/**
 * One tick of player intent, safe to take during a frozen phase.
 *
 * `sample` CONSUMES its latches — cycling the weapon and cycling the target are
 * one-shot by construction — and outside a live round `step` throws the whole
 * frame away. Left alone that means a special chosen during the three-second
 * countdown is not delayed, it is destroyed, and a key that does nothing is the
 * kind of thing a player blames on themselves rather than on the game.
 *
 * Sampling every tick regardless is what keeps steering and throttle honest at
 * the instant the round goes live. Carrying the two latches forward is what
 * stops the press disappearing on the way there.
 */
function playerFrame(tick: number): InputFrame {
  const sampled = input.sample(tick, TICK_DT)

  if (!acceptsInput(current.match)) {
    heldCycle ||= sampled.cycleWeapon
    heldTarget ||= sampled.cycleTarget
    // Returned rather than dropped: `step` ignores it, but this file still
    // reads `lookBack` off it, and looking around while frozen costs nothing.
    return { ...sampled, cycleWeapon: false, cycleTarget: false }
  }

  if (!heldCycle && !heldTarget) return sampled

  const carried: InputFrame = {
    ...sampled,
    cycleWeapon: sampled.cycleWeapon || heldCycle,
    cycleTarget: sampled.cycleTarget || heldTarget,
  }
  heldCycle = false
  heldTarget = false
  return carried
}

function frame(now: number): void {
  const elapsed = Math.min((now - lastFrame) / 1000, 0.25)
  lastFrame = now

  // R restarts, and it is the same R that has always been the reset — one key
  // meaning "again" beats a second key that only exists on one screen. Swallowed
  // inside the guard so a shot fired on the buzzer cannot skip the scoreboard.
  if (input.takeReset()) {
    const guarded = resultAt !== null && now - resultAt < RESULT_GUARD * 1000
    if (!guarded && started) reset()
  }

  // Everything below this line is skipped while paused OR while the title is
  // up: no ticks, no match clock, no bots, no projectiles. The scene still
  // renders, so you are looking at a held frame rather than a black screen.
  const frozen = paused || !started
  const { clock: nextClock, steps } = frozen
    ? { clock, steps: 0 }
    : advance(clock, elapsed)
  clock = nextClock

  // ── fixed-step sim ─────────────────────────────────────────────────────────
  const simStart = performance.now()
  for (let i = 0; i < steps; i++) {
    // Sampled per tick, not per frame: an InputFrame is a sim-time value.
    const frameInput = playerFrame(current.tick)
    lookBack = frameInput.lookBack
    throttleAxis = frameInput.throttle

    // Bots and the player produce the same shape, and `step` cannot tell them
    // apart. That is the M5 contract, and the reason M8 is a transport problem.
    const inputs: Inputs = botInputs(roster, current, new Map([[PLAYER, frameInput]]))

    previous = current
    current = step(current, inputs)

    // Vehicles as well as events: sparks need the damaged car's own position,
    // because a blast's `pos` is the explosion centre rather than the car.
    renderer.effects.consume(current.events, current.vehicles)

    // The ears are the car, not the camera. A chase camera sits eight metres
    // back, and placing sound there puts every shot you fire behind you.
    const heard = current.vehicles[PLAYER]
    if (heard !== undefined) {
      audio.consume(current.events, { x: heard.pos.x, z: heard.pos.z, yaw: heard.yaw }, PLAYER)
    }
    // The one sound that is a state rather than an event.
    audio.tick(current.projectiles.filter((p) => p.weapon === 'mine').length)

    // Only what happens to the player shakes the player's camera.
    const player = current.vehicles[PLAYER]

    // How much speed the player actually lost this tick. Hit-stop is gated on
    // this rather than on impact magnitude, and the distinction is the whole
    // trick: freezing the camera while the car is still travelling just lets
    // the car run away from it — measured at 46 m/s the chase spring already
    // trails 14.2m, and a freeze stretches that to 18.1m before reeling back.
    // Freezing when the car has been *stopped* is the opposite motion, and the
    // one that reads as impact.
    const before = previous.vehicles[PLAYER]
    const lostSpeed =
      before === undefined || player === undefined
        ? 0
        : Math.hypot(before.vel.x, before.vel.z) - Math.hypot(player.vel.x, player.vel.z)

    for (const event of current.events) {
      if (event.type === 'impact' && event.id === PLAYER) {
        renderer.chase.addShake(event.magnitude)
        // 12 m/s of speed shed in one tick is a genuine crash rather than a
        // scrape. Scaled from there and capped, so being shunted by a bot is a
        // flicker and putting it into a wall at full speed is a beat.
        if (lostSpeed > 12) renderer.chase.hitStop(Math.min(0.09, lostSpeed * 0.0035))
      } else if (event.type === 'landed' && event.id === PLAYER) {
        renderer.chase.addShake(event.magnitude * 0.6)
      } else if (event.type === 'damaged' && event.id === PLAYER) {
        renderer.chase.addShake(event.amount * 0.35)
      } else if (event.type === 'explosion' && player !== undefined) {
        // Distance-scaled, so a rocket across the arena is not felt.
        const distance = Math.hypot(event.pos.x - player.pos.x, event.pos.z - player.pos.z)
        const closeness = Math.max(0, 1 - distance / (event.radius * 3))
        if (closeness > 0) renderer.chase.addShake(26 * closeness * closeness)
      } else if (event.type === 'vehicleDestroyed' && event.id === PLAYER) {
        renderer.chase.addShake(45)
        // The one freeze that is always right: the car is gone, so there is
        // nothing left to run away from the camera.
        renderer.chase.hitStop(0.12)
        // Null for an own goal or the arena: there is then nobody to look at,
        // and the death camera falls back to the wreck's own heading.
        killer = event.by
      } else if (event.type === 'vehicleRespawned' && event.id === PLAYER) {
        killer = null
      } else if (event.type === 'matchEnded') {
        resultAt = now
      }
    }
  }
  const simMs = performance.now() - simStart

  // ── the death camera ───────────────────────────────────────────────────────
  // `Renderer.render` skips a wreck outright — the `continue` lands before the
  // follow branch — so a dead player's camera is never updated at all. It does
  // not merely sit still: it freezes mid-smoothing with the last frame's shake
  // baked in as a permanent offset, holds it for the full three seconds, then
  // snaps back on respawn. Driving it from here fixes that without teaching the
  // renderer about death, because `render` will not overwrite a car it skipped.
  //
  // It looks at whoever did it. Three seconds of a frozen frame is the thing
  // the mode exists to avoid; three seconds of watching the car that killed you
  // is something you can spend the moment you are back.
  const wreck = current.vehicles[PLAYER]
  if (wreck !== undefined && !isAlive(wreck)) {
    const by = killer === null ? undefined : current.vehicles.find((v) => v.id === killer)
    const yaw =
      by === undefined ? wreck.yaw : headingOf(by.pos.x - wreck.pos.x, by.pos.z - wreck.pos.z)

    renderer.chase.update(
      {
        x: wreck.pos.x,
        y: wreck.pos.y,
        z: wreck.pos.z,
        yaw,
        headingYaw: null,
        speed: 0,
        maxSpeed: vehicleTuning.maxSpeed,
        lookBack,
      },
      elapsed,
    )
  }

  const driver = current.vehicles[PLAYER]
  audio.update(
    {
      speed: driver?.forwardSpeed ?? 0,
      maxSpeed: vehicleTuning.maxSpeed,
      throttle: throttleAxis,
      grounded: driver?.grounded ?? true,
      alive:
        !paused && driver !== undefined && driver.health > 0 && acceptsInput(current.match),
      // 0 where the tyres start to let go, 1 at a full handbrake slide. The
      // floor is the same 0.7x slipSaturation the tyre smoke uses, so what you
      // hear and what you see agree; the ceiling is the 2.4x a handbrake turn
      // was measured reaching.
      slip:
        driver === undefined
          ? 0
          : Math.max(
              0,
              Math.min(
                1,
                (Math.abs(driver.lateralSpeed) / vehicleTuning.slipSaturation - 0.7) / 1.7,
              ),
            ),
    },
    elapsed,
  )

  // ── render ─────────────────────────────────────────────────────────────────
  renderer.render(previous, current, alphaOf(clock), elapsed, PLAYER, lookBack)

  // ── readouts ───────────────────────────────────────────────────────────────
  fps = fps === 0 ? 1 / elapsed : fps * 0.92 + (1 / elapsed) * 0.08

  const car = current.vehicles[PLAYER]
  if (car !== undefined) {
    hud.setHealth(car.health, car.maxHealth)
    hud.setAlive(
      car.health > 0,
      car.respawnAt === null ? 0 : (car.respawnAt - current.tick) * TICK_DT,
    )
    hud.setAmmo(car.ammo.machineGun)

    const lock: HudLock =
      car.selectedSpecial !== 'homingMissile' || car.lockTarget === null
        ? 'none'
        : car.lockTime >= LOCK_TIME
          ? 'locked'
          : 'locking'
    hud.setSpecial(car.selectedSpecial, car.ammo, lock)

    blips.length = 0
    for (const other of current.vehicles) {
      if (other.id === PLAYER) continue
      blips.push({
        id: other.id,
        x: other.pos.x,
        z: other.pos.z,
        alive: other.health > 0,
        locked: car.lockTarget === other.id,
      })
    }
    hud.setRadar(car.pos.x, car.pos.z, car.yaw, blips)

    // `match.timer` means three different things depending on the phase —
    // countdown remaining, round remaining, and in matchOver a constant, since
    // `stepMatch` returns from that branch before decrementing. The HUD is told
    // the phase for exactly that reason rather than being handed a bare number.
    const { match } = current
    hud.setRound(
      match.phase,
      match.timer * TICK_DT,
      match.scores,
      match.phase === 'matchOver' ? match.matchWinner : match.roundWinner,
    )

    const r = panel.readouts
    r.speedKph = Math.hypot(car.vel.x, car.vel.z) * 3.6
    r.forwardSpeed = car.forwardSpeed
    r.lateralSpeed = car.lateralSpeed
    r.yawRate = car.yawRate
    r.grounded = car.grounded
    r.tick = current.tick
    r.fps = fps
    r.simMs = steps > 0 ? simMs / steps : 0
    r.drawCalls = renderer.drawCalls
    r.health = car.health
    r.bullets = car.ammo.machineGun
    r.rockets = car.ammo.rocket
    r.projectiles = current.projectiles.length
    r.special = WEAPONS[car.selectedSpecial].label
    r.specialAmmo = car.ammo[car.selectedSpecial]
    const missileMode = car.selectedSpecial === 'homingMissile'
    r.lock =
      car.lockTarget === null
        ? '—'
        : `${car.lockTime >= LOCK_TIME ? `LOCKED on ${car.lockTarget}` : `${Math.round((car.lockTime / LOCK_TIME) * 100)}%`}${car.manualTarget ? ' (manual)' : ''}`
    r.bots = roster.length === 0 ? 'off' : roster.map((b) => b.state).join(' ')
    r.targets = missileMode
      ? `${lockableTargets(car, current.vehicles, current.arena, HOLD_RULES).length} in range  (T)`
      : 'missile mode only'
  }

  // Tweakpane redraws are not free; ten times a second is plenty for a readout.
  refreshCountdown -= elapsed
  if (refreshCountdown <= 0) {
    refreshCountdown = 0.1
    panel.refresh()
  }

  requestAnimationFrame(frame)
}

requestAnimationFrame(frame)
