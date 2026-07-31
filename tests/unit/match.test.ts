/**
 * M6's match tests.
 *
 * The state machine is four states and about sixty lines; what it decides is
 * everything. The phase gates input, gates respawn, and is the only thing in the
 * game that says "rebuild the arena". So these tests are mostly about *when* a
 * phase changes and *what is true on the tick it changes*, counted in ticks,
 * because the match is sim time and a match that drifts with frame rate is not
 * the same match.
 *
 * PLAN.md names two edge cases by hand — simultaneous elimination, and timer
 * expiry with a tie. Both have a `describe` of their own below.
 */
import { describe, expect, it } from 'vitest'
import { TICK_DT, TICK_HZ } from '../../src/core/clock'
import { PROVING_GROUND } from '../../src/content/arenas/proving-ground'
import { DEATHMATCH, QUICK_RULES, SANDBOX_RULES, type MatchRules } from '../../src/content/match'
import {
  acceptsInput,
  allowsRespawn,
  initialMatch,
  leaderOnHealth,
  leaderOnKills,
  seconds,
  spawnVehicle,
  stepMatch,
  tallyKills,
  type EntityId,
  type MatchPhase,
  type MatchState,
  type SimEvent,
  type Vehicle,
} from '../../src/sim'

const QUIET: readonly SimEvent[] = []

/**
 * A car with an id and a pulse. The match machine reads exactly two fields off a
 * vehicle — `id` and `health`, the latter only through `isAlive` — so building
 * these off the real spawn path costs nothing and keeps the shape honest if the
 * type grows a field.
 */
const car = (id: EntityId, health = 100): Vehicle => ({
  ...spawnVehicle(id, PROVING_GROUND),
  health,
})

const wreck = (id: EntityId): Vehicle => car(id, 0)

const killed = (id: EntityId, by: EntityId | null): SimEvent => ({
  type: 'vehicleDestroyed',
  id,
  by,
  pos: { x: 0, y: 0, z: 0 },
})

type EventOf<K extends SimEvent['type']> = Extract<SimEvent, { readonly type: K }>

const only = <K extends SimEvent['type']>(events: readonly SimEvent[], type: K): EventOf<K>[] =>
  events.filter((event): event is EventOf<K> => event.type === type)

/**
 * The one event of this type, or a failure.
 *
 * Reaching for `only(...)[0]?.winner` and asserting null passes just as happily
 * when the event was never emitted, which is the failure most worth catching.
 */
function soleEvent<K extends SimEvent['type']>(events: readonly SimEvent[], type: K): EventOf<K> {
  const found = only(events, type)
  if (found.length !== 1) throw new Error(`expected one ${type}, saw ${found.length}`)
  return found[0]!
}

/**
 * Rules whose tick arithmetic you can do in your head: 6, 30, 12.
 *
 * The shipping rules are five minutes long. A transition that takes 18,000 ticks
 * to arrive is one nobody can read the failure of, and every property these
 * tests assert is about the shape of the machine rather than the size of the
 * numbers fed to it.
 */
const TINY: MatchRules = {
  label: 'Tiny',
  countdown: 0.1,
  roundSeconds: 0.5,
  intermission: 0.2,
  rounds: 2,
  eliminate: false,
}

const CD = seconds(TINY.countdown)
const ROUND = seconds(TINY.roundSeconds)
const GAP = seconds(TINY.intermission)

/** The same shape, decided in one round, the way deathmatch is. */
const ONE_ROUND: MatchRules = { ...TINY, rounds: 1 }

/** The flag that benches a player. Nothing ships with it; the code path exists. */
const LAST_CAR: MatchRules = { ...ONE_ROUND, eliminate: true }

const ALL_PHASES: readonly MatchPhase[] = ['countdown', 'live', 'roundOver', 'matchOver']

/** A match parked in one phase, for the predicates that only read the phase. */
const inPhase = (phase: MatchPhase): MatchState => ({ ...initialMatch(TINY, 2), phase })

/** A live round with `timer` ticks left on the clock, so a test can start at the end. */
const liveWith = (rules: MatchRules, cars: number, timer: number): MatchState => ({
  ...initialMatch(rules, cars),
  phase: 'live',
  timer,
})

type Run = {
  readonly match: MatchState
  readonly events: SimEvent[]
  /** 1-based ticks on which `resetArena` came back true. */
  readonly resetTicks: number[]
  readonly phases: MatchPhase[]
}

/**
 * Advance a match `ticks` times. `at` injects the tick's sim events, so a test
 * can land a kill on a named tick rather than on "somewhere in the round".
 */
function runFor(
  start: MatchState,
  rules: MatchRules,
  vehicles: readonly Vehicle[],
  ticks: number,
  at: (tick: number) => readonly SimEvent[] = () => QUIET,
): Run {
  let match = start
  const events: SimEvent[] = []
  const resetTicks: number[] = []
  const phases: MatchPhase[] = []

  for (let tick = 1; tick <= ticks; tick++) {
    const stepped = stepMatch(match, rules, vehicles, at(tick))
    match = stepped.match
    events.push(...stepped.events)
    if (stepped.resetArena) resetTicks.push(tick)
    phases.push(match.phase)
  }

  return { match, events, resetTicks, phases }
}

/** The phase the match was in after tick `tick`, 1-based. */
function phaseAt(run: Run, tick: number): MatchPhase {
  const phase = run.phases[tick - 1]
  if (phase === undefined) throw new Error(`the run was only ${run.phases.length} ticks long`)
  return phase
}

const two = [car(0), car(1)]

describe('the clock is counted in ticks', () => {
  it('converts seconds at the sim rate, not the frame rate', () => {
    expect(seconds(1)).toBe(TICK_HZ)
    expect(seconds(TICK_DT)).toBe(1)
    expect(seconds(300)).toBe(300 * TICK_HZ)
  })

  it('lands on whole ticks for durations that do not divide evenly', () => {
    // A timer is a tick count; half a tick is not a thing the sim can hold.
    expect(Number.isInteger(seconds(0.1))).toBe(true)
    expect(Number.isInteger(seconds(1 / 7))).toBe(true)
  })
})

describe('a match before anything happens', () => {
  it('freezes the cars for the countdown the rules asked for', () => {
    const start = initialMatch(TINY, 2)
    expect(start.phase).toBe('countdown')
    expect(start.timer).toBe(CD)
    expect(acceptsInput(start)).toBe(false)
  })

  it('starts live immediately when the rules ask for no countdown', () => {
    // Why sandbox worlds take input from tick zero: a zero-second countdown is
    // *no* countdown, not a countdown that lasts one tick.
    const start = initialMatch(SANDBOX_RULES, 2)
    expect(start.phase).toBe('live')
    expect(start.timer).toBe(seconds(SANDBOX_RULES.roundSeconds))
    expect(acceptsInput(start)).toBe(true)
  })

  it('opens the scoreboard at zero for every car and nobody winning', () => {
    const start = initialMatch(TINY, 4)
    expect(start.scores).toEqual([0, 0, 0, 0])
    expect(start.round).toBe(1)
    expect(start.roundWinner).toBeNull()
    expect(start.matchWinner).toBeNull()
  })
})

describe('the phases, in order', () => {
  it('holds the countdown for exactly its length, then goes live', () => {
    const run = runFor(initialMatch(TINY, 2), TINY, two, CD)

    expect(phaseAt(run, CD - 1)).toBe('countdown')
    expect(phaseAt(run, CD)).toBe('live')
    expect(run.match.timer).toBe(ROUND)
  })

  it('announces the round on the tick it becomes live', () => {
    const run = runFor(initialMatch(TINY, 2), TINY, two, CD)
    expect(only(run.events, 'roundStarted').map((event) => event.round)).toEqual([1])
  })

  it('ends the round on the clock and pauses for the intermission', () => {
    const run = runFor(initialMatch(TINY, 2), TINY, two, CD + ROUND)

    expect(phaseAt(run, CD + ROUND - 1)).toBe('live')
    expect(phaseAt(run, CD + ROUND)).toBe('roundOver')
    expect(run.match.timer).toBe(GAP)

    const ended = only(run.events, 'roundEnded')
    expect(ended).toHaveLength(1)
    expect(ended[0]?.round).toBe(1)
    expect(ended[0]?.onTime).toBe(true)
  })

  it('comes back to a countdown for the next round, one round further on', () => {
    const run = runFor(initialMatch(TINY, 2), TINY, two, CD + ROUND + GAP)

    expect(phaseAt(run, CD + ROUND + GAP - 1)).toBe('roundOver')
    expect(phaseAt(run, CD + ROUND + GAP)).toBe('countdown')
    expect(run.match.round).toBe(2)
    expect(run.match.timer).toBe(CD)
    // Last round's result is cleared going in — a scoreboard that still says
    // "car 2 won" while car 2 is on the start line is a scoreboard that lies.
    expect(run.match.roundWinner).toBeNull()
  })

  it('walks a whole two-round match through every state and stops', () => {
    const secondRoundEnds = CD + ROUND + GAP + CD + ROUND
    const run = runFor(initialMatch(TINY, 2), TINY, two, secondRoundEnds + 40)

    expect(phaseAt(run, CD + ROUND + GAP + CD)).toBe('live')
    expect(phaseAt(run, secondRoundEnds - 1)).toBe('live')
    expect(phaseAt(run, secondRoundEnds)).toBe('matchOver')
    expect(run.match.round).toBe(2)
    expect(only(run.events, 'roundStarted').map((event) => event.round)).toEqual([1, 2])
    expect(only(run.events, 'roundEnded')).toHaveLength(2)
    expect(only(run.events, 'matchEnded')).toHaveLength(1)
  })

  it('ends the whole match when the clock runs out on a single-round mode', () => {
    // Deathmatch is one round, so the clock and the match end together — there
    // is no roundOver to sit in.
    const four = [car(0), car(1), car(2), car(3)]
    const stepped = stepMatch(liveWith(DEATHMATCH, 4, 1), DEATHMATCH, four, QUIET)

    expect(DEATHMATCH.rounds).toBe(1)
    expect(stepped.match.phase).toBe('matchOver')
    expect(only(stepped.events, 'matchEnded')).toHaveLength(1)
  })

  it('carries the shipping quick rules all the way to matchOver', () => {
    // The one test that runs real content rather than hand-cut numbers: if the
    // arithmetic in the rules and the arithmetic in the machine ever disagree,
    // this is where it shows.
    const total = seconds(QUICK_RULES.countdown) + seconds(QUICK_RULES.roundSeconds)
    const run = runFor(initialMatch(QUICK_RULES, 2), QUICK_RULES, two, total + 120)

    expect(phaseAt(run, total - 1)).toBe('live')
    expect(run.match.phase).toBe('matchOver')
    expect(run.resetTicks).toEqual([])
  })

  it('leaves the state it was handed untouched', () => {
    // Every phase is a pure function of the world; a transition returns a new
    // state rather than editing the old one, or rollback netcode is impossible.
    const before = liveWith(ONE_ROUND, 2, 1)
    const snapshot = JSON.stringify(before)
    stepMatch(before, ONE_ROUND, two, [killed(1, 0)])
    expect(JSON.stringify(before)).toBe(snapshot)
  })
})

describe('what a phase permits', () => {
  it('takes input only while the round is being fought', () => {
    for (const phase of ALL_PHASES) {
      expect(acceptsInput(inPhase(phase)), phase).toBe(phase === 'live')
    }
  })

  it('brings wrecks back only while live, and only under rules that are not elimination', () => {
    for (const phase of ALL_PHASES) {
      expect(allowsRespawn(inPhase(phase), TINY), phase).toBe(phase === 'live')
    }
  })

  it('never brings a wreck back under elimination rules, in any phase', () => {
    for (const phase of ALL_PHASES) {
      expect(allowsRespawn(inPhase(phase), LAST_CAR), phase).toBe(false)
    }
  })

  it('ships no mode with elimination turned on', () => {
    // Being made to spectate the game you sat down to play is the worst thing a
    // mode can do to someone. The flag exists; nothing in content sets it.
    for (const rules of [DEATHMATCH, SANDBOX_RULES, QUICK_RULES]) {
      expect(rules.eliminate, rules.label).toBe(false)
    }
  })
})

describe('crediting a kill', () => {
  it('gives it to the car that caused it', () => {
    expect(tallyKills([0, 0, 0], [killed(2, 1)])).toEqual([0, 1, 0])
  })

  it('gives an environment death to nobody', () => {
    expect(tallyKills([0, 0], [killed(1, null)])).toEqual([0, 0])
  })

  it('gives driving into your own mine to nobody', () => {
    // An own goal must not read on the board the same way as beating someone,
    // or suicide becomes a strategy in a mode decided on kill count.
    expect(tallyKills([3, 0], [killed(0, 0)])).toEqual([3, 0])
  })

  it('counts every death in a tick, not just the first', () => {
    const scores = tallyKills([0, 0, 0], [killed(1, 0), killed(2, 0), killed(0, 2)])
    expect(scores).toEqual([2, 0, 1])
  })

  it('steps over events that are not deaths', () => {
    const noise: readonly SimEvent[] = [
      { type: 'explosion', pos: { x: 0, y: 0, z: 0 }, radius: 4 },
      { type: 'lockLost', id: 1 },
      killed(1, 0),
    ]
    expect(tallyKills([0, 0], noise)).toEqual([1, 0])
  })

  it('hands back the very same array when nothing died', () => {
    // An allocation guard on a path that runs every tick of every match, so the
    // identity is the property, not the contents.
    const scores = [4, 1, 0]
    expect(tallyKills(scores, QUIET)).toBe(scores)
    expect(tallyKills(scores, [{ type: 'lockLost', id: 0 }])).toBe(scores)
  })

  it('hands back the same array when the only deaths credit nobody', () => {
    const scores = [4, 1, 0]
    expect(tallyKills(scores, [killed(0, null), killed(1, 1)])).toBe(scores)
  })

  it('copies rather than edits the scoreboard it was given', () => {
    const scores = [0, 0]
    const next = tallyKills(scores, [killed(1, 0)])
    expect(next).not.toBe(scores)
    expect(scores).toEqual([0, 0])
  })
})

describe('reading the leader off the kill count', () => {
  it('names the car out in front', () => {
    expect(leaderOnKills([1, 4, 2])).toBe(1)
    expect(leaderOnKills([7, 0, 0])).toBe(0)
  })

  it('calls a tie at the top a draw, wherever the tie sits in the array', () => {
    expect(leaderOnKills([0, 2, 2])).toBeNull()
    expect(leaderOnKills([2, 2, 0])).toBeNull()
    expect(leaderOnKills([3, 1, 3, 1])).toBeNull()
  })

  it('lets a real win stand over a tie below it', () => {
    // The trap: a later equal pair must not spoil a lead already established.
    expect(leaderOnKills([1, 2, 1])).toBe(1)
    expect(leaderOnKills([5, 1, 1, 1])).toBe(0)
    expect(leaderOnKills([1, 1, 5])).toBe(2)
  })

  it('calls a match where nobody scored a draw', () => {
    expect(leaderOnKills([0, 0])).toBeNull()
    expect(leaderOnKills([0, 0, 0, 0])).toBeNull()
  })

  it('has nobody to name in an empty match', () => {
    expect(leaderOnKills([])).toBeNull()
  })

  it('names the only entrant in a one-car match', () => {
    // Uncontested, but a lone car is not tied with anyone, so it wins.
    expect(leaderOnKills([0])).toBe(0)
  })
})

describe('reading the leader off health', () => {
  it('names the least beaten-up car still moving', () => {
    expect(leaderOnHealth([car(0, 30), car(1, 80), car(2, 55)])).toBe(1)
  })

  it('ignores wrecks entirely', () => {
    expect(leaderOnHealth([wreck(0), car(1, 10)])).toBe(1)
  })

  it('calls two cars level a draw', () => {
    expect(leaderOnHealth([car(0, 60), car(1, 60)])).toBeNull()
  })

  it('has nobody to name when every car is wrecked', () => {
    expect(leaderOnHealth([wreck(0), wreck(1)])).toBeNull()
    expect(leaderOnHealth([])).toBeNull()
  })

  it('reports the car id, not its slot in the array', () => {
    expect(leaderOnHealth([car(7, 20), car(3, 90)])).toBe(3)
  })
})

describe('the scoreboard over a round', () => {
  it('accumulates kills tick by tick as they land', () => {
    const kills = new Map<number, readonly SimEvent[]>([
      [3, [killed(1, 0)]],
      [9, [killed(1, 0)]],
      [14, [killed(0, 1)]],
    ])
    const run = runFor(liveWith(ONE_ROUND, 2, ROUND), ONE_ROUND, two, 20, (tick) =>
      kills.get(tick) ?? QUIET,
    )
    expect(run.match.scores).toEqual([2, 1])
    expect(run.match.phase).toBe('live')
  })

  it('carries the final tally into matchOver', () => {
    const run = runFor(liveWith(ONE_ROUND, 2, ROUND), ONE_ROUND, two, ROUND + 60, (tick) =>
      tick === 5 ? [killed(1, 0)] : QUIET,
    )
    expect(run.match.phase).toBe('matchOver')
    expect(run.match.scores).toEqual([1, 0])
    expect(run.match.matchWinner).toBe(0)
  })

  it('does not move while the round has not started', () => {
    // Weapons are gated on the same phase, so nothing can die here — but the
    // machine should not be the thing that assumes it.
    const run = runFor(initialMatch(TINY, 2), TINY, two, CD - 1, () => [killed(1, 0)])
    expect(run.match.phase).toBe('countdown')
    expect(run.match.scores).toEqual([0, 0])
  })

  it('does not move once the round is over', () => {
    const over: MatchState = { ...initialMatch(TINY, 2), phase: 'roundOver', timer: GAP }
    const run = runFor(over, TINY, two, GAP - 1, () => [killed(1, 0)])
    expect(run.match.scores).toEqual([0, 0])
  })
})

describe('rebuilding the arena', () => {
  it('fires on exactly one tick, at the end of the intermission', () => {
    const run = runFor(initialMatch(TINY, 2), TINY, two, CD + ROUND + GAP + CD + ROUND + 40)
    expect(run.resetTicks).toEqual([CD + ROUND + GAP])
  })

  it('fires once per round boundary and never anywhere else', () => {
    const rules: MatchRules = { ...TINY, rounds: 4 }
    const perRound = CD + ROUND + GAP
    const run = runFor(initialMatch(rules, 2), rules, two, perRound * 4 + 60)

    // Three boundaries between four rounds; the last round ends the match, and
    // a match that is over has nothing left to rebuild for.
    expect(run.resetTicks).toEqual([perRound, perRound * 2, perRound * 3])
    for (const tick of run.resetTicks) expect(phaseAt(run, tick)).toBe('countdown')
  })

  it('never fires on a match that only ever has one round', () => {
    const run = runFor(initialMatch(ONE_ROUND, 2), ONE_ROUND, two, CD + ROUND + GAP + 200)
    expect(run.match.phase).toBe('matchOver')
    expect(run.resetTicks).toEqual([])
  })
})

describe('matchOver is terminal', () => {
  it('a thousand ticks change nothing at all', () => {
    const ended = stepMatch(liveWith(ONE_ROUND, 2, 1), ONE_ROUND, two, [killed(1, 0)]).match
    expect(ended.phase).toBe('matchOver')

    let match = ended
    for (let tick = 0; tick < 1000; tick++) {
      const stepped = stepMatch(match, ONE_ROUND, two, [killed(0, 1)])
      expect(stepped.events).toEqual([])
      expect(stepped.resetArena).toBe(false)
      match = stepped.match
    }

    // Same object, not merely an equal one: getting out of here is a new world.
    expect(match).toBe(ended)
    expect(match.scores).toEqual([1, 0])
  })
})

/**
 * PLAN.md edge case, by name: SIMULTANEOUS ELIMINATION.
 *
 * Everyone dies on the same tick. The array has an order; the outcome must not.
 */
describe('simultaneous elimination', () => {
  const wiped = [wreck(0), wreck(1), wreck(2)]
  const bomb = [killed(0, null), killed(1, null), killed(2, null)]

  it('is a draw, not a win for whoever is first in the array', () => {
    const stepped = stepMatch(liveWith(LAST_CAR, 3, ROUND), LAST_CAR, wiped, bomb)

    expect(stepped.match.roundWinner).toBeNull()
    expect(stepped.match.matchWinner).toBeNull()
    expect(soleEvent(stepped.events, 'roundEnded').winner).toBeNull()
    expect(soleEvent(stepped.events, 'matchEnded').winner).toBeNull()
  })

  it('leaves every score exactly where it was', () => {
    // Nobody killed anybody: the arena did. A wipeout must not hand out points.
    const stepped = stepMatch(liveWith(LAST_CAR, 3, ROUND), LAST_CAR, wiped, bomb)
    expect(stepped.match.scores).toEqual([0, 0, 0])
  })

  it('ends the round on elimination rather than on the clock', () => {
    const stepped = stepMatch(liveWith(LAST_CAR, 3, ROUND), LAST_CAR, wiped, bomb)
    expect(stepped.match.phase).toBe('matchOver')
    expect(soleEvent(stepped.events, 'roundEnded').onTime).toBe(false)
  })

  it('is still a draw when the two survivors shoot each other dead at once', () => {
    // The other flavour: scores do move, and they move equally, so both routes
    // to "nobody won" agree.
    const mutual = [killed(0, 1), killed(1, 0)]
    const stepped = stepMatch(liveWith(LAST_CAR, 2, ROUND), LAST_CAR, [wreck(0), wreck(1)], mutual)

    expect(stepped.match.scores).toEqual([1, 1])
    expect(stepped.match.matchWinner).toBeNull()
  })
})

/**
 * PLAN.md edge case, by name: TIMER EXPIRY WITH A TIE.
 *
 * There is no tiebreak in this mode on purpose — inventing one would decide the
 * match on a statistic nobody was watching.
 */
describe('timer expiry with a tie', () => {
  const traded = (tick: number): readonly SimEvent[] =>
    tick === 3 ? [killed(1, 0)] : tick === 11 ? [killed(0, 1)] : QUIET

  it('ends the match with nobody named, rather than defaulting to car 0', () => {
    const run = runFor(liveWith(ONE_ROUND, 2, ROUND), ONE_ROUND, two, ROUND, traded)

    expect(run.match.scores).toEqual([1, 1])
    expect(run.match.phase).toBe('matchOver')
    expect(run.match.roundWinner).toBeNull()
    expect(run.match.matchWinner).toBeNull()
  })

  it('still reports the round and the match as ended, drawn', () => {
    const run = runFor(liveWith(ONE_ROUND, 2, ROUND), ONE_ROUND, two, ROUND, traded)

    expect(soleEvent(run.events, 'roundEnded').winner).toBeNull()
    expect(soleEvent(run.events, 'roundEnded').onTime).toBe(true)
    expect(soleEvent(run.events, 'matchEnded').winner).toBeNull()
  })

  it('names the leader when the clock runs out and the scores are not level', () => {
    const three = [car(0), car(1), car(2)]
    const run = runFor(liveWith(ONE_ROUND, 3, ROUND), ONE_ROUND, three, ROUND, (tick) =>
      tick === 4 ? [killed(2, 1)] : QUIET,
    )
    expect(run.match.matchWinner).toBe(1)
    expect(soleEvent(run.events, 'matchEnded').winner).toBe(1)
  })
})

describe('elimination against the clock', () => {
  it('reads as the kill when the last car falls on the tick the clock expires', () => {
    // Both conditions resolve together. Elimination is checked first, so the
    // round is reported as won by the survivor, not decided on time.
    const stepped = stepMatch(liveWith(LAST_CAR, 2, 1), LAST_CAR, [car(0), wreck(1)], [killed(1, 0)])

    expect(stepped.match.roundWinner).toBe(0)
    expect(stepped.match.matchWinner).toBe(0)
    expect(soleEvent(stepped.events, 'roundEnded').onTime).toBe(false)
    expect(stepped.match.scores).toEqual([1, 0])
  })

  it('does not end a round early under rules that are not elimination', () => {
    // The same world under deathmatch rules: one car left, clock still running,
    // and the wreck is coming back.
    const stepped = stepMatch(liveWith(ONE_ROUND, 2, ROUND), ONE_ROUND, [car(0), wreck(1)], QUIET)

    expect(stepped.match.phase).toBe('live')
    expect(stepped.match.timer).toBe(ROUND - 1)
    expect(allowsRespawn(stepped.match, ONE_ROUND)).toBe(true)
  })

  it('ends the round the moment one car is left, long before the clock', () => {
    const run = runFor(liveWith(LAST_CAR, 2, ROUND), LAST_CAR, [car(0), wreck(1)], ROUND)
    expect(phaseAt(run, 1)).toBe('matchOver')
    expect(run.match.matchWinner).toBe(0)
  })

  it('decides on kills, not survival, when the clock beats the elimination', () => {
    const alive = [car(0), car(1), car(2)]
    const run = runFor(liveWith(LAST_CAR, 3, ROUND), LAST_CAR, alive, ROUND, (tick) =>
      tick === 2 ? [killed(2, 1)] : QUIET,
    )
    // Three cars still standing in the array, so elimination never triggers and
    // the clock has the final say.
    expect(run.match.matchWinner).toBe(1)
    expect(soleEvent(run.events, 'roundEnded').onTime).toBe(true)
  })
})

/**
 * Corners nobody set out to build, found by running them.
 *
 * These pin down what the machine *actually does* at the edges of its inputs.
 * Where the behaviour is arguable rather than wrong it is called out here and
 * reported upward rather than quietly blessed.
 */
describe('the edges of the rules', () => {
  it('runs an empty match down its clock and ends it drawn', () => {
    const run = runFor(initialMatch(ONE_ROUND, 0), ONE_ROUND, [], CD + ROUND)

    expect(run.match.scores).toEqual([])
    expect(run.match.phase).toBe('matchOver')
    expect(run.match.matchWinner).toBeNull()
  })

  it('ends an empty match on its first live tick under elimination rules', () => {
    // Nobody standing is "one or fewer standing", so the last-car check fires
    // straight away. A draw, which is the only honest answer.
    const stepped = stepMatch(liveWith(LAST_CAR, 0, ROUND), LAST_CAR, [], QUIET)

    expect(stepped.match.phase).toBe('matchOver')
    expect(stepped.match.matchWinner).toBeNull()
    expect(soleEvent(stepped.events, 'roundEnded').onTime).toBe(false)
  })

  it('counts a kill that lands on the very tick the clock expires', () => {
    // The tally runs before the expiry check, so the last shot of the match is
    // part of the match. Getting this backwards would lose a decisive kill.
    const run = runFor(liveWith(ONE_ROUND, 2, ROUND), ONE_ROUND, two, ROUND, (tick) =>
      tick === ROUND ? [killed(0, 1)] : QUIET,
    )

    expect(run.match.scores).toEqual([0, 1])
    expect(run.match.matchWinner).toBe(1)
  })

  it('ends the match at the end of round one when the rules ask for no rounds', () => {
    // `rounds: 0` is nonsense a mode could still be authored with. It does not
    // hang or loop; the first round is also the last.
    const noRounds: MatchRules = { ...TINY, rounds: 0 }
    const run = runFor(initialMatch(noRounds, 2), noRounds, two, CD + ROUND)

    expect(run.match.phase).toBe('matchOver')
    expect(run.match.round).toBe(1)
  })

  it('carries kills from one round into the next rather than resetting them', () => {
    // Scores are match kills, not round kills, and nothing clears them at a
    // round boundary. Defensible for a kill count; see the note about what it
    // does to `roundWinner` in a multi-round mode.
    const firstRound = CD + ROUND
    const secondRound = firstRound + GAP + CD + ROUND
    const run = runFor(initialMatch(TINY, 2), TINY, two, secondRound, (tick) =>
      tick === CD + 4 ? [killed(1, 0)] : tick === firstRound + GAP + CD + 4 ? [killed(0, 1)] : QUIET,
    )

    expect(run.match.scores).toEqual([1, 1])
  })

  /**
   * The consequence of the above, and a real defect the moment a second mode
   * exists. `roundWinner` is `leaderOnKills(scores)`, and `scores` is the whole
   * match, so round two is decided on round one's kills: give car 0 three kills
   * in the first round and car 1 the only kill of the second, and both rounds
   * are reported as won by car 0 — a car that did nothing in the round it won.
   *
   * Left open rather than fixed, deliberately. Nothing ships with `rounds > 1`,
   * and the fix is a choice between two defensible semantics — reset the board
   * each round, or keep a per-round baseline and let the final scoreboard stay
   * cumulative — which should be made by whoever actually needs the second mode
   * rather than guessed at now. Recorded here so they find it before shipping it.
   */
  it.todo('decides a round on that round’s kills, not the whole match’s')

  it('still spends a tick in countdown between rounds when the rules ask for none', () => {
    // Inconsistent with `initialMatch`, which goes straight to live on a zero
    // countdown. Round two of a zero-countdown mode drops one tick of input.
    const instant: MatchRules = { ...TINY, countdown: 0, intermission: 0 }
    const run = runFor(initialMatch(instant, 2), instant, two, ROUND + 3)

    expect(initialMatch(instant, 2).phase).toBe('live')
    expect(phaseAt(run, ROUND)).toBe('roundOver')
    expect(phaseAt(run, ROUND + 1)).toBe('countdown')
    expect(acceptsInput(inPhase(phaseAt(run, ROUND + 1)))).toBe(false)
    expect(phaseAt(run, ROUND + 2)).toBe('live')
    expect(run.resetTicks).toEqual([ROUND + 1])
  })

  it.todo('announces round one even when there is no countdown to announce it after')

  it('announces later rounds of a zero-countdown mode', () => {
    const instant: MatchRules = { ...TINY, countdown: 0, intermission: 0 }
    const run = runFor(initialMatch(instant, 2), instant, two, ROUND + 3)
    expect(only(run.events, 'roundStarted').map((event) => event.round)).toContain(2)
  })

  it('parks the intermission clock in matchOver and never counts it down', () => {
    // Harmless — the phase is terminal — but the field is meaningless here, and
    // anything drawing "time remaining" off it will show a frozen number.
    const ended = stepMatch(liveWith(ONE_ROUND, 2, 1), ONE_ROUND, two, QUIET).match
    expect(ended.phase).toBe('matchOver')
    expect(ended.timer).toBe(GAP)
    expect(stepMatch(ended, ONE_ROUND, two, QUIET).match.timer).toBe(GAP)
  })

  it('only ever moves along an edge the state machine has', () => {
    // The whole machine as one invariant, checked on every tick of a three-round
    // match: no phase is ever reached from a phase that cannot reach it, and the
    // arena is rebuilt on exactly the roundOver -> countdown edge and no other.
    const legal: Readonly<Record<MatchPhase, readonly MatchPhase[]>> = {
      countdown: ['countdown', 'live'],
      live: ['live', 'roundOver', 'matchOver'],
      roundOver: ['roundOver', 'countdown'],
      matchOver: ['matchOver'],
    }

    const rules: MatchRules = { ...TINY, rounds: 3 }
    const start = initialMatch(rules, 3)
    const run = runFor(start, rules, [car(0), car(1), car(2)], 400)

    let previous = start.phase
    for (let tick = 1; tick <= run.phases.length; tick++) {
      const phase = phaseAt(run, tick)
      expect(legal[previous], `tick ${tick}: ${previous} -> ${phase}`).toContain(phase)

      const rebuilt = previous === 'roundOver' && phase === 'countdown'
      expect(run.resetTicks.includes(tick), `tick ${tick}: ${previous} -> ${phase}`).toBe(rebuilt)
      previous = phase
    }

    expect(run.match.phase).toBe('matchOver')
    expect(run.match.round).toBe(3)
  })
})
