import { describe, expect, it } from 'vitest'
import * as V from '../../src/core/vec3'

const a = V.vec3(1, 2, 3)
const b = V.vec3(-4, 5, 0.5)

describe('vec3', () => {
  it('adds, subtracts and scales', () => {
    expect(V.add(a, b)).toEqual({ x: -3, y: 7, z: 3.5 })
    expect(V.sub(a, b)).toEqual({ x: 5, y: -3, z: 2.5 })
    expect(V.scale(a, 2)).toEqual({ x: 2, y: 4, z: 6 })
    expect(V.negate(a)).toEqual({ x: -1, y: -2, z: -3 })
  })

  it('addScaled matches add(a, scale(b, s))', () => {
    expect(V.addScaled(a, b, 0.25)).toEqual(V.add(a, V.scale(b, 0.25)))
  })

  it('dots and crosses', () => {
    expect(V.dot(a, b)).toBe(-4 + 10 + 1.5)
    // Right-handed: x cross y = z.
    expect(V.cross(V.vec3(1, 0, 0), V.vec3(0, 1, 0))).toEqual({ x: 0, y: 0, z: 1 })
    // A vector crossed with itself is zero.
    expect(V.equals(V.cross(a, a), V.ZERO)).toBe(true)
  })

  it('measures length and distance', () => {
    expect(V.length(V.vec3(3, 4, 0))).toBe(5)
    expect(V.lengthSq(V.vec3(3, 4, 0))).toBe(25)
    expect(V.distance(V.vec3(1, 0, 0), V.vec3(4, 4, 0))).toBe(5)
  })

  it('normalizes to unit length', () => {
    expect(V.length(V.normalize(V.vec3(0, 0, -9)))).toBeCloseTo(1, 12)
  })

  it('returns the fallback instead of NaN for degenerate input', () => {
    expect(V.normalize(V.ZERO)).toEqual(V.ZERO)
    expect(V.normalize(V.ZERO, V.UP)).toEqual(V.UP)
    expect(V.isFinite(V.normalize(V.vec3(NaN, 0, 0)))).toBe(true)
    expect(V.isFinite(V.normalize(V.vec3(Infinity, 0, 0)))).toBe(true)
  })

  it('lerps the endpoints exactly', () => {
    expect(V.lerp(a, b, 0)).toEqual(a)
    expect(V.lerp(a, b, 1)).toEqual(b)
    expect(V.lerp(V.ZERO, V.vec3(10, 10, 10), 0.5)).toEqual({ x: 5, y: 5, z: 5 })
  })

  it('never mutates its arguments', () => {
    const source = V.vec3(1, 2, 3)
    V.add(source, b)
    V.scale(source, 99)
    V.normalize(source)
    expect(source).toEqual({ x: 1, y: 2, z: 3 })
  })

  it('detects non-finite components', () => {
    expect(V.isFinite(a)).toBe(true)
    expect(V.isFinite(V.vec3(0, NaN, 0))).toBe(false)
    expect(V.isFinite(V.vec3(0, 0, Infinity))).toBe(false)
  })
})
