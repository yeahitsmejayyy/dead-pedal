/**
 * Model reference sheets, for handing an image model an accurate car.
 *
 * A screenshot from Blender shows the raw Quaternius asset. That is not what is
 * in the game: `carFor` scales each model to its collision box, seats the wheels
 * on their axles and repaints it in its livery, and those three steps are the
 * difference between "a low-poly car" and "the player's car". This page renders
 * the car the pipeline actually produces.
 *
 * Two deliberate departures from what the game draws:
 *
 * 1. NEUTRAL, EVEN LIGHT, not the game's single warm key at 10.6% luminance.
 *    A reference sheet lit like the game is a reference sheet you cannot read.
 * 2. ONE SCALE FOR EVERY IMAGE. The ortho frustum is sized once, from the
 *    largest car, and reused. Views are therefore comparable: the box truck is
 *    visibly bigger than the sports car, which is exactly the fact a reference
 *    sheet exists to communicate.
 */
import {
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
  Sphere,
  Vector3,
  WebGLRenderer,
} from 'three'
import { DEFAULT_VEHICLE, tuningFor } from '../src/content/vehicles'
import { CAR_MODELS, carFor, loadCarModels } from '../src/view/carModels'
import { CAR_PAINT } from '../src/view/carPaint'
import { LIVERIES } from '../src/view/palette'

/** Big enough to be useful as reference, small enough that 20 of them are quick. */
const SIZE = 512

/** Neutral, and lighter than every livery so all four read against it. */
const BACKDROP = 0x9aa0a6

type View = {
  readonly name: string
  /** Where the camera sits, relative to the car. Normalised internally. */
  readonly dir: readonly [number, number, number]
  readonly up?: readonly [number, number, number]
  /** Perspective sells volume; ortho states proportion. Hero shots want the former. */
  readonly perspective?: boolean
}

/**
 * Front is +Z because that is the direction these models face — the same
 * convention `forwardOf(yaw)` uses, which is why they needed no yaw offset when
 * they were wired in.
 */
const VIEWS: readonly View[] = [
  { name: 'front', dir: [0, 0, 1] },
  { name: 'front 3/4', dir: [1, 0.42, 1], perspective: true },
  // A worm's-eye hero, because that is the camera cover art actually uses: down
  // at the dirt looking slightly up, so the car towers. Negative y puts the lens
  // BELOW the car's centre. Without this the illustrator has to invent the
  // undercut on the bumper and the roofline foreshortening, and inventing them
  // is how you end up with a car that is not this car.
  { name: 'hero low 3/4', dir: [1, -0.12, 1.05], perspective: true },
  // Camera on -X, not +X. A camera on +X puts world +Z — the nose — on the
  // screen LEFT, because screen-right works out to -Z there. Every automotive
  // side profile ever drawn has the nose on the right, and a reference sheet
  // that breaks that convention is a reference sheet somebody mirrors by
  // accident. Verified by tinting the FrontWheel nodes and looking.
  { name: 'side', dir: [-1, 0, 0] },
  { name: 'rear 3/4', dir: [-1, 0.42, -1], perspective: true },
  { name: 'rear', dir: [0, 0, -1] },
  // up = +Z puts the nose at the top of the frame, which is the plan-view
  // convention for the same reason.
  { name: 'top', dir: [0, 1, 0.001], up: [0, 0, 1] },
]

/** What each livery is, in words, for the sheet labels and for ART.md's substitution table. */
const BODIES = ['clean sports car (player)', 'armoured pickup', 'armoured box truck', 'armoured sports coupe']

const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
renderer.setSize(SIZE, SIZE, false)
renderer.setPixelRatio(1)

const scene = new Scene()
scene.background = new Color(BACKDROP)

/**
 * Flat enough to read shape, directional enough to read form.
 *
 * A reference sheet lit like the game would be a reference sheet you cannot see:
 * the game runs one warm key at 10.6% mean luminance, which is a mood, not a
 * description of a shape.
 */
scene.add(new AmbientLight(0xffffff, 2.2))
const key = new DirectionalLight(0xffffff, 2.4)
key.position.set(4, 7, 5)
scene.add(key)
const fill = new DirectionalLight(0xffffff, 1.1)
fill.position.set(-5, 2, -4)
scene.add(fill)

const tuning = tuningFor(DEFAULT_VEHICLE)

const out = document.getElementById('out')!
const status = document.getElementById('status')!
const sheets: { name: string; dataUrl: string }[] = []

async function build(): Promise<void> {
  await loadCarModels()

  // One frustum for every image. Sized from the largest car so nothing clips.
  let radius = 0
  const cars = CAR_MODELS.map((_, livery) => {
    const car = carFor(livery, tuning)
    if (car === null) return null
    const sphere = new Box3().setFromObject(car.body).getBoundingSphere(new Sphere())
    radius = Math.max(radius, sphere.radius)
    return car
  })

  const half = radius * 1.06
  const ortho = new OrthographicCamera(-half, half, half, -half, 0.1, 100)
  const persp = new PerspectiveCamera(30, 1, 0.1, 100)

  for (const [livery, car] of cars.entries()) {
    if (car === null) continue
    const model = CAR_MODELS[livery]!

    const wrap = document.createElement('div')
    wrap.className = 'car'
    const hex = `#${LIVERIES[livery]!.toString(16).padStart(6, '0')}`
    wrap.innerHTML =
      `<h2><i class="swatch" style="background:${hex}"></i>` +
      `LIVERY ${livery} · ${BODIES[livery]} · ${model} · ${hex} · ${CAR_PAINT[model]?.treatment ?? ''}</h2>` +
      `<div class="views"></div>`
    const views = wrap.querySelector('.views')!
    out.appendChild(wrap)

    // The sheet is one strip per car: every view side by side, which is one file
    // to drag into a prompt instead of six.
    const sheet = document.createElement('canvas')
    sheet.width = SIZE * VIEWS.length
    sheet.height = SIZE
    const sheetCtx = sheet.getContext('2d')!

    scene.add(car.body)
    // Orbit the car about its own centre, not about the world origin: the model
    // is seated so its tyres touch y=0, which puts its centre well above it.
    const centre = new Box3().setFromObject(car.body).getCenter(new Vector3())

    for (const [i, view] of VIEWS.entries()) {
      const camera = view.perspective === true ? persp : ortho
      const dir = new Vector3(...view.dir).normalize()
      // Perspective needs distance chosen to frame the same sphere the ortho
      // frustum shows, or the hero view arrives at a different scale.
      const distance = view.perspective === true ? radius / Math.sin((persp.fov * Math.PI) / 360) : radius * 3
      camera.position.copy(centre).addScaledVector(dir, distance)
      camera.up.set(...(view.up ?? [0, 1, 0]))
      camera.lookAt(centre)
      camera.updateProjectionMatrix()
      renderer.render(scene, camera)

      const cell = document.createElement('div')
      cell.className = 'view'
      const canvas = document.createElement('canvas')
      canvas.width = SIZE
      canvas.height = SIZE
      canvas.style.width = '160px'
      canvas.style.height = '160px'
      canvas.getContext('2d')!.drawImage(renderer.domElement, 0, 0)
      cell.appendChild(canvas)
      const label = document.createElement('span')
      label.textContent = view.name.toUpperCase()
      cell.appendChild(label)
      views.appendChild(cell)

      sheetCtx.drawImage(renderer.domElement, i * SIZE, 0)
    }

    scene.remove(car.body)
    sheets.push({ name: `${model}-livery${livery}`, dataUrl: sheet.toDataURL('image/png') })
  }

  // One sheet with every car on it, at half scale. Four files is right when you
  // want a single car in front of the model; one file is right when you want it
  // to see the whole cast and keep them distinct from each other.
  const all = document.createElement('canvas')
  all.width = (SIZE * VIEWS.length) / 2
  all.height = (SIZE * sheets.length) / 2
  const allCtx = all.getContext('2d')!
  await Promise.all(
    sheets.map(async (sheet, row) => {
      const bitmap = await createImageBitmap(await (await fetch(sheet.dataUrl)).blob())
      allCtx.drawImage(bitmap, 0, (row * SIZE) / 2, all.width, SIZE / 2)
    }),
  )
  sheets.push({ name: 'all-four', dataUrl: all.toDataURL('image/png') })

  status.textContent = `${sheets.length - 1} cars · ${VIEWS.length} views each · same scale throughout`
  ;(window as unknown as { __sheets: typeof sheets }).__sheets = sheets
}

document.getElementById('download')!.addEventListener('click', () => {
  for (const sheet of sheets) {
    const a = document.createElement('a')
    a.href = sheet.dataUrl
    a.download = `${sheet.name}.png`
    a.click()
  }
})

void build().catch((error: unknown) => {
  status.textContent = `failed: ${String(error)}`
})
