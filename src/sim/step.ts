import { TICK_DT } from '../core/clock'
import { tuningFor } from '../content/vehicles'
import { resolveArena } from './arena'
import { resolveVehiclePairs } from './contact'
import { stepPickups } from './pickups'
import {
  NEUTRAL_INPUT,
  isAlive,
  type Inputs,
  type SimEvent,
  type Vehicle,
  type WorldState,
} from './types'
import { integrateVehicle } from './vehicle'
import { stepWeapons } from './weapons'
import { acceptsInput, allowsRespawn, stepMatch } from './match'
import { NO_EVENTS, NO_PROJECTILES, initialPickups, spawnVehicle } from './world'

/**
 * The whole game, in one signature.
 *
 * Contract: pure with respect to the outside world. Same world + same inputs =
 * same output, forever. No wall clock, no `Math.random`, no DOM, no `three` —
 * enforced by lint and by a second tsc pass, not by memory.
 *
 * `dt` is deliberately absent: it is fixed at `TICK_DT` and a parameter would
 * invite someone to pass a variable one.
 */
const NO_INPUT: Inputs = new Map()

export function step(world: WorldState, inputs: Inputs): WorldState {
  const events: SimEvent[] = []

  // Cars are frozen outside a live round. Handing the systems an empty input
  // map rather than skipping them keeps physics running — a car still coasts to
  // a stop and settles during a countdown, it just stops taking orders.
  const live = acceptsInput(world.match)
  const orders = live ? inputs : NO_INPUT

  // Four phases, in this order and never interleaved. Resolving car 0 against a
  // wall before car 1 has moved would make the outcome depend on array order,
  // and firing before everyone has moved would shoot at stale positions.
  const moved: Vehicle[] = []
  for (const vehicle of world.vehicles) {
    // A wreck takes no input and runs no physics until it respawns.
    if (!isAlive(vehicle)) {
      moved.push(vehicle)
      continue
    }
    const input = orders.get(vehicle.id) ?? NEUTRAL_INPUT
    const result = integrateVehicle(vehicle, input, world.arena, TICK_DT)
    moved.push(result.vehicle)
    events.push(...result.events)
  }

  const grounded: Vehicle[] = []
  for (const vehicle of moved) {
    if (!isAlive(vehicle)) {
      grounded.push(vehicle)
      continue
    }
    const result = resolveArena(vehicle, world.arena, tuningFor(vehicle.archetype))
    grounded.push(result.vehicle)
    events.push(...result.events)
  }

  const settled = resolveVehiclePairs(grounded.filter(isAlive))
  events.push(...settled.events)

  // Put the wrecks back where they were in the array, so ids keep their slots.
  const byId = new Map(settled.vehicles.map((v) => [v.id, v]))
  const standing = grounded.map((v) => byId.get(v.id) ?? v)

  const armed = stepWeapons(
    standing,
    world.projectiles,
    world.arena,
    orders,
    world.tick + 1,
    world.rngState,
    world.nextProjectileId,
    allowsRespawn(world.match, world.rules),
  )
  events.push(...armed.events)

  // Last, so a car that drove onto a crate this tick has already finished
  // moving and cannot be handed ammo it then immediately fires from a stale
  // position.
  const stocked = stepPickups(armed.vehicles, world.pickups, world.tick + 1)
  events.push(...stocked.events)

  // Last, so "is anyone left standing" is asked of the world as it now is,
  // rather than as it was before this tick's damage landed.
  const decided = stepMatch(world.match, world.rules, stocked.vehicles, events)
  events.push(...decided.events)

  const fresh = decided.resetArena

  return {
    tick: world.tick + 1,
    rngState: armed.rngState,
    arena: world.arena,
    rules: world.rules,
    match: decided.match,
    vehicles: fresh
      ? stocked.vehicles.map((v) => spawnVehicle(v.id, world.arena, v.archetype, v.maxHealth))
      : stocked.vehicles,
    projectiles: fresh ? NO_PROJECTILES : armed.projectiles,
    pickups: fresh ? initialPickups(world.arena) : stocked.pickups,
    nextProjectileId: armed.nextProjectileId,
    events: events.length > 0 ? events : NO_EVENTS,
  }
}

/** Convenience for headless runs: step `count` times from one world. */
export function stepMany(world: WorldState, inputs: Inputs, count: number): WorldState {
  let next = world
  for (let i = 0; i < count; i++) next = step(next, inputs)
  return next
}

/**
 * Step with inputs that change over time — a replay, a scripted test, a bot.
 * `source` is called once per tick with the absolute tick number.
 */
export function stepScripted(
  world: WorldState,
  source: (tick: number) => Inputs,
  count: number,
): WorldState {
  let next = world
  for (let i = 0; i < count; i++) next = step(next, source(next.tick))
  return next
}
