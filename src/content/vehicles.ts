/**
 * L2 — vehicle tuning. Contract 5: every number that decides how a car feels
 * lives here, never in a function body. The debug panel binds straight to a copy
 * of these, so this file is what you edit once you've found the values by hand.
 *
 * Units: metres, seconds, radians. Accelerations, not forces — mass has nothing
 * to do with anything until car-vs-car ramming at M2.
 */

export type VehicleTuning = {
  readonly label: string

  // ── longitudinal ──────────────────────────────────────────────────────────
  /** Top forward speed, m/s. ~46 m/s is 165 km/h. */
  readonly maxSpeed: number
  /** Acceleration at a standstill, m/s². Falls to zero as speed → maxSpeed. */
  readonly engineAccel: number
  readonly maxReverseSpeed: number
  readonly reverseAccel: number
  /** Deceleration when throttle is reversed while moving forward. */
  readonly brakeAccel: number
  /** Deceleration while coasting. Only applies with throttle near zero. */
  readonly rollingResistance: number
  /** Extra longitudinal deceleration from the handbrake. */
  readonly handbrakeDecel: number

  // ── lateral (this is where drift lives) ───────────────────────────────────
  /** Sideways deceleration, m/s². High = railed, low = loose. */
  readonly lateralGrip: number
  /** Sideways deceleration with the handbrake down. The whole drift mechanic. */
  readonly handbrakeLateralGrip: number

  // ── steering ──────────────────────────────────────────────────────────────
  /** Yaw rate at full lock and optimal speed, rad/s. */
  readonly maxYawRate: number
  /** How fast yaw rate reaches its target, rad/s². Low = heavy, vague. */
  readonly yawAccel: number
  /**
   * Speed at which full steering authority arrives, m/s. Below this the car
   * turns proportionally less, which is also what stops it pirouetting when
   * parked — and, with a signed ratio, what inverts the steering in reverse.
   */
  readonly steerSpeedFloor: number
  /** Speed above which steering starts washing out. */
  readonly steerSpeedOptimal: number
  /** Fraction of steering authority left at maxSpeed. */
  readonly highSpeedSteerScale: number
  /** Lateral speed, m/s, at which the tyres are fully saturated. */
  readonly slipSaturation: number
  /**
   * Fraction of yaw authority left with the tyres fully sliding. Low values
   * make a spin-out something you have to drive out of; 1 disables the effect
   * and impacts stop leaving any mark.
   */
  readonly slidingYawAuthority: number

  // ── body ──────────────────────────────────────────────────────────────────
  /** Downward acceleration, m/s². Deliberately above 9.81: arcade cars land fast. */
  readonly gravity: number
  /** Height of the chassis centre above the ground when resting. */
  readonly rideHeight: number
  /** Half-extents of the chassis box: x = width, y = height, z = length. */
  readonly halfExtents: { readonly x: number; readonly y: number; readonly z: number }
  /** Sphere radius used for car-vs-car. Stable and cheap. */
  readonly bodyRadius: number
  /** Restitution against arena walls and blocks, 0..1. */
  readonly wallBounce: number
  /** Speed scrubbed off along a wall per contact, 0..1. 0 = frictionless slide. */
  readonly wallFriction: number
  /** Downward speed at touchdown below which a landing isn't worth an event. */
  readonly landingThreshold: number
  /**
   * Ceiling on the upward speed a surface can impart, m/s.
   *
   * A ramp's ends are both slopes now, so the old job of this number — stopping
   * the vertical back face firing cars into orbit — is mostly done by the
   * geometry. What is left is the two places a vertical step survives:
   *
   * - A ramp's **flanks**. `rampHeightAt` cuts off hard at `halfExtents.x`, so
   *   driving side-on into a ramp is still a step of up to `rise`, taken in one
   *   tick. Ramps are ride-on surfaces rather than solids (see `Ramp`), and
   *   fixing that properly means either tapering the surface across its width
   *   or fencing each ramp with blocks. Until then this is the governor.
   * - Full throttle up a boost incline. 3.6m over 8m is a 0.45 slope, so above
   *   about 31 m/s the climb rate would outrun this and gets held here instead.
   *
   * Measured at 14: a side-on hit at 30 m/s tops out near 6.8m rather than 8.4m,
   * and the boost incline gives 4.5m to 7.4m of arc across the usable speed
   * range. Normal climbing never reaches it — the long approach at full speed is
   * about 7.5 m/s — so lowering this costs the intended jumps nothing at all.
   */
  readonly maxLaunchSpeed: number

  // ── survival ──────────────────────────────────────────────────────────────
  /**
   * Default hit points, before any per-car adjustment.
   *
   * Every number in `weapons.ts` is balanced against this. It was 100, which
   * made a fight last three seconds: the machine gun alone killed in 3.2s and
   * three rockets did it in 2.5s. Doubling it is what buys room for a fight to
   * have a middle.
   */
  readonly maxHealth: number
  /** Seconds a wreck stays down before it comes back. */
  readonly respawnDelay: number

  // ── ramming ───────────────────────────────────────────────────────────────
  /** Kilograms. Only ever matters relative to another car's mass. */
  readonly mass: number
  /**
   * Coefficient of restitution for car-vs-car, 0..1 — and it really is the
   * coefficient, not a number that gets multiplied by something else later.
   *
   * 0 means the two cars leave the contact at a shared speed: maximum thud,
   * zero rebound, and you push the other car rather than being repelled by it.
   * 1 is a billiard-ball swap that stops the rammer dead. Real cars crumple and
   * sit near 0.1–0.2, and so does anything that should feel heavy.
   */
  readonly restitution: number
  /**
   * How readily an off-centre hit spins the car, as a divisor on its yaw
   * inertia. 1 is a physically honest rectangular slab; above 1 the car pivots
   * more eagerly than its shape says it should, which is the arcade version.
   * Must stay above 0 — it divides.
   */
  readonly spinFromImpact: number
}

export const DEFAULT_VEHICLE = 'roadster' as const

export const VEHICLES: Readonly<Record<string, VehicleTuning>> = {
  roadster: {
    label: 'Roadster',

    maxSpeed: 46,
    engineAccel: 20,
    maxReverseSpeed: 15,
    reverseAccel: 11,
    brakeAccel: 34,
    rollingResistance: 3.5,
    handbrakeDecel: 14,

    // Holding a turn costs `speed × yawRate` of lateral acceleration — about
    // 62 m/s² at full lock. Grip below that means the car understeers at speed
    // and rails at mid speed, which is the character we want. Raise it past ~65
    // and the car goes on rails everywhere; drop it toward 30 and it feels icy.
    lateralGrip: 55,
    handbrakeLateralGrip: 6,

    maxYawRate: 2.7,
    yawAccel: 14,
    steerSpeedFloor: 4,
    steerSpeedOptimal: 16,
    highSpeedSteerScale: 0.5,
    slipSaturation: 14,
    slidingYawAuthority: 0.25,

    gravity: 24,
    rideHeight: 0.55,
    halfExtents: { x: 0.95, y: 0.55, z: 2.1 },
    bodyRadius: 1.5,
    wallBounce: 0.35,
    wallFriction: 0.06,
    landingThreshold: 3,
    maxLaunchSpeed: 14,

    maxHealth: 200,
    respawnDelay: 3,

    mass: 1200,
    // Was an effective 0.44 and read as ping-pong: a head-on hit sent the
    // rammer backwards at a third of its approach speed. At 0.18 the rammer
    // keeps ~41% of its speed going forward and stays on the car it hit, which
    // is the difference between shoving something and bouncing off it.
    restitution: 0.18,
    spinFromImpact: 1.4,
  },
}

export function tuningFor(archetype: string): VehicleTuning {
  const tuning = VEHICLES[archetype]
  if (tuning === undefined) throw new Error(`unknown vehicle archetype: ${archetype}`)
  return tuning
}
