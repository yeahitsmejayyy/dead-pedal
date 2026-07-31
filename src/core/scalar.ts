/** L0 — scalar helpers the vehicle model leans on every tick. */

export const TAU = Math.PI * 2

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Move `value` toward `target` by at most `maxDelta`. Never overshoots. */
export function moveToward(value: number, target: number, maxDelta: number): number {
  const delta = target - value
  if (delta > maxDelta) return value + maxDelta
  if (delta < -maxDelta) return value - maxDelta
  return target
}

/** Shrink a magnitude toward zero by `amount`, stopping at zero. */
export function decay(value: number, amount: number): number {
  return moveToward(value, 0, Math.abs(amount))
}

/** Wrap an angle into (-π, π]. */
export function wrapAngle(radians: number): number {
  const wrapped = ((radians + Math.PI) % TAU + TAU) % TAU
  return wrapped - Math.PI
}

/** Signed shortest angular distance from `a` to `b`, in (-π, π]. */
export function angleDelta(a: number, b: number): number {
  return wrapAngle(b - a)
}

/** Interpolate angles the short way round. */
export function lerpAngle(a: number, b: number, t: number): number {
  return wrapAngle(a + angleDelta(a, b) * t)
}
