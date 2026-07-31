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
 * Who is winning on health right now.
 *
 * Used when the clock runs out. Returns null on an exact tie, which is a real
 * outcome and not an error — PLAN.md names "timer expiry with a tie" as an edge
 * case worth testing, and the honest answer is that nobody won the round.
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
      const standing = vehicles.filter(isAlive)

      // Elimination first: a round decided by the last car moving should not
      // wait for the clock, and a clock that expires on the same tick as the
      // final kill should read as the kill.
      const eliminated = rules.eliminate && standing.length <= 1
      const expired = timer <= 0
      if (!eliminated && !expired) return { match: { ...match, timer }, events, resetArena: false }

      // Everyone dying together is a draw, not a win for whoever is first in
      // the array. PLAN.md calls out simultaneous elimination by name.
      const winner = eliminated
        ? (standing.length === 1 ? standing[0]!.id : null)
        : leaderOnHealth(vehicles)

      const scores = match.scores.slice()
      if (winner !== null) scores[winner] = (scores[winner] ?? 0) + 1

      events.push({ type: 'roundEnded', round: match.round, winner, onTime: !eliminated })

      const champion = winner !== null && (scores[winner] ?? 0) >= rules.roundsToWin ? winner : null
      if (champion !== null) events.push({ type: 'matchEnded', winner: champion })

      return {
        match: {
          ...match,
          phase: champion !== null ? 'matchOver' : 'roundOver',
          timer: seconds(rules.intermission),
          scores,
          roundWinner: winner,
          matchWinner: champion,
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
