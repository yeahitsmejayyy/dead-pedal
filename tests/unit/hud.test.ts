/**
 * The health colour ramp, in both places it exists.
 *
 * The floating bars are three.js `Color`s and the HUD is a CSS string, so they
 * are two implementations of one rule — which is exactly the kind of pair that
 * drifts. These tests pin the rule and then pin that the two agree.
 */
import { describe, expect, it } from 'vitest'
import { Color } from 'three'
import { healthColour as barColour } from '../../src/view/healthBars'
import {
  LIVERIES,
  PICKUP_COLOURS,
  healthCss,
  healthRgb,
  pickupCss,
  pickupHex,
} from '../../src/view/palette'
import { WEAPONS } from '../../src/content/weapons'

const rgb = (css: string): number[] =>
  css.match(/\d+/g)!.map(Number)

/**
 * The bar colour as sRGB bytes.
 *
 * `Color.r/g/b` are *linear*: three converts on construction and back on
 * output, so reading the raw channels and scaling by 255 compares linear
 * numbers against the HUD's sRGB ones and they will never agree.
 * `getHexString` does the conversion the renderer does.
 */
const bar = (fraction: number): number[] => {
  const hex = barColour(fraction, new Color()).getHexString()
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
}

describe('the health colour ramp', () => {
  it('is green at full health', () => {
    const [r, g, b] = bar(1)
    expect(g).toBeGreaterThan(180)
    expect(g).toBeGreaterThan(r!)
    expect(g).toBeGreaterThan(b!)
  })

  it('stays green while the car is merely scratched', () => {
    // The whole reason for the plateau: 62% health is not "weak", and a
    // straight ramp had it reading yellow.
    for (const fraction of [1, 0.85, 0.7, 0.62]) {
      expect(bar(fraction), `at ${fraction}`).toEqual(bar(1))
    }
  })

  it('is yellow when weak', () => {
    const [r, g, b] = bar(0.35)
    // Red and green high and close together, blue low: that is yellow.
    expect(r).toBeGreaterThan(180)
    expect(g).toBeGreaterThan(180)
    expect(Math.abs(r! - g!)).toBeLessThan(60)
    expect(b!).toBeLessThan(90)
  })

  it('is fully red once health is dangerous', () => {
    for (const fraction of [0.12, 0.06, 0]) {
      expect(bar(fraction), `at ${fraction}`).toEqual(bar(0))
    }
  })

  it('is red at the bottom', () => {
    const [r, g, b] = bar(0)
    expect(r).toBeGreaterThan(180)
    expect(r).toBeGreaterThan(g! + 60)
    expect(r).toBeGreaterThan(b! + 60)
  })

  it('moves away from green as health drops', () => {
    let previous = Number.POSITIVE_INFINITY
    for (const fraction of [1, 0.6, 0.5, 0.4, 0.3, 0.2, 0]) {
      const [r, g] = bar(fraction)
      const greenness = g! - r!
      expect(greenness, `at ${fraction}`).toBeLessThanOrEqual(previous)
      previous = greenness
    }
  })

  it('clamps outside 0..1 rather than producing nonsense', () => {
    for (const fraction of [-1, 0, 1, 2]) {
      for (const channel of bar(fraction)) {
        expect(channel).toBeGreaterThanOrEqual(0)
        expect(channel).toBeLessThanOrEqual(255)
      }
    }
  })

  it('gives the scene and the HUD the same colour', () => {
    // One ramp, two consumers. The three.js side converts sRGB -> linear on the
    // way in and back on the way out, so a byte or two of rounding is expected
    // and anything more means the conversion is wrong.
    for (const fraction of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      const scene = bar(fraction)
      const hud = rgb(healthCss(fraction))
      const source = healthRgb(fraction)
      for (let i = 0; i < 3; i++) {
        expect(hud[i], `HUD channel ${i} at ${fraction}`).toBe(source[i])
        expect(Math.abs(scene[i]! - source[i]!), `scene channel ${i} at ${fraction}`)
          .toBeLessThanOrEqual(2)
      }
    }
  })
})

/**
 * Crate colour is a legend, and a legend only works if it is complete.
 *
 * The crate in the arena and the pip in the HUD read the same map, so they
 * cannot disagree with each other. What they *can* do is silently say nothing:
 * add a weapon, forget the colour, and `pickupHex` falls back to the old olive —
 * which is not an error anywhere, just a crate that has stopped explaining
 * itself. That is what these pin.
 */
describe('what is in the crate, by colour', () => {
  it('has a colour for every weapon a crate can hold', () => {
    for (const id of Object.keys(WEAPONS)) {
      expect(PICKUP_COLOURS, `no crate colour for ${id}`).toHaveProperty(id)
    }
  })

  it('has a colour for the crates that are not weapons', () => {
    expect(PICKUP_COLOURS).toHaveProperty('health')
    expect(PICKUP_COLOURS).toHaveProperty('armour')
  })

  const apart = (a: number, b: number): number =>
    Math.hypot(((a >> 16) & 0xff) - ((b >> 16) & 0xff), ((a >> 8) & 0xff) - ((b >> 8) & 0xff), (a & 0xff) - (b & 0xff))

  it('gives every crate a colour of its own', () => {
    const seen = Object.entries(PICKUP_COLOURS)
    for (const [[ka, a], [kb, b]] of seen.flatMap((x, i) => seen.slice(i + 1).map((y) => [x, y] as const))) {
      // 80 in sRGB. The tightest real pair is health against armour at 88 —
      // both are green-blue "good pickup" colours and that is fine, because
      // taking the wrong one is never a mistake worth punishing.
      expect(apart(a, b), `${ka} and ${kb} are the same colour`).toBeGreaterThan(80)
    }
  })

  it('keeps crates clear of the cars, which are the other coloured things', () => {
    // A rocket crate the same orange as a car is the confusion the scheme
    // exists to remove, so this is asserted rather than assumed. It has already
    // earned its place once: the obvious palette put rocket 60 from the gold
    // car, hazard yellow 68, and health green 60 from the green car, and this
    // test is what said so. The tightest surviving pair is rocket at 99.
    for (const [key, crate] of Object.entries(PICKUP_COLOURS)) {
      for (const car of LIVERIES) {
        expect(apart(crate, car), `${key} is too close to a car's paint`).toBeGreaterThan(90)
      }
    }
  })

  it('reports the same colour to the scene and to the HUD', () => {
    // One reads a packed hex for three.js, the other a CSS string for a pip.
    // Two readers of one table is fine; two tables would not be.
    expect(pickupCss('rocket')).toBe(`#${pickupHex('rocket').toString(16).padStart(6, '0')}`)
    expect(pickupHex('homingMissile')).toBe(PICKUP_COLOURS.homingMissile)
  })
})
