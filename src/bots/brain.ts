/**
 * L4 — one bot: perceive, decide, drive.
 *
 * **The contract, from PLAN.md M5:** "Bots emit `InputFrame`s. No bot may touch
 * `WorldState` directly." Everything here reads the world and returns an
 * `InputFrame`. It has no other output and no way to reach into the sim — which
 * is what makes a bot share every code path with a human, and what turns M8
 * into a transport problem instead of a rewrite.
 *
 * **Reaction delay is modelled as a stale picture, not a stalled car.** The bot
 * re-reads the world every `reactionDelay` seconds into `perceived`, and steers
 * continuously against whatever it last saw. Freezing the whole input instead
 * would make bots stutter; this way they drive smoothly toward where you *were*,
 * which is what being outmanoeuvred actually looks like.
 */
import { TICK_DT } from '../core/clock'
import { next as nextRandom, fromSeed, type RngState } from '../core/rng'
import { angleDelta, clamp } from '../core/scalar'
import type { BotDifficulty } from '../content/bots'
import { SPECIAL_IDS, WEAPONS, type WeaponId } from '../content/weapons'
import {
  NEUTRAL_INPUT,
  forwardOf,
  headingOf,
  isAlive,
  type EntityId,
  type InputFrame,
  type Vehicle,
  type WorldState,
} from '../sim'
import { arrive, avoidMines, avoidWalls, evade, pursue, seek, steerToward } from './steering'

export type BotState = 'hunt' | 'attack' | 'flee' | 'collect'

/**
 * Closest a bot ever tries to sit, however aggressive.
 *
 * Raised from 7m, which was measurably unusable. At seven metres the bearing to
 * a car doing 40 m/s swings at 5.4 rad/s, so a forward-firing gun has a window
 * of about 30 milliseconds to shoot through — Ultra Instinct fired a quarter as
 * many rounds as Super Saiyan while spending the entire match in reverse,
 * backing off because it was always inside its own preferred range.
 *
 * Fourteen metres halves the bearing rate and, not by coincidence, is also
 * where rockets and missiles become safe to fire: the range a bot wants to
 * fight at has to be a range its weapons work at.
 */
const BRAWL_RANGE = 14

/** Roughly a car's half-width, for working out how big a target looks. */
const TARGET_HALF_WIDTH = 1.3

/** How far out a bot starts swerving around a mine. Well over its 4.2m trigger. */
const MINE_DANGER = 13

/** What the bot last saw. Everything it does is based on this, not on `now`. */
type Perceived = {
  state: BotState
  targetId: EntityId | null
  targetX: number
  targetZ: number
  targetVelX: number
  targetVelZ: number
  /** Where it is heading when it has no target — a crate, or open space. */
  goalX: number
  goalZ: number
  /** Aim offset for this decision, so a burst wanders rather than jittering. */
  aimOffset: number
  wantSpecial: WeaponId | null
}

const IDLE: Perceived = {
  state: 'hunt',
  targetId: null,
  targetX: 0,
  targetZ: 0,
  targetVelX: 0,
  targetVelZ: 0,
  goalX: 0,
  goalZ: 0,
  aimOffset: 0,
  wantSpecial: null,
}

export class Bot {
  readonly id: EntityId
  readonly difficulty: BotDifficulty
  /** Who counts as a human, for `playerFocus`. */
  private readonly humans: ReadonlySet<EntityId>

  private rng: RngState
  private perceived: Perceived = { ...IDLE }
  private sinceDecision = Number.POSITIVE_INFINITY
  private sinceSpecial = 0
  private fleeingFor = 0
  /** Set for one tick when the brain wants to change weapon. */
  private wantsCycle = false

  constructor(
    id: EntityId,
    difficulty: BotDifficulty,
    seed: number,
    humans: ReadonlySet<EntityId> = new Set([0]),
  ) {
    this.id = id
    this.difficulty = difficulty
    this.humans = humans
    // Per-bot stream, so eight bots do not all miss in the same direction.
    this.rng = fromSeed(seed * 7919 + id * 104729)
  }

  /** Current plan, for tests and the debug panel. Never read by the sim. */
  get state(): BotState {
    return this.perceived.state
  }

  get target(): EntityId | null {
    return this.perceived.targetId
  }

  private roll(): number {
    const draw = nextRandom(this.rng)
    this.rng = draw.state
    return draw.value
  }

  /** One tick of intent. The only thing this class produces. */
  think(world: WorldState, tick: number): InputFrame {
    const me = world.vehicles.find((v) => v.id === this.id)
    if (me === undefined || !isAlive(me)) {
      this.sinceDecision = Number.POSITIVE_INFINITY
      this.fleeingFor = 0
      return { ...NEUTRAL_INPUT, tick }
    }

    this.sinceDecision += TICK_DT
    this.sinceSpecial += TICK_DT
    if (this.fleeingFor > 0) this.fleeingFor -= TICK_DT

    if (this.sinceDecision >= this.difficulty.reactionDelay) {
      this.sinceDecision = 0
      this.decide(world, me)
    }

    return this.drive(world, me, tick)
  }

  // ── decide ─────────────────────────────────────────────────────────────────

  private decide(world: WorldState, me: Vehicle): void {
    const d = this.difficulty
    const p = this.perceived

    const enemy = this.nearestEnemy(world, me)
    const distance =
      enemy === null ? Number.POSITIVE_INFINITY : Math.hypot(enemy.pos.x - me.pos.x, enemy.pos.z - me.pos.z)

    // ── state ────────────────────────────────────────────────────────────────
    // Ordered by urgency, and `fleeingFor` gives the decision hysteresis: a bot
    // that re-evaluates fleeing every fifth of a second oscillates on the
    // threshold and just twitches in place.
    const hurt = me.health / Math.max(1, me.maxHealth) < d.fleeBelow
    if (hurt && enemy !== null) this.fleeingFor = d.fleeFor

    const crate = this.wantedCrate(world, me)

    if (this.fleeingFor > 0) p.state = 'flee'
    else if (crate !== null && (enemy === null || distance > d.standoff * 1.6)) p.state = 'collect'
    else if (enemy !== null && distance <= d.sightRange) p.state = 'attack'
    else p.state = 'hunt'

    // ── what it thinks it can see ────────────────────────────────────────────
    if (enemy !== null) {
      p.targetId = enemy.id
      p.targetX = enemy.pos.x
      p.targetZ = enemy.pos.z
      p.targetVelX = enemy.vel.x
      p.targetVelZ = enemy.vel.z
    } else {
      p.targetId = null
    }

    if (crate !== null) {
      p.goalX = crate.x
      p.goalZ = crate.z
    } else if (enemy === null) {
      // Nothing to do: wander toward the middle rather than sit in a corner.
      p.goalX = 0
      p.goalZ = 0
    }

    // Symmetric, and resampled per decision rather than per tick — a burst that
    // rerolls every frame averages out to perfect aim.
    p.aimOffset = (this.roll() * 2 - 1) * d.aimError

    // ── specials ─────────────────────────────────────────────────────────────
    // Allowed while fleeing as well as attacking: dropping a mine on someone
    // chasing you is the single best thing a running car can do, and gating
    // specials on `attack` meant it never happened.
    p.wantSpecial = null
    const fighting = p.state === 'attack' || p.state === 'flee'
    if (fighting && enemy !== null && this.sinceSpecial >= d.specialInterval) {
      const pick = this.chooseSpecial(me, enemy, distance, p.state === 'flee')
      if (pick !== null) {
        p.wantSpecial = pick
        this.wantsCycle = me.selectedSpecial !== pick
      }
    }
  }

  /**
   * Who to go after.
   *
   * Nearest, except the human's distance is discounted by `playerFocus` — so a
   * high-tier bot will cross the arena for you while a low-tier one deals with
   * whoever is under its nose.
   */
  private nearestEnemy(world: WorldState, me: Vehicle): Vehicle | null {
    let best: Vehicle | null = null
    let bestScore = Number.POSITIVE_INFINITY

    for (const other of world.vehicles) {
      if (other.id === me.id || !isAlive(other)) continue

      const distance = Math.hypot(other.pos.x - me.pos.x, other.pos.z - me.pos.z)
      const score = this.humans.has(other.id)
        ? distance * (1 - this.difficulty.playerFocus)
        : distance

      // Ties break on id so eight bots do not disagree about who is nearest.
      if (score < bestScore || (score === bestScore && best !== null && other.id < best.id)) {
        best = other
        bestScore = score
      }
    }

    return best
  }

  /** The nearest available crate for something it is short of, if any. */
  private wantedCrate(world: WorldState, me: Vehicle): { x: number; z: number } | null {
    let best: { x: number; z: number } | null = null
    let bestDistance = Number.POSITIVE_INFINITY

    for (const pickup of world.pickups) {
      if (world.tick < pickup.availableAt) continue

      if (pickup.kind === 'weapon') {
        if (pickup.weapon === null) continue
        const capacity = WEAPONS[pickup.weapon].capacity
        if (me.ammo[pickup.weapon] / capacity > this.difficulty.restockBelow) continue
      } else if (me.health / Math.max(1, me.maxHealth) > this.difficulty.restockBelow + 0.2) {
        // Health and armour are worth a detour when hurt. The margin over the
        // ammo threshold is deliberate: a bot should want patching up sooner
        // than it wants topping up.
        continue
      }

      const distance = Math.hypot(pickup.pos.x - me.pos.x, pickup.pos.z - me.pos.z)
      if (distance < bestDistance) {
        best = { x: pickup.pos.x, z: pickup.pos.z }
        bestDistance = distance
      }
    }

    return best
  }

  /**
   * Which special suits the situation, or null if none is worth spending.
   *
   * Two rules, and both exist because breaking them made bots kill themselves.
   *
   * **Rockets and missiles need room.** Both blast for 6–7m, so firing one at
   * eight metres is a bot choosing to take the damage as well as deal it.
   *
   * **A mine is a defensive weapon.** It goes out the back and triggers on
   * anyone within 4.2m, so laying one while circling a target at seven metres
   * means driving straight back over it. Only laid when running away or when
   * the enemy is behind — which is what a mine is *for*. Before this rule,
   * suicides accounted for a third of all deaths in a mixed-tier arena.
   */
  private chooseSpecial(
    me: Vehicle,
    enemy: Vehicle,
    distance: number,
    fleeing: boolean,
  ): WeaponId | null {
    const nose = forwardOf(me.yaw)
    const toEnemy = seek(me.pos.x, me.pos.z, enemy.pos.x, enemy.pos.z)
    const behind = Math.abs(angleDelta(headingOf(nose.x, nose.z), toEnemy)) > 1.9

    // Blast safety is judged at the moment of *detonation*, not at the moment
    // of firing.
    //
    // A flat multiple of the blast radius does not work. Too small and a bot
    // charging at 40 m/s covers nine metres during a rocket's flight and is
    // standing five metres from its own explosion; too large and the minimum
    // range lands beyond where aggressive bots choose to fight, which disarms
    // exactly the tiers that should be dangerous. Predicting the gap at impact
    // is the only version that is right at both ends.
    const closing = this.closingSpeed(me, enemy)
    const safeToFire = (blastRadius: number, projectileSpeed: number): boolean => {
      const flight = distance / projectileSpeed
      const atImpact = distance - Math.max(0, closing) * flight
      return atImpact >= blastRadius * 1.25
    }

    const wants: WeaponId[] = []
    // Close enough that whoever is chasing will actually meet it. A mine laid
    // with a pursuer thirty metres back is not a trap, it is litter you will
    // drive into yourself once you turn around — and the tier that flees most
    // was the tier killing itself most.
    if ((fleeing || behind) && distance < 22) wants.push('mine')
    if (safeToFire(WEAPONS.homingMissile.blastRadius, WEAPONS.homingMissile.speed)) {
      wants.push('homingMissile')
    }
    if (distance < 45 && safeToFire(WEAPONS.rocket.blastRadius, WEAPONS.rocket.speed)) {
      wants.push('rocket')
    }

    for (const weapon of wants) {
      if (!SPECIAL_IDS.includes(weapon as (typeof SPECIAL_IDS)[number])) continue
      if (me.ammo[weapon] > 0) return weapon
    }
    return null
  }

  /** How fast the gap is shrinking, m/s. Negative when it is opening. */
  private closingSpeed(me: Vehicle, enemy: Vehicle): number {
    const dx = enemy.pos.x - me.pos.x
    const dz = enemy.pos.z - me.pos.z
    const distance = Math.hypot(dx, dz)
    if (distance < 1e-6) return 0
    return ((me.vel.x - enemy.vel.x) * dx + (me.vel.z - enemy.vel.z) * dz) / distance
  }

  // ── drive ──────────────────────────────────────────────────────────────────

  private drive(world: WorldState, me: Vehicle, tick: number): InputFrame {
    const d = this.difficulty
    const p = this.perceived

    const nose = forwardOf(me.yaw)
    const heading = headingOf(nose.x, nose.z)
    const speed = Math.hypot(me.vel.x, me.vel.z)

    let desired = heading
    let throttle = 1
    let wantsRange = Number.POSITIVE_INFINITY

    switch (p.state) {
      case 'flee': {
        desired = evade(me.pos.x, me.pos.z, p.targetX, p.targetZ, p.targetVelX, p.targetVelZ)
        break
      }

      case 'collect': {
        const distance = Math.hypot(p.goalX - me.pos.x, p.goalZ - me.pos.z)
        desired = seek(me.pos.x, me.pos.z, p.goalX, p.goalZ)
        throttle = arrive(distance, 14, 0)
        break
      }

      case 'attack': {
        const distance = Math.hypot(p.targetX - me.pos.x, p.targetZ - me.pos.z)
        wantsRange = distance

        // Aggression is the whole difference between a brawler and a sniper:
        // it decides how close the bot wants to be, and everything else follows.
        //
        // Interpolated toward `BRAWL_RANGE` rather than toward zero. Scaling
        // the standoff by `(1 - aggression)` collapsed the veteran's preferred
        // range to 2.4m, where the bearing to a moving car swings far too fast
        // to ever satisfy a firing tolerance — it drove beautifully into
        // everyone and shot nobody, scoring zero kills across 360 bot-seconds
        // while the rookie managed three a match.
        const preferred = BRAWL_RANGE + (1 - d.aggression) * (d.standoff - BRAWL_RANGE)

        if (distance < preferred) {
          // Too close for its taste — back off, but keep facing the fight so it
          // can still shoot. Reversing away is what gives standoff bots their
          // circling look rather than a retreat.
          desired = pursue(
            me.pos.x, me.pos.z, p.targetX, p.targetZ, p.targetVelX, p.targetVelZ, Math.max(speed, 1),
          )
          throttle = -0.6
        } else {
          desired = pursue(
            me.pos.x, me.pos.z, p.targetX, p.targetZ, p.targetVelX, p.targetVelZ, Math.max(speed, 1),
          )
          throttle = arrive(distance - preferred, 18, 0)
        }
        break
      }

      case 'hunt':
      default: {
        desired =
          p.targetId !== null
            ? seek(me.pos.x, me.pos.z, p.targetX, p.targetZ)
            : seek(me.pos.x, me.pos.z, p.goalX, p.goalZ)
        break
      }
    }

    // ── don't drive into things ──────────────────────────────────────────────
    // Applied last and to every state: whatever the plan was, it does not
    // survive contact with a pillar.
    const lookahead = d.lookahead * clamp(0.4 + speed / 30, 0.4, 2)
    const clear = avoidWalls(world.arena, me.pos.x, me.pos.z, desired, lookahead, me.pos.y)

    // Mines last 25 seconds and trigger on anyone within 4.2m, so they outlive
    // the reason they were laid. Given the arm delay, the radius has to cover a
    // car's stopping distance rather than the trigger radius itself.
    const steered = avoidMines(
      world.projectiles.filter((x) => x.weapon === 'mine'),
      me.pos.x,
      me.pos.z,
      clear,
      MINE_DANGER,
    )
    const error = angleDelta(heading, steered)

    // Reversing flips which way you have to turn.
    const steer = steerToward(heading, steered, d.steerSkill) * (throttle < 0 ? -1 : 1)

    // Lift off when pointing badly wrong, so it corners instead of understeering
    // into whatever it was aiming at.
    if (throttle > 0 && Math.abs(error) > d.cautionAngle) {
      throttle *= clamp(1 - (Math.abs(error) - d.cautionAngle) / 1.2, 0.25, 1)
    }

    const handbrake = throttle > 0 && speed > 18 && Math.abs(error) > d.handbrakeAngle

    // ── shooting ─────────────────────────────────────────────────────────────
    const aimError =
      p.targetId === null
        ? Number.POSITIVE_INFINITY
        : Math.abs(
            angleDelta(heading, seek(me.pos.x, me.pos.z, p.targetX, p.targetZ) + p.aimOffset),
          )

    // How wide the target actually looks from here. A fixed firing tolerance is
    // wrong at both ends: absurdly strict up close, where a car fills your
    // windscreen, and far too loose at range. `fireAngle` is the floor — how
    // speculatively the bot is willing to shoot when the target is a dot.
    const subtended = Math.atan2(TARGET_HALF_WIDTH, Math.max(3, wantsRange))
    const tolerance = Math.max(d.fireAngle, subtended)

    const inRange = wantsRange < WEAPONS.machineGun.range
    const fire = p.state === 'attack' && inRange && aimError < tolerance

    // A special is spent the tick the bot is holding the right one and lined
    // up. Mines are exempt from the aim check — they go out the back, and a bot
    // that has to face its pursuer to drop one would never drop one at all.
    const readyToAim = p.wantSpecial === 'mine' || aimError < tolerance * 2
    const special = p.wantSpecial !== null && me.selectedSpecial === p.wantSpecial && readyToAim
    if (special) {
      this.sinceSpecial = 0
      this.perceived.wantSpecial = null
    }

    const cycleWeapon = this.wantsCycle
    this.wantsCycle = false

    return {
      tick,
      throttle: clamp(throttle, -1, 1),
      steer,
      handbrake,
      fire,
      special,
      cycleWeapon,
      // Bots pick their target by driving at it, not by cycling.
      cycleTarget: false,
      lookBack: false,
    }
  }
}
