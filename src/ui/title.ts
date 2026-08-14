/**
 * L5 — the title screen. One action: start.
 *
 * The game used to boot straight into a live match, which meant the first thing
 * anyone saw was a countdown they had not asked for, over a car they had not
 * chosen, with the audio still locked because no gesture had happened yet.
 *
 * That last point is the load-bearing one. A browser will not build an
 * AudioContext until the user does something, so the engine, the music and every
 * weapon were silent for however long it took the player to touch a key. `arm`
 * was wired to the first keydown as a workaround. A START button is the gesture
 * — it is the thing the platform actually wants, and it arrives before the
 * player needs to hear anything.
 *
 * The screen is DOM over the canvas, not geometry in the scene, for the same
 * reason the HUD is: text rendered by the browser is text that scales, wraps and
 * stays crisp at any device pixel ratio, and none of it costs a draw call.
 */

export type TitleOptions = {
  /**
   * Called when the outro FINISHES and the arena should take over.
   *
   * Not when the button is pressed. Two seconds of countdown draining behind a
   * fade nobody can see through is the exact bug the title screen exists to
   * prevent, so the sim stays frozen for the whole transition.
   */
  readonly onStart: () => void
  /** Called the instant the player commits, while the outro runs. */
  readonly onCommit?: () => void
  /** Pointer entered the button. Already debounced. */
  readonly onHover?: () => void
}

export type Title = {
  readonly show: () => void
  readonly hide: () => void
  readonly visible: () => boolean
}

/**
 * Outro length, in milliseconds.
 *
 * 900, not the 2000 it was. This used to be the last step before the arena and
 * was cut against `menu-start.ogg` — a two-second starter motor. START now
 * opens the vehicle select instead, so the engine moved to the launch button
 * where it belongs, and two seconds of choreography to cross between two menus
 * is just latency with a bow on it. The select screen keeps the full 2s launch.
 */
const OUTRO_MS = 900

/** Ignore hover retriggers closer together than this. */
const HOVER_DEBOUNCE_MS = 140

const reducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function createTitle(root: HTMLElement, options: TitleOptions): Title {
  root.innerHTML = `
    <div class="title-embers" aria-hidden="true">
      <span class="title-ember title-ember--a"></span>
      <span class="title-ember title-ember--b"></span>
      <span class="title-ember title-ember--c"></span>
      <span class="title-smoke title-smoke--a"></span>
      <span class="title-smoke title-smoke--b"></span>
      <span class="title-flash title-flash--a"></span>
      <span class="title-flash title-flash--b"></span>
      <span class="title-flash title-flash--c"></span>
    </div>
    <div class="title-plate">
      <div class="title-markwrap">
        <img class="title-mark" src="brand/dead-pedal-logo.png" alt="Dead Pedal" width="1390" height="352" />
      </div>
      <p class="title-tagline">Four cars. One arena. Five minutes.</p>
      <button class="title-start" type="button" data-start>
        START
      </button>
      <p class="title-hint"><b>Enter</b> or <b>Space</b></p>
    </div>
  `

  const start = root.querySelector<HTMLButtonElement>('[data-start]')
  if (start === null) throw new Error('title: missing start button')

  let shown = true
  let fired = false

  /**
   * Idempotent on purpose. Enter fires the keydown handler AND, because the
   * button holds focus, the browser's own click-on-Enter — so a naive handler
   * starts the match twice, and the second call lands after the world has
   * already been rebuilt.
   */
  function commit(): void {
    if (fired || !shown) return
    fired = true
    options.onCommit?.()

    // Reduced motion gets the destination, not the journey.
    if (reducedMotion()) {
      hide()
      options.onStart()
      return
    }

    /**
     * Hand the wordmark off from wherever its breathe loop happens to be.
     *
     * The logo is on a 4.4s infinite scale animation and the player can press
     * START at any point in it. Simply swapping in the outro animation resets
     * the transform to scale(1) on the first frame, which is a visible snap on
     * the largest thing on screen. Reading the live matrix and handing that
     * value to the outro's opening keyframe makes the pull-away continue from
     * the exact size it was already at.
     */
    const mark = root.querySelector<HTMLElement>('.title-markwrap')
    if (mark !== null) {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(mark).transform)
      mark.style.setProperty('--mark-from', String(matrix.a || 1))
    }

    root.classList.add('is-leaving')
    window.setTimeout(() => {
      hide()
      root.classList.remove('is-leaving')
      options.onStart()
    }, OUTRO_MS)
  }

  function show(): void {
    shown = true
    fired = false
    root.classList.add('is-shown')
    // Focus the button so a keyboard player can commit without hunting, and so
    // the focus ring tells them where they are.
    start?.focus()
  }

  function hide(): void {
    shown = false
    root.classList.remove('is-shown')
    start?.blur()
  }

  start.addEventListener('click', commit)

  /**
   * Hover, debounced.
   *
   * `pointerenter` fires on every crossing, and a pointer resting near the edge
   * of the button can chatter across the boundary several times a second. The
   * mixer has its own repeat guard, but that guard exists to stop comb
   * filtering on simultaneous sim events and is far shorter than a menu wants.
   */
  let lastHover = 0
  start.addEventListener('pointerenter', () => {
    if (!shown || fired) return
    const now = performance.now()
    if (now - lastHover < HOVER_DEBOUNCE_MS) return
    lastHover = now
    options.onHover?.()
  })

  window.addEventListener('keydown', (event) => {
    if (!shown) return
    if (event.code !== 'Enter' && event.code !== 'Space' && event.code !== 'NumpadEnter') return
    // Space scrolls the page by default, and the game binds it to the handbrake
    // — neither should happen while a menu owns the screen.
    event.preventDefault()
    commit()
  })

  root.classList.add('is-shown')

  return { show, hide, visible: () => shown }
}
