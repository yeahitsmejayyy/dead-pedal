/**
 * L2 — weapon tuning. Contract 5, same as `vehicles.ts`: every number that
 * decides how a weapon feels lives here, never in a function body.
 *
 * Two weapons at M3, exactly as PLAN.md §4 asks: a hitscan machine gun and a
 * dumb rocket. Lock-on, mines and napalm are M4 and are not modelled here even
 * as placeholders — a weapon that exists but does nothing is a weapon you have
 * to keep explaining.
 */

export type WeaponId = 'machineGun' | 'rocket' | 'homingMissile' | 'mine'

export const WEAPON_IDS: readonly WeaponId[] = ['machineGun', 'rocket', 'homingMissile', 'mine']

/**
 * What the `special` trigger cycles through. The machine gun is not in here —
 * it lives on its own button, because a vehicular-combat game where you have to cycle
 * off your gun to lay a mine is a vehicular-combat game nobody wants to drive.
 *
 * PLAN.md §7 caps this at four weapons before M6, which is exactly what exists.
 */
export const SPECIAL_IDS = ['rocket', 'homingMissile', 'mine'] as const satisfies readonly WeaponId[]

type Common = {
  readonly label: string
  /** Damage per hit, against a car with 100 health. */
  readonly damage: number
  /** Seconds between shots. */
  readonly fireInterval: number
  /**
   * Rounds carried. Deliberately finite, even for the machine gun: `Infinity`
   * does not survive `JSON.stringify` (it comes back as `null`), and world
   * state has to round-trip through the wire intact for M8. A generous finite
   * number is also what gives M4's ammo pickups something to be for.
   */
  readonly capacity: number
  /**
   * Muzzle positions in the car's own frame: right, up, forward.
   *
   * A list, because a weapon can have more than one barrel — and because the
   * view builds its gun models from these exact offsets, so what you see on the
   * hood is where the rays actually start. One source, no drift.
   */
  readonly muzzles: readonly { readonly x: number; readonly y: number; readonly z: number }[]
}

export type HitscanWeapon = Common & {
  readonly kind: 'hitscan'
  readonly range: number
  /**
   * Half-angle of the cone a round can land in, radians. **Zero on purpose**
   * for the machine gun: dispersion made the stream wander around the target
   * and read as noise, and it moved the job of aiming from the player to the
   * dice. Straight barrels mean hitting something is a driving problem.
   *
   * Above zero this draws from `world.rngState`, never `Math.random`.
   */
  readonly spread: number
}

/**
 * What a missile needs to chase something.
 *
 * Every number here is a way out for whoever is being shot at, which is the
 * point: `lockTime` is warning, `lockCone` and `lockRange` are the ways to
 * break a lock before it completes, and `turnRate` is the way to dodge one that
 * already launched.
 */
export type Homing = {
  /** Radians per second the missile can bend its course. */
  readonly turnRate: number
  /** Seconds a target has to stay locked before the shot will track it. */
  readonly lockTime: number
  /** Half-angle of the cone that will *start* a lock, radians. */
  readonly lockCone: number
  readonly lockRange: number
  /**
   * The wider cone and range that *keep* an existing lock.
   *
   * Without this the lock resets every time the nearest car drifts across the
   * acquisition cone, which while actually driving means never: measured over
   * 25 seconds of ordinary cornering it completed 0% of the time and every
   * missile fired came out dumb.
   */
  readonly holdCone: number
  readonly holdRange: number
  /** Seconds a lock survives with no valid target at all — a brief LOS break. */
  readonly holdGrace: number
  /**
   * How much being off the nose counts against a candidate, versus distance.
   *
   * This is what makes the lock feel alive: swing the car toward someone and
   * the target follows your driving, rather than sitting on whoever happens to
   * be nearest regardless of where you are pointing.
   */
  readonly aimBias: number
  /** How much better a rival must score to steal the lock. Stops it chattering. */
  readonly switchMargin: number
}

export type ProjectileWeapon = Common & {
  readonly kind: 'projectile'
  /** Absent for a dumb rocket. */
  readonly homing?: Homing
  readonly speed: number
  readonly lifetime: number
  /** Radius over which the blast still does something, metres. */
  readonly blastRadius: number
  /** Damage at the very centre of the blast, falling linearly to zero. */
  readonly blastDamage: number
  /** Vertical kick at launch, so a rocket arcs rather than tracking a laser. */
  readonly launchLift: number
  /** Downward acceleration on the rocket, m/s². 0 flies flat. */
  readonly gravity: number
}

/** Dropped, not fired. Sits still, arms, then triggers on proximity. */
export type MineWeapon = Common & {
  readonly kind: 'mine'
  /** Seconds before it will trigger — long enough to drive clear of your own. */
  readonly armDelay: number
  /** Seconds it stays live before fizzling out. */
  readonly lifetime: number
  /** How close a car has to get to set it off. */
  readonly triggerRadius: number
  readonly blastRadius: number
  readonly blastDamage: number
}

export type WeaponSpec = HitscanWeapon | ProjectileWeapon | MineWeapon

// Declared separately and then collected, rather than annotated as
// `Record<WeaponId, WeaponSpec>`. That annotation widens every entry to the
// union, so `WEAPONS.rocket.speed` stops existing at the type level even though
// the rocket obviously has one.
const MACHINE_GUN: HitscanWeapon = {
  kind: 'hitscan',
  label: 'Machine Gun',
  // Per round, and there are two barrels, so a volley that lands both is 2.8
  // and sustained fire is 22 damage/second. Against 200 health that is a
  // nine-second kill with the trigger held and every round on target — the gun
  // is meant to grind someone down, not delete them.
  damage: 1.4,
  // 8 volleys a second, 16 rounds. Fast enough to feel like suppression, slow
  // enough that a car does not evaporate before you register hitting it.
  fireInterval: 0.125,
  // 300 volleys — about 37 seconds on the trigger.
  capacity: 600,
  range: 140,
  spread: 0,
  // Twin hood mounts, parallel. Not converging: a convergence distance is a
  // number that is wrong at every other range.
  muzzles: [
    { x: -0.55, y: 0.62, z: 2.15 },
    { x: 0.55, y: 0.62, z: 2.15 },
  ],
}

const ROCKET: ProjectileWeapon = {
  kind: 'projectile',
  label: 'Rocket',
  // Direct hits are rare at speed, so most of a rocket's damage is its blast.
  // Direct + full blast is 34, about a sixth of a health bar: six rockets to
  // kill. At 26 + 34 it was 60% of a bar and two of them ended a fight.
  damage: 14,
  fireInterval: 1.1,
  capacity: 6,
  speed: 62,
  lifetime: 4,
  blastRadius: 7,
  blastDamage: 20,
  launchLift: 1.5,
  gravity: 6,
  muzzles: [{ x: 0, y: 0.42, z: 2.3 }],
}

const HOMING_MISSILE: ProjectileWeapon = {
  kind: 'projectile',
  label: 'Homing Missile',
  // 18 + 26 = 44, a little over a fifth of a bar. Costlier than a rocket
  // because it is harder to avoid, and there are only four of them.
  damage: 18,
  fireInterval: 1.5,
  capacity: 4,
  // Only 10 m/s faster than a car flat out. That differential is the whole
  // balance of the weapon: over its six-second life it can close 60m of gap, so
  // running for it works if you had a head start and fails if you did not.
  speed: 56,
  lifetime: 6,
  blastRadius: 6,
  blastDamage: 26,
  launchLift: 2.2,
  // Flies level. A homing missile that also drops is two problems at once.
  gravity: 0,
  homing: {
    // ~126°/s. Slower than a car can change heading at speed, so a hard late
    // turn beats it and a lazy one does not.
    turnRate: 2.2,
    lockTime: 0.7,
    // ~54° half-angle. Wide enough to hold something while you are steering,
    // which the old 29° was not.
    lockCone: 0.95,
    lockRange: 130,
    // ~92°: nearly abeam. Once you have earned a lock it takes a real turn away
    // to lose it, not an ordinary corner.
    holdCone: 1.6,
    holdRange: 175,
    holdGrace: 0.7,
    aimBias: 1.6,
    switchMargin: 0.22,
  },
  muzzles: [{ x: 0, y: 0.42, z: 2.3 }],
}

const MINE: MineWeapon = {
  kind: 'mine',
  label: 'Mine',
  // Mines do no impact damage — everything they do is the blast.
  damage: 0,
  fireInterval: 0.55,
  capacity: 5,
  armDelay: 0.9,
  lifetime: 25,
  triggerRadius: 4.2,
  blastRadius: 8,
  // The heaviest single hit in the game, at a quarter of a bar — it should be,
  // because you have to trick someone into it.
  blastDamage: 50,
  // Out the back, below the boot: you lay these for whoever is chasing you.
  muzzles: [{ x: 0, y: 0.15, z: -2.5 }],
}

export const WEAPONS = {
  machineGun: MACHINE_GUN,
  rocket: ROCKET,
  homingMissile: HOMING_MISSILE,
  mine: MINE,
} satisfies Record<WeaponId, WeaponSpec>

export function weaponFor(id: WeaponId): WeaponSpec {
  return WEAPONS[id]
}

/** A fresh loadout. Written as a function so nothing can share one by accident. */
export function fullAmmo(): Record<WeaponId, number> {
  return {
    machineGun: MACHINE_GUN.capacity,
    rocket: ROCKET.capacity,
    homingMissile: HOMING_MISSILE.capacity,
    mine: MINE.capacity,
  }
}

export function noCooldowns(): Record<WeaponId, number> {
  return { machineGun: 0, rocket: 0, homingMissile: 0, mine: 0 }
}
