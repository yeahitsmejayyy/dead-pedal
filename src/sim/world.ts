import { fromSeed } from '../core/rng'
import { PROVING_GROUND } from '../content/arenas/proving-ground'
import { DEFAULT_VEHICLE, tuningFor } from '../content/vehicles'
import { SPECIAL_IDS, fullAmmo, noCooldowns } from '../content/weapons'
import { SANDBOX_RULES, type MatchRules } from '../content/match'
import { initialMatch } from './match'
import type { Arena, EntityId, Pickup, Projectile, SimEvent, Vehicle, WorldState } from './types'

export const NO_EVENTS: readonly SimEvent[] = Object.freeze([])
export const NO_PROJECTILES: readonly Projectile[] = Object.freeze([])

export type WorldOptions = {
  /** Any integer. The same seed must always produce the same match. */
  readonly seed?: number
  readonly arena?: Arena
  /** How many cars to place on the arena's spawn points. */
  readonly vehicles?: number
  readonly archetype?: string
  /**
   * Per-car health ceiling. A plain function of id on purpose — the sim has no
   * idea what a "bot" or a "difficulty" is, and this is how durability gets in
   * without teaching it.
   */
  readonly health?: (id: EntityId) => number
  /** Defaults to `SANDBOX_RULES` — a bare world has no match running. */
  readonly rules?: MatchRules
}

/**
 * A car entering the arena: on its spawn point, at full health, fully loaded.
 *
 * Also the respawn path, so a car that comes back is byte-identical to one that
 * started there — there is no second place for "what a fresh car looks like" to
 * drift out of agreement with this one.
 */
export function spawnVehicle(
  id: EntityId,
  arena: Arena,
  archetype: string = DEFAULT_VEHICLE,
  maxHealth?: number,
): Vehicle {
  const spawn = arena.spawns[id % arena.spawns.length]
  if (spawn === undefined) throw new Error(`arena ${arena.id} has no spawn points`)
  const t = tuningFor(archetype)

  return {
    id,
    archetype,
    pos: { x: spawn.pos.x, y: arena.groundY + t.rideHeight, z: spawn.pos.z },
    vel: { x: 0, y: 0, z: 0 },
    yaw: spawn.yaw,
    yawRate: 0,
    grounded: true,
    forwardSpeed: 0,
    lateralSpeed: 0,

    health: maxHealth ?? t.maxHealth,
    maxHealth: maxHealth ?? t.maxHealth,
    ammo: fullAmmo(),
    cooldowns: noCooldowns(),
    respawnAt: null,

    selectedSpecial: SPECIAL_IDS[0],
    lockTarget: null,
    lockTime: 0,
    lockGrace: 0,
    manualTarget: false,
  }
}

/** Every crate the arena declares, all present at tick zero. */
export function initialPickups(arena: Arena): Pickup[] {
  return arena.pickups.map((spot) => ({
    id: spot.id,
    kind: spot.kind,
    weapon: spot.weapon ?? null,
    pos: spot.pos,
    availableAt: 0,
  }))
}

export function createWorld({
  seed = 1,
  arena = PROVING_GROUND,
  vehicles = 1,
  archetype = DEFAULT_VEHICLE,
  health,
  rules = SANDBOX_RULES,
}: WorldOptions = {}): WorldState {
  return {
    tick: 0,
    rngState: fromSeed(seed),
    arena,
    rules,
    match: initialMatch(rules, vehicles),
    vehicles: Array.from({ length: vehicles }, (_, i) =>
      spawnVehicle(i, arena, archetype, health?.(i)),
    ),
    projectiles: NO_PROJECTILES,
    pickups: initialPickups(arena),
    nextProjectileId: 0,
    events: NO_EVENTS,
  }
}
