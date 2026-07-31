/**
 * M5's steering tests, from PLAN.md §4: "steering primitives, in isolation,
 * with known inputs".
 *
 * In isolation is the point. These take numbers and return a heading — no bot,
 * no world, no car — so when a bot drives into a wall you can tell whether the
 * behaviour is wrong or the thing calling it is.
 */
import { describe, expect, it } from 'vitest'
import { angleDelta } from '../../src/core/scalar'
import { PROVING_GROUND } from '../../src/content/arenas/proving-ground'
import { forwardOf, headingOf, type Arena } from '../../src/sim'
import { arrive, avoidWalls, clearance, evade, flee, pursue, seek, steerToward } from '../../src/bots'

const EMPTY: Arena = { ...PROVING_GROUND, blocks: [], ramps: [], pickups: [] }

/** Heading pointing at a point from the origin, for readable expectations. */
const toward = (x: number, z: number): number => headingOf(x, z)

describe('seek and flee', () => {
  it('seeks straight at a point', () => {
    expect(seek(0, 0, 0, 10)).toBeCloseTo(toward(0, 10), 9)
    expect(seek(0, 0, 10, 0)).toBeCloseTo(toward(10, 0), 9)
  })

  it('flees exactly opposite', () => {
    expect(Math.abs(angleDelta(seek(0, 0, 5, 7), flee(0, 0, 5, 7)))).toBeCloseTo(Math.PI, 9)
  })

  it('is translation invariant', () => {
    expect(seek(100, -50, 110, -40)).toBeCloseTo(seek(0, 0, 10, 10), 9)
  })
})

describe('arrive', () => {
  it('is full throttle beyond the slow radius', () => {
    expect(arrive(100, 20)).toBe(1)
  })

  it('eases off inside it', () => {
    expect(arrive(10, 20)).toBeCloseTo(0.5, 9)
    expect(arrive(2, 20)).toBeCloseTo(0.1, 9)
  })

  it('is zero at the stop radius', () => {
    expect(arrive(3, 20, 3)).toBe(0)
    expect(arrive(0, 20)).toBe(0)
  })

  it('never leaves 0..1', () => {
    for (const d of [-5, 0, 1, 19, 20, 500]) {
      const t = arrive(d, 20, 2)
      expect(t).toBeGreaterThanOrEqual(0)
      expect(t).toBeLessThanOrEqual(1)
    }
  })
})

describe('pursue', () => {
  it('matches seek against a stationary target', () => {
    expect(pursue(0, 0, 0, 40, 0, 0, 30)).toBeCloseTo(seek(0, 0, 0, 40), 6)
  })

  it('leads a crossing target', () => {
    // Target 40m ahead, moving +X at 20 m/s. The intercept has to be to its
    // right, not at it — a tail chase never closes on something crossing.
    const lead = pursue(0, 0, 0, 40, 20, 0, 40)
    const direct = seek(0, 0, 0, 40)
    expect(lead).not.toBeCloseTo(direct, 3)
    // Leading toward +X means a heading whose x-component is positive.
    expect(-Math.sin(lead)).toBeGreaterThan(0)
  })

  it('leads further the faster the target moves', () => {
    const slow = Math.abs(angleDelta(seek(0, 0, 0, 40), pursue(0, 0, 0, 40, 5, 0, 40)))
    const fast = Math.abs(angleDelta(seek(0, 0, 0, 40), pursue(0, 0, 0, 40, 25, 0, 40)))
    expect(fast).toBeGreaterThan(slow)
  })

  it('falls back to seek when the target cannot be caught', () => {
    // Target running away faster than the pursuer can travel.
    const chasing = pursue(0, 0, 0, 40, 0, 90, 20)
    expect(chasing).toBeCloseTo(seek(0, 0, 0, 40), 6)
  })

  it('never returns a non-finite heading', () => {
    for (const speed of [0, 1, 46, 200]) {
      for (const tv of [-90, -20, 0, 20, 90]) {
        expect(Number.isFinite(pursue(0, 0, 3, 20, tv, tv, speed))).toBe(true)
      }
    }
    // Degenerate: target exactly on top of the pursuer.
    expect(Number.isFinite(pursue(5, 5, 5, 5, 0, 0, 30))).toBe(true)
  })
})

describe('evade', () => {
  it('runs from where the threat is going, not where it is', () => {
    // Threat behind and closing from -Z, moving +Z. Running has to be +Z-ish.
    const away = evade(0, 0, 0, -30, 0, 40)
    expect(Math.cos(away)).toBeGreaterThan(0)
  })

  it('is roughly opposite to pursuing the same threat', () => {
    const running = evade(0, 0, 0, 40, 0, 0)
    const chasing = seek(0, 0, 0, 40)
    expect(Math.abs(angleDelta(running, chasing))).toBeCloseTo(Math.PI, 6)
  })
})

describe('clearance', () => {
  const walled: Arena = {
    ...EMPTY,
    blocks: [
      { id: 'wall', pos: { x: 0, y: 0, z: 20 }, halfExtents: { x: 8, y: 3, z: 1 }, yaw: 0 },
    ],
  }

  it('reports the cap when nothing is in the way', () => {
    expect(clearance(EMPTY, 0, 0, 0, 30)).toBe(30)
  })

  it('reports the distance to a block', () => {
    expect(clearance(walled, 0, 0, 0, 40)).toBeCloseTo(19, 6)
  })

  it('counts the arena bound as an obstacle', () => {
    // Facing +Z from 10m short of the wall.
    const near = PROVING_GROUND.halfExtents.z - 10
    expect(clearance(EMPTY, 0, near, 0, 40)).toBeCloseTo(10, 6)
  })

  it('sees nothing above a low block', () => {
    // Airborne, clearing a 6m-tall block's roof.
    expect(clearance(walled, 0, 0, 0, 40, 20)).toBe(40)
  })

  it('is never negative or non-finite', () => {
    for (let heading = -Math.PI; heading <= Math.PI; heading += 0.3) {
      const c = clearance(PROVING_GROUND, 12, -30, heading, 40)
      expect(Number.isFinite(c)).toBe(true)
      expect(c).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('avoidWalls', () => {
  const pillar: Arena = {
    ...EMPTY,
    blocks: [
      { id: 'pillar', pos: { x: 0, y: 0, z: 20 }, halfExtents: { x: 4, y: 4, z: 4 }, yaw: 0 },
    ],
  }

  it('leaves a clear heading alone', () => {
    expect(avoidWalls(EMPTY, 0, 0, 0, 25)).toBe(0)
  })

  it('turns away from something dead ahead', () => {
    const steered = avoidWalls(pillar, 0, 0, 0, 25)
    expect(steered).not.toBe(0)
    // And the new heading is clearer than the old one.
    expect(clearance(pillar, 0, 0, steered, 25)).toBeGreaterThan(clearance(pillar, 0, 0, 0, 25))
  })

  it('turns harder the closer the obstacle', () => {
    const far = Math.abs(avoidWalls(pillar, 0, 0, 0, 25))
    const near = Math.abs(avoidWalls(pillar, 0, 12, 0, 25))
    expect(near).toBeGreaterThan(far)
  })

  it('picks the side with more room', () => {
    // A pillar dead ahead to trigger avoidance at all, plus a long wall down the
    // +X side so one flank is genuinely blocked. Without the wall a 0.75 rad
    // probe clears a 10m pillar on *both* sides and the choice is a tie, which
    // is a fine thing for the code to do and a useless thing to assert.
    const corridor: Arena = {
      ...EMPTY,
      blocks: [
        { id: 'ahead', pos: { x: 0, y: 0, z: 18 }, halfExtents: { x: 4, y: 4, z: 3 }, yaw: 0 },
        { id: 'side', pos: { x: 11, y: 0, z: 18 }, halfExtents: { x: 1, y: 4, z: 22 }, yaw: 0 },
      ],
    }

    const steered = avoidWalls(corridor, 0, 0, 0, 25)

    // The wall is at +X, so the way round is -X. Compass yaw makes forward
    // (-sin, cos), so heading toward -X is a *positive* heading.
    expect(steered).toBeGreaterThan(0)
    // An improvement rather than full clearance: the correction is scaled by
    // urgency, so one call nudges rather than solves.
    expect(clearance(corridor, 0, 0, steered, 25)).toBeGreaterThan(
      clearance(corridor, 0, 0, 0, 25),
    )
  })

  it('still produces a finite heading when boxed in', () => {
    const boxed: Arena = {
      ...EMPTY,
      blocks: [
        { id: 'a', pos: { x: 0, y: 0, z: 6 }, halfExtents: { x: 20, y: 4, z: 1 }, yaw: 0 },
        { id: 'b', pos: { x: -6, y: 0, z: 0 }, halfExtents: { x: 1, y: 4, z: 20 }, yaw: 0 },
        { id: 'c', pos: { x: 6, y: 0, z: 0 }, halfExtents: { x: 1, y: 4, z: 20 }, yaw: 0 },
      ],
    }
    expect(Number.isFinite(avoidWalls(boxed, 0, 0, 0, 25))).toBe(true)
  })
})

describe('steerToward', () => {
  it('is zero when already pointing the right way', () => {
    expect(steerToward(0.7, 0.7, 1)).toBe(0)
  })

  it('turns the short way round', () => {
    // From just below +π to just above −π: the short way is positive.
    expect(steerToward(Math.PI - 0.1, -Math.PI + 0.1, 1)).toBeGreaterThan(0)
  })

  it('signs correctly for either side', () => {
    expect(steerToward(0, 0.5, 1)).toBeGreaterThan(0)
    expect(steerToward(0, -0.5, 1)).toBeLessThan(0)
  })

  it('is capped by skill', () => {
    for (const skill of [0.2, 0.6, 1]) {
      expect(Math.abs(steerToward(0, Math.PI, skill))).toBeLessThanOrEqual(skill + 1e-9)
    }
  })

  it('never exceeds full lock', () => {
    for (let error = -Math.PI; error <= Math.PI; error += 0.2) {
      expect(Math.abs(steerToward(0, error, 1))).toBeLessThanOrEqual(1 + 1e-9)
    }
  })

  it('uses the forward axis convention, not raw trig', () => {
    // A car at yaw 0 asked to head at a point on its right must steer right.
    const nose = forwardOf(0)
    const heading = headingOf(nose.x, nose.z)
    // Yaw is a compass heading, so +X is the car's left.
    expect(steerToward(heading, seek(0, 0, -10, 10), 1)).toBeGreaterThan(0)
  })
})
