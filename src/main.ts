/**
 * L6 — the only file that wires layers together.
 *
 * Read the wall clock, hand the elapsed time to the fixed-step accumulator, run
 * the sim that many times at exactly 60Hz, then draw an interpolation between
 * the last two states. The sim below this file has no idea a browser exists.
 */
import { TICK_DT, advance, alpha as alphaOf, createClock } from './core/clock'
import { DEFAULT_VEHICLE, tuningFor } from './content/vehicles'
import { WEAPONS } from './content/weapons'
import { InputSource } from './input'
import { botInputs, createRoster, rosterHealth, type Bot } from './bots'
import { DEFAULT_DIFFICULTY } from './content/bots'
import { createWorld, lockableTargets, step, type Inputs, type WorldState } from './sim'
import { DEFAULT_CAMERA } from './view/camera'
import { Renderer } from './view/renderer'
import { createDebugPanel } from './ui/debug'
import { createHud } from './ui/hud'

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
function onBotsChanged(): void {
  reset()
}

function freshWorld(): WorldState {
  return createWorld({
    seed: 1,
    vehicles: CARS,
    health: rosterHealth(roster, vehicleTuning.maxHealth),
  })
}

let current: WorldState = freshWorld()
let previous: WorldState = current

const input = new InputSource(window)
const renderer = new Renderer(canvas, current.arena, cameraTuning)
const hudRoot = document.getElementById('hud')
if (hudRoot === null) throw new Error('missing #hud')
const hud = createHud(hudRoot)

const panel = createDebugPanel(vehicleTuning, cameraTuning, input.tuning, reset, botSettings, onBotsChanged)

function reset(): void {
  // Roster first: the world's health ceilings are read off it.
  rebuildRoster()
  current = freshWorld()
  previous = current
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
      // Lets the e2e suite park the opposition. Tests about ramming and
      // destruction are about those mechanics, not about whether a bot will
      // hold still for them.
      setBots: (enabled: boolean): void => {
        botSettings.enabled = enabled
        rebuildRoster()
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

function frame(now: number): void {
  const elapsed = Math.min((now - lastFrame) / 1000, 0.25)
  lastFrame = now

  if (input.takeReset()) reset()

  const { clock: nextClock, steps } = advance(clock, elapsed)
  clock = nextClock

  // ── fixed-step sim ─────────────────────────────────────────────────────────
  const simStart = performance.now()
  for (let i = 0; i < steps; i++) {
    // Sampled per tick, not per frame: an InputFrame is a sim-time value.
    const frameInput = input.sample(current.tick, TICK_DT)
    lookBack = frameInput.lookBack

    // Bots and the player produce the same shape, and `step` cannot tell them
    // apart. That is the M5 contract, and the reason M8 is a transport problem.
    const inputs: Inputs = botInputs(roster, current, new Map([[PLAYER, frameInput]]))

    previous = current
    current = step(current, inputs)

    renderer.effects.consume(current.events)

    // Only what happens to the player shakes the player's camera.
    const player = current.vehicles[PLAYER]
    for (const event of current.events) {
      if (event.type === 'impact' && event.id === PLAYER) {
        renderer.chase.addShake(event.magnitude)
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
      }
    }
  }
  const simMs = performance.now() - simStart

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
