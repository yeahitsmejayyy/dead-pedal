/**
 * L4 — keyboard and gamepad → `InputFrame`.
 *
 * The only thing this layer is allowed to produce. Bots (M5) and the network
 * (M8) are alternative implementations of exactly this output, which is why
 * neither is a refactor.
 *
 * Sampled once per *tick*, not once per frame: an InputFrame is a sim-time
 * value, and recording frames at display rate would make replays depend on the
 * monitor they were captured on.
 */
import { clamp, moveToward } from '../core/scalar'
import { isBound, keysFor } from '../content/controls'
import { type InputFrame } from '../sim'

export type InputTuning = {
  /**
   * How fast a keyboard steer axis ramps to full lock, units/s. Digital input
   * straight to ±1 makes any car feel twitchy; this is the difference between
   * "the handling is bad" and "the input is bad", and they are easy to confuse.
   */
  steerRamp: number
  /** How fast the steer axis returns to centre when nothing is held, units/s. */
  steerReturn: number
  throttleRamp: number
  /** Deadzone applied to gamepad sticks. */
  deadzone: number
}

export const DEFAULT_INPUT: InputTuning = {
  steerRamp: 4.2,
  steerReturn: 7,
  throttleRamp: 8,
  deadzone: 0.12,
}

/**
 * Derived, not declared — `content/controls` is the source.
 *
 * Kept as a local lookup because `sample` runs every tick and reads several of
 * these per call; resolving through the table each time would be a table walk
 * inside the hot path for a value that never changes.
 */
const KEYS = {
  forward: keysFor('forward'),
  back: keysFor('back'),
  left: keysFor('left'),
  right: keysFor('right'),
  handbrake: keysFor('handbrake'),
  lookBack: keysFor('lookBack'),
  fire: keysFor('fire'),
  special: keysFor('special'),
  cycle: keysFor('cycle'),
  cycleTarget: keysFor('cycleTarget'),
} as const

export class InputSource {
  readonly tuning: InputTuning

  private readonly held = new Set<string>()
  private readonly mouse = new Set<number>()
  private steer = 0
  private throttle = 0
  private resetRequested = false
  /**
   * Counted, not a flag. Two presses inside one tick used to collapse into one
   * cycle and silently eat an input — rare with human fingers at 60Hz, but a
   * dropped press is the kind of thing you blame on yourself rather than on the
   * game.
   */
  private cycleRequests = 0
  private targetRequests = 0
  /** Last frame's pad state, so a held shoulder button cycles once, not 60×/s. */
  private padCycleHeld = false
  private padTargetHeld = false

  constructor(target: Window, tuning: InputTuning = { ...DEFAULT_INPUT }) {
    this.tuning = tuning

    // Mouse: left fires, right launches. Bound on the window rather than the
    // canvas so a drag that leaves the canvas still releases the trigger.
    target.addEventListener('mousedown', (event) => {
      // Ignore clicks on the debug panel — dragging a slider is not firing.
      if (event.target !== document.body && !(event.target instanceof HTMLCanvasElement)) return
      this.mouse.add(event.button)
    })
    target.addEventListener('mouseup', (event) => this.mouse.delete(event.button))
    target.addEventListener('contextmenu', (event) => {
      if (event.target instanceof HTMLCanvasElement) event.preventDefault()
    })
    target.addEventListener('blur', () => {
      this.mouse.clear()
      this.cycleRequests = 0
      this.targetRequests = 0
    })

    target.addEventListener('keydown', (event) => {
      if (event.repeat) return
      if (isBound('reset', event.code)) this.resetRequested = true
      // Latched, so holding the key does not cycle every tick.
      if (KEYS.cycle.includes(event.code)) {
        this.cycleRequests++
        event.preventDefault()
      }
      if (KEYS.cycleTarget.includes(event.code)) {
        this.targetRequests++
        event.preventDefault()
      }
      // Space scrolls the page otherwise, which is a great way to lose a lap.
      if (event.code === 'Space' || event.code.startsWith('Arrow')) event.preventDefault()
      this.held.add(event.code)
    })

    target.addEventListener('keyup', (event) => this.held.delete(event.code))
    target.addEventListener('blur', () => this.held.clear())
  }

  /** True for exactly one sampled tick per key press. */
  private takeCycle(): boolean {
    if (this.cycleRequests === 0) return false
    this.cycleRequests--
    return true
  }

  private takeTargetCycle(): boolean {
    if (this.targetRequests === 0) return false
    this.targetRequests--
    return true
  }

  /** True once per request, then cleared. */
  takeReset(): boolean {
    const requested = this.resetRequested
    this.resetRequested = false
    return requested
  }

  private any(codes: readonly string[]): boolean {
    return codes.some((code) => this.held.has(code))
  }

  private pad(): Gamepad | null {
    for (const pad of navigator.getGamepads?.() ?? []) {
      if (pad !== null && pad.connected) return pad
    }
    return null
  }

  /** Sample the current hardware state as one tick of intent. */
  sample(tick: number, dt: number): InputFrame {
    const pad = this.pad()
    const t = this.tuning

    // ── steer ────────────────────────────────────────────────────────────────
    let steerTarget = 0
    if (this.any(KEYS.left)) steerTarget -= 1
    if (this.any(KEYS.right)) steerTarget += 1

    const stick = pad?.axes[0] ?? 0
    if (Math.abs(stick) > t.deadzone) {
      // Rescale past the deadzone so the first degree of stick isn't dead.
      const sign = Math.sign(stick)
      steerTarget = sign * ((Math.abs(stick) - t.deadzone) / (1 - t.deadzone))
    }

    const steerRate = steerTarget === 0 ? t.steerReturn : t.steerRamp
    this.steer = moveToward(this.steer, clamp(steerTarget, -1, 1), steerRate * dt)

    // ── throttle ─────────────────────────────────────────────────────────────
    let throttleTarget = 0
    if (this.any(KEYS.forward)) throttleTarget += 1
    if (this.any(KEYS.back)) throttleTarget -= 1

    const rightTrigger = pad?.buttons[7]?.value ?? 0
    const leftTrigger = pad?.buttons[6]?.value ?? 0
    if (rightTrigger > 0.02 || leftTrigger > 0.02) {
      throttleTarget = rightTrigger - leftTrigger
    }

    this.throttle = moveToward(this.throttle, clamp(throttleTarget, -1, 1), t.throttleRamp * dt)

    // ── pad edges ────────────────────────────────────────────────────────────
    // The keyboard paths latch on the DOM event; a pad has no events, so the
    // edge has to be found by comparing against last tick.
    const padCycleNow = pad?.buttons[5]?.pressed ?? false
    const padTargetNow = pad?.buttons[4]?.pressed ?? false
    const padCycle = padCycleNow && !this.padCycleHeld
    const padTarget = padTargetNow && !this.padTargetHeld
    this.padCycleHeld = padCycleNow
    this.padTargetHeld = padTargetNow

    return {
      tick,
      throttle: this.throttle,
      steer: this.steer,
      handbrake: this.any(KEYS.handbrake) || (pad?.buttons[0]?.pressed ?? false),
      fire: this.any(KEYS.fire) || this.mouse.has(0) || (pad?.buttons[2]?.pressed ?? false),
      special:
        this.any(KEYS.special) || this.mouse.has(2) || (pad?.buttons[3]?.pressed ?? false),
      cycleWeapon: this.takeCycle() || padCycle,
      cycleTarget: this.takeTargetCycle() || padTarget,
      lookBack: this.any(KEYS.lookBack) || (pad?.buttons[1]?.pressed ?? false),
    }
  }
}
