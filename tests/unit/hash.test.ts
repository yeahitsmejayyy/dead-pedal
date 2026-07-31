import { describe, expect, it } from 'vitest'
import { canonicalJson, hashState, hashString } from '../../src/core/hash'

describe('canonicalJson', () => {
  it('is insensitive to key order', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }))
  })

  it('is sensitive to array order', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]))
  })

  it('distinguishes NaN from null', () => {
    // JSON.stringify turns both into "null", which would let a NaN bug hash clean.
    expect(canonicalJson({ v: NaN })).not.toBe(canonicalJson({ v: null }))
    expect(canonicalJson({ v: NaN })).toContain('NaN')
  })

  it('distinguishes the infinities', () => {
    expect(canonicalJson(Infinity)).not.toBe(canonicalJson(-Infinity))
    expect(canonicalJson(Infinity)).not.toBe(canonicalJson(null))
  })

  it('treats -0 and 0 as the same state', () => {
    expect(canonicalJson(-0)).toBe(canonicalJson(0))
  })

  it('recurses through nested structures', () => {
    const nested = { a: [{ z: 1, y: [2, { x: 3 }] }] }
    expect(canonicalJson(nested)).toBe(canonicalJson(structuredClone(nested)))
  })

  it('refuses values that are not plain data', () => {
    expect(() => canonicalJson({ fn: () => 1 })).toThrow(TypeError)
    expect(() => canonicalJson({ sym: Symbol('x') })).toThrow(TypeError)
  })
})

describe('hashString', () => {
  it('returns 16 hex characters', () => {
    expect(hashString('hello')).toMatch(/^[0-9a-f]{16}$/)
    expect(hashString('')).toMatch(/^[0-9a-f]{16}$/)
  })

  it('is stable across calls', () => {
    expect(hashString('dead-pedal')).toBe(hashString('dead-pedal'))
  })

  it('separates inputs that differ by one bit of text', () => {
    expect(hashString('tick:1')).not.toBe(hashString('tick:2'))
  })
})

describe('hashState', () => {
  it('agrees for structurally identical values', () => {
    expect(hashState({ tick: 1, pos: { x: 0, y: 0, z: 0 } })).toBe(
      hashState({ pos: { z: 0, y: 0, x: 0 }, tick: 1 }),
    )
  })

  it('disagrees when any number changes', () => {
    expect(hashState({ x: 1.0000001 })).not.toBe(hashState({ x: 1.0000002 }))
  })
})
