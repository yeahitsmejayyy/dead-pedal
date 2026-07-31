/**
 * L5 — the debug panel.
 *
 * PLAN.md M1: "Debug panel bound to every handling constant, live." Not a nice
 * to have — finding arcade handling is a search, and a search you can only run
 * once per page reload is a search you will abandon.
 *
 * This is the one place in the codebase that writes to `content/`. The sim only
 * ever reads it, so the layering holds, but note the consequence: retuning
 * invalidates any replay recorded against the old numbers. `npm run record`
 * regenerates the fixture.
 */
import { Pane } from 'tweakpane'
import type { VehicleTuning } from '../content/vehicles'
import type { CameraTuning } from '../view/camera'
import type { InputTuning } from '../input'
import { DIFFICULTIES } from '../content/bots'

export type Readouts = {
  health: number
  special: string
  specialAmmo: number
  lock: string
  targets: string
  bots: string
  bullets: number
  rockets: number
  projectiles: number
  speedKph: number
  forwardSpeed: number
  lateralSpeed: number
  yawRate: number
  grounded: boolean
  tick: number
  fps: number
  simMs: number
  drawCalls: number
}

export type DebugPanel = {
  readonly readouts: Readouts
  refresh(): void
  dispose(): void
}

export function createDebugPanel(
  vehicle: VehicleTuning,
  camera: CameraTuning,
  input: InputTuning,
  onReset: () => void,
  bots: { difficulty: string; enabled: boolean },
  /** Tier changed: the health ceilings move, so the match has to start over. */
  onDifficultyChanged: () => void,
  /** Bots switched on or off. Rebuilds the roster and nothing else. */
  onBotsToggled: () => void,
): DebugPanel {
  const pane = new Pane({ title: 'dead-pedal — M5' })

  const readouts: Readouts = {
    health: 0,
    special: '',
    specialAmmo: 0,
    lock: '—',
    targets: '',
    bots: '',
    bullets: 0,
    rockets: 0,
    projectiles: 0,
    speedKph: 0,
    forwardSpeed: 0,
    lateralSpeed: 0,
    yawRate: 0,
    grounded: true,
    tick: 0,
    fps: 0,
    simMs: 0,
    drawCalls: 0,
  }

  // A real HUD is M6. Until then the numbers you need to judge a weapon live
  // here next to the numbers that produce them.
  const combat = pane.addFolder({ title: 'combat' })
  combat.addBinding(readouts, 'health', { readonly: true, format: (v: number) => v.toFixed(0) })
  combat.addBinding(readouts, 'bullets', { readonly: true, format: (v: number) => v.toFixed(0) })
  combat.addBinding(readouts, 'special', { readonly: true, label: 'special  (L)' })
  combat.addBinding(readouts, 'specialAmmo', { readonly: true, label: 'special ammo' })
  combat.addBinding(readouts, 'lock', { readonly: true })
  combat.addBinding(readouts, 'targets', { readonly: true })

  // M5. `state` is each bot's current plan — hunt / attack / flee / collect —
  // which is the fastest way to see whether a bot is doing something stupid on
  // purpose or by accident.
  const ai = pane.addFolder({ title: 'bots' })
  ai.addBinding(readouts, 'bots', { readonly: true, label: 'state' })
  // Two handlers, not one, and the difference is load-bearing. Restarting the
  // match on a *tier* change is right — the tier sets how much health everyone
  // has, and changing that mid-match would be incoherent. Restarting when bots
  // are merely switched off is not: the cars already on the field keep the
  // health they were given, so there is nothing to rebuild.
  //
  // It also stopped being harmless. `refresh()` runs ten times a second and
  // fires `change` for any value that moved, including one moved from code — so
  // the dev probe's `setBots(false)` was silently restarting the match about
  // 100ms later, which is a wonderful way to spend an afternoon debugging a
  // test that measures a world it did not think it had thrown away.
  ai.addBinding(bots, 'enabled').on('change', onBotsToggled)
  ai.addBinding(bots, 'difficulty', {
    options: Object.fromEntries(Object.keys(DIFFICULTIES).map((k) => [DIFFICULTIES[k]!.label, k])),
  }).on('change', onDifficultyChanged)
  combat.addBinding(readouts, 'rockets', { readonly: true, format: (v: number) => v.toFixed(0) })
  combat.addBinding(readouts, 'projectiles', {
    readonly: true,
    label: 'in flight',
    format: (v: number) => v.toFixed(0),
  })

  const telemetry = pane.addFolder({ title: 'telemetry' })
  telemetry.addBinding(readouts, 'speedKph', { readonly: true, label: 'km/h', format: (v: number) => v.toFixed(0) })
  telemetry.addBinding(readouts, 'lateralSpeed', {
    readonly: true,
    label: 'slip m/s',
    format: (v: number) => v.toFixed(2),
  })
  telemetry.addBinding(readouts, 'yawRate', { readonly: true, label: 'yaw rad/s', format: (v: number) => v.toFixed(2) })
  telemetry.addBinding(readouts, 'grounded', { readonly: true })
  telemetry.addBinding(readouts, 'tick', { readonly: true, format: (v: number) => v.toFixed(0) })

  const perf = pane.addFolder({ title: 'perf', expanded: false })
  perf.addBinding(readouts, 'fps', { readonly: true, format: (v: number) => v.toFixed(0) })
  perf.addBinding(readouts, 'simMs', { readonly: true, label: 'sim ms', format: (v: number) => v.toFixed(3) })
  perf.addBinding(readouts, 'drawCalls', { readonly: true, label: 'draws', format: (v: number) => v.toFixed(0) })

  // ── the numbers that decide how the car feels ───────────────────────────────
  // The cast is deliberate and confined to this file: `content/` is readonly to
  // everything else, exactly as contract 5 intends.
  const v = vehicle as { -readonly [K in keyof VehicleTuning]: VehicleTuning[K] }

  const engine = pane.addFolder({ title: 'engine' })
  engine.addBinding(v, 'maxSpeed', { min: 10, max: 90, step: 0.5 })
  engine.addBinding(v, 'engineAccel', { min: 2, max: 60, step: 0.5 })
  engine.addBinding(v, 'brakeAccel', { min: 5, max: 80, step: 0.5 })
  engine.addBinding(v, 'rollingResistance', { min: 0, max: 20, step: 0.1 })
  engine.addBinding(v, 'maxReverseSpeed', { min: 2, max: 40, step: 0.5 })
  engine.addBinding(v, 'reverseAccel', { min: 1, max: 40, step: 0.5 })

  const grip = pane.addFolder({ title: 'grip' })
  grip.addBinding(v, 'lateralGrip', { min: 1, max: 140, step: 0.5 })
  grip.addBinding(v, 'handbrakeLateralGrip', { min: 0, max: 60, step: 0.5 })
  grip.addBinding(v, 'handbrakeDecel', { min: 0, max: 60, step: 0.5 })

  const steering = pane.addFolder({ title: 'steering' })
  steering.addBinding(v, 'maxYawRate', { min: 0.4, max: 6, step: 0.05 })
  steering.addBinding(v, 'yawAccel', { min: 1, max: 60, step: 0.5 })
  steering.addBinding(v, 'steerSpeedFloor', { min: 0.5, max: 20, step: 0.1 })
  steering.addBinding(v, 'steerSpeedOptimal', { min: 2, max: 60, step: 0.5 })
  steering.addBinding(v, 'highSpeedSteerScale', { min: 0.05, max: 1, step: 0.01 })

  steering.addBinding(v, 'slipSaturation', { min: 2, max: 40, step: 0.5 })
  steering.addBinding(v, 'slidingYawAuthority', { min: 0.02, max: 1, step: 0.01 })

  // M2. `bounce` is the coefficient of restitution and the one that decides
  // whether a hit reads as a shove or a ping-pong: 0 leaves the two cars moving
  // together, 1 is a billiard swap that stops you dead.
  const contact = pane.addFolder({ title: 'contact' })
  contact.addBinding(v, 'mass', { min: 400, max: 4000, step: 25 })
  contact.addBinding(v, 'restitution', { min: 0, max: 1, step: 0.01, label: 'bounce' })
  contact.addBinding(v, 'spinFromImpact', { min: 0, max: 1.2, step: 0.01 })
  contact.addBinding(v, 'wallBounce', { min: 0, max: 1, step: 0.01 })
  contact.addBinding(v, 'wallFriction', { min: 0, max: 0.6, step: 0.01 })

  const body = pane.addFolder({ title: 'body', expanded: false })
  body.addBinding(v, 'gravity', { min: 5, max: 80, step: 0.5 })
  body.addBinding(v, 'rideHeight', { min: 0.2, max: 2, step: 0.05 })

  const feel = pane.addFolder({ title: 'input', expanded: false })
  feel.addBinding(input, 'steerRamp', { min: 0.5, max: 20, step: 0.1 })
  feel.addBinding(input, 'steerReturn', { min: 0.5, max: 30, step: 0.1 })
  feel.addBinding(input, 'throttleRamp', { min: 0.5, max: 40, step: 0.1 })

  const cam = pane.addFolder({ title: 'camera', expanded: false })
  cam.addBinding(camera, 'distance', { min: 3, max: 30, step: 0.1 })
  cam.addBinding(camera, 'height', { min: 0.5, max: 20, step: 0.1 })
  cam.addBinding(camera, 'lookAhead', { min: 0, max: 30, step: 0.1 })
  cam.addBinding(camera, 'lookHeight', { min: -2, max: 8, step: 0.1 })
  cam.addBinding(camera, 'positionStiffness', { min: 0.5, max: 40, step: 0.1 })
  cam.addBinding(camera, 'yawStiffness', { min: 0.5, max: 40, step: 0.1 })
  cam.addBinding(camera, 'velocityBlend', { min: 0, max: 1, step: 0.01 })
  cam.addBinding(camera, 'baseFov', { min: 40, max: 110, step: 1 })
  cam.addBinding(camera, 'fovAtSpeed', { min: 0, max: 40, step: 0.5 })
  cam.addBinding(camera, 'shakeScale', { min: 0, max: 0.3, step: 0.005 })

  pane.addButton({ title: 'reset car  (R)' }).on('click', onReset)

  return {
    readouts,
    refresh: () => pane.refresh(),
    dispose: () => pane.dispose(),
  }
}
