/**
 * L5 — pick a car, then launch.
 *
 * Four choices, one live model on a turntable, and a confirm. The car shown is
 * the real thing built by `carFor`, not an illustration — see `carPreview.ts`
 * for why that matters.
 *
 * WHAT SELECTION ACTUALLY CHANGES is worth stating, because it is less than you
 * would expect. The sim has no concept of paint: vehicles are ids, and the view
 * decides what an id looks like. So choosing a car writes one number into
 * `setPlayerLivery` and every consumer — the model, the radar blip, the HUD pip,
 * the scoreboard swatch — follows from that. Nothing below the view layer knows
 * a choice was made.
 */
import { CAR_MODELS } from '../view/carModels'
import { CAR_PAINT } from '../view/carPaint'
import { createCarPreview, type CarPreview } from '../view/carPreview'
import { LIVERIES, setPlayerLivery } from '../view/palette'

export type SelectOptions = {
  /** Pointer entered a control. Already debounced. */
  readonly onHover?: () => void
  /** The highlighted car changed. */
  readonly onChange?: () => void
  /** Fired the instant the player commits, while the launch animation runs. */
  readonly onCommit?: () => void
  /** Fired when the launch animation finishes and the match should begin. */
  readonly onLaunch: (livery: number) => void
  /** Which archetype to build the preview from. */
  readonly archetype: string
}

export type Select = {
  /** Render and fade in. Does NOT accept input yet — see `arm`. */
  readonly show: () => void
  /**
   * Start accepting input.
   *
   * Separate from `show` because the select screen is revealed UNDER the title
   * while the title is still fading out. Without this gap, the Enter that
   * dismissed the title would arrive here a frame later and launch the match
   * before the player had seen a single car.
   */
  readonly arm: () => void
  readonly hide: () => void
  readonly visible: () => boolean
  readonly dispose: () => void
}

/**
 * The cast, in the order the liveries are declared.
 *
 * Names first and body type second, because the name is what people will
 * actually call them. Each one is tied to something true about the car — the
 * paint, the plough, the primer — rather than being a cool word attached at
 * random, which is what makes a name stick to a silhouette.
 *
 * Deliberately none of them borrows from an existing vehicular-combat game.
 * This is going public, and a cast list that reads as homage in the README
 * reads as something else in a takedown notice.
 */
const CARS: readonly {
  readonly name: string
  readonly kind: string
  readonly line: string
}[] = [
  { name: 'FLATLINE', kind: 'Sports coupe', line: 'No armour. Nothing to slow it down.' },
  { name: 'COLD FRONT', kind: 'Armoured pickup', line: 'Leads with the plough.' },
  { name: 'TETANUS', kind: 'Armoured box truck', line: 'The biggest thing on the field.' },
  { name: 'BRASS KNUCKLE', kind: 'Armoured coupe', line: 'Plated doors. Built to trade paint.' },
]

const LAUNCH_MS = 2000
const HOVER_DEBOUNCE_MS = 140

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function createSelect(root: HTMLElement, options: SelectOptions): Select {
  root.innerHTML = `
    <div class="select-plate">
      <p class="select-eyebrow">SELECT VEHICLE</p>

      <div class="select-card">
        <div class="select-name">
          <i class="select-chip" data-chip></i>
          <span data-label>—</span>
        </div>
        <p class="select-kind" data-kind>&nbsp;</p>
        <p class="select-line" data-line>&nbsp;</p>
        <p class="select-treatment" data-treatment>&nbsp;</p>
      </div>

      <div class="select-pips" data-pips></div>

      <button class="menu-button select-go" type="button" data-go>LAUNCH</button>
      <p class="select-hint"><b>&#8592; &#8594;</b> choose &nbsp;·&nbsp; <b>Enter</b> launch</p>
    </div>

    <div class="select-stage">
      <button class="select-arrow select-arrow--prev" type="button" data-prev aria-label="Previous vehicle">&#10094;</button>
      <div class="select-bay" data-bay></div>
      <button class="select-arrow select-arrow--next" type="button" data-next aria-label="Next vehicle">&#10095;</button>
    </div>
  `

  /**
   * Narrowing a `const` does not reach into hoisted function declarations —
   * TypeScript assumes one could be called before the check ran — so the null
   * test has to live inside something that returns a non-null type.
   */
  function must<T extends HTMLElement>(selector: string): T {
    const found = root.querySelector<T>(selector)
    if (found === null) throw new Error(`select: missing ${selector}`)
    return found
  }

  const bay = must<HTMLElement>('[data-bay]')
  const go = must<HTMLButtonElement>('[data-go]')
  const pips = must<HTMLElement>('[data-pips]')

  const preview: CarPreview = createCarPreview(options.archetype)
  bay.appendChild(preview.canvas)

  pips.innerHTML = CARS.map(
    (_, i) => `<button class="select-pip" type="button" data-pip="${String(i)}" aria-label="Vehicle ${String(i + 1)}"></button>`,
  ).join('')

  let index = 0
  let shown = false
  let armed = false
  let fired = false
  let lastHover = 0

  function hover(): void {
    const now = performance.now()
    if (now - lastHover < HOVER_DEBOUNCE_MS) return
    lastHover = now
    options.onHover?.()
  }

  function paint(): void {
    const car = CARS[index]!
    const model = CAR_MODELS[index]!
    must('[data-label]').textContent = car.name
    must('[data-kind]').textContent = car.kind
    must('[data-line]').textContent = car.line
    must('[data-treatment]').textContent = CAR_PAINT[model]?.treatment ?? ''
    const chip = root.querySelector<HTMLElement>('[data-chip]')
    // Straight from LIVERIES so the chip cannot drift from the car behind it.
    // Note this does NOT call setPlayerLivery — browsing is not choosing, and
    // writing the choice on every arrow press would restyle the arena behind
    // the menu four times on the way to the car you wanted.
    if (chip !== null) chip.style.background = liveryCssFor(index)
    for (const pip of pips.querySelectorAll<HTMLElement>('[data-pip]')) {
      const on = Number(pip.dataset['pip']) === index
      pip.classList.toggle('is-on', on)
      pip.style.background = on ? liveryCssFor(Number(pip.dataset['pip'])) : ''
    }
    preview.show(index)
  }

  function liveryCssFor(livery: number): string {
    return `#${LIVERIES[livery]!.toString(16).padStart(6, '0')}`
  }

  function move(delta: number): void {
    const next = (index + delta + CARS.length) % CARS.length
    if (next === index) return
    index = next
    paint()
    options.onChange?.()
  }

  function commit(): void {
    if (fired || !shown || !armed) return
    fired = true
    setPlayerLivery(index)
    options.onCommit?.()

    if (reducedMotion()) {
      finish()
      return
    }
    root.classList.add('is-leaving')
    window.setTimeout(finish, LAUNCH_MS)
  }

  function finish(): void {
    hide()
    root.classList.remove('is-leaving')
    options.onLaunch(index)
  }

  root.querySelector('[data-prev]')?.addEventListener('click', () => {
    move(-1)
  })
  root.querySelector('[data-next]')?.addEventListener('click', () => {
    move(1)
  })
  go.addEventListener('click', commit)

  for (const control of root.querySelectorAll('[data-prev],[data-next],[data-go],[data-pip]')) {
    control.addEventListener('pointerenter', () => {
      if (shown && armed && !fired) hover()
    })
  }
  pips.addEventListener('click', (event) => {
    const pip = (event.target as HTMLElement).closest<HTMLElement>('[data-pip]')
    if (pip === null) return
    const next = Number(pip.dataset['pip'])
    if (next === index) return
    index = next
    paint()
    options.onChange?.()
  })

  window.addEventListener('keydown', (event) => {
    if (!shown || !armed || fired) return
    if (event.code === 'ArrowLeft' || event.code === 'KeyA') {
      event.preventDefault()
      move(-1)
    } else if (event.code === 'ArrowRight' || event.code === 'KeyD') {
      event.preventDefault()
      move(1)
    } else if (event.code === 'Enter' || event.code === 'NumpadEnter' || event.code === 'Space') {
      event.preventDefault()
      commit()
    }
  })

  function show(): void {
    shown = true
    armed = false
    fired = false
    root.classList.remove('is-armed')
    root.classList.add('is-shown')
    document.body.classList.add('is-select')
    resize()
    paint()
    preview.start()
  }

  function arm(): void {
    armed = true
    // A class as well as a flag: it is the only outward sign that the screen has
    // stopped being scenery and started being a menu, which the e2e suite needs
    // to know before it can press anything.
    root.classList.add('is-armed')
    go.focus()
  }

  function hide(): void {
    shown = false
    armed = false
    root.classList.remove('is-shown')
    document.body.classList.remove('is-select')
    preview.stop()
  }

  function resize(): void {
    const box = bay.getBoundingClientRect()
    preview.resize(Math.max(box.width, 1), Math.max(box.height, 1))
  }
  window.addEventListener('resize', resize)

  return {
    show,
    arm,
    hide,
    visible: () => shown,
    dispose: () => {
      preview.dispose()
    },
  }
}
