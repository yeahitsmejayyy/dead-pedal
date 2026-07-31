import type { RngState } from '../core/rng'
import type { Vec3 } from '../core/vec3'
import type { WeaponId } from '../content/weapons'
import type { MatchRules } from '../content/match'

export type EntityId = number
export type ProjectileId = number
export type PickupId = number

/**
 * One frame of intent, from any source. Humans, bots and (at M8) the network all
 * produce these and nothing else — that is the contract that stops multiplayer
 * from being a rewrite.
 */
export type InputFrame = {
  readonly tick: number
  /** -1..1, reverse..forward. */
  readonly throttle: number
  /** -1..1, left..right. */
  readonly steer: number
  readonly handbrake: boolean
  readonly fire: boolean
  readonly special: boolean
  /** One tick per press, not held: advances to the next special weapon. */
  readonly cycleWeapon: boolean
  /**
   * One tick per press: advances the lock to the next enemy in range.
   *
   * Only does anything while the homing missile is selected — target choice is
   * a property of that weapon, and a key that silently does nothing two thirds
   * of the time is a key nobody trusts.
   */
  readonly cycleTarget: boolean
  readonly lookBack: boolean
}

export const NEUTRAL_INPUT: InputFrame = Object.freeze({
  tick: 0,
  throttle: 0,
  steer: 0,
  handbrake: false,
  fire: false,
  special: false,
  cycleWeapon: false,
  cycleTarget: false,
  lookBack: false,
})

export type Spawn = { readonly pos: Vec3; readonly yaw: number }

/** A solid, yaw-rotated box. The arena's walls, crates, pillars. */
export type Block = {
  readonly id: string
  /** Centre of the footprint; `y` is the base the block sits on. */
  readonly pos: Vec3
  readonly halfExtents: { readonly x: number; readonly y: number; readonly z: number }
  readonly yaw: number
}

/**
 * A drive-on tent. The top surface sits at `pos.y` along the ramp's back edge,
 * rises to `pos.y + rise` at the ridge, then falls back to `pos.y` at the
 * ramp's front, where front is the ramp's local +Z.
 *
 * Ramps are ride-on surfaces, not solids: approach one from the side and the
 * car climbs it rather than being blocked. That is a deliberate M2 limitation —
 * pair a ramp with a `Block` if you want its flanks to be walls.
 */
export type Ramp = {
  readonly id: string
  readonly pos: Vec3
  readonly halfExtents: { readonly x: number; readonly z: number }
  readonly yaw: number
  readonly rise: number
  /**
   * Length of the short incline on the far side of the ridge.
   *
   * The rest of the footprint is the long approach, so the surface is a tent:
   * a gentle climb one way, a steep boost the other, and ground at both ends.
   *
   * This exists because the alternative is a cliff. With no back slope the
   * surface height jumps from `rise` to zero across a single point, and a car
   * driving at that edge gets teleported to the top of it — which read to
   * players exactly as it sounds: running into a flat wall and being flung.
   * A `backRun` of 0 restores that cliff, which is the only reason the degenerate
   * case is still expressible.
   */
  readonly backRun: number
}

/**
 * Arena collision, as data. The sim never sees a mesh — it sees this, and so
 * does the renderer. One source, two consumers, which is the cheapest possible
 * reading of "authored together" and defers the Blender pipeline to M7.
 */
export type Arena = {
  readonly id: string
  readonly label: string
  readonly groundY: number
  /** Hard bounds. Enforced by a clamp, so escaping is not merely unlikely. */
  readonly halfExtents: { readonly x: number; readonly z: number }
  readonly wallHeight: number
  readonly blocks: readonly Block[]
  readonly ramps: readonly Ramp[]
  readonly pickups: readonly PickupSpot[]
  readonly spawns: readonly Spawn[]
}

export type Vehicle = {
  readonly id: EntityId
  readonly archetype: string
  readonly pos: Vec3
  readonly vel: Vec3
  readonly yaw: number
  readonly yawRate: number
  readonly grounded: boolean

  /** Zero or below means destroyed. */
  readonly health: number
  /**
   * This car's own ceiling, not the archetype's.
   *
   * Carried per car so durability can vary — a tougher opponent is a real
   * difficulty lever, and it has to survive respawn. Everything that draws a
   * health bar reads this rather than the archetype, or a 320-health car would
   * show a full bar at 100.
   */
  readonly maxHealth: number
  readonly ammo: Readonly<Record<WeaponId, number>>
  /** Seconds left before each weapon can fire again. */
  readonly cooldowns: Readonly<Record<WeaponId, number>>
  /** Tick this car comes back, or null while it is alive. */
  readonly respawnAt: number | null

  /** Which of `SPECIAL_IDS` the special trigger will fire. */
  readonly selectedSpecial: WeaponId
  /**
   * Who the missiles would chase, and for how long it has been held.
   *
   * Tracked continuously rather than only while the trigger is down, so the
   * lock is something the player can *see* building before they commit a shot —
   * which is the difference between a missile that feels dangerous and one that
   * feels arbitrary.
   */
  readonly lockTarget: EntityId | null
  /** Seconds the current target has been held, in seconds. */
  readonly lockTime: number
  /** Seconds the held target has been invalid. Drops the lock past `holdGrace`. */
  readonly lockGrace: number
  /**
   * True when the player picked this target by hand.
   *
   * Kept so a manual choice is not quietly replaced the moment something else
   * looks better, and so the view can say which it is.
   */
  readonly manualTarget: boolean
  /**
   * Speed along the car's own forward axis. Derived, but kept on the vehicle
   * because the HUD, the camera and the audio layer all want it and none of them
   * should be recomputing a basis to get it.
   */
  readonly forwardSpeed: number
  /** Speed across the car's own right axis. Non-zero means the car is sliding. */
  readonly lateralSpeed: number
}

/**
 * How the sim talks to the view and audio without knowing they exist. Drained
 * every tick; nothing downstream may write back.
 */
/**
 * A rocket, missile or mine in the world. Hitscan shots resolve within the tick
 * they are fired and never become one.
 *
 * Mines are the same shape with no velocity — one list, one set of lifetime and
 * detonation rules, rather than a parallel system that has to be kept in step.
 */
export type Projectile = {
  readonly id: ProjectileId
  readonly owner: EntityId
  readonly weapon: WeaponId
  readonly pos: Vec3
  readonly vel: Vec3
  /** Who this is chasing. Null for a dumb rocket, a mine, or a missile fired
   *  without a lock — which then flies straight, and that is the point. */
  readonly target: EntityId | null
  /** Tick a mine becomes live. Equal to the spawn tick for everything else. */
  readonly armsAt: number
  /** Tick at which it fizzles out if it has not hit anything. */
  readonly expiresAt: number
}

/**
 * What a crate gives you.
 *
 * `armour` is health that can take you *above* your own ceiling, which is what
 * makes it worth crossing the arena for once you are already full.
 */
export type PickupKind = 'weapon' | 'health' | 'armour'

/** A crate on the arena floor. */
export type Pickup = {
  readonly id: PickupId
  readonly kind: PickupKind
  /** Only meaningful for `weapon` crates. */
  readonly weapon: WeaponId | null
  readonly pos: Vec3
  /** Tick it is back. At or before the current tick means it is there now. */
  readonly availableAt: number
}

/**
 * PLAN.md §2: "Match flow is a state machine with four states."
 *
 * - `countdown`  cars frozen, clock running down to the start
 * - `live`       the round is being fought
 * - `roundOver`  someone won it; a pause before the next one
 * - `matchOver`  someone took the match
 */
export type MatchPhase = 'countdown' | 'live' | 'roundOver' | 'matchOver'

export type MatchState = {
  readonly phase: MatchPhase
  /** 1-based. Increments when a new countdown begins. */
  readonly round: number
  /** Ticks left in this phase — for `live`, what remains of the round timer. */
  readonly timer: number
  /** Rounds won, indexed by entity id. Plain array so it hashes and serialises. */
  readonly scores: readonly number[]
  /** Who took the round that just ended. Null for a draw, or mid-round. */
  readonly roundWinner: EntityId | null
  readonly matchWinner: EntityId | null
}

export type SimEvent =
  | {
      readonly type: 'impact'
      readonly id: EntityId
      /** What was hit. `null` for the arena itself. */
      readonly against: EntityId | null
      readonly pos: Vec3
      /** Closing speed along the contact normal, m/s. Drives shake and sound. */
      readonly magnitude: number
    }
  | {
      readonly type: 'landed'
      readonly id: EntityId
      readonly pos: Vec3
      /** Downward speed at touchdown, m/s. */
      readonly magnitude: number
    }
  | {
      readonly type: 'weaponFired'
      readonly id: EntityId
      readonly weapon: WeaponId
      readonly pos: Vec3
      /** Unit direction, for the muzzle flash and the tracer. */
      readonly dir: Vec3
    }
  | {
      /** A hitscan round landing. Carries both ends so the view can draw it. */
      readonly type: 'tracer'
      readonly id: EntityId
      readonly weapon: WeaponId
      readonly from: Vec3
      readonly to: Vec3
      /** Whether it found a car rather than scenery or thin air. */
      readonly hit: EntityId | null
    }
  | {
      readonly type: 'damaged'
      readonly id: EntityId
      readonly by: EntityId
      readonly weapon: WeaponId
      readonly pos: Vec3
      readonly amount: number
    }
  | {
      readonly type: 'explosion'
      readonly pos: Vec3
      readonly radius: number
    }
  | {
      readonly type: 'vehicleDestroyed'
      readonly id: EntityId
      readonly by: EntityId | null
      readonly pos: Vec3
    }
  | {
      readonly type: 'vehicleRespawned'
      readonly id: EntityId
      readonly pos: Vec3
    }
  | {
      readonly type: 'lockAcquired'
      readonly id: EntityId
      readonly target: EntityId
    }
  | {
      readonly type: 'lockLost'
      readonly id: EntityId
    }
  | {
      readonly type: 'mineArmed'
      readonly id: ProjectileId
      readonly pos: Vec3
    }
  | {
      readonly type: 'roundStarted'
      readonly round: number
    }
  | {
      readonly type: 'roundEnded'
      readonly round: number
      /** Null when the timer ran out on a tie. */
      readonly winner: EntityId | null
      /** True when it was decided by the clock rather than by elimination. */
      readonly onTime: boolean
    }
  | {
      readonly type: 'matchEnded'
      readonly winner: EntityId | null
    }
  | {
      readonly type: 'pickedUp'
      readonly id: EntityId
      readonly pickup: PickupId
      readonly kind: PickupKind
      readonly weapon: WeaponId | null
      readonly pos: Vec3
    }

/**
 * The entire game, as plain data. Serialisable, diffable, hashable — if a field
 * here can't survive `JSON.parse(JSON.stringify(...))`, it belongs in the view.
 */
export type WorldState = {
  readonly tick: number
  readonly rngState: RngState
  readonly arena: Arena
  readonly rules: MatchRules
  readonly match: MatchState
  readonly vehicles: readonly Vehicle[]
  readonly projectiles: readonly Projectile[]
  readonly pickups: readonly Pickup[]
  /** Monotonic, so a projectile id is never reused inside one match. */
  readonly nextProjectileId: ProjectileId
  readonly events: readonly SimEvent[]
}

/** Destroyed cars stay in the array, inert, until they respawn. */
export function isAlive(vehicle: Vehicle): boolean {
  return vehicle.health > 0
}

/** Arena spots a pickup returns to. */
export type PickupSpot = {
  readonly id: PickupId
  readonly kind: PickupKind
  readonly weapon?: WeaponId
  readonly pos: Vec3
}

export type Inputs = ReadonlyMap<EntityId, InputFrame>
