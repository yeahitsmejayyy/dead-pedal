/**
 * L3 — per-car paint, by rewriting the texture atlas rather than tinting it.
 *
 * The old approach multiplied one colour over the whole model, which cannot
 * express "charcoal body, galvanised plate, blue plough" because every texel
 * gets the same multiplier. It also washed the paint out: `lerp(white, livery,
 * 0.55)` turned the player's `#d8452f` into `#ebb9b6` dusty pink, so the car and
 * its own radar blip disagreed.
 *
 * These models share one PALETTE ATLAS — 82 flat swatches, no gradients, no
 * anti-aliasing, UVs pointing at swatch centres. That means a swatch is
 * addressable: find every texel of one exact colour and write a different exact
 * colour over it, and you have repainted one part of the car and nothing else.
 * A per-car copy of the atlas costs 512×512 once per car at load.
 *
 * WHICH SWATCH IS WHAT was measured, not guessed. Vertex counts lie — a large
 * flat panel has few vertices — so coverage below is triangle AREA summed per
 * sampled swatch. That is how we know the pickup's blue is bodywork at 11.4% of
 * its surface while the grey it sits next to is armour plate at 44.1%.
 */
import { CanvasTexture, NearestFilter, type Texture } from 'three'

/** A group of atlas swatches that get repainted together. */
export type Family = {
  /** Exact atlas colours, as measured. */
  readonly from: readonly number[]
  /** What they become. */
  readonly to: number
  /**
   * How much of the family's internal lightness variation to keep, 0..1.
   *
   * 1 preserves it exactly, which is right when a family is one material at
   * several shades. Lower values pull the swatches together toward the target,
   * which is what you want when a family contains an outlier that would
   * otherwise dominate — the box truck's cab panel is a near-white at lightness
   * 0.75 against a family mean of 0.52, and preserving that offset produced a
   * pale patchy green when the brief was a DARKER green. Defaults to 1.
   */
  readonly spread?: number
  readonly what: string
}

export type CarPaint = {
  /** Named so the reference sheet and ART.md can say which is which. */
  readonly treatment: string
  readonly families: readonly Family[]
}

/**
 * Armour is a different metal on every car, and that is the point.
 *
 * Four cars sharing one grey plate read as one kit-bashed vehicle in four
 * colours. Giving each its own metal — and its own relationship between metal
 * and paint — is what makes the silhouette legible at the distance you actually
 * fight at, which is the same argument that got four different body shapes.
 *
 * Every swatch listed here was measured off the atlas. Anything not listed is
 * left exactly as it is, which is deliberate: the rusts (`#923c12`, `#8b755e`,
 * `#5a4b3e`), the near-blacks that are glass and tyre (`#1f1f1f`, `#141414`) and
 * the light units carry the grime and must survive being repainted.
 */
export const CAR_PAINT: Readonly<Record<string, CarPaint>> = {
  /**
   * Livery 0, the player. Body was 64.3% of the surface in one saturated
   * yellow, which makes it the cleanest car to repaint and the right one to
   * carry the loudest colour.
   */
  Vehicle_Sports: {
    treatment: 'bare scratched steel',
    families: [
      { from: [0xdaa700], to: 0xd8452f, what: 'body' },
      // Warm and dirty rather than bright. This model carries no rust swatches
      // of its own — it is the clean car — so its only route to looking used is
      // for the bumpers, mirrors and surrounds to read as scuffed dirty metal.
      { from: [0x7c7c7c, 0x353535], to: 0x8a8078, what: 'trim — scuffed dirty steel' },
    ],
  },

  /**
   * Livery 1. Charcoal cannot be the identity colour — a `#36393f` blip
   * measures 1.62:1 against the radar dial and is invisible — so the body goes
   * charcoal and the identity blue moves onto the plough, which is the most
   * front-facing surface on the car and the only saturated thing left on it.
   *
   * Which swatch is which was settled by rendering each one in a debug colour
   * and looking, after two attempts got it backwards from area figures alone:
   * `#585858` is the BOLTED PLATE on the bonnet and bed rails, and `#4e8aac`
   * with `#adadad` are the cab and flank panels. Coverage percentages cannot
   * tell you that, because they count the underside and the interior.
   */
  Vehicle_Pickup_Armored: {
    treatment: 'galvanised zinc',
    families: [
      { from: [0x4e8aac], to: 0x3a3e45, what: 'body — cab and flanks, charcoal' },
      { from: [0xadadad], to: 0x2f333a, what: 'body — rockers and arches, a step darker' },
      { from: [0x585858], to: 0x9aa3ab, what: 'armour — bolted plate, galvanised' },
      { from: [0x444444], to: 0x7c848c, what: 'armour — shadowed plate' },
      { from: [0x8b8786], to: 0x8f979e, what: 'armour — bright plate' },
      { from: [0x9e731d], to: 0x3f8ecc, what: 'plough — carries the identity' },
      { from: [0xb89651], to: 0x4f9ad4, what: 'plough — lit edge' },
      { from: [0xcaa507], to: 0x5aa6de, what: 'plough — highlight' },
    ],
  },

  /**
   * Livery 2. Red-oxide primer against green is the loudest pairing here and it
   * is doing a job: the truck is the slabbiest silhouette and the easiest to
   * lose against a dirt floor, so it gets the highest-contrast armour.
   *
   * Each green is targeted separately rather than as one family. `#c0bfbc` is
   * the big box panel and the near-white of the set, and carrying its lightness
   * across — even compressed — kept landing it in bright green when the brief
   * was darker. A single-swatch family lands exactly on its target.
   */
  Vehicle_Truck_Armored: {
    treatment: 'red-oxide primer',
    families: [
      { from: [0xc0bfbc], to: 0x3d7a35, what: 'body — box panels and rear doors' },
      { from: [0x757a6a], to: 0x35682f, what: 'body — roof band, darker' },
      { from: [0x939e3e], to: 0x4a8f3f, what: 'body — cab' },
      { from: [0x687a65], to: 0x2f5c2a, what: 'body — the mottled patches, darkest' },
      { from: [0x585858], to: 0x6f4632, what: 'armour — plough and bumpers, red-oxide primer' },
      { from: [0x444444], to: 0x593727, what: 'armour — rack and arches, shadowed' },
    ],
  },

  /**
   * Livery 3. The one car whose armour stays grey, because gold against dark
   * steel is already the highest-contrast body-to-plate relationship of the
   * four and does not need help.
   */
  Vehicle_Sports_Armored: {
    treatment: 'chipped paint over dark steel',
    families: [
      { from: [0xdaa700], to: 0xc9a227, what: 'body' },
      { from: [0x585858, 0x7c7c7c, 0x353535, 0x444444], to: 0x4a4f57, what: 'armour — dark cool steel' },
    ],
  },
}

/** sRGB bytes to HSL, all 0..1. Hand-rolled to stay out of three's linear working space. */
function toHsl(r: number, g: number, b: number): [number, number, number] {
  const [x, y, z] = [r / 255, g / 255, b / 255]
  const max = Math.max(x, y, z)
  const min = Math.min(x, y, z)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === x ? (y - z) / d + (y < z ? 6 : 0) : max === y ? (z - x) / d + 2 : (x - y) / d + 4
  return [h / 6, s, l]
}

function fromHsl(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255)
    return [v, v, v]
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (t: number): number => {
    let u = t
    if (u < 0) u += 1
    if (u > 1) u -= 1
    if (u < 1 / 6) return p + (q - p) * 6 * u
    if (u < 1 / 2) return q
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6
    return p
  }
  return [Math.round(channel(h + 1 / 3) * 255), Math.round(channel(h) * 255), Math.round(channel(h - 1 / 3) * 255)]
}

/**
 * Build the swatch substitution for one car.
 *
 * Lightness is carried across rather than flattened. A family is usually three
 * or four values of one material — a lit panel, a shaded panel, a seam — and
 * collapsing them all onto the target colour would remove the only shading
 * these flat-shaded models have. Each swatch keeps its offset from its own
 * family's mean, so the relationship survives the repaint.
 */
export function buildSubstitution(paint: CarPaint): Map<number, number> {
  const out = new Map<number, number>()
  for (const family of paint.families) {
    const lightnesses = family.from.map((hex) => toHsl((hex >> 16) & 255, (hex >> 8) & 255, hex & 255)[2])
    const mean = lightnesses.reduce((a, b) => a + b, 0) / Math.max(lightnesses.length, 1)
    const [th, ts, tl] = toHsl((family.to >> 16) & 255, (family.to >> 8) & 255, family.to & 255)
    const spread = family.spread ?? 1
    for (const [i, hex] of family.from.entries()) {
      const l = Math.min(0.96, Math.max(0.04, tl + (lightnesses[i]! - mean) * spread))
      const [r, g, b] = fromHsl(th, ts, l)
      out.set(hex, (r << 16) | (g << 8) | b)
    }
  }
  return out
}

/**
 * A repainted copy of the atlas.
 *
 * Filtering and wrapping are copied off the source rather than chosen, so the
 * repainted car renders exactly like the original did — except for the colours
 * that were deliberately changed. `NearestFilter` is forced on magnification
 * only: this is a palette atlas whose swatches are a few texels wide, and linear
 * magnification bleeds one swatch into its neighbour along every UV island edge.
 */
export function repaint(source: Texture, paint: CarPaint): CanvasTexture | null {
  const image = source.image as CanvasImageSource & { width?: number; height?: number }
  const width = Number(image.width ?? 0)
  const height = Number(image.height ?? 0)
  if (width === 0 || height === 0) return null

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (ctx === null) return null
  ctx.drawImage(image, 0, 0)

  const pixels = ctx.getImageData(0, 0, width, height)
  const data = pixels.data
  const substitution = buildSubstitution(paint)
  for (let i = 0; i < data.length; i += 4) {
    // Exact match. Safe because the atlas is 82 flat swatches with no
    // anti-aliasing between them — measured, not assumed.
    const replacement = substitution.get((data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!)
    if (replacement === undefined) continue
    data[i] = (replacement >> 16) & 255
    data[i + 1] = (replacement >> 8) & 255
    data[i + 2] = replacement & 255
  }
  ctx.putImageData(pixels, 0, 0)

  const texture = new CanvasTexture(canvas)
  texture.flipY = source.flipY
  texture.colorSpace = source.colorSpace
  texture.wrapS = source.wrapS
  texture.wrapT = source.wrapT
  texture.minFilter = source.minFilter
  texture.magFilter = NearestFilter
  texture.needsUpdate = true
  return texture
}
