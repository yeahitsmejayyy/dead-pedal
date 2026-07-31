/**
 * L1 — who the missile is allowed to lock on to.
 *
 * PLAN.md M4 gives the rule in six words: "cone in front, nearest, line of
 * sight". This is exactly that and nothing more, because a lock rule you cannot
 * state in one sentence is a lock rule nobody can play around.
 *
 * Every filter here is a *reason you cannot be locked*, and each one is a way
 * out for whoever is being shot at: break the cone, put a wall between you, or
 * get far enough away. That is what makes the missile fair to be hit by — the
 * other half of M4's done criterion, and the half a homing weapon usually
 * fails.
 */
import { angleDelta } from '../core/scalar'
import { rayRect } from './collision'
import { forwardOf, headingOf } from './vehicle'
import { isAlive, type Arena, type EntityId, type Vehicle } from './types'

export type LockRules = {
  /** Half-angle of the cone ahead of the shooter, radians. */
  readonly cone: number
  readonly range: number
  /**
   * How much being off the nose counts against a candidate.
   *
   * 0 is pure nearest. Higher values pull the lock toward whatever you are
   * pointing at, which is what makes the target track your driving rather than
   * sitting on whoever happens to be closest.
   */
  readonly aimBias?: number
  /**
   * How much better a rival has to score before it steals an existing lock.
   *
   * Without this the lock chatters between two similar candidates and never
   * finishes building — which is exactly the bug that made the whole weapon
   * useless. 0.25 means "a quarter better, or stay where you are".
   */
  readonly switchMargin?: number
}

/**
 * How attractive a candidate is. Lower is better.
 *
 * Distance scaled by how far off the nose it sits, so "near" and "in front"
 * both count and neither alone decides it.
 */
function scoreOf(distance: number, offNose: number, bias: number): number {
  return distance * (1 + offNose * bias)
}

/** Is the straight line between two points clear of arena blocks? */
export function hasLineOfSight(
  arena: Arena,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  y: number,
): boolean {
  const dx = toX - fromX
  const dz = toZ - fromZ
  const distance = Math.hypot(dx, dz)
  if (distance < 1e-6) return true

  const nx = dx / distance
  const nz = dz / distance

  for (const block of arena.blocks) {
    // Cleared its roof, so it is not in the way.
    if (y > block.pos.y + block.halfExtents.y * 2) continue

    const hit = rayRect(fromX, fromZ, nx, nz, distance, {
      x: block.pos.x,
      z: block.pos.z,
      halfX: block.halfExtents.x,
      halfZ: block.halfExtents.z,
      yaw: block.yaw,
    })
    if (hit !== null) return false
  }

  return true
}

/**
 * Can this shooter still see that specific car under these rules?
 *
 * Separate from `selectTarget` because acquiring and *keeping* a lock are
 * different questions and want different numbers. Acquisition asks "is anything
 * lined up"; retention asks "is the one I already have still roughly in front
 * of me" — and a lock that drops the instant its target crosses the acquisition
 * cone is a lock nobody can hold while steering.
 */
export function canHold(
  shooter: Vehicle,
  target: Vehicle,
  arena: Arena,
  rules: LockRules,
): boolean {
  if (!isAlive(target)) return false

  const dx = target.pos.x - shooter.pos.x
  const dz = target.pos.z - shooter.pos.z
  const distance = Math.hypot(dx, dz)
  if (distance > rules.range || distance < 1e-6) return false

  const forward = forwardOf(shooter.yaw)
  const bearing = headingOf(dx, dz)
  if (Math.abs(angleDelta(headingOf(forward.x, forward.z), bearing)) > rules.cone) return false

  return hasLineOfSight(arena, shooter.pos.x, shooter.pos.z, target.pos.x, target.pos.z, shooter.pos.y)
}

/**
 * Every car a shooter could lock on to right now, in entity-id order.
 *
 * Ordered by id rather than by distance on purpose. Distance order reshuffles
 * as you drive, so "press the key twice to get back where you were" would stop
 * being true exactly when you are moving — which is always. Id order is
 * arbitrary but stable, and stable is what a cycle key needs.
 */
export function lockableTargets(
  shooter: Vehicle,
  vehicles: readonly Vehicle[],
  arena: Arena,
  rules: LockRules,
): EntityId[] {
  return vehicles
    .filter((candidate) => candidate.id !== shooter.id && canHold(shooter, candidate, arena, rules))
    .map((candidate) => candidate.id)
    .sort((a, b) => a - b)
}

/**
 * The car a shooter would lock on to right now, or null.
 *
 * Nearest wins, and ties break on the lower entity id — not because either
 * matters much in play, but because "nearest" alone is not a total order and
 * this has to give the same answer on a client and a server.
 */
export function selectTarget(
  shooter: Vehicle,
  vehicles: readonly Vehicle[],
  arena: Arena,
  rules: LockRules,
): EntityId | null {
  return scoredTargets(shooter, vehicles, arena, rules)[0]?.id ?? null
}

/** Every legal candidate with its score, best first. */
export function scoredTargets(
  shooter: Vehicle,
  vehicles: readonly Vehicle[],
  arena: Arena,
  rules: LockRules,
): { id: EntityId; score: number }[] {
  const forward = forwardOf(shooter.yaw)
  const nose = headingOf(forward.x, forward.z)
  const eye = shooter.pos.y
  const bias = rules.aimBias ?? 0

  const found: { id: EntityId; score: number }[] = []

  for (const candidate of vehicles) {
    if (candidate.id === shooter.id || !isAlive(candidate)) continue

    const dx = candidate.pos.x - shooter.pos.x
    const dz = candidate.pos.z - shooter.pos.z
    const distance = Math.hypot(dx, dz)
    if (distance > rules.range || distance < 1e-6) continue

    // Inside the cone ahead. Measured against the car's nose, not the camera:
    // what you can lock is decided by where the car is pointing, which is the
    // thing the player is actually steering.
    const offNose = Math.abs(angleDelta(nose, headingOf(dx, dz)))
    if (offNose > rules.cone) continue

    if (!hasLineOfSight(arena, shooter.pos.x, shooter.pos.z, candidate.pos.x, candidate.pos.z, eye)) {
      continue
    }

    found.push({ id: candidate.id, score: scoreOf(distance, offNose, bias) })
  }

  // Ties break on the lower id — not because it matters in play, but because a
  // score alone is not a total order and this has to agree on a client and a
  // server.
  found.sort((a, b) => (a.score === b.score ? a.id - b.id : a.score - b.score))
  return found
}

/**
 * The target a lock should be on now, given the one it is on.
 *
 * The lock tracks whoever is nearest *and* most in front, so it follows your
 * driving — but a rival has to beat the incumbent by `switchMargin` to take it.
 * Re-picking outright every tick is what made a lock impossible to finish;
 * never re-picking made it stick to whoever you happened to see first.
 */
export function retarget(
  shooter: Vehicle,
  vehicles: readonly Vehicle[],
  arena: Arena,
  rules: LockRules,
  current: EntityId | null,
): EntityId | null {
  const ranked = scoredTargets(shooter, vehicles, arena, rules)
  const best = ranked[0]
  if (best === undefined) return null
  if (current === null) return best.id

  const held = ranked.find((entry) => entry.id === current)
  if (held === undefined) return best.id

  const margin = rules.switchMargin ?? 0.25
  return best.score < held.score * (1 - margin) ? best.id : current
}
