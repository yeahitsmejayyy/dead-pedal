/**
 * M5's bot tests, from PLAN.md §4:
 *
 *   - Headless: 100 bot-vs-bot matches, none stall, none NaN, all reach a win
 *     condition
 *   - Perf: eight bots' decision cost measured per tick and budgeted
 *
 * The win condition is the one part that cannot land yet — the match state
 * machine is M6 — so the soak asserts the strongest thing available today: the
 * match stays finite, the bots keep fighting, and nothing goes non-finite. The
 * `it.todo` at the bottom holds the gap open rather than letting it be
 * forgotten.
 */
import { describe, expect, it } from 'vitest'
import { TICK_HZ } from '../../src/core/clock'
import * as V from '../../src/core/vec3'
import { DIFFICULTIES, DIFFICULTY_ORDER } from '../../src/content/bots'
import { Bot, botInputs, createRoster, rosterHealth } from '../../src/bots'
import { VEHICLES } from '../../src/content/vehicles'
import {
  NEUTRAL_INPUT,
  createWorld,
  step,
  type Inputs,
  type WorldState,
} from '../../src/sim'

const SECONDS = 30
const TICKS = SECONDS * TICK_HZ

type MatchResult = {
  world: WorldState
  kills: number
  shots: number
  movedTicks: number
  worstSpeed: number
}

function playMatch(seed: number, cars: number, difficulty = 'superSaiyan', ticks = TICKS): MatchResult {
  const roster = createRoster(cars, { humans: [], difficulty, seed })
  // Health comes from the roster, exactly as the game wires it. Without this a
  // "difficulty" match runs every tier at the same durability, which is half
  // the thing being tested.
  let world = createWorld({
    seed,
    vehicles: cars,
    health: rosterHealth(roster, VEHICLES.roadster!.maxHealth),
  })

  let kills = 0
  let shots = 0
  let movedTicks = 0
  let worstSpeed = 0

  for (let i = 0; i < ticks; i++) {
    const before = world.vehicles.map((v) => `${v.pos.x},${v.pos.z}`).join('|')
    world = step(world, botInputs(roster, world))
    if (world.vehicles.map((v) => `${v.pos.x},${v.pos.z}`).join('|') !== before) movedTicks++

    for (const event of world.events) {
      if (event.type === 'vehicleDestroyed') kills++
      if (event.type === 'weaponFired') shots++
    }
    for (const v of world.vehicles) worstSpeed = Math.max(worstSpeed, V.length(v.vel))
  }

  return { world, kills, shots, movedTicks, worstSpeed }
}

describe('the bot contract', () => {
  it('produces an InputFrame and nothing else', () => {
    // PLAN.md M5: "No bot may touch WorldState directly." The world handed in
    // has to come back untouched — this is the property that makes a bot
    // interchangeable with a human and, later, with the network.
    const world = createWorld({ seed: 1, vehicles: 3 })
    const before = JSON.stringify(world)

    const bot = new Bot(1, DIFFICULTIES.superSaiyan!, 1)
    const frame = bot.think(world, world.tick)

    expect(JSON.stringify(world), 'a bot mutated the world').toBe(before)
    expect(Object.keys(frame).sort()).toEqual(Object.keys(NEUTRAL_INPUT).sort())
  })

  it('keeps every axis inside its legal range', () => {
    const roster = createRoster(6, { humans: [] })
    let world = createWorld({ seed: 3, vehicles: 6 })

    for (let i = 0; i < 12 * TICK_HZ; i++) {
      const inputs = botInputs(roster, world)
      for (const [, frame] of inputs) {
        expect(frame.throttle).toBeGreaterThanOrEqual(-1)
        expect(frame.throttle).toBeLessThanOrEqual(1)
        expect(frame.steer).toBeGreaterThanOrEqual(-1)
        expect(frame.steer).toBeLessThanOrEqual(1)
        expect(Number.isFinite(frame.throttle)).toBe(true)
        expect(Number.isFinite(frame.steer)).toBe(true)
      }
      world = step(world, inputs)
    }
  })

  it('is silent while dead', () => {
    const world = createWorld({ seed: 1, vehicles: 2 })
    const dead: WorldState = {
      ...world,
      vehicles: world.vehicles.map((v) => (v.id === 1 ? { ...v, health: 0 } : v)),
    }

    const frame = new Bot(1, DIFFICULTIES.ultraInstinct!, 1).think(dead, dead.tick)
    expect(frame).toEqual({ ...NEUTRAL_INPUT, tick: dead.tick })
  })

  it('leaves the human alone', () => {
    // Car 0 is the player by default: no bot should be generated for it.
    const roster = createRoster(4)
    expect(roster.map((b) => b.id)).toEqual([1, 2, 3])

    const world = createWorld({ seed: 1, vehicles: 4 })
    expect([...botInputs(roster, world).keys()].sort()).toEqual([1, 2, 3])
  })

  it('lets a human frame win over a bot with the same id', () => {
    const roster = createRoster(2, { humans: [] })
    const world = createWorld({ seed: 1, vehicles: 2 })
    const mine = { ...NEUTRAL_INPUT, tick: world.tick, throttle: -1 }

    const merged = botInputs(roster, world, new Map([[1, mine]]))
    expect(merged.get(1)).toEqual(mine)
  })

  it('is deterministic for a given seed', () => {
    const a = playMatch(9, 4, 'superSaiyan', 5 * TICK_HZ)
    const b = playMatch(9, 4, 'superSaiyan', 5 * TICK_HZ)
    expect(JSON.stringify(a.world)).toBe(JSON.stringify(b.world))
  })

  it('gives different bots different luck', () => {
    // One shared RNG stream would have eight bots miss in the same direction
    // on the same tick, which reads as a formation rather than a fight.
    const world = createWorld({ seed: 1, vehicles: 4 })
    const one = new Bot(1, DIFFICULTIES.baseForm!, 1)
    const two = new Bot(2, DIFFICULTIES.baseForm!, 1)

    const framesOne: number[] = []
    const framesTwo: number[] = []
    for (let i = 0; i < 200; i++) {
      framesOne.push(one.think(world, i).steer)
      framesTwo.push(two.think(world, i).steer)
    }
    expect(framesOne).not.toEqual(framesTwo)
  })
})

describe('bot behaviour', () => {
  it('drives at a distant enemy rather than sitting still', () => {
    const world = createWorld({ seed: 1, vehicles: 2 })
    const roster = createRoster(2, { humans: [0] })

    let current = world
    for (let i = 0; i < 4 * TICK_HZ; i++) current = step(current, botInputs(roster, current))

    const bot = current.vehicles.find((v) => v.id === 1)!
    const start = world.vehicles.find((v) => v.id === 1)!
    expect(Math.hypot(bot.pos.x - start.pos.x, bot.pos.z - start.pos.z)).toBeGreaterThan(15)
  })

  it('breaks off when badly hurt', () => {
    const base = createWorld({ seed: 1, vehicles: 2 })
    const hurt: WorldState = {
      ...base,
      vehicles: base.vehicles.map((v) => (v.id === 1 ? { ...v, health: 5 } : v)),
    }

    const bot = new Bot(1, DIFFICULTIES.superSaiyan!, 1)
    bot.think(hurt, hurt.tick)
    expect(bot.state).toBe('flee')
  })

  it('goes for a crate when it is short of ammo', () => {
    const base = createWorld({ seed: 1, vehicles: 1 })
    const dry: WorldState = {
      ...base,
      vehicles: base.vehicles.map((v) => ({
        ...v,
        id: 1,
        ammo: { machineGun: 0, rocket: 0, homingMissile: 0, mine: 0 },
      })),
    }

    const bot = new Bot(1, DIFFICULTIES.superSaiyan!, 1)
    bot.think(dry, dry.tick)
    expect(bot.state).toBe('collect')
  })

  it('actually restocks, rather than merely intending to', () => {
    const base = createWorld({ seed: 1, vehicles: 1 })
    const dry: WorldState = {
      ...base,
      vehicles: base.vehicles.map((v) => ({
        ...v,
        ammo: { machineGun: 0, rocket: 0, homingMissile: 0, mine: 0 },
      })),
    }

    const roster = createRoster(1, { humans: [] })
    let world = dry
    for (let i = 0; i < 20 * TICK_HZ; i++) world = step(world, botInputs(roster, world))

    const total = Object.values(world.vehicles[0]!.ammo).reduce((a, b) => a + b, 0)
    expect(total, 'the bot never reached a crate').toBeGreaterThan(0)
  })

  it('exposes exactly the three named tiers, weakest first', () => {
    expect([...DIFFICULTY_ORDER]).toEqual(['baseForm', 'superSaiyan', 'ultraInstinct'])
    expect(DIFFICULTY_ORDER.map((k) => DIFFICULTIES[k]!.label)).toEqual([
      'Base Form',
      'Super Saiyan',
      'Ultra Instinct',
    ])
    // Every tier in the order actually exists, and nothing exists outside it.
    expect(Object.keys(DIFFICULTIES).sort()).toEqual([...DIFFICULTY_ORDER].sort())
  })

  it('makes every lever monotonic across the ladder', () => {
    // Difficulty is data, so the ladder is checkable as data. A tier that is
    // faster to react but also worse at aiming is a tier nobody can reason
    // about, and this catches it the moment someone tweaks one number.
    const tiers = DIFFICULTY_ORDER.map((k) => DIFFICULTIES[k]!)

    for (let i = 1; i < tiers.length; i++) {
      const worse = tiers[i - 1]!
      const better = tiers[i]!
      const at = `${worse.label} -> ${better.label}`

      expect(better.reactionDelay, `${at}: reaction`).toBeLessThan(worse.reactionDelay)
      expect(better.aimError, `${at}: aim`).toBeLessThan(worse.aimError)
      expect(better.sightRange, `${at}: sight`).toBeGreaterThan(worse.sightRange)
      expect(better.steerSkill, `${at}: steering`).toBeGreaterThan(worse.steerSkill)
      expect(better.aggression, `${at}: aggression`).toBeGreaterThan(worse.aggression)
      expect(better.specialInterval, `${at}: specials`).toBeLessThan(worse.specialInterval)
      expect(better.fleeBelow, `${at}: nerve`).toBeLessThan(worse.fleeBelow)
      expect(better.toughness, `${at}: durability`).toBeGreaterThan(worse.toughness)
      expect(better.playerFocus, `${at}: focus on the player`).toBeGreaterThan(worse.playerFocus)
    }
  })

  it('never gives a bot instant reactions, however hard the tier', () => {
    // Ultra Instinct is meant to feel like being outclassed, not cheated. Zero
    // reaction delay is a bot that cannot be juked at all — a wall with a gun.
    for (const key of DIFFICULTY_ORDER) {
      expect(DIFFICULTIES[key]!.reactionDelay).toBeGreaterThan(0.02)
    }
  })

  it('puts the harder tier on top head to head', () => {
    // Two of each tier in one arena, counting only cross-tier kills — a mirror
    // match tells you how lethal a tier is, not whether it beats another one.
    const duel = (weaker: string, stronger: string): { weaker: number; stronger: number } => {
      const tally = { weaker: 0, stronger: 0 }
      const tierOf = (id: number): string => (id < 2 ? weaker : stronger)

      for (let seed = 1; seed <= 8; seed++) {
        const roster = createRoster(4, { humans: [], difficulty: tierOf, seed })
        let world = createWorld({
          seed,
          vehicles: 4,
          health: rosterHealth(roster, VEHICLES.roadster!.maxHealth),
        })
        // 45 seconds, not 30. A fight now takes about three times as long as it
        // did before the damage retune, and a match that ends mid-fight
        // measures nothing.
        for (let i = 0; i < 45 * TICK_HZ; i++) {
          world = step(world, botInputs(roster, world))
          for (const e of world.events) {
            if (e.type !== 'vehicleDestroyed' || e.by === null) continue
            if (tierOf(e.by) === tierOf(e.id)) continue
            if (tierOf(e.by) === weaker) tally.weaker++
            else tally.stronger++
          }
        }
      }
      return tally
    }

    const spar = duel('baseForm', 'superSaiyan')
    expect(spar.stronger, 'Super Saiyan lost to Base Form').toBeGreaterThan(spar.weaker)

    const gulf = duel('baseForm', 'ultraInstinct')
    expect(gulf.stronger, 'Ultra Instinct lost to Base Form').toBeGreaterThan(gulf.weaker)

    const topRung = duel('superSaiyan', 'ultraInstinct')
    expect(topRung.stronger, 'Ultra Instinct lost to Super Saiyan').toBeGreaterThan(topRung.weaker)
  })

  it('gets harder as the difficulty goes up', () => {
    // The ladder was inverted at first: veteran drove to 2.4m, where the bearing
    // to a moving car swings faster than any firing tolerance can follow, and
    // scored zero kills while the rookie managed three a match.
    const kills = (difficulty: string): number =>
      [1, 2, 3, 4].reduce((sum, seed) => sum + playMatch(seed, 6, difficulty, 45 * TICK_HZ).kills, 0)

    const weakest = kills('baseForm')
    const strongest = kills('ultraInstinct')

    expect(weakest).toBeGreaterThan(0)
    expect(strongest, 'the difficulty ladder is upside down').toBeGreaterThan(weakest)
  })
})

describe('bot-vs-bot soak', () => {
  it('runs 100 matches without stalling, breaking or going quiet', () => {
    let totalKills = 0
    let totalShots = 0

    for (let seed = 1; seed <= 100; seed++) {
      // Thirty seconds. Twelve was enough before health doubled and weapon
      // damage came down; a soak that ends before any fight resolves is only
      // testing that cars can drive.
      const result = playMatch(seed, 4, 'superSaiyan', 30 * TICK_HZ)
      const where = `match ${seed}`

      for (const v of result.world.vehicles) {
        expect(V.isFinite(v.pos), `${where}: car ${v.id} position`).toBe(true)
        expect(V.isFinite(v.vel), `${where}: car ${v.id} velocity`).toBe(true)
        expect(Number.isFinite(v.yaw), `${where}: car ${v.id} yaw`).toBe(true)
        expect(Number.isFinite(v.health), `${where}: car ${v.id} health`).toBe(true)
      }

      // Something moved on essentially every tick — a match where the cars stop
      // is a stall even if nothing crashed.
      expect(result.movedTicks, `${where}: stalled`).toBeGreaterThan(30 * TICK_HZ * 0.9)
      expect(result.worstSpeed, `${where}: runaway velocity`).toBeLessThan(200)

      totalKills += result.kills
      totalShots += result.shots
    }

    // The soak is worthless if the bots were driving in circles not fighting.
    expect(totalShots, 'nobody fired a shot in 100 matches').toBeGreaterThan(5000)
    // Floor set well under the measured 80, so ordinary tuning does not turn
    // this red — it is here to catch bots that stop fighting, not to pin a
    // kill rate.
    expect(totalKills, 'nobody died in 100 matches').toBeGreaterThan(40)
  })

  it('holds together with eight bots in the furnished arena', () => {
    // 45s, not 20: health doubled and weapon damage came down, so a kill takes
    // roughly three times as long as it used to.
    const result = playMatch(42, 8, 'ultraInstinct', 45 * TICK_HZ)
    for (const v of result.world.vehicles) {
      expect(V.isFinite(v.pos)).toBe(true)
      expect(V.isFinite(v.vel)).toBe(true)
    }
    expect(result.kills).toBeGreaterThan(0)
  })

  it.todo('every match reaches a win condition — needs M6 match flow')
})

describe('perf', () => {
  it('keeps eight bots well inside the tick budget', () => {
    // PLAN.md §6 budgets 2ms for the whole sim tick. Bots are not the sim, but
    // they run on the same tick, so they get a slice of the same budget.
    const roster = createRoster(8, { humans: [] })
    let world = createWorld({ seed: 1, vehicles: 8 })

    // Warm up, so this measures steady state rather than the first JIT pass.
    for (let i = 0; i < 200; i++) world = step(world, botInputs(roster, world))

    const samples = 2000
    const started = performance.now()
    for (let i = 0; i < samples; i++) {
      const inputs: Inputs = botInputs(roster, world)
      world = step(world, inputs)
    }
    const perTick = (performance.now() - started) / samples

    // Deliberately loose: this is a guard against an order-of-magnitude
    // regression, not a benchmark, and a tight bound here would flake on CI.
    expect(perTick, `${perTick.toFixed(3)} ms per tick for 8 bots + sim`).toBeLessThan(1)
  })
})
