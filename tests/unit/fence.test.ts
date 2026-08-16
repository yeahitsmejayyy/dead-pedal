/**
 * The perimeter fence.
 *
 * Two things here are easy to get backwards and impossible to see from the
 * chase camera, which is 100m from the nearest fence at spawn.
 *
 * THE LEAN. Barbed arms that tilt OUTWARD are a fence keeping people out; ones
 * that tilt INWARD are keeping something in. They look nearly identical from
 * inside the arena and say opposite things about what this place is. The sign
 * of that tilt is computed per side from a hand-written `inward` argument, and
 * a flipped sign on one of the four sides would be invisible in play.
 *
 * THE DAMAGE. It is seeded, so "some spans are torn" is a property that either
 * holds or silently stops holding when a constant moves.
 */
import { describe, expect, it } from 'vitest'
import { Box3, Vector3 } from 'three'
import { buildFence, KERB_HEIGHT } from '../../src/view/fence'
import { PROVING_GROUND } from '../../src/content/arenas/proving-ground'

const arena = PROVING_GROUND
const { x: hx, z: hz } = arena.halfExtents

/** Centre of a geometry, in world space. */
function centreOf(geometry: { computeBoundingBox: () => void; boundingBox: Box3 | null }): Vector3 {
  geometry.computeBoundingBox()
  return geometry.boundingBox?.getCenter(new Vector3()) ?? new Vector3()
}

describe('the perimeter fence', () => {
  const fence = buildFence(arena)

  const spans = Math.round((hz * 2) / 9) * 2 + Math.round((hx * 2) / 9) * 2

  it('builds all four kinds of part', () => {
    // The kerb is cast per SPAN, not one slab per side, so each section can
    // settle and tilt on its own. A single extruded box per wall is the most
    // untouched-looking thing you can put in a wasteland.
    expect(fence.kerb.length, 'one kerb section per span').toBe(spans)
    expect(fence.posts.length, 'two segments per post, plus rails and arms').toBeGreaterThan(spans * 2)
    expect(fence.mesh.length).toBeGreaterThan(20)
    expect(fence.barbed.length).toBeGreaterThan(20)
  })

  it('cuts its barbed wire out of quads rather than extruding bars', () => {
    // Four vertices is a plane. A box has 24, and a box is what this used to be
    // — which is to say a bar, which is not barbed wire. The silhouette lives
    // in the alpha map, so the geometry underneath must stay a quad.
    for (const strand of fence.barbed) {
      expect(strand.getAttribute('position').count).toBe(4)
    }
  })

  it('tears out some spans but nothing like all of them', () => {
    expect(fence.mesh.length, 'most spans still have their wire').toBeGreaterThan(spans * 0.7)
    expect(fence.mesh.length, 'but some are torn out').toBeLessThan(spans)
  })

  it('leaves wreckage rather than clean gaps', () => {
    // Damage has to leave something behind. A span that is simply absent reads
    // as "not installed yet"; a half-height panel reads as a top ripped away.
    // So the panels must NOT all be full height.
    const heights = fence.mesh.map((panel) => {
      const box = new Box3().setFromBufferAttribute(panel.getAttribute('position') as never)
      return box.max.y - box.min.y
    })
    const tallest = Math.max(...heights)
    const partial = heights.filter((h) => h < tallest * 0.85).length
    expect(partial, 'some sections are torn down to a stub').toBeGreaterThan(0)
  })

  it('leans its barbed wire INWARD on all four sides', () => {
    let checked = 0
    for (const strand of fence.barbed) {
      const c = centreOf(strand)
      // Which wall this strand belongs to is whichever axis it is extreme on.
      const nearX = Math.abs(Math.abs(c.x) - hx) < Math.abs(Math.abs(c.z) - hz)

      if (nearX) {
        // On the ±X walls the strand must sit closer to the centre than the
        // wall line it hangs off. Outward lean would put it further out.
        expect(Math.abs(c.x), `strand at x=${c.x.toFixed(2)} must be inside the wall`).toBeLessThan(hx)
      } else {
        expect(Math.abs(c.z), `strand at z=${c.z.toFixed(2)} must be inside the wall`).toBeLessThan(hz)
      }
      checked++
    }
    expect(checked, 'and there were strands to check').toBeGreaterThan(20)
  })

  it('hangs the barbed wire above the wire, not through it', () => {
    const wireTop = arena.groundY + arena.wallHeight
    for (const strand of fence.barbed) {
      expect(centreOf(strand).y).toBeGreaterThanOrEqual(wireTop - 0.01)
    }
  })

  it('stands the wire on the kerb rather than in the dirt', () => {
    for (const panel of fence.mesh) {
      const box = new Box3().setFromBufferAttribute(panel.getAttribute('position') as never)
      /**
       * Tolerance derived, not guessed: a sagging panel drops 12cm off its post
       * and tilts up to 0.05 rad, which over a 9m span lowers the far corner by
       * another 22cm. 0.4 leaves margin on that and still catches wire buried in
       * the dirt, which would be a bug rather than a look.
       */
      expect(box.min.y, 'the wire sits on the kerb, give or take a sag').toBeGreaterThan(
        arena.groundY + KERB_HEIGHT - 0.4,
      )
      expect(box.max.y, 'and never above the rail').toBeLessThan(arena.groundY + arena.wallHeight + 0.2)
    }
  })
})
