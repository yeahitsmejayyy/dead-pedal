/**
 * L2 — match rules, as data.
 *
 * PLAN.md M6: "Match flow is a state machine with four states." The states
 * themselves live in `sim/match.ts`; everything that decides how long they last
 * and what ends them is here, so a different game mode is a different object
 * rather than a different code path.
 */

export type MatchRules = {
  readonly label: string

  /** Seconds of frozen cars before a round starts. */
  readonly countdown: number
  /** Seconds a round runs before it is decided on health. */
  readonly roundSeconds: number
  /** Seconds between a round ending and the next countdown. */
  readonly intermission: number
  /** Rounds a car must win to take the match. */
  readonly roundsToWin: number

  /**
   * Wrecks stay down until the round ends.
   *
   * This is what turns M3's respawn into a *round*. With respawn on there is no
   * such thing as being eliminated, so there is nothing for a round to be
   * about; with it off, the last car moving wins and the timer is only there to
   * stop two cowards circling each other forever.
   */
  readonly eliminate: boolean
}

export const DEFAULT_RULES: MatchRules = {
  label: 'Deathmatch',
  countdown: 3,
  // Long enough that a round is normally decided by elimination, short enough
  // that a stalemate is not something you sit through.
  roundSeconds: 90,
  intermission: 4,
  // Best of three.
  roundsToWin: 2,
  eliminate: true,
}

/**
 * No match at all: no countdown, no elimination, no clock.
 *
 * This is what `createWorld()` gives you when nobody asks for rules, and it is
 * the default on purpose. A bare world should be the *simplest* world — cars
 * that take input immediately and come back when they are wrecked — because
 * that is what every test about handling, collision or weapons is actually
 * about. Turning a match on is a decision; being able to drive is not.
 */
export const SANDBOX_RULES: MatchRules = {
  label: 'Sandbox',
  countdown: 0,
  // Two hours. Not `Infinity`: the timer is ticks in serialised world state,
  // and `Infinity` does not survive `JSON.stringify`.
  roundSeconds: 7200,
  intermission: 0,
  roundsToWin: Number.MAX_SAFE_INTEGER,
  eliminate: false,
}

/** A round that resolves fast, for tests and for the headless runner. */
export const QUICK_RULES: MatchRules = {
  ...DEFAULT_RULES,
  label: 'Quick',
  countdown: 1,
  roundSeconds: 20,
  intermission: 1,
  roundsToWin: 2,
}
