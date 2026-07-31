/**
 * L0 — plain-data 3D vectors.
 *
 * Values are immutable by convention: every function returns a fresh object and
 * never writes to its arguments. If the sim's allocation rate ever shows up in a
 * profile, the fix is to add `*Into(out, a, b)` variants alongside these — not to
 * start mutating these.
 */

export type Vec3 = { readonly x: number; readonly y: number; readonly z: number }

export const ZERO: Vec3 = Object.freeze({ x: 0, y: 0, z: 0 })
export const UP: Vec3 = Object.freeze({ x: 0, y: 1, z: 0 })

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z }
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

export function scale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s }
}

/** `a + b * s` — the integrator's inner loop, worth having as one call. */
export function addScaled(a: Vec3, b: Vec3, s: number): Vec3 {
  return { x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s }
}

export function negate(a: Vec3): Vec3 {
  return { x: -a.x, y: -a.y, z: -a.z }
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

export function lengthSq(a: Vec3): number {
  return a.x * a.x + a.y * a.y + a.z * a.z
}

export function length(a: Vec3): number {
  return Math.sqrt(lengthSq(a))
}

export function distanceSq(a: Vec3, b: Vec3): number {
  return lengthSq(sub(a, b))
}

export function distance(a: Vec3, b: Vec3): number {
  return Math.sqrt(distanceSq(a, b))
}

/**
 * Unit vector, or `fallback` when `a` is degenerate. Never returns NaN — a single
 * NaN loose in the sim poisons every subsequent tick and the hash goes with it.
 */
export function normalize(a: Vec3, fallback: Vec3 = ZERO): Vec3 {
  const lenSq = lengthSq(a)
  if (lenSq === 0 || !Number.isFinite(lenSq)) return fallback
  return scale(a, 1 / Math.sqrt(lenSq))
}

export function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  }
}

export function equals(a: Vec3, b: Vec3, epsilon = 1e-9): boolean {
  return (
    Math.abs(a.x - b.x) <= epsilon &&
    Math.abs(a.y - b.y) <= epsilon &&
    Math.abs(a.z - b.z) <= epsilon
  )
}

export function isFinite(a: Vec3): boolean {
  return Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z)
}
