/**
 * L3 — the vehicle models, loaded and normalised.
 *
 * Quaternius "Zombie Apocalypse Kit", CC0 (see `_models/QUATERNIUS-License.txt`).
 * Four vehicles rather than one recoloured four times, because the thing that
 * makes a car a character is its silhouette: you have to know which one just
 * rammed you from a chase camera, and four identical shapes in four colours
 * never managed that.
 *
 * THE MODEL CONFORMS TO THE CAR, never the reverse. `halfExtents` and
 * `rideHeight` are tuned handling values that the whole sim is balanced around;
 * a model that arrives 5.66m long gets scaled to fit the 4.2m collision box, not
 * indulged. Everything here is that normalisation.
 */
import { Box3, Color, Group, Mesh, MeshStandardMaterial, type Object3D, Vector3 } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { VehicleTuning } from '../content/vehicles'
import { LIVERIES } from './palette'

/**
 * Which vehicle each car drives, by id.
 *
 * Three armoured and one clean, deliberately. Pickup and Pickup_Armored side by
 * side would read as the same car twice; a clean Sports next to an armoured one
 * reads as two different drivers. Silhouette first, detail second.
 */
export const CAR_MODELS = [
  'Vehicle_Sports_Armored',
  'Vehicle_Pickup_Armored',
  'Vehicle_Truck_Armored',
  'Vehicle_Sports',
] as const

export type CarModel = (typeof CAR_MODELS)[number]

/** Wheel nodes, as Quaternius names them. `BackWheels` is one node for both. */
const WHEEL_NAMES = /^(FrontWheel_[LR]|BackWheels)$/

export type LoadedCar = {
  /** Ready to add to a view. Already scaled, centred and sitting on y=0. */
  readonly body: Object3D
  /** The wheel nodes, lifted out so they can be spun. */
  readonly wheels: Object3D[]
  readonly wheelRadius: number
}

/**
 * Scale and seat a model so it matches the car the sim is simulating.
 *
 * Length is the axis matched, because it is the one you read. The models come
 * out slightly wider than the collision box doing it that way — 2.18m against
 * 1.9m — and that is the right trade for this game: a car that looks chunkier
 * than its collider reads as heavy, while one scaled to its width looks stunted.
 */
function normalise(source: Object3D, tuning: VehicleTuning, livery: number): LoadedCar {
  const model = source.clone(true)

  const box = new Box3().setFromObject(model)
  const size = box.getSize(new Vector3())
  const scale = (tuning.halfExtents.z * 2) / Math.max(size.z, 0.001)
  model.scale.setScalar(scale)

  // Re-measure after scaling: centre it horizontally on the car's origin and
  // drop it so the lowest point — the tyres — lands exactly on the ground.
  // Several of these models extend below their own origin, so this cannot be
  // assumed from the file.
  const scaled = new Box3().setFromObject(model)
  const centre = scaled.getCenter(new Vector3())
  model.position.x -= centre.x
  model.position.z -= centre.z
  model.position.y -= scaled.min.y + tuning.rideHeight

  const wheels: Object3D[] = []
  let wheelRadius = tuning.rideHeight * 0.65
  model.traverse((node) => {
    if (!WHEEL_NAMES.test(node.name)) return
    wheels.push(node)
    const wheelBox = new Box3().setFromObject(node)
    wheelRadius = Math.max(wheelRadius, wheelBox.getSize(new Vector3()).y / 2)
  })

  model.traverse((node) => {
    if (!(node instanceof Mesh)) return
    // Only the body casts. Sixteen wheel shadows across four cars measured at
    // 16 draw calls for about eight pixels of shadow each, and that lesson does
    // not stop applying because the wheels came from a file.
    node.castShadow = !WHEEL_NAMES.test(node.parent?.name ?? '') && !WHEEL_NAMES.test(node.name)
    node.receiveShadow = true
    // These ship doubleSided, which doubles the shadow work for a closed solid.
    // Materials are shared across every clone of a cached scene, so they have to
    // be cloned before anything is written to them or all four cars change.
    const shared = node.material
    if (!(shared instanceof MeshStandardMaterial)) return
    const material = shared.clone()
    material.side = 0 // FrontSide

    /**
     * Tint toward the car's livery.
     *
     * The models carry their own colours in a shared palette atlas, so out of
     * the box all four are whatever Quaternius painted them — and the radar,
     * the health bars and the scoreboard all say red, blue, green, gold. The
     * HUD was right and the cars were wrong, so the cars move.
     *
     * Multiplied at 55% rather than replaced: full strength flattens the
     * texture into one colour and throws away the panel detail that makes them
     * look beaten up, which is the whole reason for using these models.
     */
    const paint = new Color(LIVERIES[livery % LIVERIES.length]!)
    material.color.copy(new Color(0xffffff).lerp(paint, 0.55))
    node.material = material
  })

  return { body: model, wheels, wheelRadius: wheelRadius / scale === 0 ? 0.3 : wheelRadius }
}

/**
 * Move each wheel's geometry onto its own node origin, so it spins on its axle.
 *
 * Quaternius exports the front wheels with a translation and geometry centred on
 * zero — those rotate correctly. `BackWheels` has NO translation and geometry
 * sitting at z -2.03..-1.14, so `rotation.x` swept the whole rear axle through a
 * two-metre arc around the car's centre. On screen the back wheels orbited the
 * body and vanished through it once a revolution, which reads as flickering
 * rather than as the geometry problem it is.
 *
 * Done once on the cached source, before any clone: the geometry is shared
 * between all four cars, so translating it per car would move it four times.
 */
function seatWheelsOnTheirAxles(scene: Object3D): void {
  scene.traverse((node) => {
    if (!WHEEL_NAMES.test(node.name)) return

    const local = new Box3()
    node.traverse((child) => {
      if (!(child instanceof Mesh)) return
      child.geometry.computeBoundingBox()
      if (child.geometry.boundingBox !== null) local.union(child.geometry.boundingBox)
    })
    if (local.isEmpty()) return

    const centre = local.getCenter(new Vector3())
    // Already on its axle. The front wheels land here and are left alone.
    if (centre.lengthSq() < 1e-6) return

    node.traverse((child) => {
      if (child instanceof Mesh) child.geometry.translate(-centre.x, -centre.y, -centre.z)
    })
    node.position.add(centre)
  })
}

const cache = new Map<CarModel, Object3D>()
let settled = false

/**
 * Fetch every car model once.
 *
 * Deliberately fire-and-forget from the caller's side: the game starts on its
 * procedural boxes and swaps them out as models arrive. 2.7MB of geometry is not
 * worth a loading screen on a game that is playable without it.
 */
export async function loadCarModels(): Promise<void> {
  const loader = new GLTFLoader()
  settled = false
  await Promise.all(
    CAR_MODELS.map(async (name) => {
      try {
        const gltf = await loader.loadAsync(`models/${name}.gltf`)
        seatWheelsOnTheirAxles(gltf.scene)
        cache.set(name, gltf.scene)
      } catch {
        // A model that will not load costs you that car's looks, not the game.
      }
    }),
  )
  settled = true
}

/** The normalised model for a car, or null while it is still loading. */
export function carFor(livery: number, tuning: VehicleTuning): LoadedCar | null {
  const name = CAR_MODELS[livery % CAR_MODELS.length]!
  const source = cache.get(name)
  return source === undefined ? null : normalise(source, tuning, livery)
}

/**
 * True once EVERY model has settled, however each turned out.
 *
 * Not `cache.size > 0`, which was the first version and was wrong in a way that
 * only a screenshot test could see: it went true when the first of four models
 * landed, so a frame captured then had some cars swapped and some still boxes,
 * decided by network ordering. The visual fixture waits on this.
 */
export function modelsReady(): boolean {
  return settled
}

export { Group }
