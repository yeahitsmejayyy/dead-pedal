/**
 * L1 — firing, projectiles, damage, destruction, respawn.
 *
 * PLAN.md rates M3 low-risk and it is, but two things here are easy to get
 * subtly wrong and both are pinned by tests:
 *
 * - **Cooldowns are carried in seconds and decremented by `dt`**, not counted
 *   in ticks. A fire interval expressed in ticks silently changes meaning the
 *   day anyone touches `TICK_HZ`.
 * - **Spread draws from `world.rngState`**, never `Math.random`. This is the
 *   first thing in the sim to consume randomness, and it is exactly why the
 *   RNG has lived inside the world state since M0: a replay of a firefight has
 *   to land the same rounds in the same places.
 *
 * Ordering is deliberate: every car fires from where it ended up this tick,
 * then projectiles move, then all damage lands at once. Applying damage as it
 * is found would let the first car in the array kill the second before the
 * second had taken its shot.
 */
import { TICK_DT } from '../core/clock'
import { next as nextRandom, type RngState } from '../core/rng'
import { tuningFor } from '../content/vehicles'
import { SPECIAL_IDS, WEAPON_IDS, weaponFor, type WeaponId } from '../content/weapons'
import type { Vec3 } from '../core/vec3'
import { bodyCircles, rayCircle, rayRect } from './collision'
import { angleDelta, clamp, wrapAngle } from '../core/scalar'
import { canHold, lockableTargets, retarget, selectTarget } from './targeting'
import { forwardOf, headingOf, rightOf } from './vehicle'
import {
  isAlive,
  type Arena,
  type EntityId,
  type Inputs,
  type Projectile,
  type ProjectileId,
  type SimEvent,
  type Vehicle,
} from './types'
import { spawnVehicle } from './world'

type Vec3Out = { x: number; y: number; z: number }

/** Muzzle position in world space, from an offset in the car's own frame. */
function muzzleOf(vehicle: Vehicle, offset: { x: number; y: number; z: number }): Vec3Out {
  const forward = forwardOf(vehicle.yaw)
  const right = rightOf(vehicle.yaw)
  return {
    x: vehicle.pos.x + right.x * offset.x + forward.x * offset.z,
    y: vehicle.pos.y + offset.y,
    z: vehicle.pos.z + right.z * offset.x + forward.z * offset.z,
  }
}

/** Nearest car a ray reaches, ignoring the shooter and anything already dead. */
function traceVehicles(
  vehicles: readonly Vehicle[],
  shooter: EntityId,
  ox: number,
  oz: number,
  dx: number,
  dz: number,
  maxDistance: number,
): { id: EntityId; distance: number } | null {
  let best: { id: EntityId; distance: number } | null = null

  for (const target of vehicles) {
    if (target.id === shooter || !isAlive(target)) continue

    const t = tuningFor(target.archetype)
    const forward = forwardOf(target.yaw)

    // Against the same circle chain that car-vs-car uses, so what you can hit
    // is what you can crash into.
    for (const circle of bodyCircles(t.halfExtents.x, t.halfExtents.z)) {
      const cx = target.pos.x + forward.x * circle.offset
      const cz = target.pos.z + forward.z * circle.offset
      const distance = rayCircle(ox, oz, dx, dz, maxDistance, cx, cz, circle.radius)
      if (distance === null) continue
      if (best === null || distance < best.distance) best = { id: target.id, distance }
    }
  }

  return best
}

/** Nearest arena block a ray reaches. Scenery stops bullets. */
function traceBlocks(
  arena: Arena,
  ox: number,
  oz: number,
  dx: number,
  dz: number,
  maxDistance: number,
  y: number,
): number | null {
  let nearest: number | null = null

  for (const block of arena.blocks) {
    // A shot passing over a low crate should not clip it.
    if (y > block.pos.y + block.halfExtents.y * 2) continue

    const distance = rayRect(ox, oz, dx, dz, maxDistance, {
      x: block.pos.x,
      z: block.pos.z,
      halfX: block.halfExtents.x,
      halfZ: block.halfExtents.z,
      yaw: block.yaw,
    })
    if (distance === null) continue
    if (nearest === null || distance < nearest) nearest = distance
  }

  return nearest
}

type Pending = { total: number; by: EntityId; weapon: WeaponId; pos: Vec3 }

export type WeaponsResult = {
  readonly vehicles: Vehicle[]
  readonly projectiles: Projectile[]
  readonly events: SimEvent[]
  readonly rngState: RngState
  readonly nextProjectileId: ProjectileId
}

export function stepWeapons(
  vehicles: readonly Vehicle[],
  projectiles: readonly Projectile[],
  arena: Arena,
  inputs: Inputs,
  tick: number,
  rngState: RngState,
  nextProjectileId: ProjectileId,
  /** False during an elimination round: a wreck stays a wreck until it ends. */
  allowRespawn = true,
): WeaponsResult {
  const events: SimEvent[] = []
  const damage = new Map<EntityId, Pending>()
  const spawned: Projectile[] = []

  let rng = rngState
  let projectileId = nextProjectileId

  const roll = (): number => {
    const draw = nextRandom(rng)
    rng = draw.state
    return draw.value
  }

  const addDamage = (
    id: EntityId,
    amount: number,
    by: EntityId,
    weapon: WeaponId,
    pos: Vec3,
  ): void => {
    if (amount <= 0) return
    const existing = damage.get(id)
    if (existing === undefined) damage.set(id, { total: amount, by, weapon, pos })
    else existing.total += amount
  }

  // ── 1. cooldowns, lock, firing ─────────────────────────────────────────────
  const fired = vehicles.map((vehicle) => {
    const cooldowns: Record<WeaponId, number> = { ...vehicle.cooldowns }
    for (const id of WEAPON_IDS) cooldowns[id] = Math.max(0, cooldowns[id] - TICK_DT)

    if (!isAlive(vehicle)) {
      // A wreck holds no lock. Coming back with a missile already primed on
      // whoever killed you would be a very strange gift.
      return { ...vehicle, cooldowns, lockTarget: null, lockTime: 0, lockGrace: 0, manualTarget: false }
    }

    const input = inputs.get(vehicle.id)

    // ── weapon selection ─────────────────────────────────────────────────────
    // Resolved before the lock, because the lock only exists in missile mode.
    let selectedSpecial = vehicle.selectedSpecial
    if (input?.cycleWeapon === true) {
      const at = SPECIAL_IDS.indexOf(selectedSpecial as (typeof SPECIAL_IDS)[number])
      selectedSpecial = SPECIAL_IDS[(at + 1) % SPECIAL_IDS.length]!
    }

    // ── lock ─────────────────────────────────────────────────────────────────
    // Only while the homing missile is the selected special.
    //
    // Targeting is that weapon's mechanic, so showing a lock while you are
    // holding a rocket is a promise the rocket cannot keep — it flies where the
    // nose points and nothing else. Gating it here means the reticle appearing
    // *is* the feedback that you have switched into homing mode.
    const homing = weaponFor('homingMissile')
    const missileMode = selectedSpecial === 'homingMissile'
    const rules =
      missileMode && homing.kind === 'projectile' && homing.homing !== undefined
        ? {
            cone: homing.homing.lockCone,
            range: homing.homing.lockRange,
            aimBias: homing.homing.aimBias,
            switchMargin: homing.homing.switchMargin,
          }
        : null

    let lockTarget = vehicle.lockTarget
    let lockTime = vehicle.lockTime
    let lockGrace = vehicle.lockGrace
    let manualTarget = vehicle.manualTarget

    if (rules === null) {
      // Out of missile mode: no reticle, no progress, nothing to inherit when
      // you switch back.
      if (lockTarget !== null) events.push({ type: 'lockLost', id: vehicle.id })
      lockTarget = null
      lockTime = 0
      lockGrace = 0
      manualTarget = false
    } else if (homing.kind === 'projectile' && homing.homing !== undefined) {
      const spec = homing.homing
      const hold = {
        cone: spec.holdCone,
        range: spec.holdRange,
        aimBias: spec.aimBias,
        switchMargin: spec.switchMargin,
      }

      const current = lockTarget === null ? undefined : vehicles.find((v) => v.id === lockTarget)
      const alive = current !== undefined && isAlive(current)
      const holdable = alive && canHold(vehicle, current, arena, hold)

      // A hand-picked target is never taken away by the scoring — you chose it,
      // and it stays chosen until it is gone.
      const wanted = manualTarget && holdable
        ? lockTarget
        : retarget(vehicle, vehicles, arena, rules, holdable ? lockTarget : null)

      if (wanted !== null && wanted === lockTarget) {
        lockGrace = 0
        const before = lockTime
        lockTime += TICK_DT
        if (before < spec.lockTime && lockTime >= spec.lockTime) {
          events.push({ type: 'lockAcquired', id: vehicle.id, target: lockTarget })
        }
      } else if (wanted === null && alive && lockGrace < spec.holdGrace) {
        // Briefly out of the cone or behind a pillar. Hold the lock, but do not
        // let it progress while the target cannot be seen.
        lockGrace += TICK_DT
      } else {
        // Switched, or lost for good.
        if (lockTarget !== null) events.push({ type: 'lockLost', id: vehicle.id })
        lockTarget = wanted
        lockTime = wanted === null ? 0 : TICK_DT
        lockGrace = 0
        manualTarget = false
      }
    }

    if (input === undefined) {
      return { ...vehicle, cooldowns, selectedSpecial, lockTarget, lockTime, lockGrace, manualTarget }
    }

    // ── manual target cycling ────────────────────────────────────────────────
    // Gated on the missile being selected. Choosing a target is that weapon's
    // business, and a key that does nothing under the other two would be a key
    // you stop believing in.
    if (
      input.cycleTarget &&
      selectedSpecial === 'homingMissile' &&
      rules !== null &&
      homing.kind === 'projectile' &&
      homing.homing !== undefined
    ) {
      // Cycled over the *hold* set rather than the acquisition set: if you can
      // keep a lock on someone, you can choose them.
      const candidates = lockableTargets(vehicle, vehicles, arena, {
        cone: homing.homing.holdCone,
        range: homing.homing.holdRange,
      })

      if (candidates.length > 0) {
        const at = lockTarget === null ? -1 : candidates.indexOf(lockTarget)
        const next = candidates[(at + 1) % candidates.length]!
        if (next !== lockTarget) {
          // Switching by hand restarts the clock, exactly as switching for any
          // other reason does. Picking a new victim is not free.
          lockTarget = next
          lockTime = TICK_DT
          lockGrace = 0
        }
        manualTarget = true
      }
    }

    const ammo: Record<WeaponId, number> = { ...vehicle.ammo }
    const wants: [WeaponId, boolean][] = [
      ['machineGun', input.fire],
      [selectedSpecial, input.special],
    ]

    for (const [weaponId, held] of wants) {
      if (!held || cooldowns[weaponId] > 0 || ammo[weaponId] <= 0) continue

      const spec = weaponFor(weaponId)
      cooldowns[weaponId] = spec.fireInterval

      // A volley costs one round per barrel. Both hood guns firing at once is
      // what makes the twin mounts read as twin mounts, and a magazine that
      // only counted trigger pulls would be lying about how much you have left.
      const rounds = Math.min(spec.muzzles.length, ammo[weaponId])
      ammo[weaponId] -= rounds

      const forward = forwardOf(vehicle.yaw)

      if (spec.kind === 'hitscan') {
        for (let barrel = 0; barrel < rounds; barrel++) {
          const muzzle = muzzleOf(vehicle, spec.muzzles[barrel]!)

          // Barrels point dead ahead. Spread is zero for the machine gun, so
          // the RNG is not touched at all — drawing from it and multiplying by
          // zero would still advance the stream and change every later replay.
          const aim =
            spec.spread > 0 ? forwardOf(vehicle.yaw + (roll() * 2 - 1) * spec.spread) : forward

          events.push({
            type: 'weaponFired',
            id: vehicle.id,
            weapon: weaponId,
            pos: muzzle,
            dir: aim,
          })

          const onCar = traceVehicles(
            vehicles,
            vehicle.id,
            muzzle.x,
            muzzle.z,
            aim.x,
            aim.z,
            spec.range,
          )
          const onBlock = traceBlocks(
            arena,
            muzzle.x,
            muzzle.z,
            aim.x,
            aim.z,
            spec.range,
            muzzle.y,
          )

          // Scenery in front of a car saves it.
          const blocked = onBlock !== null && (onCar === null || onBlock < onCar.distance)
          const distance = blocked ? onBlock : (onCar?.distance ?? spec.range)
          const struck = blocked ? null : (onCar?.id ?? null)

          const to = {
            x: muzzle.x + aim.x * distance,
            y: muzzle.y,
            z: muzzle.z + aim.z * distance,
          }

          events.push({
            type: 'tracer',
            id: vehicle.id,
            weapon: weaponId,
            from: muzzle,
            to,
            hit: struck,
          })
          if (struck !== null) addDamage(struck, spec.damage, vehicle.id, weaponId, to)
        }
      } else if (spec.kind === 'mine') {
        const muzzle = muzzleOf(vehicle, spec.muzzles[0]!)
        events.push({
          type: 'weaponFired',
          id: vehicle.id,
          weapon: weaponId,
          pos: muzzle,
          dir: { x: -forward.x, y: 0, z: -forward.z },
        })

        spawned.push({
          id: projectileId++,
          owner: vehicle.id,
          weapon: weaponId,
          pos: { x: muzzle.x, y: arena.groundY + 0.2, z: muzzle.z },
          // Laid, not thrown. It stays exactly where it was dropped.
          vel: { x: 0, y: 0, z: 0 },
          target: null,
          armsAt: tick + Math.round(spec.armDelay / TICK_DT),
          expiresAt: tick + Math.round(spec.lifetime / TICK_DT),
        })
      } else {
        const muzzle = muzzleOf(vehicle, spec.muzzles[0]!)
        events.push({
          type: 'weaponFired',
          id: vehicle.id,
          weapon: weaponId,
          pos: muzzle,
          dir: forward,
        })

        // A homing missile homes. Always.
        //
        // It used to go dumb unless the lock had completed, which sounds like a
        // fair cost until you measure it: over 25 seconds of ordinary driving
        // the lock completed 0% of the time, so in practice every missile ever
        // fired came out as a worse version of the rocket — a weapon that
        // already exists. A weapon whose name is a promise has to keep it.
        //
        // The lock still does real work. It picks *who* (rather than whatever
        // happens to be nearest at launch), it holds that choice through a
        // corner, and it warns the target with a ring closing on them. What it
        // no longer does is decide whether the thing homes at all.
        let seeker = spec.homing !== undefined && lockTarget !== null ? lockTarget : null

        if (spec.homing !== undefined && seeker === null) {
          // Nothing locked: take whatever is in front of the launcher.
          seeker = selectTarget(vehicle, vehicles, arena, {
            cone: spec.homing.holdCone,
            range: spec.homing.holdRange,
          })
        }

        spawned.push({
          id: projectileId++,
          owner: vehicle.id,
          weapon: weaponId,
          pos: muzzle,
          // Inherits the car's velocity: firing while reversing must not leave
          // the rocket hanging in front of you.
          vel: {
            x: vehicle.vel.x + forward.x * spec.speed,
            y: spec.launchLift,
            z: vehicle.vel.z + forward.z * spec.speed,
          },
          target: seeker,
          armsAt: tick,
          expiresAt: tick + Math.round(spec.lifetime / TICK_DT),
        })
      }
    }

    return {
      ...vehicle,
      ammo,
      cooldowns,
      selectedSpecial,
      lockTarget,
      lockTime,
      lockGrace,
      manualTarget,
    }
  })

  // ── 2. projectiles ─────────────────────────────────────────────────────────
  const surviving: Projectile[] = []

  for (const projectile of [...projectiles, ...spawned]) {
    const spec = weaponFor(projectile.weapon)

    // ── mines ────────────────────────────────────────────────────────────────
    if (spec.kind === 'mine') {
      const armed = tick >= projectile.armsAt
      if (tick === projectile.armsAt) {
        events.push({ type: 'mineArmed', id: projectile.id, pos: projectile.pos })
      }

      let triggeredBy: EntityId | null = null
      if (armed) {
        for (const target of fired) {
          if (!isAlive(target)) continue
          const distance = Math.hypot(
            target.pos.x - projectile.pos.x,
            target.pos.z - projectile.pos.z,
          )
          // Once armed it does not care who laid it. Reversing over your own is
          // a mistake the weapon is allowed to punish.
          if (distance <= spec.triggerRadius) {
            triggeredBy = target.id
            break
          }
        }
      }

      if (triggeredBy === null && tick < projectile.expiresAt) {
        surviving.push(projectile)
        continue
      }

      if (triggeredBy !== null) {
        events.push({ type: 'explosion', pos: projectile.pos, radius: spec.blastRadius })
        for (const target of fired) {
          if (!isAlive(target)) continue
          const distance = Math.hypot(
            target.pos.x - projectile.pos.x,
            target.pos.z - projectile.pos.z,
          )
          if (distance >= spec.blastRadius) continue
          addDamage(
            target.id,
            spec.blastDamage * (1 - distance / spec.blastRadius),
            projectile.owner,
            projectile.weapon,
            projectile.pos,
          )
        }
      }
      // Expired without being touched: it just stops existing, no blast.
      continue
    }

    if (spec.kind !== 'projectile') continue

    // ── homing ───────────────────────────────────────────────────────────────
    // Steering is a bounded turn of the heading, not a redirect of the velocity
    // vector. A missile that simply points at its target every tick is
    // undodgeable, and undodgeable is the failure mode PLAN.md's "fair to be
    // hit by" is warning about.
    let steered = projectile.vel
    if (spec.homing !== undefined && projectile.target !== null) {
      const target = fired.find((v) => v.id === projectile.target)
      if (target !== undefined && isAlive(target)) {
        const heading = headingOf(projectile.vel.x, projectile.vel.z)
        const desired = headingOf(target.pos.x - projectile.pos.x, target.pos.z - projectile.pos.z)
        const maxTurn = spec.homing.turnRate * TICK_DT
        const turned = wrapAngle(
          heading + clamp(angleDelta(heading, desired), -maxTurn, maxTurn),
        )

        const aim = forwardOf(turned)
        // Climb or dive toward the target, bounded the same way.
        const rise = clamp(
          (target.pos.y + 0.4 - projectile.pos.y) * 2,
          -spec.speed * 0.35,
          spec.speed * 0.35,
        )
        steered = { x: aim.x * spec.speed, y: rise, z: aim.z * spec.speed }
      }
    }

    const vel = {
      x: steered.x,
      y: steered.y - spec.gravity * TICK_DT,
      z: steered.z,
    }
    const pos = {
      x: projectile.pos.x + vel.x * TICK_DT,
      y: projectile.pos.y + vel.y * TICK_DT,
      z: projectile.pos.z + vel.z * TICK_DT,
    }

    // Swept along the step, so a 62 m/s rocket cannot skip through a car.
    const travelX = pos.x - projectile.pos.x
    const travelZ = pos.z - projectile.pos.z
    const travel = Math.hypot(travelX, travelZ)

    let detonateAt: Vec3Out | null = null
    let directHit: EntityId | null = null

    if (travel > 1e-6) {
      const dx = travelX / travel
      const dz = travelZ / travel

      const onCar = traceVehicles(
        fired,
        projectile.owner,
        projectile.pos.x,
        projectile.pos.z,
        dx,
        dz,
        travel,
      )
      const onBlock = traceBlocks(
        arena,
        projectile.pos.x,
        projectile.pos.z,
        dx,
        dz,
        travel,
        projectile.pos.y,
      )

      const blocked = onBlock !== null && (onCar === null || onBlock < onCar.distance)
      if (blocked) {
        detonateAt = {
          x: projectile.pos.x + dx * onBlock,
          y: pos.y,
          z: projectile.pos.z + dz * onBlock,
        }
      } else if (onCar !== null) {
        directHit = onCar.id
        detonateAt = {
          x: projectile.pos.x + dx * onCar.distance,
          y: pos.y,
          z: projectile.pos.z + dz * onCar.distance,
        }
      }
    }

    if (detonateAt === null && pos.y <= arena.groundY) {
      detonateAt = { x: pos.x, y: arena.groundY, z: pos.z }
    }
    if (detonateAt === null && tick >= projectile.expiresAt) {
      detonateAt = pos
    }
    // Outside the arena is a detonation too, not a projectile that lives forever.
    if (
      detonateAt === null &&
      (Math.abs(pos.x) > arena.halfExtents.x || Math.abs(pos.z) > arena.halfExtents.z)
    ) {
      detonateAt = pos
    }

    if (detonateAt === null) {
      // A missile whose target died goes dumb rather than chasing a wreck.
      const target =
        projectile.target !== null && fired.some((v) => v.id === projectile.target && isAlive(v))
          ? projectile.target
          : null
      surviving.push({ ...projectile, pos, vel, target })
      continue
    }

    events.push({ type: 'explosion', pos: detonateAt, radius: spec.blastRadius })

    if (directHit !== null) {
      addDamage(directHit, spec.damage, projectile.owner, projectile.weapon, detonateAt)
    }

    // Blast reaches everyone, including whoever fired it. Rocketing a car you
    // are two metres behind should hurt.
    for (const target of fired) {
      if (!isAlive(target)) continue
      const distance = Math.hypot(target.pos.x - detonateAt.x, target.pos.z - detonateAt.z)
      if (distance >= spec.blastRadius) continue
      const falloff = 1 - distance / spec.blastRadius
      addDamage(
        target.id,
        spec.blastDamage * falloff,
        projectile.owner,
        projectile.weapon,
        detonateAt,
      )
    }
  }

  // ── 3. damage, destruction, respawn ────────────────────────────────────────
  const resolved = fired.map((vehicle) => {
    const tuning = tuningFor(vehicle.archetype)

    if (!isAlive(vehicle)) {
      if (allowRespawn && vehicle.respawnAt !== null && tick >= vehicle.respawnAt) {
        // Its own ceiling, not the archetype's: a tough opponent stays tough
        // after it comes back.
        const fresh = spawnVehicle(vehicle.id, arena, vehicle.archetype, vehicle.maxHealth)
        events.push({ type: 'vehicleRespawned', id: vehicle.id, pos: fresh.pos })
        return fresh
      }
      return vehicle
    }

    const pending = damage.get(vehicle.id)
    if (pending === undefined) return vehicle

    const health = vehicle.health - pending.total
    events.push({
      type: 'damaged',
      id: vehicle.id,
      by: pending.by,
      weapon: pending.weapon,
      pos: pending.pos,
      amount: pending.total,
    })

    if (health > 0) return { ...vehicle, health }

    events.push({
      type: 'vehicleDestroyed',
      id: vehicle.id,
      by: pending.by === vehicle.id ? null : pending.by,
      pos: vehicle.pos,
    })

    return {
      ...vehicle,
      health: 0,
      // Frozen where it died, and skipped by every other system until it comes
      // back. `vel` is zeroed so a wreck does not coast away.
      vel: { x: 0, y: 0, z: 0 },
      yawRate: 0,
      // `null` under elimination rules: nothing is scheduled, so nothing can
      // bring it back before the round is over.
      respawnAt: allowRespawn ? tick + Math.round(tuning.respawnDelay / TICK_DT) : null,
    }
  })

  return {
    vehicles: resolved,
    projectiles: surviving,
    events,
    rngState: rng,
    nextProjectileId: projectileId,
  }
}
