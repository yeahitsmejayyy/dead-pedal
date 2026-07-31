/**
 * L1 — weapon crates: collection and respawn.
 *
 * Deliberately the dullest system in the sim. A pickup is a position, a weapon
 * and a tick it comes back on; picking one up refills that weapon to full and
 * starts the timer. There is no partial refill and no carrying capacity,
 * because both are decisions that belong to M6's match rules and neither would
 * survive contact with them.
 */
import { TICK_DT } from '../core/clock'
import { weaponFor, type WeaponId } from '../content/weapons'
import { isAlive, type Pickup, type SimEvent, type Vehicle } from './types'

/** How close a car has to get. Generous — chasing a crate is not the game. */
export const PICKUP_RADIUS = 4
/** Seconds before a taken crate returns. */
export const PICKUP_RESPAWN = 12

/** Health restored by a health crate. */
export const HEALTH_AMOUNT = 60
/** Health an armour crate gives, and how far past your ceiling it can push. */
export const ARMOUR_AMOUNT = 70
/**
 * Armour can carry you to 1.5× your own maximum.
 *
 * That overcharge is the whole reason to cross the arena for one when you are
 * already healthy — a crate that does nothing at full health is a crate you
 * learn to ignore.
 */
export const ARMOUR_CEILING = 1.5

/** What a car would gain from this crate, or 0 if it has no use for it. */
function valueOf(vehicle: Vehicle, pickup: Pickup): number {
  if (pickup.kind === 'weapon') {
    const weapon = pickup.weapon
    if (weapon === null) return 0
    return Math.max(0, weaponFor(weapon).capacity - vehicle.ammo[weapon])
  }

  const ceiling =
    pickup.kind === 'armour' ? vehicle.maxHealth * ARMOUR_CEILING : vehicle.maxHealth
  return Math.max(0, Math.min(ceiling, vehicle.health + amountOf(pickup)) - vehicle.health)
}

function amountOf(pickup: Pickup): number {
  return pickup.kind === 'armour' ? ARMOUR_AMOUNT : HEALTH_AMOUNT
}

export function stepPickups(
  vehicles: readonly Vehicle[],
  pickups: readonly Pickup[],
  tick: number,
): { vehicles: Vehicle[]; pickups: Pickup[]; events: SimEvent[] } {
  const events: SimEvent[] = []
  const refills = new Map<number, WeaponId[]>()
  const healing = new Map<number, number>()

  const nextPickups = pickups.map((pickup) => {
    if (tick < pickup.availableAt) return pickup

    for (const vehicle of vehicles) {
      if (!isAlive(vehicle)) continue

      const distance = Math.hypot(vehicle.pos.x - pickup.pos.x, vehicle.pos.z - pickup.pos.z)
      if (distance > PICKUP_RADIUS) continue

      // Nothing to gain: leave the crate for someone who needs it rather than
      // burning it on a car that is already full.
      if (valueOf(vehicle, pickup) <= 0) continue

      if (pickup.kind === 'weapon' && pickup.weapon !== null) {
        const taken = refills.get(vehicle.id) ?? []
        taken.push(pickup.weapon)
        refills.set(vehicle.id, taken)
      } else {
        healing.set(vehicle.id, (healing.get(vehicle.id) ?? 0) + amountOf(pickup))
      }

      events.push({
        type: 'pickedUp',
        id: vehicle.id,
        pickup: pickup.id,
        kind: pickup.kind,
        weapon: pickup.weapon,
        pos: pickup.pos,
      })

      return { ...pickup, availableAt: tick + Math.round(PICKUP_RESPAWN / TICK_DT) }
    }

    return pickup
  })

  const nextVehicles = vehicles.map((vehicle) => {
    const taken = refills.get(vehicle.id)
    const gained = healing.get(vehicle.id)
    if (taken === undefined && gained === undefined) return vehicle

    const ammo = { ...vehicle.ammo }
    if (taken !== undefined) for (const weapon of taken) ammo[weapon] = weaponFor(weapon).capacity

    // Armour is the only thing that can put a car over its own ceiling, so the
    // clamp is the armour cap rather than `maxHealth`.
    const health =
      gained === undefined
        ? vehicle.health
        : Math.min(vehicle.maxHealth * ARMOUR_CEILING, vehicle.health + gained)

    return { ...vehicle, ammo, health }
  })

  return { vehicles: nextVehicles, pickups: nextPickups, events }
}
