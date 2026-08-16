/**
 * L3 — making a crate legible: a glow that says "collectable", and a name when
 * you are close enough for the name to matter.
 *
 * The meshes landed first and they say WHAT a pickup is — a rocket looks like a
 * rocket. They do not say two other things a player needs:
 *
 *   THAT IT IS THERE. A 1.5m object on a 180m dirt floor, lit by a dusk sky
 *   that is the same family of oranges as the ground, is genuinely hard to see
 *   until you are nearly on it. Silhouette does not help when everything behind
 *   it is the same value. Light does, because nothing else in the arena emits
 *   any — so a glow is not decoration here, it is the only channel that reads
 *   at distance against this particular backdrop.
 *
 *   WHAT IT IS CALLED. Silhouette tells you it is a missile; it does not tell
 *   you the missile is the one that tracks, or which of the two HUD rows will
 *   fill up. The label closes that gap, and only needs to exist at the moment
 *   you are choosing whether to turn for it.
 *
 * WHY NOT EMISSIVE, WHICH IS ALREADY THERE. `MeshStandardMaterial.emissive` is
 * set to a fraction of the crate colour in `effects.ts`, and it does what it
 * can: it stops a crate going grey in shadow. It cannot glow. Emissive without
 * a bloom pass only lifts the surface's own pixels — the object gets brighter,
 * but no light leaves it, so there is no halo and nothing to catch the eye in
 * peripheral vision. A bloom post-process would do it properly and costs a full
 * screen pass plus two blur targets; two additive quads cost two draw calls and
 * buy the part of bloom that matters here.
 *
 * DRAW CALLS. The halo and the bloom are one `InstancedMesh` each — two calls
 * for the whole arena however many crates are in it, per-crate colour carried
 * on the instance rather than in the material. The labels are `Sprite`s and DO
 * cost one call each, which is why they are gated on proximity: at a 20m radius
 * on this arena's crate spacing, one or two are ever up at once. PLAN.md §6
 * budgets 100, and `drive.spec.ts` samples the peak through a real fight — that
 * test is the authority on the headroom, not this comment.
 */
import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  type Camera,
  type Scene,
  Vector3,
} from 'three'
import { clamp } from '../core/scalar'
import { pickupHex } from './palette'
import { WEAPONS, type WeaponId } from '../content/weapons'
import { crateLift, MAX_CRATES } from './effects'
import type { Pickup, Vehicle } from '../sim'

/**
 * Metres at which a label starts to appear, and where it is fully up.
 *
 * FAR is deliberately five times the 4m collection radius. A label that only
 * appears once you are close enough to take the crate anyway has told you
 * nothing you could still act on — the whole value is in reading it while there
 * is still time to turn. NEAR sits just outside collection so the label is
 * solid, not still fading, at the moment of the decision.
 */
export const LABEL_FAR = 20
export const LABEL_NEAR = 7

/** Metres the label floats above the crate's bobbing centre. */
const LABEL_RISE = 1.75

/** World size of the ground halo, in metres across. */
const HALO_SIZE = 4.6

/** World size of the bloom quad standing at the crate. */
const BLOOM_SIZE = 3.9

/**
 * How far off the floor the halo sits.
 *
 * The terrain has relief and a crate's `pos.y` is its spawn height, not the
 * dirt directly beneath it, so a halo laid exactly at `pos.y` sinks into rising
 * ground and z-fights on flat ground. Additive blending with no depth write
 * hides most of that, but not the sinking.
 */
const HALO_LIFT = 0.09

/**
 * The two falloffs, both authored in GREYSCALE ON BLACK.
 *
 * Additive blending adds the texel's colour to whatever is behind it, so black
 * is already invisible and the alpha channel does nothing at all. Writing a
 * glow as alpha over solid white — the obvious way to author one, and how this
 * was first written — produces a flat white disc with a hard edge, because
 * every texel still adds white.
 *
 * NOTHING REACHES FULL WHITE. Additive over this sky is the constraint: the
 * horizon is already a hot amber, and a core at #ffffff clips all three
 * channels and comes out as a white blob with no hue left in it — the tint
 * carrying WHICH pickup this is gets destroyed by the glow advertising THAT it
 * is one. Capping the peaks in the greys keeps the sum inside the tint.
 */
function radialTexture(stops: readonly (readonly [number, string])[]): CanvasTexture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new Error('pickupTags: no 2d context')

  const half = size / 2
  const falloff = ctx.createRadialGradient(half, half, 0, half, half, half)
  for (const [stop, hex] of stops) falloff.addColorStop(stop, hex)
  ctx.fillStyle = falloff
  ctx.fillRect(0, 0, size, size)

  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

/**
 * The pool of light on the dirt: hot core, fast falloff.
 *
 * A linear ramp reads as a disc with a soft edge. A pool of light needs a
 * bright middle that drops away quickly, which is what the weighting toward
 * the centre is doing.
 */
const HALO_STOPS = [
  [0.0, '#d2d2d2'],
  [0.25, '#9e9e9e'],
  [0.5, '#3c3c3c'],
  [1.0, '#000000'],
] as const

/**
 * The aura around the object: an ANNULUS, dim in the middle.
 *
 * This started as the same filled disc the halo uses and it was wrong in a way
 * that only showed on the thin pickups. On the ammo box — big, opaque, square
 * — a hot core behind it looked fine, because the box blocked it. On the rocket
 * it shone straight through the gaps in a 20cm-wide airframe and bleached the
 * silhouette out of existence: the glow erased the exact thing it was there to
 * draw attention to, and the mesh work of the last pass with it.
 *
 * So the light comes from AROUND the object instead. The ring peaks at 0.3 of
 * the radius, which at `BLOOM_SIZE` puts it just outside a 1.5m crate, and the
 * centre stays dim enough to read a dark silhouette against.
 */
const BLOOM_STOPS = [
  [0.0, '#242424'],
  [0.3, '#8a8a8a'],
  [0.58, '#333333'],
  [1.0, '#000000'],
] as const

/** What a crate is called, for the label. */
export function labelFor(key: string): string {
  if (key === 'health') return 'Health'
  if (key === 'armour') return 'Armour'
  const weapon = WEAPONS[key as WeaponId]
  // `?? key` rather than a throw: an unknown kind is a content bug, and showing
  // its raw id on screen is how you find it. Crashing the renderer is not.
  return weapon?.label ?? key
}

/**
 * How solid the label is at `distance` metres.
 *
 * Ramped rather than switched. A label that pops on at exactly 20m flickers
 * every time you drive along the edge of that circle, and the flicker is far
 * more distracting than the label is useful.
 */
export function labelOpacity(distance: number): number {
  if (distance >= LABEL_FAR) return 0
  return clamp((LABEL_FAR - distance) / (LABEL_FAR - LABEL_NEAR), 0, 1)
}

/**
 * The label plate for one kind of pickup, drawn once and shared.
 *
 * Power-of-two and generously oversized: the sprite is only ~3m wide in world
 * space but you can be 7m from it, and a plate rendered at its on-screen size
 * would be visibly soft. Text is cheap to draw and this happens once per kind.
 */
function plateTexture(key: string): CanvasTexture {
  const width = 512
  const height = 128
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new Error('pickupTags: no 2d context')

  const accent = `#${pickupHex(key).toString(16).padStart(6, '0')}`
  const inset = 8
  const radius = 14

  // The plate. Dark and nearly opaque, because it has to hold white text
  // against a sky that is bright amber at exactly the height it floats at.
  ctx.beginPath()
  ctx.roundRect(inset, inset, width - inset * 2, height - inset * 2, radius)
  ctx.fillStyle = 'rgba(8, 10, 14, 0.86)'
  ctx.fill()
  ctx.lineWidth = 3
  ctx.strokeStyle = accent
  ctx.globalAlpha = 0.85
  ctx.stroke()
  ctx.globalAlpha = 1

  // A solid bar of the pickup's colour down the leading edge. This is the same
  // colour as the crate, the HUD row and the radar blip — four places one hue
  // has to mean one thing, which is the whole job of `palette.ts`.
  ctx.beginPath()
  ctx.roundRect(inset + 6, inset + 10, 10, height - inset * 2 - 20, 5)
  ctx.fillStyle = accent
  ctx.fill()

  ctx.font = 'bold 46px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.fillStyle = '#eef2f7'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(labelFor(key).toUpperCase(), inset + 30, height / 2 + 2)

  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

const plates = new Map<string, CanvasTexture>()

function plateFor(key: string): CanvasTexture {
  const cached = plates.get(key)
  if (cached !== undefined) return cached
  const built = plateTexture(key)
  plates.set(key, built)
  return built
}

export class PickupTags {
  private readonly halo: InstancedMesh
  private readonly bloom: InstancedMesh
  private readonly labels: Sprite[] = []
  /** What each label slot is currently showing, so the plate is set once. */
  private readonly labelKeys: string[] = []

  private readonly matrix = new Matrix4()
  private readonly position = new Vector3()
  private readonly scale = new Vector3()
  private readonly quaternion = new Quaternion()
  private readonly flat = new Quaternion()
  private readonly colour = new Color()

  constructor(scene: Scene) {
    const quad = new PlaneGeometry(1, 1)

    const material = (map: CanvasTexture): MeshBasicMaterial =>
      new MeshBasicMaterial({
        map,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        // Additive already ignores what is behind it; the depth TEST is what
        // stops a crate's glow shining through the wall it is parked behind.
        depthTest: true,
      })

    this.halo = new InstancedMesh(quad, material(radialTexture(HALO_STOPS)), MAX_CRATES)
    this.bloom = new InstancedMesh(quad, material(radialTexture(BLOOM_STOPS)), MAX_CRATES)

    for (const mesh of [this.halo, this.bloom]) {
      mesh.frustumCulled = false
      // Behind the labels, in front of the arena. Additive surfaces have to be
      // drawn after the opaque geometry they are meant to brighten.
      mesh.renderOrder = 4
      mesh.count = 0
      scene.add(mesh)
    }

    // Lying flat. Stored once rather than rebuilt per crate — the halo never
    // turns, unlike the bloom, which tracks the camera every frame.
    this.flat.setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2)

    for (let i = 0; i < MAX_CRATES; i++) {
      const sprite = new Sprite(
        new SpriteMaterial({ transparent: true, depthWrite: false, opacity: 0 }),
      )
      sprite.visible = false
      sprite.renderOrder = 12
      scene.add(sprite)
      this.labels.push(sprite)
      this.labelKeys.push('')
    }
  }

  /**
   * Glow every available crate, and name the ones near `follow`.
   *
   * `tick` and the slot index feed the same `crateLift` the crate mesh itself
   * uses, so the glow and the label ride the bob instead of hanging beside a
   * crate that has floated up out of them.
   */
  update(
    pickups: readonly Pickup[],
    tick: number,
    follow: Vehicle | undefined,
    camera: Camera,
  ): void {
    camera.getWorldQuaternion(this.quaternion)

    let count = 0
    for (let i = 0; i < pickups.length && count < MAX_CRATES; i++) {
      const pickup = pickups[i]!

      // Taken. No glow and no name until it comes back — the respawn timer is
      // information, and a crate that still glows while it is gone lies about
      // whether crossing the arena for it is worth it. The trailing loop below
      // hides whatever slots this skip leaves unclaimed.
      if (tick < pickup.availableAt) continue

      const label = this.labels[count]!
      const key = pickup.kind === 'weapon' ? (pickup.weapon ?? '') : pickup.kind
      const hex = pickupHex(key)
      // Keyed on the pickup's id, exactly as the crate mesh is — see
      // `crateLift`. Anything positional here detaches the glow from its crate
      // as soon as the slots compact around a collected one.
      const lift = crateLift(pickup.id, tick)

      /**
       * A slow breath, out of phase per crate.
       *
       * In phase, sixteen crates pulsing together read as the whole screen
       * flickering — a rendering fault rather than an invitation. The per-id
       * offset is what turns one blink into an arena that shimmers.
       */
      const pulse = 0.88 + Math.sin(tick * 0.045 + pickup.id * 1.7) * 0.12

      this.colour.setHex(hex, SRGBColorSpace)

      // The pool on the dirt. Fixed to the floor, not the bob: light cast by a
      // hovering object does not hover with it.
      this.position.set(pickup.pos.x, pickup.pos.y + HALO_LIFT, pickup.pos.z)
      this.scale.set(HALO_SIZE * pulse, HALO_SIZE * pulse, 1)
      this.matrix.compose(this.position, this.flat, this.scale)
      this.halo.setMatrixAt(count, this.matrix)
      this.halo.setColorAt(count, this.colour)

      // The bloom around the object itself, billboarded so it stays a disc from
      // every angle rather than flattening to a line as you drive past.
      this.position.set(pickup.pos.x, pickup.pos.y + lift, pickup.pos.z)
      this.scale.set(BLOOM_SIZE * pulse, BLOOM_SIZE * pulse, 1)
      this.matrix.compose(this.position, this.quaternion, this.scale)
      this.bloom.setMatrixAt(count, this.matrix)
      this.bloom.setColorAt(count, this.colour)

      // ── the name, if you are close enough to care ──────────────────────────
      const opacity =
        follow === undefined
          ? 0
          : labelOpacity(
              Math.hypot(pickup.pos.x - follow.pos.x, pickup.pos.z - follow.pos.z),
            )

      label.visible = opacity > 0.01
      if (label.visible) {
        if (this.labelKeys[count] !== key) {
          this.labelKeys[count] = key
          label.material.map = plateFor(key)
          label.material.needsUpdate = true
        }
        label.material.opacity = opacity
        label.position.set(pickup.pos.x, pickup.pos.y + lift + LABEL_RISE, pickup.pos.z)
        // 4:1, matching the plate canvas. Any other ratio stretches the text.
        label.scale.set(3.0, 0.75, 1)
      }

      count++
    }

    for (let i = count; i < this.labels.length; i++) this.labels[i]!.visible = false

    this.halo.count = count
    this.bloom.count = count
    this.halo.instanceMatrix.needsUpdate = true
    this.bloom.instanceMatrix.needsUpdate = true
    if (this.halo.instanceColor !== null) this.halo.instanceColor.needsUpdate = true
    if (this.bloom.instanceColor !== null) this.bloom.instanceColor.needsUpdate = true
  }
}
