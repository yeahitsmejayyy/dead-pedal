/**
 * PLAN.md M5's last unmet line: "Headless: a full match simulated end to end in
 * under a second."
 *
 * Everything else in the suite tests a slice — a weapon's arithmetic, a bot's
 * frame, thirty seconds of driving. This runs the actual product: four bots, the
 * real `DEATHMATCH` rules, tick zero to `matchOver`, nothing mocked and nothing
 * shortened. It is the only test that can catch the class of bug that only shows
 * up after five minutes of compounding state.
 *
 * The match is played once and cached. Eighteen thousand ticks is cheap but not
 * free, and re-running it per assertion would turn a 300ms file into a 2s one
 * for no extra coverage.
 */
import { describe, expect, it } from 'vitest'
import { TICK_DT } from '../../src/core/clock'
import { hashState } from '../../src/core/hash'
import { DEATHMATCH } from '../../src/content/match'
import { DEFAULT_VEHICLE, tuningFor } from '../../src/content/vehicles'
import { botInputs, createRoster, rosterHealth } from '../../src/bots'
import {
  createWorld,
  isAlive,
  leaderOnKills,
  seconds,
  step,
  type EntityId,
  type WorldState,
} from '../../src/sim'

const CARS = 4
/** The default tier, so this measures the match people will actually play. */
const TIER = 'superSaiyan'
/** Picked for a lively board: all four cars die, and it resolves to a winner. */
const SEED = 3

/**
 * 3s of countdown then 300s of round. Deathmatch is a single round, so the
 * round clock and the match clock are the same clock — nothing else can end it.
 */
const MATCH_TICKS = seconds(DEATHMATCH.countdown) + seconds(DEATHMATCH.roundSeconds)
const RESPAWN_TICKS = Math.round(tuningFor(DEFAULT_VEHICLE).respawnDelay / TICK_DT)

type Deathmatch = {
  readonly world: WorldState
  /** Ticks actually stepped before the phase went terminal. */
  readonly ticks: number
  readonly elapsedMs: number
  /** CPU actually burned by this worker. See the wall-clock test for why. */
  readonly cpuMs: number
  /** `vehicleDestroyed` events with a killer who was not the victim. */
  readonly credited: number
  readonly deaths: readonly number[]
  readonly respawns: readonly number[]
  /** Longest unbroken run of *live* ticks each car spent wrecked. */
  readonly benched: readonly number[]
  /** Winner reported by each `matchEnded` event. There should be exactly one. */
  readonly endings: readonly (EntityId | null)[]
  readonly hash: string
}

function playDeathmatch(seed: number): Deathmatch {
  // `humans: []` is load-bearing. `createRoster` reserves car 0 for the player
  // by default, so the obvious call leaves car 0 parked for five minutes as a
  // free punching bag — which produces a scoreboard that looks fine and means
  // nothing. `seed` is likewise the *bot* seed, separate from the world seed:
  // omit it and every seed below plays the identical match.
  const roster = createRoster(CARS, { humans: [], difficulty: TIER, seed })
  let world = createWorld({
    seed,
    vehicles: CARS,
    rules: DEATHMATCH,
    // Wired exactly as the game wires it, so changing TIER above changes the
    // durability too rather than silently running everyone at player health.
    health: rosterHealth(roster, tuningFor(DEFAULT_VEHICLE).maxHealth),
  })

  let credited = 0
  const deaths = new Array<number>(CARS).fill(0)
  const respawns = new Array<number>(CARS).fill(0)
  const benched = new Array<number>(CARS).fill(0)
  const deadFor = new Array<number>(CARS).fill(0)
  const endings: (EntityId | null)[] = []

  // Bounded, so a match that never ends fails an assertion instead of hanging
  // the suite. Thirty seconds of slack past the clock: if it has not finished
  // by then it was never going to.
  const cap = MATCH_TICKS + seconds(30)
  let ticks = 0

  const startedCpu = process.cpuUsage()
  const startedAt = performance.now()
  while (world.match.phase !== 'matchOver' && ticks < cap) {
    world = step(world, botInputs(roster, world))
    ticks++

    for (const event of world.events) {
      if (event.type === 'vehicleDestroyed') {
        deaths[event.id] = (deaths[event.id] ?? 0) + 1
        if (event.by !== null && event.by !== event.id) credited++
      } else if (event.type === 'vehicleRespawned') {
        respawns[event.id] = (respawns[event.id] ?? 0) + 1
      } else if (event.type === 'matchEnded') {
        endings.push(event.winner)
      }
    }

    // Counted only while the round is live, because respawn is gated on the
    // same phase: a car wrecked as the clock runs out stays down because the
    // match is over, not because it was left out of it.
    const live = world.match.phase === 'live'
    for (const vehicle of world.vehicles) {
      const streak = live && !isAlive(vehicle) ? (deadFor[vehicle.id] ?? 0) + 1 : 0
      deadFor[vehicle.id] = streak
      if (streak > (benched[vehicle.id] ?? 0)) benched[vehicle.id] = streak
    }
  }
  const elapsedMs = performance.now() - startedAt
  const spent = process.cpuUsage(startedCpu)
  const cpuMs = (spent.user + spent.system) / 1000

  return {
    world,
    ticks,
    elapsedMs,
    cpuMs,
    credited,
    deaths,
    respawns,
    benched,
    endings,
    hash: hashState(world),
  }
}

let cached: Deathmatch | null = null
const match = (): Deathmatch => (cached ??= playDeathmatch(SEED))

describe('a full deathmatch, played headless', () => {
  it('reaches a finished match on the clock rather than stalling', () => {
    const { world, ticks, endings } = match()

    expect(world.match.phase, 'the match never finished').toBe('matchOver')
    // One round, no elimination: the timer is the only thing that can end this,
    // so it should end on precisely the tick the timer names.
    expect(ticks).toBe(MATCH_TICKS)
    expect(endings, 'the match ended more than once').toHaveLength(1)
    expect(endings[0]).toBe(world.match.matchWinner)
  })

  it('scores kills and nothing else, and the board adds up', () => {
    const { world, credited, deaths } = match()
    const board = world.match.scores.reduce((sum, score) => sum + score, 0)
    const died = deaths.reduce((sum, count) => sum + count, 0)

    expect(world.match.scores, 'a score per car').toHaveLength(CARS)
    expect(died, 'nothing died in five minutes, so this proves nothing').toBeGreaterThan(0)

    // The one that catches `tallyKills` drifting: every point on the board is
    // one wrecked car with a killer behind it, and no such kill went uncounted.
    expect(board, 'the board disagrees with the body count').toBe(credited)
    // Suicides and environment deaths credit nobody, so the board can lag the
    // body count but must never lead it.
    expect(board).toBeLessThanOrEqual(died)
  })

  it('ends with a winner or an honest draw, and the board agrees which', () => {
    const { scores, matchWinner, roundWinner } = match().world.match

    expect(matchWinner).toBe(leaderOnKills(scores))
    // The last round of a deathmatch *is* the match; the two cannot disagree.
    expect(roundWinner).toBe(matchWinner)

    const top = Math.max(...scores)
    if (matchWinner === null) {
      // A draw is an outcome, not a missing one: it means two or more cars
      // finished level at the top and there is no tiebreak to invent.
      expect(scores.filter((score) => score === top).length).toBeGreaterThan(1)
    } else {
      expect(scores[matchWinner]).toBe(top)
      expect(scores.filter((score) => score === top), 'a winner who was tied').toEqual([top])
    }
  })

  it('brings every wreck back, and never benches one past the respawn delay', () => {
    const { benched, deaths, respawns } = match()

    // The mode's whole design premise. Elimination is off precisely so that
    // being wrecked costs you three seconds and nothing else — a car left down
    // longer than that is a player made to spectate the game they sat down to
    // play, which `content/match.ts` calls "the worst thing a mode can do to
    // someone". Nothing else in the suite checks it over a whole match.
    for (let id = 0; id < CARS; id++) {
      // The designed figure is exact — the wreck comes back on tick
      // `death + RESPAWN_TICKS` — so the slack is for the boundary, not for
      // drift.
      expect(benched[id], `car ${id} sat wrecked for ${benched[id]} ticks`).toBeLessThanOrEqual(
        RESPAWN_TICKS + 2,
      )
      // At most one death per car can go unanswered: the one that lands inside
      // the last three seconds, where the match ends before the respawn does.
      // A wreck cannot die twice, so there is never a second.
      expect(respawns[id], `car ${id} never came back`).toBeGreaterThanOrEqual(
        (deaths[id] ?? 0) - 1,
      )
    }

    expect(Math.max(...benched), 'nobody was ever wrecked, so this proves nothing').toBeGreaterThan(
      0,
    )
  })

  it('replays identically from the same seed', () => {
    // Eighteen thousand ticks of bots, weapons, respawns and a state machine,
    // and the two runs have to agree bit for bit. This is the M8 precondition:
    // no rollback netcode is possible if a match can drift from itself.
    expect(playDeathmatch(SEED).hash).toBe(match().hash)
  })

  it('simulates the whole five minutes in a fraction of a second', () => {
    const { elapsedMs, cpuMs, ticks } = match()

    // Measured, always the cold run because the cached match is the first thing
    // this file does. 18,180 ticks of four bots:
    //
    //   this file alone   362 / 363 / 365 / 373 / 377 ms wall,  ~850 ms cpu
    //   whole `vitest run` 767 / 789 / 796 / 804 / 830 ms wall, ~1050 ms cpu
    //
    // The 2.2x on wall clock is not the sim getting slower. Vitest forks a
    // worker per test file and nineteen of them oversubscribe the box, so most
    // of that second is queueing. Which is the trap in bounding this on wall
    // clock: against the 800 ms in-suite baseline, PLAN.md's "under a second"
    // is a 1.25x bar that a slower machine trips for no reason, and against the
    // 363 ms standalone one it is a 2.7x bar that catches nothing.
    //
    // CPU burned is the number that tracks the work rather than the queue, and
    // it is measured PER TICK so the bound does not have to be re-derived every
    // time the round length changes. 850ms/18,180 = 0.047 standalone, 0.058
    // contended; 0.09 turns red on a 1.55x slowdown from the worst baseline and
    // on any outright doubling.
    const budget = `${cpuMs.toFixed(0)} ms cpu / ${elapsedMs.toFixed(0)} ms wall, ${ticks} ticks`
    expect(cpuMs / ticks, budget).toBeLessThan(0.09)

    // Wall clock is a STALL DETECTOR here, not the perf bar, and the bound is
    // loose on purpose. PLAN.md's "under a second" is real and met — 365ms for
    // this match run on its own — but in-suite the same work takes 767-830ms
    // because vitest forks a worker per file and nineteen of them oversubscribe
    // the box. Asserting 1000ms against an 800ms baseline is a 1.2x margin,
    // which is not a performance test, it is a coin flip that goes red on a
    // busy machine. Observed doing exactly that once during development.
    expect(elapsedMs, budget).toBeLessThan(2500)
  })
})
