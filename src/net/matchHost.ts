/**
 * L3 — the authoritative match. One room, one world, one simulator.
 *
 * This is the only thing in the system permitted to advance the world. That is
 * not a style choice: `src/sim/vehicle.ts` records that `Math.sin`/`Math.cos`
 * are not bit-identical across JS engines, so any design where two machines
 * simulate the same match can drift apart. Exactly one simulator makes that
 * whole class of bug impossible rather than merely unlikely.
 *
 * It owns no socket and no clock. `tick()` advances exactly one sim step and is
 * called by whatever is driving — a real loop in the server, or a test that
 * wants to run a match to completion in a millisecond. That separation is what
 * makes the ticket's "assertable without a browser" achievable rather than
 * aspirational, and it is the same shape as `tools/headless.ts`.
 *
 * Everything the sim needs is reused, never reimplemented: `createWorld`,
 * `step`, `createRoster`, `botInputs`, `rosterHealth`.
 */
import { botInputs, createRoster, rosterHealth, type Bot } from '../bots'
import { DEFAULT_DIFFICULTY } from '../content/bots'
import { DEATHMATCH, type MatchRules } from '../content/match'
import { DEFAULT_VEHICLE, tuningFor } from '../content/vehicles'
import {
  createWorld,
  step,
  NEUTRAL_INPUT,
  type EntityId,
  type InputFrame,
  type Inputs,
  type WorldState,
} from '../sim'
import { setupOf, snapshotOf, type MatchSetup, type WorldSnapshot } from './protocol'

export type MatchHostOptions = {
  /** Cars on the field. Slots without a player are driven by a bot. */
  readonly slots?: number
  readonly seed?: number
  readonly rules?: MatchRules
  readonly difficulty?: string
  readonly archetype?: string
}

/** A connected player, and the slot they drive. */
export type Seat = {
  readonly id: EntityId
  readonly name: string
}

export class MatchHost {
  private world: WorldState
  private roster: Bot[]
  private readonly seats = new Map<EntityId, Seat>()
  /**
   * The last frame each player sent, held until they send another.
   *
   * Held rather than consumed, and that is the whole point. A packet that
   * arrives late must not read as a released throttle — falling back to
   * `NEUTRAL_INPUT` every time one is missing makes the car brake by itself at
   * exactly the moments the network is worst, which is the one behaviour
   * guaranteed to be blamed on the handling.
   */
  private readonly held = new Map<EntityId, InputFrame>()

  private readonly slots: number
  private readonly rules: MatchRules
  private readonly difficulty: string
  private readonly archetype: string
  private seed: number

  constructor(options: MatchHostOptions = {}) {
    this.slots = options.slots ?? 4
    this.seed = options.seed ?? 1
    this.rules = options.rules ?? DEATHMATCH
    this.difficulty = options.difficulty ?? DEFAULT_DIFFICULTY
    this.archetype = options.archetype ?? DEFAULT_VEHICLE

    this.roster = this.freshRoster()
    this.world = this.freshWorld()
  }

  // ── seats ────────────────────────────────────────────────────────────────

  /**
   * Take the lowest free slot, or null when the room is full.
   *
   * Lowest free rather than a counter: a counter never gives a seat back, so
   * the first player to reconnect is told the room is full while it is empty.
   */
  join(name = 'player'): EntityId | null {
    for (let id = 0; id < this.slots; id++) {
      if (this.seats.has(id)) continue
      this.seats.set(id, { id, name })
      // The slot stops being a bot immediately, so nobody is briefly driven by
      // two things at once.
      this.roster = this.freshRoster()
      return id
    }
    return null
  }

  /** The seat goes back to the bot that was driving it before anyone joined. */
  leave(id: EntityId): void {
    if (!this.seats.delete(id)) return
    this.held.delete(id)
    this.roster = this.freshRoster()
  }

  seated(): readonly Seat[] {
    return [...this.seats.values()]
  }

  hasSeat(id: EntityId): boolean {
    return this.seats.has(id)
  }

  get capacity(): number {
    return this.slots
  }

  // ── input ────────────────────────────────────────────────────────────────

  /** Ignored for a seat nobody holds: a client cannot drive someone else's car. */
  input(id: EntityId, frame: InputFrame): void {
    if (!this.seats.has(id)) return
    this.held.set(id, frame)
  }

  // ── the world ────────────────────────────────────────────────────────────

  /**
   * Advance exactly one sim tick.
   *
   * No clock is read here. The caller decides when time passes, which is what
   * lets a test run a whole match instantly and a server run it at 60Hz.
   */
  tick(): WorldState {
    const humans: Inputs = new Map(
      [...this.seats.keys()].map((id) => [
        id,
        this.held.get(id) ?? { ...NEUTRAL_INPUT, tick: this.world.tick },
      ]),
    )

    // Bots fill every seat nobody holds; the human map overrides the rest.
    this.world = step(this.world, botInputs(this.roster, this.world, humans))
    return this.world
  }

  /** Throw the match away and start another, keeping everyone in their seats. */
  restart(): WorldState {
    this.seed++
    this.roster = this.freshRoster()
    this.world = this.freshWorld()
    this.held.clear()
    return this.world
  }

  get state(): WorldState {
    return this.world
  }

  get over(): boolean {
    return this.world.match.phase === 'matchOver'
  }

  /** Sent once, on join. Half of a snapshot and none of it ever changes. */
  setup(): MatchSetup {
    return setupOf(this.world)
  }

  /** Sent every tick. The world minus the half that cannot change. */
  snapshot(): WorldSnapshot {
    return snapshotOf(this.world)
  }

  // ── internals ────────────────────────────────────────────────────────────

  private freshRoster(): Bot[] {
    return createRoster(this.slots, {
      humans: [...this.seats.keys()],
      difficulty: this.difficulty,
      seed: this.seed,
    })
  }

  private freshWorld(): WorldState {
    return createWorld({
      seed: this.seed,
      vehicles: this.slots,
      archetype: this.archetype,
      health: rosterHealth(this.roster, tuningFor(this.archetype).maxHealth),
      rules: this.rules,
    })
  }
}
