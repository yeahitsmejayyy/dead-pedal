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
import { healthCss, healthRgb } from '../../src/view/palette'

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
