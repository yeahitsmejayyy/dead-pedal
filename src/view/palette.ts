/**
 * L3 — colours shared between the 3D scene and the DOM overlay.
 *
 * This file exists because the health ramp was written twice — once as a
 * three.js `Color` for the floating bars and once as a CSS string for the HUD —
 * and the two could not be made to agree. three interpolates in *linear* space
 * and CSS in *sRGB*, so even with identical endpoints the midpoints differed by
 * about 8%: a car reading yellow overhead while your own bar still read green.
 *
 * One function, sRGB bytes, both consumers convert at the edge. Testing that
 * two copies agree is worse than not having two copies.
 */

/** sRGB bytes. */
export type Rgb = readonly [number, number, number]

const FULL: Rgb = [0x4a, 0xde, 0x80]
const HURT: Rgb = [0xfa, 0xcc, 0x15]
const CRITICAL: Rgb = [0xef, 0x44, 0x44]

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ]
}

/** Above this the bar is simply green. */
const HEALTHY = 0.6
/** Squarely yellow here — the middle of "weak". */
const WEAK = 0.35
/** Below this the bar is simply red. */
const DANGER = 0.12

/**
 * Green → yellow → red, as sRGB bytes.
 *
 * Three colours with **plateaus at each end**, not a continuous blend between
 * them. A straight two-segment ramp put yellow at half health, which meant a
 * car at 62% already read yellow — and "yellow" is supposed to mean weak, not
 * lightly scratched. Green now holds to 60% and red owns everything under 12%,
 * so each colour means one thing rather than being a point you sweep past.
 *
 * Clamped here rather than trusting the caller: linear interpolation
 * extrapolates happily, and a fraction slightly outside 0..1 produced negative
 * colour channels.
 */
export function healthRgb(fraction: number): Rgb {
  const t = fraction < 0 ? 0 : fraction > 1 ? 1 : fraction

  if (t >= HEALTHY) return FULL
  if (t <= DANGER) return CRITICAL
  if (t >= WEAK) return mix(HURT, FULL, (t - WEAK) / (HEALTHY - WEAK))
  return mix(CRITICAL, HURT, (t - DANGER) / (WEAK - DANGER))
}

export function healthCss(fraction: number): string {
  const [r, g, b] = healthRgb(fraction)
  return `rgb(${r}, ${g}, ${b})`
}
