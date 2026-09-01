/** SPIKE — throwaway. Where do the snapshot bytes actually go? */
import { createWorld, step, type Inputs, type WorldState } from '../src/sim'
import { DEATHMATCH } from '../src/content/match'

let world: WorldState = createWorld({ seed: 1, vehicles: 2, health: () => 200, rules: DEATHMATCH })
for (let i = 0; i < 300; i++) {
  const inputs: Inputs = new Map([
    [0, { tick: world.tick, throttle: 1, steer: 0.3, handbrake: false, fire: true, special: i % 90 === 0, cycleWeapon: false, cycleTarget: false, lookBack: false }],
    [1, { tick: world.tick, throttle: 1, steer: -0.2, handbrake: false, fire: true, special: false, cycleWeapon: false, cycleTarget: false, lookBack: false }],
  ])
  world = step(world, inputs)
}

const total = JSON.stringify(world).length
const part = (k: keyof WorldState): number => JSON.stringify(world[k]).length
const rows: Array<[string, number]> = [
  ['arena', part('arena')],
  ['pickups', part('pickups')],
  ['vehicles', part('vehicles')],
  ['rules', part('rules')],
  ['match', part('match')],
  ['projectiles', part('projectiles')],
  ['events', part('events')],
]
rows.sort((a, b) => b[1] - a[1])

console.log(`total snapshot: ${total} B\n`)
for (const [name, bytes] of rows) {
  console.log(`${name.padEnd(12)} ${String(bytes).padStart(5)} B  ${((bytes / total) * 100).toFixed(1).padStart(5)}%`)
}

const static_ = part('arena') + part('rules')
console.log(`\nnever changes after the first tick: ${static_} B (${((static_ / total) * 100).toFixed(1)}%)`)
console.log(`at 60Hz that is ${((static_ * 60) / 1024).toFixed(0)} KB/s per client of pure repetition`)
console.log(`\nbandwidth per client, as measured:`)
for (const hz of [60, 30, 20, 10]) {
  console.log(`  ${String(hz).padStart(2)}Hz full snapshots: ${((total * hz) / 1024).toFixed(0)} KB/s  (${(((total * hz * 8) / 1_000_000)).toFixed(1)} Mbit/s)`)
}
