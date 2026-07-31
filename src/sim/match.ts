/**
 * L1 — the match state machine.
 *
 * PLAN.md rates M6 low-risk and calls it "a state machine with four states —
 * easy, but touches everything". Both halves are true, and the second is the
 * dangerous one: the phase decides whether input reaches the cars, whether a
 * wreck comes back, and when the whole arena is rebuilt. Keeping all of that in
 * one file is what stops it leaking into five.
 *
 * Everything here is a pure function of the world. Timers are counted in
 * **ticks**, not seconds, because a match is sim time — the same match has to
 * play out identically on a machine rendering at 30fps and one at 240.
 */
import { TICK_DT } from '../core/clock'
import type { MatchRules } from '../content/match'
import { isAlive, type EntityId, type MatchState, type SimEvent, type Vehicle } from './types'

export const seconds = (value: number): number => Math.round(value / TICK_DT)

export function initialMatch(rules: MatchRules, cars: number): MatchState {
  return {
    // A zero-second countdown means the round is already live, rather than a
    // phase that lasts one tick. Sandbox worlds take input from tick zero.
    phase: rules.countdown > 0 ? 'countdown' : 'live',
    round: 1,
    timer: rules.countdown > 0 ? seconds(rules.countdown) : seconds(rules.roundSeconds),
    scores: new Array<number>(cars).fill(0),
    roundWinner: null,
    matchWinner: null,
  }
}

/** Cars only take input while the round is actually being fought. */
export function acceptsInput(match: MatchState): boolean {
  return match.phase === 'live'
}

/** Wrecks only come back when the rules are not elimination rules. */
export function allowsRespawn(match: MatchState, rules: MatchRules): boolean {
  return match.phase === 'live' && !rules.eliminate
}

/**
 * Credit this tick's kills.
 *
 * A kill only counts for the car that caused it, which is what `by` already
 * records. Driving yourself into your own mine, or off something that kills you
 * with nobody involved, scores for nobody — an own goal should not read on the
 * board the same way as beating someone, and letting it would make suicide a
 * viable strategy in a mode decided on kill count.
 *
 * Returns the same array when nothing died, so the common case allocates
 * nothing: this runs every tick of every match.
 */
export function tallyKills(scores: readonly number[], events: readonly SimEvent[]): number[] {
  let next: number[] | null = null

  for (const event of events) {
    if (event.type !== 'vehicleDestroyed') continue
    if (event.by === null || event.by === event.id) continue

    next ??= scores.slice()
    next[event.by] = (next[event.by] ?? 0) + 1
  }

  return next ?? (scores as number[])
}

/**
 * Who has the most kills.
 *
 * Returns null on an exact tie at the top, which is a real outcome rather than
 * an error — PLAN.md names "timer expiry with a tie" as an edge case worth
 * testing, and in a mode with no tiebreak the honest answer is that nobody won.
 */
export function leaderOnKills(scores: readonly number[]): EntityId | null {
  let best: EntityId | null = null
  let bestScore = -Infinity
  let tied = false

  for (let id = 0; id < scores.length; id++) {
    const score = scores[id]!
    if (score > bestScore) {
      best = id
      bestScore = score
      tied = false
    } else if (score === bestScore) {
      tied = true
    }
  }

  return tied ? null : best
}

/**
 * Who is winning on health right now.
 *
 * Not used by deathmatch, which is decided on kills. Kept because a mode that
 * ends on a clock with no kills scored needs *some* answer, and "whoever is
 * least beaten up" is the least arbitrary one available.
 */
export function leaderOnHealth(vehicles: readonly Vehicle[]): EntityId | null {
  let best: EntityId | null = null
  let bestHealth = -Infinity
  let tied = false

  for (const vehicle of vehicles) {
    if (!isAlive(vehicle)) continue
    if (vehicle.health > bestHealth) {
      best = vehicle.id
      bestHealth = vehicle.health
      tied = false
    } else if (vehicle.health === bestHealth) {
      tied = true
    }
  }

  return tied ? null : best
}

export type MatchStep = {
  readonly match: MatchState
  readonly events: SimEvent[]
  /**
   * True on the tick a fresh round begins. `step` rebuilds the cars, the
   * projectiles and the crates when it sees this — the match machine decides
   * *when* to reset, and never touches the things being reset.
   */
  readonly resetArena: boolean
}

/**
 * Advance the match by one tick, after everything else has resolved.
 *
 * Ordering matters: this runs last so "is anyone left alive" is answered about
 * the world as it now stands, not as it stood before this tick's damage landed.
 */
export function stepMatch(
  match: MatchState,
  rules: MatchRules,
  vehicles: readonly Vehicle[],
  tickEvents: readonly SimEvent[],
): MatchStep {
  const events: SimEvent[] = []
  const timer = match.timer - 1

  switch (match.phase) {
    case 'countdown': {
      if (timer > 0) return { match: { ...match, timer }, events, resetArena: false }

      events.push({ type: 'roundStarted', round: match.round })
      return {
        match: { ...match, phase: 'live', timer: seconds(rules.roundSeconds) },
        events,
        resetArena: false,
      }
    }

    case 'live': {
      // Kills are counted as they happen rather than reconstructed at the end.
      // Nothing can die outside a live round — weapons are gated on the same
      // phase — so this is the only place a score can move.
      const scores = tallyKills(match.scores, tickEvents)
      const standing = vehicles.filter(isAlive)

      // Elimination first: a round decided by the last car moving should not
      // wait for the clock, and a clock that expires on the same tick as the
      // final kill should read as the kill. Deathmatch never takes this branch.
      const eliminated = rules.eliminate && standing.length <= 1
      const expired = timer <= 0
      if (!eliminated && !expired) {
        return { match: { ...match, timer, scores }, events, resetArena: false }
      }

      // Everyone dying together is a draw, not a win for whoever is first in
      // the array. PLAN.md calls out simultaneous elimination by name.
      const winner = eliminated
        ? (standing.length === 1 ? standing[0]!.id : null)
        : leaderOnKills(scores)

      events.push({ type: 'roundEnded', round: match.round, winner, onTime: !eliminated })

      // The match ends when the rounds run out, not when someone reaches a
      // score. A deathmatch is one round, so the clock and the match end
      // together — and a draw ends it just as firmly as a win does.
      const over = match.round >= rules.rounds
      if (over) events.push({ type: 'matchEnded', winner })

      return {
        match: {
          ...match,
          phase: over ? 'matchOver' : 'roundOver',
          timer: seconds(rules.intermission),
          scores,
          roundWinner: winner,
          matchWinner: over ? winner : null,
        },
        events,
        resetArena: false,
      }
    }

    case 'roundOver': {
      if (timer > 0) return { match: { ...match, timer }, events, resetArena: false }

      return {
        match: {
          ...match,
          phase: 'countdown',
          round: match.round + 1,
          timer: seconds(rules.countdown),
          roundWinner: null,
        },
        events,
        // The one place the arena is rebuilt. Everything about a new round —
        // cars back on their marks, crates restocked, projectiles gone — hangs
        // off this single flag.
        resetArena: true,
      }
    }

    case 'matchOver':
    default:
      // Terminal. Getting out of here is a new world, not a new phase.
      return { match, events, resetArena: false }
  }
}
