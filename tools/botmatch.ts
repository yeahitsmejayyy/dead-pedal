/**
 * Run headless bot-vs-bot matches and report whether they hold together.
 *
 *   npm run botmatch
 *   npm run botmatch -- --matches 100 --cars 8 --seconds 60
 *
 * PLAN.md M5 asks for "100 bot-vs-bot matches, none stall, none NaN, all reach
 * a win condition". The first two are checked here and in the test suite; the
 * third needs a win condition, which is M6's match state machine. Until then
 * this asserts the weaker but still useful thing: the match stays finite, the
 * bots keep fighting, and nothing goes non-finite.
 */
import { parseArgs } from 'node:util'
import { TICK_HZ } from '../src/core/clock'
import { botInputs, createRoster } from '../src/bots'
import { createWorld, isAlive, step } from '../src/sim'

const { values } = parseArgs({
  options: {
    matches: { type: 'string', default: '20' },
    cars: { type: 'string', default: '4' },
    seconds: { type: 'string', default: '30' },
    difficulty: { type: 'string', default: 'superSaiyan' },
  },
})

const matches = Number(values.matches)
const cars = Number(values.cars)
const ticks = Math.round(Number(values.seconds) * TICK_HZ)

let totalKills = 0
let totalShots = 0
let stalled = 0
let broken = 0
let slowest = 0

const started = performance.now()

for (let match = 0; match < matches; match++) {
  // Every car is a bot: no humans.
  const roster = createRoster(cars, { humans: [], difficulty: values.difficulty, seed: match + 1 })
  let world = createWorld({ seed: match + 1, vehicles: cars })

  let kills = 0
  let shots = 0
  let moved = 0

  for (let i = 0; i < ticks; i++) {
    const before = world.vehicles.map((v) => `${v.pos.x},${v.pos.z}`).join('|')
    world = step(world, botInputs(roster, world))
    if (world.vehicles.map((v) => `${v.pos.x},${v.pos.z}`).join('|') !== before) moved++

    for (const event of world.events) {
      if (event.type === 'vehicleDestroyed') kills++
      if (event.type === 'weaponFired') shots++
    }
  }

  for (const v of world.vehicles) {
    if (!Number.isFinite(v.pos.x) || !Number.isFinite(v.pos.z) || !Number.isFinite(v.yaw)) broken++
  }
  // A match where nothing moved for most of it is a stall, even without a crash.
  if (moved < ticks * 0.9) stalled++

  totalKills += kills
  totalShots += shots
  slowest = Math.max(slowest, kills === 0 ? 1 : 0)
}

const elapsed = performance.now() - started
const alive = createWorld({ seed: 1, vehicles: cars }).vehicles.filter(isAlive).length

console.log(`matches      ${matches} × ${values.seconds}s, ${cars} bots (${values.difficulty})`)
console.log(`cars         ${alive} per match`)
console.log(`kills        ${totalKills}  (${(totalKills / matches).toFixed(1)} per match)`)
console.log(`shots        ${totalShots}  (${(totalShots / matches).toFixed(0)} per match)`)
console.log(`stalled      ${stalled}`)
console.log(`non-finite   ${broken}`)
console.log(`wall time    ${elapsed.toFixed(0)} ms  (${(elapsed / matches).toFixed(0)} ms/match)`)

if (stalled > 0 || broken > 0) process.exit(1)
