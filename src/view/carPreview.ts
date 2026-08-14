/**
 * L3 — one car on a turntable, for the select screen.
 *
 * The car here is the LIVE model, built by the same `carFor` the arena uses. It
 * is not a painting of a car, and that is a decision worth defending: the paint
 * system rewrites each model's texture atlas at load time and has already
 * changed twice. Any illustration of these cars starts drifting from the real
 * ones the moment someone edits `carPaint.ts`, and nobody would notice until a
 * player picked the green truck and got a differently-green truck.
 *
 * It runs its own tiny WebGLRenderer on its own canvas rather than borrowing the
 * arena's. The arena renderer is wired to a chase camera following a simulated
 * vehicle through a world that is deliberately frozen while menus are up;
 * bending it into a turntable would mean special-casing the thing the whole
 * codebase is organised around. A second context costs one canvas and is thrown
 * away when the menu closes.
 */
import {
  AmbientLight,
  Box3,
  DirectionalLight,
  Group,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three'
import { tuningFor } from '../content/vehicles'
import { carFor } from './carModels'

export type CarPreview = {
  readonly canvas: HTMLCanvasElement
  /** Swap to a livery. Cheap enough to call on every arrow press. */
  readonly show: (livery: number) => void
  readonly start: () => void
  readonly stop: () => void
  readonly resize: (width: number, height: number) => void
  readonly dispose: () => void
}

/** Radians per second. Slow enough to read the silhouette, fast enough to feel alive. */
const SPIN = 0.55

export function createCarPreview(archetype: string): CarPreview {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true })
  // Transparent: the painted backdrop behind the canvas is the set, and this is
  // the actor standing on it.
  renderer.setClearAlpha(0)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

  const scene = new Scene()
  /**
   * 20mm-ish of field of view, not the 32 this started with.
   *
   * A wide lens on a close subject is the reason the car looked small: the fit
   * has to clear the car's NEAR face, and the wider the lens the more that near
   * face is exaggerated, so the camera retreats and the car shrinks inside the
   * frame. Narrowing the lens flattens the perspective, shrinks the penalty and
   * lets the car fill its bay from further back — which is also just what a
   * vehicle-select shot should look like. Product photographers use long
   * lenses for the same reason.
   */
  const camera = new PerspectiveCamera(20, 1, 0.1, 100)

  /**
   * Lit warm from the front-left and cool from behind, because that is what the
   * backdrop does — a burning sky in front of the bay, cold shade behind it. A
   * car lit neutrally on a warm set reads as pasted on.
   */
  scene.add(new AmbientLight(0xffe6cc, 1.5))
  const key = new DirectionalLight(0xfff2df, 2.6)
  key.position.set(-4, 5, 6)
  scene.add(key)
  const rim = new DirectionalLight(0x9ab4d0, 1.4)
  rim.position.set(3, 3, -5)
  scene.add(rim)

  const turntable = new Group()
  scene.add(turntable)

  const tuning = tuningFor(archetype)
  /** Half-height and XZ circumradius of whatever is loaded, for framing. */
  let halfY = 1
  let radiusXZ = 2
  let centreY = 0.6
  let aspect = 1
  let current: number | null = null
  let running = false
  let raf = 0
  let last = 0

  function show(livery: number): void {
    if (livery === current) return
    current = livery
    turntable.clear()

    const car = carFor(livery, tuning)
    if (car === null) return
    turntable.add(car.body)

    const box = new Box3().setFromObject(car.body)
    const size = box.getSize(new Vector3())
    const centre = box.getCenter(new Vector3())
    halfY = size.y / 2
    // The car spins, so its worst-case horizontal extent is the circumradius of
    // its footprint, not its length.
    radiusXZ = Math.hypot(size.x, size.z) / 2
    centreY = centre.y
    frame()
  }

  /**
   * Fit the car to the bay, height and width considered separately.
   *
   * The first version fitted the BOUNDING SPHERE, which is safe at every yaw
   * and much too loose: the sphere's radius is driven by the car's LENGTH, and
   * a car is far shorter than it is long. On a bay twice as wide as it is tall
   * that wasted most of the frame and the coupes looked marooned.
   *
   * Height and width are constrained by different things. Vertical is bounded
   * by the camera's own field of view; horizontal is bounded by that same field
   * widened by the aspect ratio, which on this layout is roughly twice as much
   * room. Taking the larger of the two requirements fills the bay in whichever
   * direction is actually tight, and the XZ circumradius keeps it honest while
   * the car turns.
   */
  function frame(): void {
    const halfFov = (camera.fov * Math.PI) / 360
    const tan = Math.tan(halfFov)
    /**
     * Fit against the car's NEAR face, not its centre.
     *
     * The previous version divided the half-extents by the tangent and stopped
     * there, which is the orthographic answer. Under perspective the closest
     * part of the car is a whole footprint-radius nearer the lens than its
     * centre — 2.4m closer on a 4.2m vehicle — and at these distances that
     * projects roughly 1.7 times larger than the centre does. The box truck's
     * plough is the nearest thing on the nearest car and it ran straight off
     * the bottom of the bay no matter how much margin got added, because the
     * margin was compensating for a term that should not have been missing.
     *
     * Adding `radiusXZ` puts the fit at the near face and holds at every yaw,
     * which is why the margin can come back down to something small.
     */
    const forHeight = halfY / tan + radiusXZ
    const forWidth = radiusXZ / (tan * Math.max(aspect, 0.1)) + radiusXZ
    /**
     * The bay is shaped so WIDTH is the binding constraint for every car, and
     * that is the whole trick.
     *
     * All four models are scaled to the same 4.2m collision box, so their
     * footprint circumradius is near-identical — 2.32 for the coupe against
     * 2.38 for the truck. Fitting on width therefore puts every car at the same
     * distance and the same apparent LENGTH, and the only thing that varies on
     * screen is how tall they are. Which is the truth: the truck is not longer
     * than the coupe, it is taller.
     *
     * Let height win instead and it inverts. The truck is height-constrained,
     * gets pushed back to fit, and renders SHORTER than the sports car — the
     * biggest vehicle in the game looking like the smallest, on the one screen
     * whose job is to show you how they differ. Measured: at a bay aspect of
     * 2.55 the truck filled 71% and the coupe 54%, so the truck's footprint
     * came out smaller. The bay is now near 2:1, below the 2.18 where the
     * truck's own height/width ratio flips the comparison.
     */
    const distance = Math.max(forHeight, forWidth) * 1.02
    // Low, so you are looking slightly UP at the car standing on the floor
    // rather than down onto its roof.
    camera.position.set(0, centreY + halfY * 0.35, distance)
    /**
     * Aim at the centre, and resist the temptation to nudge it.
     *
     * A previous version aimed high to drop the car in frame and make room for
     * the contact shadow. That shifts the car down WITHOUT the fit above
     * knowing about it, so the tallest vehicle — the box truck, by some margin —
     * had its wheels pushed straight out of the bottom of the bay. Centred
     * framing plus an even margin puts every car's base at the same fraction of
     * the frame, whatever its size, which is what lets one fixed shadow sit
     * correctly under all four.
     */
    camera.lookAt(0, centreY, 0)
    camera.updateProjectionMatrix()
  }

  function tick(now: number): void {
    if (!running) return
    const dt = Math.min((now - last) / 1000, 0.1)
    last = now
    turntable.rotation.y += SPIN * dt
    renderer.render(scene, camera)
    raf = requestAnimationFrame(tick)
  }

  return {
    canvas: renderer.domElement,
    show,
    start(): void {
      if (running) return
      running = true
      last = performance.now()
      raf = requestAnimationFrame(tick)
    },
    stop(): void {
      running = false
      cancelAnimationFrame(raf)
    },
    resize(width: number, height: number): void {
      renderer.setSize(width, height, false)
      aspect = width / Math.max(height, 1)
      camera.aspect = aspect
      // Refit, not just reproject: the fit depends on the aspect ratio, so a
      // window resize changes how far back the camera belongs.
      frame()
    },
    dispose(): void {
      running = false
      cancelAnimationFrame(raf)
      // A WebGL context that is merely unreferenced is a WebGL context the
      // browser may keep alive; there is a hard limit on how many exist at once.
      renderer.dispose()
      renderer.forceContextLoss()
    },
  }
}
