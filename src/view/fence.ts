/**
 * L3 — the perimeter: a concrete kerb, steel posts, chain-link, and barbed wire.
 *
 * The arena used to be bounded by a solid four-metre slab, which read as the
 * inside of a box. A fence does the same collision job — the sim still sees the
 * same wall, because the sim reads `arena.wallHeight` and never asked what it
 * looked like — while letting you see the world you are enclosed in. That is
 * most of what makes an arena feel like a place rather than a room.
 *
 * WHY THE MESH IS DRAWN AND NOT DOWNLOADED. A chain-link diamond is a few
 * straight lines, and generating it buys three things over a photographed
 * texture: it tiles with no seam at any repeat, the wire gauge can be tuned to
 * stay visible at distance instead of dissolving into grey mush, and it needs
 * no download. ambientCG has a CC0 wire mesh and it was the obvious candidate;
 * this is sharper at the scale it is actually seen from.
 *
 * ALPHA TEST, NOT TRANSPARENCY. Cut-out geometry that uses blending has to be
 * depth-sorted, and four overlapping fence panels seen through each other sort
 * wrong from at least one angle in every arena. `alphaTest` writes depth
 * normally and the holes are simply not drawn.
 *
 * WEAR IS GEOMETRY, NOT TEXTURE. The fence is built one post-span at a time
 * rather than one panel per side, so damage can be per span: a torn-out
 * section, a leaning post, a missing barbed arm. Baking tears into the texture
 * instead would repeat them every few metres around a 720m perimeter, and a
 * repeating hole reads as a pattern rather than as damage. The texture carries
 * only what SHOULD repeat — the weave, and the rust in it.
 */
import {
  type BufferGeometry,
  CanvasTexture,
  BoxGeometry,
  CatmullRomCurve3,
  PlaneGeometry,
  RepeatWrapping,
  TubeGeometry,
  Vector3,
} from 'three'
import type { Arena } from '../sim'
import { fromSeed, next, type RngState } from '../core/rng'

/** Metres of concrete under the wire. Stops you seeing under the fence. */
export const KERB_HEIGHT = 0.9

/** Metres between posts, and therefore the length of one repairable section. */
const POST_SPACING = 9

/** Metres of wall one tile of chain-link covers. */
const FENCE_TILE = 2.4

/** Fraction of spans with their wire torn out completely. */
const TORN = 0.09

/** Barbed arms lean this far off vertical, toward the arena. */
const ARM_TILT = 0.72 // radians, about 41°

/** How far up the posts continue past the wire, to carry the barbed wire. */
const ARM_LENGTH = 0.62

/** Radius of a razor-wire coil. Real concertina runs 45–75cm across. */
const COIL_RADIUS = 0.3

/** Metres between turns. Tighter reads as denser and costs more triangles. */
const COIL_PITCH = 0.7

/** Thickness of the wire itself. */
const WIRE_RADIUS = 0.022

/**
 * One tile of chain-link, as a greyscale mask.
 *
 * White is wire, black is hole. Greyscale rather than alpha because three.js
 * `alphaMap` samples the GREEN CHANNEL — a mask painted as transparency reads
 * as fully opaque and the fence comes out solid.
 *
 * The weave is deliberately imperfect: strand thickness wanders and a few
 * strands are broken outright. A perfectly regular diamond grid is the thing
 * that made this read as newly installed, and irregularity is most of what
 * "old" means on a woven surface.
 */
export function chainLinkTexture(): CanvasTexture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new Error('fence: no 2d context')

  let state: RngState = fromSeed(0xfe4ce)
  const rand = (): number => {
    const draw = next(state)
    state = draw.state
    return draw.value
  }

  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, size, size)
  ctx.strokeStyle = '#ffffff'
  ctx.lineCap = 'square'

  // Diamonds are two sets of diagonals. Drawn past the edges in both directions
  // so the pattern is continuous across the tile boundary — a diagonal that
  // stops at the edge leaves a visible grid line every repeat.
  const step = size / 4
  for (const direction of [1, -1]) {
    for (let i = -size; i <= size * 2; i += step) {
      // A broken strand here and there. Kept rare: this tile repeats every
      // 2.4m, so anything common becomes a pattern rather than damage.
      if (rand() < 0.08) continue
      ctx.lineWidth = 3.6 + rand() * 2.2
      ctx.beginPath()
      ctx.moveTo(i, direction > 0 ? 0 : size)
      ctx.lineTo(i + size, direction > 0 ? size : 0)
      ctx.stroke()
    }
  }

  const texture = new CanvasTexture(canvas)
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  return texture
}

/**
 * A mottled rust wash for the wire, at a much coarser scale than the weave.
 *
 * Multiplied over the fence's base colour. Its `repeat` is set low in
 * `renderer.ts` so one blotch covers several metres — rust that repeated at the
 * weave's 2.4m would read as a printed pattern, and the whole point is that it
 * should not look printed.
 */
export function rustTexture(): CanvasTexture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new Error('fence: no 2d context')

  let state: RngState = fromSeed(0x2057)
  const rand = (): number => {
    const draw = next(state)
    state = draw.state
    return draw.value
  }

  // Galvanised grey underneath, oxide blooms over it.
  ctx.fillStyle = '#9a978f'
  ctx.fillRect(0, 0, size, size)

  for (let i = 0; i < 90; i++) {
    const x = rand() * size
    const y = rand() * size
    const r = 6 + rand() * 34
    const bloom = ctx.createRadialGradient(x, y, 0, x, y, r)
    const warmth = 0.45 + rand() * 0.5
    bloom.addColorStop(0, `rgba(122, 58, 24, ${warmth.toFixed(2)})`)
    bloom.addColorStop(1, 'rgba(122, 58, 24, 0)')
    ctx.fillStyle = bloom
    // Drawn four times, wrapped, so blooms crossing an edge continue on the
    // opposite one and the tile stays seamless.
    for (const [ox, oy] of [
      [0, 0],
      [size, 0],
      [0, size],
      [-size, 0],
    ] as const) {
      ctx.save()
      ctx.translate(ox, oy)
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
  }

  const texture = new CanvasTexture(canvas)
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  return texture
}

/**
 * A coil of razor wire, as an actual helix.
 *
 * GEOMETRY THIS TIME, where the flat strands it replaces were an alpha-cut
 * silhouette. The reason is what a concertina coil IS: a spiral you see
 * THROUGH, with the far side of every loop visible inside the near side. That
 * is depth, and depth is the one thing a cut-out quad can never fake — flat
 * strands were fine as strands and would read as a printed sticker as a coil.
 *
 * Affordable because it is coarse. Thirteen turns per 9m span at eight points
 * a turn, on a three-sided tube, is about 620 triangles per span and 50,000
 * for a 720m perimeter — and it still merges into the same single draw call.
 * A three-sided tube is invisible as a triangle at 4cm thick.
 */
function coilGeometry(length: number, radius: number, pitch: number): BufferGeometry {
  const turns = Math.max(2, Math.round(length / pitch))
  const perTurn = 8
  const total = turns * perTurn

  // Built along X and rotated by the caller, the same convention the panels use.
  const points: Vector3[] = []
  for (let i = 0; i <= total; i++) {
    const t = i / total
    const angle = t * turns * Math.PI * 2
    points.push(
      new Vector3(-length / 2 + t * length, Math.cos(angle) * radius, Math.sin(angle) * radius),
    )
  }

  return new TubeGeometry(new CatmullRomCurve3(points), total, WIRE_RADIUS, 3, false)
}

/**
 * Scale a plane's UVs so one texture tile covers `FENCE_TILE` metres.
 *
 * PlaneGeometry always spans 0..1 in UV whatever its size, so a 9m span and a
 * 2m span would each get exactly one diamond stretched across them. The repeat
 * has to be baked per panel, because the texture is shared between all of them
 * and `texture.repeat` is a property of the texture, not of the mesh.
 *
 * `offset` walks the u origin along the wall so neighbouring spans continue one
 * another's weave instead of each restarting it at a strand boundary.
 */
function tileUvs(geometry: BufferGeometry, width: number, height: number, offset: number): void {
  const uv = geometry.getAttribute('uv')
  const u = width / FENCE_TILE
  const v = height / FENCE_TILE
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * u + offset / FENCE_TILE, uv.getY(i) * v)
  }
  uv.needsUpdate = true
}

export type FenceParts = {
  /** Solid concrete along the bottom. */
  readonly kerb: BufferGeometry[]
  /** Steel uprights, top rail, and the barbed arms. */
  readonly posts: BufferGeometry[]
  /** The wire panels themselves. */
  readonly mesh: BufferGeometry[]
  /** Razor-wire coils along the top. */
  readonly barbed: BufferGeometry[]
}

/** Build the perimeter for an arena, in world space, ready to merge. */
export function buildFence(arena: Arena): FenceParts {
  const { x: hx, z: hz } = arena.halfExtents
  const top = arena.wallHeight
  const wireHeight = top - KERB_HEIGHT

  const kerb: BufferGeometry[] = []
  const posts: BufferGeometry[] = []
  const mesh: BufferGeometry[] = []
  const barbed: BufferGeometry[] = []

  let state: RngState = fromSeed(0xba48)
  const rand = (): number => {
    const draw = next(state)
    state = draw.state
    return draw.value
  }
  /** Symmetric jitter in [-n, n]. */
  const jitter = (n: number): number => (rand() - 0.5) * 2 * n

  /**
   * One side of the arena, built span by span.
   *
   * `inward` is the direction the barbed arms lean: toward the middle of the
   * arena, which is what a fence built to keep something IN looks like. A fence
   * angled outward is keeping people out, and says the opposite thing about
   * what this place is.
   */
  const side = (length: number, atX: number, atZ: number, alongZ: boolean, inward: number): void => {
    const spans = Math.max(2, Math.round(length / POST_SPACING))
    const spanLength = length / spans

    for (let i = 0; i < spans; i++) {
      const centre = -length / 2 + spanLength * (i + 0.5)
      const x = atX + (alongZ ? 0 : centre)
      const z = atZ + (alongZ ? centre : 0)

      /**
       * The kerb is per span, not one slab per side.
       *
       * Cast concrete in a wasteland has settled, cracked and been shunted. A
       * continuous extruded box is the single most "untouched" thing you can
       * put in a scene, so each section gets its own small height and tilt.
       */
      const kerbHeight = KERB_HEIGHT * (0.86 + rand() * 0.28)
      const base = new BoxGeometry(
        alongZ ? 0.5 : spanLength * 1.02,
        kerbHeight,
        alongZ ? spanLength * 1.02 : 0.5,
      )
      base.rotateZ(alongZ ? 0 : jitter(0.02))
      base.rotateX(alongZ ? jitter(0.02) : 0)
      base.translate(x, arena.groundY + kerbHeight / 2, z)
      kerb.push(base)

      /**
       * The wire, in one of four states.
       *
       * The previous version only had two — present or absent — and absence
       * reads as "not installed yet" rather than as damage. Something has to be
       * left behind: a bottom half with the top ripped away, or a panel hanging
       * off its post. Wreckage is more convincing than a gap.
       */
      const fate = rand()
      if (fate > TORN) {
        const halfTorn = fate < TORN + 0.13
        const sagging = !halfTorn && fate < TORN + 0.22

        const panelHeight = halfTorn ? wireHeight * (0.35 + rand() * 0.3) : wireHeight
        const panel = new PlaneGeometry(spanLength, panelHeight)
        tileUvs(panel, spanLength, panelHeight, centre)

        if (sagging) {
          // Come away from one post and dropped. Rotating about the fence's own
          // axis is what makes it hang rather than merely lean.
          //
          // 0.05 rad, not the 0.09 this started at. Over a 9m span that was a
          // 40cm drop at the low corner — chain-link is a woven steel sheet, and
          // it does not fold like a curtain. This is a panel that has come loose,
          // not one that has melted.
          panel.rotateZ(alongZ ? 0 : jitter(0.05))
          panel.rotateX(alongZ ? jitter(0.05) : 0)
        }
        if (alongZ) panel.rotateY(Math.PI / 2)
        panel.translate(
          x,
          arena.groundY + KERB_HEIGHT + panelHeight / 2 - (sagging ? 0.12 : 0),
          z,
        )
        mesh.push(panel)
      }

      // The top rail follows the wire: no rail where the section is gone.
      if (fate > TORN + 0.05) {
        const rail = new BoxGeometry(alongZ ? 0.1 : spanLength, 0.1, alongZ ? spanLength : 0.1)
        rail.translate(x, arena.groundY + top + jitter(0.03), z)
        posts.push(rail)
      }

      /**
       * Barbed arms and their wire, leaning in over the arena.
       *
       * A few spans are missing theirs entirely, and the tilt varies. Uniform
       * damage is not damage, it is a texture — the eye reads regularity as
       * intent, so the gaps and the angles have to be irregular to say that
       * something happened here.
       */
      if (rand() > 0.16) {
        const tilt = ARM_TILT + jitter(0.22)
        const armLift = ARM_LENGTH * Math.cos(tilt)
        const armReach = ARM_LENGTH * Math.sin(tilt) * inward

        const arm = new BoxGeometry(0.09, ARM_LENGTH, 0.09)
        arm.rotateZ(alongZ ? -tilt * inward : 0)
        arm.rotateX(alongZ ? 0 : tilt * inward)
        arm.translate(
          x + (alongZ ? armReach / 2 : 0),
          arena.groundY + top + armLift / 2,
          z + (alongZ ? 0 : armReach / 2),
        )
        posts.push(arm)

        /**
         * One coil, riding on the arm tip.
         *
         * Its axis runs ALONG the fence, so consecutive spans read as one
         * continuous run of concertina rather than as a row of separate hoops.
         * Radius jitters a little between spans — a coil is sprung steel that
         * has been stretched by hand, not extruded.
         */
        const coil = coilGeometry(spanLength, COIL_RADIUS * (0.85 + rand() * 0.3), COIL_PITCH)
        if (alongZ) coil.rotateY(Math.PI / 2)
        coil.translate(
          x + (alongZ ? armReach : 0),
          arena.groundY + top + armLift + COIL_RADIUS * 0.55,
          z + (alongZ ? 0 : armReach),
        )
        barbed.push(coil)
      }

      /**
       * The post at the near end of this span, in two segments with a kink.
       *
       * A straight post is a straight post however much you lean it. Real ones
       * that have been driven into take a bend partway up, and the top half
       * carries on at a different angle from the bottom — which is the detail
       * that stops a fence line looking surveyed.
       */
      const px = atX + (alongZ ? 0 : centre - spanLength / 2)
      const pz = atZ + (alongZ ? centre - spanLength / 2 : 0)
      const bent = rand() < 0.28
      const lean = rand() < 0.35 ? jitter(0.09) : 0
      const kink = bent ? jitter(0.3) : 0
      const lower = wireHeight * 0.55
      const upper = wireHeight * 0.45 + ARM_LENGTH * 0.5

      const bottom = new BoxGeometry(0.15, lower, 0.15)
      bottom.rotateZ(alongZ ? 0 : lean)
      bottom.rotateX(alongZ ? lean : 0)
      bottom.translate(px, arena.groundY + KERB_HEIGHT + lower / 2, pz)
      posts.push(bottom)

      const tipOffset = Math.sin(lean) * lower
      const topSeg = new BoxGeometry(0.14, upper, 0.14)
      topSeg.rotateZ(alongZ ? 0 : lean + kink)
      topSeg.rotateX(alongZ ? lean + kink : 0)
      topSeg.translate(
        px + (alongZ ? 0 : tipOffset + Math.sin(lean + kink) * upper * 0.5),
        arena.groundY + KERB_HEIGHT + lower + upper / 2,
        pz + (alongZ ? tipOffset + Math.sin(lean + kink) * upper * 0.5 : 0),
      )
      posts.push(topSeg)
    }
  }

  // `inward` points at the arena centre from each side.
  side(hz * 2, -hx, 0, true, 1)
  side(hz * 2, hx, 0, true, -1)
  side(hx * 2, 0, -hz, false, 1)
  side(hx * 2, 0, hz, false, -1)

  return { kerb, posts, mesh, barbed }
}
