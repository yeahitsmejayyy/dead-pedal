/**
 * A fixed 30-second input program: the "recorded input file" M1 asks for.
 *
 * It is a script rather than 1,800 captured frames because a script is legible
 * in a diff — when the replay hash changes you can see what the car was being
 * told to do at the moment it diverged. The recorder turns it into a pinned
 * hash; the replay test asserts against that pin.
 */
import { NEUTRAL_INPUT, TICK_HZ, type EntityId, type InputFrame, type Inputs } from '../src/sim'

// ── the firefight ───────────────────────────────────────────────────────────
// M3 asks for "fixed input file → target destroyed at exactly tick N". Car 0
// sits still and shoots car 1, so the recorded tick is a statement about the
// weapon arithmetic and nothing else — no driving to drift.

type Segment = {
  readonly seconds: number
  readonly throttle?: number
  readonly steer?: number
  readonly handbrake?: boolean
}

export const CIRCUIT_SEGMENTS: readonly Segment[] = [
  { seconds: 3, throttle: 1 }, // launch
  { seconds: 2, throttle: 1, steer: 0.6 }, // long right
  { seconds: 2, throttle: 1, steer: -0.6 }, // long left
  { seconds: 1.5, throttle: 1, steer: 1, handbrake: true }, // handbrake turn
  { seconds: 2, throttle: 1 }, // straighten and recover
  { seconds: 1, throttle: -1 }, // hard brake
  { seconds: 2, throttle: -1, steer: 0.8 }, // reverse, steering inverted
  { seconds: 3, throttle: 1, steer: -0.4 },
  { seconds: 2.5, throttle: 1, steer: 1 }, // hold a long corner
  { seconds: 2, throttle: 0 }, // coast
  { seconds: 1.5, throttle: 1, handbrake: true }, // fight the handbrake
  { seconds: 4, throttle: 1, steer: 0.25 }, // long sweep into a wall
  { seconds: 3.5, throttle: 1, steer: -1 },
]

export const CIRCUIT_SECONDS = CIRCUIT_SEGMENTS.reduce((sum, s) => sum + s.seconds, 0)
export const CIRCUIT_TICKS = Math.round(CIRCUIT_SECONDS * TICK_HZ)

const PLAYER: EntityId = 0

/** The input for one absolute tick of the circuit. */
export function circuitInput(tick: number): InputFrame {
  let remaining = tick
  for (const segment of CIRCUIT_SEGMENTS) {
    const length = Math.round(segment.seconds * TICK_HZ)
    if (remaining < length) {
      return {
        ...NEUTRAL_INPUT,
        tick,
        throttle: segment.throttle ?? 0,
        steer: segment.steer ?? 0,
        handbrake: segment.handbrake ?? false,
      }
    }
    remaining -= length
  }
  return { ...NEUTRAL_INPUT, tick }
}

export function circuitInputs(tick: number): Inputs {
  return new Map([[PLAYER, circuitInput(tick)]])
}


type FireSegment = {
  readonly seconds: number
  readonly fire?: boolean
  readonly special?: boolean
  readonly cycle?: boolean
}

/**
 * PLAN.md M4 asks for "replay coverage per weapon", so this walks the whole
 * selection: rockets, then homing missiles once the lock has had time to build,
 * then mines — with the gun going the whole time.
 */
export const FIREFIGHT_SEGMENTS: readonly FireSegment[] = [
  { seconds: 0.5 }, // settle
  { seconds: 1.2, special: true }, // open with rockets
  { seconds: 0.4 },
  { seconds: 3.0, fire: true }, // then hose it
  { seconds: 0.3 },
  { seconds: 2.0, fire: true, special: true },

  { seconds: 0.1, cycle: true }, // -> homing missile
  { seconds: 1.2 }, // let the lock finish
  { seconds: 2.4, special: true }, // and launch
  { seconds: 1.0, fire: true },

  { seconds: 0.1, cycle: true }, // -> mine
  { seconds: 1.6, special: true },
  { seconds: 2.0, fire: true },
]

export const FIREFIGHT_SECONDS = FIREFIGHT_SEGMENTS.reduce((sum, s) => sum + s.seconds, 0)
export const FIREFIGHT_TICKS = Math.round(FIREFIGHT_SECONDS * TICK_HZ)

export function firefightInput(tick: number): InputFrame {
  let remaining = tick
  for (const segment of FIREFIGHT_SEGMENTS) {
    const length = Math.round(segment.seconds * TICK_HZ)
    if (remaining < length) {
      return {
        ...NEUTRAL_INPUT,
        tick,
        fire: segment.fire ?? false,
        special: segment.special ?? false,
        // Only on the segment's first tick: `cycleWeapon` is a press, not a hold.
        cycleWeapon: (segment.cycle ?? false) && remaining === 0,
      }
    }
    remaining -= length
  }
  return { ...NEUTRAL_INPUT, tick }
}

export function firefightInputs(tick: number): Inputs {
  return new Map([[PLAYER, firefightInput(tick)]])
}
