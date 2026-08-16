/**
 * The glow and the proximity label.
 *
 * Most of `pickupTags.ts` is canvases, instanced matrices and billboarding, and
 * none of that can be reached from a node environment. What CAN be reached is
 * the part that decides what a player is told and when — and that part has two
 * failure modes which are both silent in play:
 *
 *   A KIND WITH NO NAME. `labelFor` falls through to the raw id rather than
 *   throwing, on purpose: a renderer that crashes because content grew a new
 *   pickup is worse than one that shows `superShotgun` for a session. But
 *   "worse" is not "fine", and nothing on screen distinguishes a deliberate
 *   label from a fallthrough. The test below drives the mapping from the
 *   arena's own pickup list, so adding a kind without naming it goes red here
 *   instead of shipping.
 *
 *   A LABEL THAT ARRIVES TOO LATE. The point of the label is to be readable
 *   while there is still time to turn for the crate. If its radius ever creeps
 *   down toward the collection radius it still LOOKS like it works — you drive
 *   over a crate, a label flashes — while having stopped doing the one thing it
 *   is for.
 */
import { describe, expect, it } from 'vitest'
import { labelFor, labelOpacity, LABEL_FAR, LABEL_NEAR } from '../../src/view/pickupTags'
import { crateLift } from '../../src/view/effects'
import { PICKUP_RADIUS } from '../../src/sim/pickups'
import { PROVING_GROUND } from '../../src/content/arenas/proving-ground'

/** Every kind of pickup the arena actually places, deduplicated. */
const kinds = [
  ...new Set(
    PROVING_GROUND.pickups.map((p) => (p.kind === 'weapon' ? (p.weapon ?? '') : p.kind)),
  ),
]

describe('naming a pickup', () => {
  it('has a written name for every kind the arena places', () => {
    expect(kinds.length, 'the arena places pickups at all').toBeGreaterThan(3)
    for (const kind of kinds) {
      // The fallthrough returns the key itself. A real label never equals its
      // own id, because the ids are camelCase and the labels are words.
      expect(labelFor(kind), `\`${kind}\` has no label — add one to labelFor`).not.toBe(kind)
      expect(labelFor(kind).length).toBeGreaterThan(2)
    }
  })

  it('names the two missiles differently', () => {
    // They share an airframe and very nearly share a silhouette, which is the
    // whole reason the label exists. If these ever collapse to one string the
    // label is actively misleading rather than merely absent.
    expect(labelFor('rocket')).not.toBe(labelFor('homingMissile'))
  })

  it('falls through to the id rather than throwing', () => {
    expect(labelFor('superShotgun')).toBe('superShotgun')
  })
})

describe('when the label is up', () => {
  it('is readable well before you are close enough to collect', () => {
    /**
     * The load-bearing assertion. A label is only useful while you can still
     * act on it, and you act on it by turning — so it has to be solid at a
     * distance where turning is still a decision, not at the distance where
     * the crate is already yours.
     */
    expect(LABEL_NEAR, 'fully up outside the collection radius').toBeGreaterThan(PICKUP_RADIUS)
    expect(labelOpacity(PICKUP_RADIUS)).toBe(1)
    expect(LABEL_FAR, 'and starts appearing several car-lengths out').toBeGreaterThan(
      PICKUP_RADIUS * 3,
    )
  })

  it('is off at range and solid up close', () => {
    expect(labelOpacity(LABEL_FAR)).toBe(0)
    expect(labelOpacity(LABEL_FAR + 50)).toBe(0)
    expect(labelOpacity(LABEL_NEAR)).toBe(1)
    expect(labelOpacity(0)).toBe(1)
  })

  it('ramps rather than switches', () => {
    // A hard cut-on flickers whenever you drive along the edge of the circle,
    // and the flicker is more distracting than the label is useful.
    const mid = labelOpacity((LABEL_FAR + LABEL_NEAR) / 2)
    expect(mid).toBeGreaterThan(0.2)
    expect(mid).toBeLessThan(0.8)
  })

  it('never gets fainter as you approach', () => {
    let previous = 0
    for (let d = LABEL_FAR + 5; d >= 0; d -= 0.5) {
      const opacity = labelOpacity(d)
      expect(opacity, `opacity dipped at ${d}m`).toBeGreaterThanOrEqual(previous)
      previous = opacity
    }
    expect(previous).toBe(1)
  })
})

describe('the hover the glow rides on', () => {
  /**
   * `crateLift` is shared by the crate mesh and by its glow and label. These
   * tests are about the property that makes sharing safe rather than about the
   * curve itself: it must depend on nothing but the pickup's identity and the
   * tick, so two callers holding the same pickup cannot disagree.
   */
  it('depends only on the id and the tick', () => {
    expect(crateLift(3, 120)).toBe(crateLift(3, 120))
    expect(crateLift(3, 120)).not.toBe(crateLift(3, 121))
  })

  it('puts different crates at different points in the bob', () => {
    // Sixteen crates rising and falling together reads as the scene pulsing,
    // not as sixteen objects hovering.
    const heights = new Set(PROVING_GROUND.pickups.map((p) => crateLift(p.id, 0).toFixed(4)))
    expect(heights.size, 'the arena is not bobbing in unison').toBeGreaterThan(4)
  })

  it('stays a hover, not a launch', () => {
    for (const pickup of PROVING_GROUND.pickups) {
      for (let tick = 0; tick < 400; tick += 7) {
        const lift = crateLift(pickup.id, tick)
        expect(lift).toBeGreaterThan(0.8)
        expect(lift).toBeLessThan(1.4)
      }
    }
  })
})
