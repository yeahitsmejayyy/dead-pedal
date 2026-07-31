/**
 * L2 — bot difficulty, as data.
 *
 * PLAN.md M5: "Difficulty as data (reaction delay, aim error, aggression), not
 * as branching code." That is the whole design constraint of this file. There is
 * no `if (difficulty === 'hard')` anywhere in `src/bots/` — every difference
 * between Base Form and Ultra Instinct is a number below, which means a new tier is a
 * new entry here and not a new code path to test.
 *
 * The three levers PLAN.md names do most of the work:
 *
 * - **reactionDelay** is the big one. A bot that re-reads the world every tick
 *   is inhumanly sharp no matter how badly it drives; one that re-reads every
 *   third of a second can be outmanoeuvred by changing direction, which is what
 *   makes fighting it feel like fighting someone.
 * - **aimError** decides whether being in front of it is dangerous.
 * - **aggression** decides whether it commits or circles.
 */

export type BotDifficulty = {
  readonly label: string

  // ── perception ────────────────────────────────────────────────────────────
  /** Seconds between re-reading the world. Everything in between acts on a
   *  stale picture, which is exactly what a reaction time is. */
  readonly reactionDelay: number
  /** Radians of error added to its aim, resampled each decision. */
  readonly aimError: number
  /** How far it can see a target at all. */
  readonly sightRange: number

  // ── driving ───────────────────────────────────────────────────────────────
  /** Fraction of full lock it is willing to use, 0..1. Low = clumsy lines. */
  readonly steerSkill: number
  /** Heading error, radians, above which it stops flooring the throttle. */
  readonly cautionAngle: number
  /** Metres it looks ahead for walls. Scaled by speed. */
  readonly lookahead: number
  /** Heading error above which it will yank the handbrake to get round. */
  readonly handbrakeAngle: number

  // ── fighting ──────────────────────────────────────────────────────────────
  /** 0..1. High commits to ramming; low prefers to stand off and shoot. */
  readonly aggression: number
  /** Metres it tries to hold when not being aggressive. */
  readonly standoff: number
  /** Health fraction below which it breaks off. */
  readonly fleeBelow: number
  /** Seconds it keeps running after deciding to flee. */
  readonly fleeFor: number
  /** Fires the gun inside this heading error, radians. */
  readonly fireAngle: number
  /** Seconds between attempts to use a special. */
  readonly specialInterval: number
  /** Ammo fraction below which it will detour to a crate. */
  readonly restockBelow: number

  /**
   * How much a bot prefers hunting the human over the nearest bot, 0..1.
   *
   * Bots pick the nearest enemy, and in a four-car arena that is usually each
   * other — which is why a top-tier field can feel oddly uninterested in you.
   * This discounts the human's apparent distance, so at 0.6 a player sixty
   * metres away looks twenty-four and the whole field drifts your way.
   *
   * It is a bias, not a script: they still fight each other, they just find you
   * more interesting. That is the difference between feeling ganged up on and
   * being ganged up on.
   */
  readonly playerFocus: number

  // ── durability ────────────────────────────────────────────────────────────
  /**
   * Multiplier on the car's health, relative to the player's.
   *
   * The fourth lever, and the bluntest. Reaction, aim and aggression change how
   * often a bot hits you; this changes how long it survives being hit — which
   * is what stops a top-tier opponent from being a five-second fight that you
   * happen to lose more often.
   */
  readonly toughness: number
}

export const DEFAULT_DIFFICULTY = 'superSaiyan' as const

/** Tier order, weakest first. The panel and any future menu read this. */
export const DIFFICULTY_ORDER = ['baseForm', 'superSaiyan', 'ultraInstinct'] as const

export const DIFFICULTIES: Readonly<Record<string, BotDifficulty>> = {
  /**
   * A light spar.
   *
   * Half a second behind, which is an age: change direction once and it is
   * still driving at where you were. It hangs back at 34m, shoots loosely,
   * and breaks off as soon as it is properly hurt.
   */
  baseForm: {
    label: 'Base Form',
    reactionDelay: 0.5,
    aimError: 0.24,
    sightRange: 72,
    steerSkill: 0.48,
    cautionAngle: 0.42,
    lookahead: 14,
    handbrakeAngle: 2.6,
    aggression: 0.15,
    standoff: 34,
    fleeBelow: 0.55,
    fleeFor: 4.5,
    fireAngle: 0.06,
    specialInterval: 6,
    restockBelow: 0.2,
    // Barely notices you over whoever is closest.
    playerFocus: 0.1,
    // Softer than you. A spar you are meant to win.
    toughness: 0.75,
  },

  /**
   * A formidable opponent.
   *
   * Quick enough to punish a lazy line, slow enough that a real feint still
   * works. Commits to the fight, uses specials on a sensible cadence, and only
   * runs when it is genuinely in trouble.
   */
  superSaiyan: {
    label: 'Super Saiyan',
    reactionDelay: 0.16,
    aimError: 0.05,
    sightRange: 135,
    steerSkill: 0.88,
    cautionAngle: 0.85,
    lookahead: 24,
    handbrakeAngle: 1.8,
    aggression: 0.68,
    standoff: 20,
    fleeBelow: 0.26,
    fleeFor: 2.2,
    fireAngle: 0.11,
    specialInterval: 1.9,
    restockBelow: 0.4,
    // 0.4 was measurably not enough: Super Saiyan sees 135m and would wander
    // off to fight other bots, taking *longer* to reach a parked player than
    // Base Form — which only sees 72m and therefore stays local.
    playerFocus: 0.45,
    // An even fight, health for health.
    toughness: 1,
  },

  /**
   * You will probably never win.
   *
   * Three ticks of reaction, near-perfect aim, sees the whole arena, and
   * essentially never disengages. Deliberately *not* zero reaction delay: a bot
   * that cannot be juked at all is not a hard opponent, it is a wall with a
   * gun, and the fantasy here is being outclassed rather than being cheated.
   */
  ultraInstinct: {
    label: 'Ultra Instinct',
    reactionDelay: 0.05,
    aimError: 0.008,
    sightRange: 185,
    steerSkill: 1,
    cautionAngle: 1.1,
    lookahead: 30,
    handbrakeAngle: 1.5,
    aggression: 0.95,
    standoff: 15,
    fleeBelow: 0.07,
    fleeFor: 1,
    fireAngle: 0.16,
    specialInterval: 0.85,
    restockBelow: 0.55,
    // Everything on the field would rather be shooting at you.
    playerFocus: 0.75,
    // Half again what you can take. Enough to feel like a wall, short of the
    // point where a mirror match stops resolving at all.
    toughness: 1.45,
  },
}

export function difficultyFor(name: string): BotDifficulty {
  const found = DIFFICULTIES[name]
  if (found === undefined) throw new Error(`unknown bot difficulty: ${name}`)
  return found
}
