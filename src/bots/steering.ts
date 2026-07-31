/**
 * L4 — steering primitives.
 *
 * PLAN.md M5: "Start with steering behaviours, not pathfinding." These are
 * those behaviours, and they are deliberately plain functions over numbers
 * rather than methods on a bot: a steering primitive you can call with three
 * numbers is a steering primitive you can test with three numbers, which is
 * what the milestone asks for.
 *
 * Every one of them answers the same question — *what heading do I want?* —
 * and nothing here decides throttle, fires a weapon, or touches a `WorldState`.
 * Turning a desired heading into an `InputFrame` is `brain.ts`'s job, and it is
 * the only job that needs to know a car exists.
 */
import { angleDelta, clamp } from '../core/scalar'
import { headingOf, rayRect, type Arena } from '../sim'

/** Head straight at a point. */
export function seek(fromX: number, fromZ: number, toX: number, toZ: number): number {
  return headingOf(toX - fromX, toZ - fromZ)
}

/** Head directly away from a point. */
export function flee(fromX: number, fromZ: number, awayX: number, awayZ: number): number {
  return headingOf(fromX - awayX, fromZ - awayZ)
}

/**
 * Throttle for closing on a point and stopping near it, 0..1.
 *
 * Separate from `seek` because arriving is about *speed* and seeking is about
 * *heading*, and a bot that confuses the two either overshoots every pickup or
 * crawls the length of the arena.
 */
export function arrive(distance: number, slowRadius: number, stopRadius = 0): number {
  if (distance <= stopRadius) return 0
  if (distance >= slowRadius) return 1
  const span = Math.max(1e-6, slowRadius - stopRadius)
  return clamp((distance - stopRadius) / span, 0, 1)
}

/**
 * Head for where a moving target *will* be.
 *
 * Pure `seek` against something crossing in front of you produces a tail chase
 * that never closes — the same failure the homing missile had. Solving for the
 * intercept instead is what makes a bot cut a corner rather than follow you
 * round it.
 */
export function pursue(
  fromX: number,
  fromZ: number,
  targetX: number,
  targetZ: number,
  targetVelX: number,
  targetVelZ: number,
  ownSpeed: number,
): number {
  const rx = targetX - fromX
  const rz = targetZ - fromZ

  // |r + v·t| = ownSpeed·t  →  (v·v − s²)t² + 2(r·v)t + r·r = 0
  const a = targetVelX * targetVelX + targetVelZ * targetVelZ - ownSpeed * ownSpeed
  const b = 2 * (rx * targetVelX + rz * targetVelZ)
  const c = rx * rx + rz * rz

  let t = -1
  if (Math.abs(a) < 1e-6) {
    // Closing speed is a wash; fall back to the linear solution.
    if (Math.abs(b) > 1e-6) t = -c / b
  } else {
    const discriminant = b * b - 4 * a * c
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant)
      const t1 = (-b - root) / (2 * a)
      const t2 = (-b + root) / (2 * a)
      // Smallest positive: the first moment we could be there.
      const positives = [t1, t2].filter((v) => v > 0)
      if (positives.length > 0) t = Math.min(...positives)
    }
  }

  // Unreachable at this speed, or degenerate: just point at it.
  if (t <= 0 || !Number.isFinite(t)) return seek(fromX, fromZ, targetX, targetZ)

  // Capped so a nearly-unreachable target does not send the bot to the horizon.
  const lead = Math.min(t, 4)
  return seek(fromX, fromZ, targetX + targetVelX * lead, targetZ + targetVelZ * lead)
}

/** Head away from where a pursuer is going, not from where it is. */
export function evade(
  fromX: number,
  fromZ: number,
  threatX: number,
  threatZ: number,
  threatVelX: number,
  threatVelZ: number,
): number {
  const distance = Math.hypot(threatX - fromX, threatZ - fromZ)
  // Look further ahead the further away the threat is; up close, just run.
  const lead = clamp(distance / 40, 0, 1.5)
  return flee(fromX, fromZ, threatX + threatVelX * lead, threatZ + threatVelZ * lead)
}

/**
 * Distance to the first thing in the way along a heading, capped at `maxDistance`.
 *
 * Counts arena bounds as well as blocks. A bot that only avoids blocks drives
 * confidently into a wall, which looks far more stupid than clipping a pillar.
 */
export function clearance(
  arena: Arena,
  x: number,
  z: number,
  heading: number,
  maxDistance: number,
  y = 1,
): number {
  const dx = -Math.sin(heading)
  const dz = Math.cos(heading)

  let nearest = maxDistance

  // ── arena bounds ──────────────────────────────────────────────────────────
  // Slab test from the inside: the first plane the ray leaves through.
  for (const [pos, dir, half] of [
    [x, dx, arena.halfExtents.x],
    [z, dz, arena.halfExtents.z],
  ] as const) {
    if (Math.abs(dir) < 1e-9) continue
    const t = ((dir > 0 ? half : -half) - pos) / dir
    if (t >= 0 && t < nearest) nearest = t
  }

  // ── blocks ────────────────────────────────────────────────────────────────
  for (const block of arena.blocks) {
    if (y > block.pos.y + block.halfExtents.y * 2) continue
    const t = rayRect(x, z, dx, dz, nearest, {
      x: block.pos.x,
      z: block.pos.z,
      halfX: block.halfExtents.x,
      halfZ: block.halfExtents.z,
      yaw: block.yaw,
    })
    if (t !== null && t < nearest) nearest = t
  }

  return nearest
}

/**
 * Nudge a desired heading away from whatever it is about to drive into.
 *
 * Three probes rather than a full plan: straight ahead tells you *whether* to
 * care, and the two shoulders tell you *which way* to go. That is the cheapest
 * thing that reliably gets a car round a pillar, and PLAN.md is explicit that
 * pathfinding is not the M5 problem.
 */
export function avoidWalls(
  arena: Arena,
  x: number,
  z: number,
  desired: number,
  lookahead: number,
  y = 1,
): number {
  const ahead = clearance(arena, x, z, desired, lookahead, y)
  if (ahead >= lookahead) return desired

  const sweep = 0.75
  const left = clearance(arena, x, z, desired - sweep, lookahead, y)
  const right = clearance(arena, x, z, desired + sweep, lookahead, y)

  // Boxed in on all three: turn hard rather than creep into the corner.
  if (left < lookahead * 0.4 && right < lookahead * 0.4) {
    return desired + (left >= right ? -1.6 : 1.6)
  }

  // How urgently we steer scales with how close the wall is, so a bot skimming
  // a barrier keeps its line and one about to hit it commits to the turn.
  const urgency = 1 - ahead / lookahead
  return desired + (left >= right ? -sweep : sweep) * urgency * 1.6
}

/**
 * Nudge a heading away from any live mine near the intended path.
 *
 * Bots read the projectile list like anything else in the world, so they avoid
 * enemy mines and their own alike — which is both more correct and simpler than
 * remembering where you personally left things. Without it, a bot that lays a
 * mine while running, then turns back to fight, drives straight over it: mines
 * were the largest single cause of bots killing themselves.
 */
export function avoidMines(
  mines: readonly { readonly pos: { readonly x: number; readonly z: number } }[],
  x: number,
  z: number,
  desired: number,
  dangerRadius: number,
): number {
  let adjusted = desired

  for (const mine of mines) {
    const dx = mine.pos.x - x
    const dz = mine.pos.z - z
    const distance = Math.hypot(dx, dz)
    if (distance > dangerRadius || distance < 1e-6) continue

    // Only care about mines roughly in front — swerving away from one you have
    // already passed is how a bot ends up driving in circles.
    const bearing = headingOf(dx, dz)
    const off = angleDelta(adjusted, bearing)
    if (Math.abs(off) > 1.2) continue

    // Steer to whichever side of it we are already leaning, harder the closer
    // it is. `off` is which way the mine sits, so we go the other way.
    const urgency = 1 - distance / dangerRadius
    adjusted += (off >= 0 ? -1 : 1) * (1.2 - Math.abs(off)) * urgency
  }

  return adjusted
}

/**
 * Steering input, -1..1, that turns a car heading toward the one it wants.
 *
 * `skill` caps how much lock the bot is willing to use, which is what makes a
 * rookie take wide, ugly lines without needing a separate driving model.
 */
export function steerToward(currentHeading: number, desired: number, skill: number): number {
  const error = angleDelta(currentHeading, desired)
  // ×2.2 so a small error still produces a definite correction; anything
  // gentler and bots weave down straights hunting for the line.
  return clamp(error * 2.2, -1, 1) * skill
}
