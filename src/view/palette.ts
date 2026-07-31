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

/**
 * Car paint. Player first, then opponents, cycled if there are more cars.
 *
 * Here rather than in `vehicleView.ts` for the same reason the health ramp is:
 * the radar draws a blip per car and has to agree with the paint on the car, and
 * a second copy of these four numbers is a second copy that can drift.
 */
export const LIVERIES = [0xd8452f, 0x3f8ecc, 0x6bbf59, 0xc9a227] as const

/** A car's paint as a CSS colour, for the DOM overlay and the radar. */
export function liveryCss(id: number): string {
  return hexCss(LIVERIES[((id % LIVERIES.length) + LIVERIES.length) % LIVERIES.length]!)
}

/**
 * What each kind of crate is worth, by colour.
 *
 * Every crate used to be the same olive box, so the only way to find out what
 * you had just driven through was to watch the ammo counter afterwards — by
 * which point you had already spent the detour. The colour is the label.
 *
 * Here rather than in `content/weapons.ts` for the reason this file exists: the
 * crate in the arena and the pip in the HUD have to be the same colour or the
 * whole scheme teaches the player nothing, and two copies of a colour are two
 * copies that can drift. Weapons are content; what they look like is view.
 *
 * Held clear of the four car liveries, which is harder than it sounds and is
 * why several of these are lighter than the obvious choice. The cars already
 * span red, blue, green and gold, so the whole saturated wheel is spoken for:
 * the natural rocket orange (0xff8c1a) measures 60 from the gold car, plain
 * hazard yellow 68, and the health green at the top of the bar ramp 60 from the
 * green car. Every one of those is close enough to misread at distance, on a
 * bobbing 1.5m cube, in the middle of a fight. Going a step lighter buys the
 * separation back without giving up the meaning — this health green is still
 * obviously green.
 *
 * The distances are asserted, not eyeballed. See the crate-colour tests.
 */
export const PICKUP_COLOURS = {
  machineGun: 0xe6edf3, // steel-white — the default gun, the plainest crate
  rocket: 0xff9f7a, // warm, and pushed pale to clear the gold car
  homingMissile: 0xb44cff, // violet, and nothing else in the scene is violet
  mine: 0xfff35c, // hazard yellow, which is what a mine is
  health: 0x86ffb0, // the health ramp's green, lightened off the green car
  armour: 0x7dd3fc, // ice blue: related to health, plainly not the same thing
} as const

export type PickupColourKey = keyof typeof PICKUP_COLOURS

function hexCss(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`
}

/** The crate colour for a pickup, as a packed hex for three.js. */
export function pickupHex(key: string): number {
  return PICKUP_COLOURS[key as PickupColourKey] ?? 0x8a8f3c
}

/** The same colour as CSS, for the HUD pips. */
export function pickupCss(key: string): string {
  return hexCss(pickupHex(key))
}

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
