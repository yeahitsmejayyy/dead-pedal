/**
 * L4 — a roster of bots, and the one function that turns them into `Inputs`.
 *
 * This is the whole seam PLAN.md M5 is protecting. A human's inputs come from
 * `input/`, a bot's come from here, and at M8 a remote player's will come from
 * the network — and `step` cannot tell the difference between any of them,
 * because all three produce exactly the same `Map<EntityId, InputFrame>`.
 */
import type { BotDifficulty } from '../content/bots'
import { DEFAULT_DIFFICULTY, difficultyFor } from '../content/bots'
import type { EntityId, Inputs, WorldState } from '../sim'
import { Bot } from './brain'

export { Bot, type BotState } from './brain'
export * from './steering'

export type BotSpec = {
  readonly id: EntityId
  readonly difficulty?: string
}

/**
 * Bots for every car except the ones listed as human.
 *
 * `seed` makes a roster reproducible: the same seed and the same world produce
 * the same match, every time, which is what lets a hundred headless bot-vs-bot
 * runs mean anything.
 */
export function createRoster(
  count: number,
  options: {
    readonly humans?: readonly EntityId[]
    /** One tier for everyone, or a function for a mixed field. */
    readonly difficulty?: string | ((id: EntityId) => string)
    readonly seed?: number
  } = {},
): Bot[] {
  const humans = new Set(options.humans ?? [0])
  const seed = options.seed ?? 1
  const pick = options.difficulty ?? DEFAULT_DIFFICULTY
  const nameFor = typeof pick === 'function' ? pick : (): string => pick

  const roster: Bot[] = []
  for (let id = 0; id < count; id++) {
    if (humans.has(id)) continue
    const difficulty: BotDifficulty = difficultyFor(nameFor(id))
    roster.push(new Bot(id, difficulty, seed, humans))
  }
  return roster
}

/**
 * Health ceiling for each car, from the roster's difficulties.
 *
 * Handed to `createWorld` as a plain function of id: the sim never learns what
 * a bot is, and anyone not in the roster — the player — keeps the archetype's
 * own number.
 */
export function rosterHealth(
  roster: readonly Bot[],
  baseHealth: number,
): (id: EntityId) => number {
  const scale = new Map(roster.map((bot) => [bot.id, bot.difficulty.toughness]))
  // Rounded: 200 × 1.15 is 229.99999999999997, which would sit in the world
  // hash and in every health readout forever.
  return (id) => Math.round(baseHealth * (scale.get(id) ?? 1))
}

/**
 * Ask every bot for one tick of intent.
 *
 * `extra` is merged last, so a human's frame always wins over a bot that
 * somehow shares its id rather than the other way round.
 */
export function botInputs(roster: readonly Bot[], world: WorldState, extra?: Inputs): Inputs {
  const inputs = new Map<EntityId, ReturnType<Bot['think']>>()
  for (const bot of roster) inputs.set(bot.id, bot.think(world, world.tick))
  if (extra !== undefined) for (const [id, frame] of extra) inputs.set(id, frame)
  return inputs
}
