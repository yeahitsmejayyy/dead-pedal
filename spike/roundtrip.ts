/**
 * SPIKE — throwaway. Answers "what in WorldState does not survive JSON".
 *
 * Uses the project's own canonical hash: if the hash of a world equals the hash
 * of that world after JSON.parse(JSON.stringify(...)), nothing was lost that
 * the sim considers part of its state.
 */
import { hashState } from '../src/core/hash'
import { createWorld, step, type Inputs, type WorldState } from '../src/sim'
import { DEATHMATCH } from '../src/content/match'

const world0 = createWorld({ seed: 1, vehicles: 2, health: () => 200, rules: DEATHMATCH })

// Drive it a while so the world has projectiles, events and pickups in flight —
// an empty world round-trips trivially and would prove nothing.
let world: WorldState = world0
let richest: WorldState = world0
for (let i = 0; i < 900; i++) {
  const inputs: Inputs = new Map([
    [0, { tick: world.tick, throttle: 1, steer: 0.3, handbrake: false, fire: true, special: i % 90 === 0, cycleWeapon: false, cycleTarget: false, lookBack: false }],
    [1, { tick: world.tick, throttle: -0.5, steer: -0.2, handbrake: false, fire: true, special: false, cycleWeapon: false, cycleTarget: false, lookBack: false }],
  ])
  world = step(world, inputs)
  // Keep the busiest world seen: the one with the most in flight plus events,
  // because an empty world round-trips trivially and proves nothing.
  if (world.projectiles.length + world.events.length >
      richest.projectiles.length + richest.events.length) {
    richest = world
  }
}
world = richest

const json = JSON.stringify(world)
const back = JSON.parse(json) as WorldState

console.log('projectiles in flight:', world.projectiles.length)
console.log('events this tick:', world.events.length)
console.log('snapshot bytes:', json.length)
console.log('hash before:', hashState(world))
console.log('hash after :', hashState(back))
console.log('identical  :', hashState(world) === hashState(back))

// Stepping both forward must also agree, or the loss is latent rather than absent.
const nextInputs: Inputs = new Map([
  [0, { tick: world.tick, throttle: 1, steer: 0, handbrake: false, fire: true, special: false, cycleWeapon: false, cycleTarget: false, lookBack: false }],
  [1, { tick: world.tick, throttle: 1, steer: 0, handbrake: false, fire: false, special: false, cycleWeapon: false, cycleTarget: false, lookBack: false }],
])
const a = hashState(step(world, nextInputs))
const b = hashState(step(back, nextInputs))
console.log('after one more step, identical:', a === b)

// Where the usual JSON losses would show up, checked explicitly.
const problems: string[] = []
const scan = (value: unknown, path: string): void => {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) problems.push(`${path} is ${value}`)
    if (Object.is(value, -0)) problems.push(`${path} is -0 (JSON makes it 0)`)
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => scan(v, `${path}[${i}]`))
  } else if (value instanceof Map || value instanceof Set) {
    problems.push(`${path} is a ${value.constructor.name} (JSON drops it)`)
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) problems.push(`${path}.${k} is undefined (JSON drops the key)`)
      scan(v, `${path}.${k}`)
    }
  }
}
scan(world, 'world')
console.log('structural problems:', problems.length === 0 ? 'none' : problems.slice(0, 10))
