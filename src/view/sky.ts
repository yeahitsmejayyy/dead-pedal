/**
 * L3 — the burning dusk, and the city that is burning.
 *
 * WHY THIS IS NOT AN HDRI. Downloading a photographed sunset is the obvious
 * move and it is the wrong one here. The cars are comic-illustrated, the cover
 * has heavy black keylines and a flat silhouette skyline, and a photograph
 * behind that reads as a screenshot from a different game. The cover already
 * shows exactly what this sky should be: a vertical gradient from blood red
 * through burnt orange to a hot amber horizon, with a flat rust-brown skyline
 * cut out against it.
 *
 * So the gradient is generated and the skyline is BUILT FROM GEOMETRY. That
 * last choice buys three things a texture cannot:
 *
 *   Seamless by construction. A 360° panorama has to wrap, and the wrap is
 *   exactly where every generated panorama falls apart. A ring of boxes has no
 *   seam because it has no edges.
 *
 *   Deterministic. The skyline is laid out from the same seeded mulberry32 the
 *   sim uses, so every player sees the same city and the visual-regression
 *   fixture has something stable to compare against.
 *
 *   Cheap. Everything here merges to three draw calls total, whatever the
 *   building count.
 */
import {
  BackSide,
  type BufferGeometry,
  BoxGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SphereGeometry,
  type Scene,
  SRGBColorSpace,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { fromSeed, next, type RngState } from '../core/rng'

/**
 * The dusk ramp, HORIZON FIRST.
 *
 * Read off the cover rather than invented: a hot amber band at the horizon
 * where the fires are, burnt orange above it, and blood red going to near-black
 * overhead. The last stop is deliberately not pure black — a sky that reaches
 * #000 makes the skyline vanish into it and the world loses its lid.
 *
 * Stop 0 is the HORIZON and stop 1 is the zenith, which is the opposite of how
 * this was first written. On a `SphereGeometry` the v coordinate is 0 at the
 * bottom ring and 1 at the pole, so an array running zenith-first produced a
 * sky that was bright overhead and black at the horizon — sunrise on the
 * ceiling.
 */
const DUSK: readonly (readonly [number, string])[] = [
  [0.0, '#f2b357'],
  [0.1, '#e8862a'],
  [0.22, '#c4551a'],
  [0.42, '#7e2a10'],
  [0.66, '#3d1410'],
  [1.0, '#120a0c'],
]

/**
 * Darker than the horizon it stands against, but not by much.
 *
 * A first pass used near-black and the city read as a hole punched in the sky
 * rather than as buildings a kilometre away. Distance desaturates and lifts
 * everything toward the colour of the air between you and it — which is what
 * the fog below is for, and why these are only a step down from the horizon.
 */
const SKYLINE = 0x4a2618
const SMOKE = 0x1c100c

export type SkyOptions = {
  /** Arena half-extent, so the city clears the walls by a sensible margin. */
  readonly arenaHalf: number
  readonly seed?: number
}

/**
 * A soft plume mask: solid at the base, gone at the top, feathered at the sides.
 *
 * Without this the smoke quads are rectangles with hard edges, and a hard-edged
 * grey rectangle standing on a building does not read as smoke — it reads as
 * another building. The alpha is what turns a quad into a column of soot.
 *
 * DRAWN IN GREYSCALE, not in alpha. `alphaMap` in three.js samples the GREEN
 * CHANNEL, not the texture's alpha — so a first attempt that painted white at
 * varying opacity produced green = 255 everywhere and no fade whatsoever. The
 * mask has to be black-to-white pixels.
 */
function plumeTexture(): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new Error('sky: no 2d context')

  // Vertical: dense where it leaves the roof, dispersed at the top.
  const rise = ctx.createLinearGradient(0, canvas.height, 0, 0)
  rise.addColorStop(0, '#ffffff')
  rise.addColorStop(0.3, '#8c8c8c')
  rise.addColorStop(1, '#000000')
  ctx.fillStyle = rise
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // Multiplied by a horizontal falloff, so the column has no vertical edges.
  ctx.globalCompositeOperation = 'multiply'
  const sides = ctx.createLinearGradient(0, 0, canvas.width, 0)
  sides.addColorStop(0, '#000000')
  sides.addColorStop(0.35, '#ffffff')
  sides.addColorStop(0.65, '#ffffff')
  sides.addColorStop(1, '#000000')
  ctx.fillStyle = sides
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  return new CanvasTexture(canvas)
}

/** A 2×N vertical gradient. Two pixels wide because one is not a texture. */
function gradientTexture(): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 2
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new Error('sky: no 2d context')

  // Canvas y runs downward and the dome's v runs upward, so the ramp is built
  // inverted here rather than flipping the texture and confusing every reader.
  const ramp = ctx.createLinearGradient(0, canvas.height, 0, 0)
  for (const [stop, hex] of DUSK) ramp.addColorStop(stop, hex)
  ctx.fillStyle = ramp
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

/**
 * Build the dome, the city and its smoke, and add them to the scene.
 *
 * Everything is `MeshBasicMaterial` — unlit, and `fog: false`. This is the
 * backdrop: it must not take the arena's light or its fog, because it is
 * supposed to be kilometres away and lit by the fires in it.
 */
export function createSky(scene: Scene, options: SkyOptions): void {
  const { arenaHalf } = options
  /**
   * The same purely-functional PRNG the sim uses, threaded by hand.
   *
   * Seeded rather than `Math.random` for the same reason the particles are: the
   * visual-regression fixture compares a rendered frame against a committed
   * baseline, and a city that rebuilds itself differently on every load would
   * make that test flake forever.
   */
  let rngState: RngState = fromSeed(options.seed ?? 0x5c1)
  const rand = (): number => {
    const draw = next(rngState)
    rngState = draw.state
    return draw.value
  }

  // ── the dome ───────────────────────────────────────────────────────────────
  /**
   * Big, but INSIDE the camera's far plane, which is 1200m (`camera.ts`).
   *
   * The first version used 14× — 1260m on this arena — so the dome was clipped
   * by the far plane and the scene's black clear colour showed through the
   * hole. On screen that was a huge dark wedge sitting over the arena that
   * looked for all the world like broken geometry.
   */
  const radius = arenaHalf * 11
  const dome = new Mesh(
    new SphereGeometry(radius, 32, 20, 0, Math.PI * 2, 0, Math.PI * 0.52),
    new MeshBasicMaterial({ map: gradientTexture(), side: BackSide, fog: false, depthWrite: false }),
  )
  // Dropped slightly so the gradient's hot band sits ON the horizon rather than
  // above it, which is where the skyline needs to meet it.
  dome.position.y = -radius * 0.06
  dome.renderOrder = -1
  scene.add(dome)

  // ── the city ───────────────────────────────────────────────────────────────
  /**
   * A ring of blocks at a fixed distance, not a dome-mapped image.
   *
   * Far enough out that parallax across the arena is small — the city should
   * feel distant and static — but close enough to sit inside the dome and read
   * as silhouette against the bright part of the gradient.
   */
  /**
   * 11× the arena half-extent, about a kilometre out.
   *
   * A first pass put it at 5.2× and the tallest towers subtended nearly 20° —
   * they read as a black wall standing just outside the fence rather than as a
   * city on the horizon. Distance is the only thing that makes a skyline look
   * like a skyline.
   */
  /**
   * 8× the arena half-extent, about 720m out, and it must stay INSIDE the dome.
   *
   * A first pass put it at 5.2× and the tallest towers subtended nearly 20° —
   * they read as a black wall standing just outside the fence rather than as a
   * city on the horizon. Distance is the only thing that makes a skyline look
   * like a skyline.
   */
  const ring = arenaHalf * 8
  const towers: BufferGeometry[] = []
  const plumes: BufferGeometry[] = []

  const COUNT = 150
  for (let i = 0; i < COUNT; i++) {
    // Jittered rather than evenly spaced, so the skyline reads as a city and
    // not as a fence. Two rows at slightly different depths give it thickness.
    const spread = (Math.PI * 2) / COUNT
    const angle = i * spread + (rand() - 0.5) * spread * 1.6
    const depth = ring * (0.86 + rand() * 0.3)

    // Narrower than the 41m spacing this ring works out to, so the skyline has
    // gaps in it. Wider than that and 150 buildings merge into one continuous
    // ridge — which is what the first pass did, and it looked like a mountain.
    const width = 8 + rand() * 26
    // A few tall ones carry the skyline; most are low. A uniform distribution
    // gives a hedge, which is the giveaway of a procedural city.
    const tall = rand() < 0.22
    // Halved. At 990m a 190m tower subtends 11°, and a row of them filled a
    // sixth of the screen — a city should sit ON the horizon, not loom over it.
    const height = tall ? 34 + rand() * 62 : 8 + rand() * 26

    const box = new BoxGeometry(width, height, width * 0.7)
    box.rotateY(-angle)
    box.translate(Math.sin(angle) * depth, height / 2 - 6, Math.cos(angle) * depth)
    towers.push(box)

    // Smoke rises off a handful of them. Flat quads turned to face the arena
    // centre — at this distance the parallax error from not billboarding is
    // smaller than the width of the plume.
    if (tall && rand() < 0.5) {
      const plumeHeight = 90 + rand() * 170
      const quad = new PlaneGeometry(18 + rand() * 26, plumeHeight)
      quad.rotateY(-angle)
      quad.translate(Math.sin(angle) * depth, height + plumeHeight / 2 - 10, Math.cos(angle) * depth)
      plumes.push(quad)
    }
  }

  const city = mergeGeometries(towers, false)
  if (city !== null) {
    /**
     * Fogged, unlike the dome.
     *
     * The dome IS the sky and must stay pure. The city is a kilometre of dusty
     * air away, and letting the fog wash it toward the horizon colour is the
     * only thing that makes it read as distant rather than as a cut-out held up
     * in front of the camera.
     */
    scene.add(new Mesh(city, new MeshBasicMaterial({ color: new Color(SKYLINE) })))
  }

  const smoke = mergeGeometries(plumes, false)
  if (smoke !== null) {
    scene.add(
      new Mesh(
        smoke,
        new MeshBasicMaterial({
          color: new Color(SMOKE),
          alphaMap: plumeTexture(),
          transparent: true,
          opacity: 0.72,
          side: DoubleSide,
          depthWrite: false,
        }),
      ),
    )
  }
}
