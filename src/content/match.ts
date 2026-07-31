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
  /** Rounds the match runs. Deathmatch is one; the mode is the clock. */
  readonly rounds: number

  /**
   * Wrecks stay down until the round ends.
   *
   * Off for deathmatch, and that is a design position rather than a default.
   * Elimination means the first player out watches the other three finish, and
   * being made to spectate the game you sat down to play is the worst thing a
   * mode can do to someone. Kept as a flag because a last-car-standing mode is
   * a reasonable thing to want later — but nothing ships with it today.
   */
  readonly eliminate: boolean
}

/**
 * The mode. Five minutes, most kills, and you always come back.
 *
 * Scoring is kills rather than rounds won, which is why `MatchState.scores`
 * counts kills: with one round there is nothing else for a score to mean. A
 * dead heat is a draw and is reported as one — there is no tiebreak, because
 * inventing one (most damage? fewest deaths?) would decide the match on a
 * statistic nobody was watching.
 */
export const DEATHMATCH: MatchRules = {
  label: 'Deathmatch',
  countdown: 3,
  roundSeconds: 300,
  // Long enough to read the scoreboard, short enough that nobody is waiting on
  // it. There is no next round to prepare for — this is the gap before you can
  // start another match.
  intermission: 8,
  rounds: 1,
  eliminate: false,
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
  // Never reach the last round, so the two hours never turn into a scoreboard.
  rounds: Number.MAX_SAFE_INTEGER,
  eliminate: false,
}

/** The same mode, resolved fast, for tests and the headless runner. */
export const QUICK_RULES: MatchRules = {
  ...DEATHMATCH,
  label: 'Quick',
  countdown: 1,
  roundSeconds: 20,
  intermission: 1,
}
