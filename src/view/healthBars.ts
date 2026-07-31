/**
 * L3 — floating health bars over the other cars.
 *
 * PLAN.md puts the HUD at M6; this is the health slice of it, brought forward
 * because you cannot judge a fight you cannot read. Ammo, the radar and the
 * round state still belong to M6.
 *
 * Two `InstancedMesh`es — one for the backing, one for the fill — so the whole
 * field costs **two draw calls** no matter how many cars are in it. Eight cars
 * as sixteen separate meshes would be sixteen calls against a budget of a
 * hundred that already sits in the eighties.
 */
import {
  Color,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  type Camera,
  type Scene,
  Vector3,
} from 'three'
import { clamp } from '../core/scalar'
import { isAlive, type EntityId, type Vehicle } from '../sim'
import { healthRgb } from './palette'

const MAX_BARS = 12

const WIDTH = 2.6
const HEIGHT = 0.3
/** Metres above the car's centre. Clears the cabin without floating free. */
const RISE = 2.1

/**
 * The shared ramp, converted at the edge.
 *
 * `setRGB` is told the values are sRGB so three does the conversion to linear
 * itself. Interpolating in linear here instead would put this out of step with
 * the HUD, which is what `palette.ts` exists to prevent.
 */
function healthColour(fraction: number, out: Color): Color {
  const [r, g, b] = healthRgb(fraction)
  return out.setRGB(r / 255, g / 255, b / 255, SRGBColorSpace)
}

export class HealthBars {
  private readonly backing: InstancedMesh
  private readonly fill: InstancedMesh
  private readonly matrix = new Matrix4()
  private readonly position = new Vector3()
  private readonly offset = new Vector3()
  private readonly scale = new Vector3()
  private readonly quaternion = new Quaternion()
  private readonly colour = new Color()

  constructor(scene: Scene) {
    // Origin at the left edge, so scaling x grows the bar rightwards instead of
    // fattening it outwards from the middle.
    const quad = new PlaneGeometry(1, 1)
    quad.translate(0.5, 0, 0)

    this.backing = new InstancedMesh(
      quad,
      new MeshBasicMaterial({ color: 0x11151b, transparent: true, opacity: 0.72, side: DoubleSide, depthWrite: false }),
      MAX_BARS,
    )
    this.fill = new InstancedMesh(
      quad,
      new MeshBasicMaterial({ side: DoubleSide, depthWrite: false, transparent: true }),
      MAX_BARS,
    )

    for (const mesh of [this.backing, this.fill]) {
      // A transparent DoubleSide material makes three.js draw the mesh twice —
      // back faces then front — so these two bars were costing four draw calls
      // rather than two. The bars are billboarded at the camera every frame, so
      // the back face is never the one you see and the second pass buys nothing.
      // Measured: 2 calls each becomes 1.
      ;(mesh.material as MeshBasicMaterial).forceSinglePass = true
      // The bars move every frame and are always near the camera.
      mesh.frustumCulled = false
      mesh.renderOrder = 10
      mesh.count = 0
      scene.add(mesh)
    }
  }

  /**
   * Place a bar over every living car except `skip`.
   *
   * `skip` is the car the camera is following: it has the HUD, and a second
   * readout hovering over the bonnet is just clutter.
   */
  update(vehicles: readonly Vehicle[], camera: Camera, skip: EntityId): void {
    camera.getWorldQuaternion(this.quaternion)

    let count = 0
    for (const vehicle of vehicles) {
      if (count >= MAX_BARS) break
      if (vehicle.id === skip || !isAlive(vehicle)) continue

      // Each car's own ceiling: a tougher opponent shows a full bar at 380,
      // not a bar that overflows because the archetype says 200.
      const fraction = clamp(vehicle.health / Math.max(1, vehicle.maxHealth), 0, 1)

      // Billboarded: the local offset has to be rotated into the camera's frame
      // before it is added, or the bar drifts off the car as you circle it.
      this.offset.set(-WIDTH / 2, RISE, 0).applyQuaternion(this.quaternion)
      this.position.set(vehicle.pos.x, vehicle.pos.y, vehicle.pos.z).add(this.offset)

      this.scale.set(WIDTH, HEIGHT, 1)
      this.matrix.compose(this.position, this.quaternion, this.scale)
      this.backing.setMatrixAt(count, this.matrix)

      // A hair in front of the backing, so the two do not z-fight.
      this.offset.set(0, 0, 0.01).applyQuaternion(this.quaternion)
      this.position.add(this.offset)

      this.scale.set(WIDTH * fraction, HEIGHT * 0.74, 1)
      this.matrix.compose(this.position, this.quaternion, this.scale)
      this.fill.setMatrixAt(count, this.matrix)
      this.fill.setColorAt(count, healthColour(fraction, this.colour))

      count++
    }

    this.backing.count = count
    this.fill.count = count
    this.backing.instanceMatrix.needsUpdate = true
    this.fill.instanceMatrix.needsUpdate = true
    if (this.fill.instanceColor !== null) this.fill.instanceColor.needsUpdate = true
  }
}

export { healthColour }
