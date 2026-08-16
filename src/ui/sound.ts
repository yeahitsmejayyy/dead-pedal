/**
 * L5 — the sound toggle.
 *
 * Sound is OFF when the page loads, and this is how it comes on.
 *
 * That default is not timidity, it is the only arrangement that cannot fail. A
 * browser refuses to let a page make noise until the user has done something,
 * and a page that tries anyway fails silently — no error, no prompt, nothing to
 * notice. Every workaround for that is a guess about when a gesture might
 * arrive. A button removes the guess: the click that turns sound on IS the
 * gesture, so it works the first time, every time, in every browser.
 *
 * It also gives the player the thing they actually wanted, which is a way to
 * turn the music off without hunting for a key they were never told about.
 *
 * Deliberately NOT persisted. Remembering "on" across reloads would put the
 * icon in the on state on a fresh page where no gesture has happened yet, so
 * the control would be lying until the player next clicked something. An honest
 * off beats a hopeful on.
 */

export type SoundToggleOptions = {
  /** Called with the new state whenever the player flips it. */
  readonly onChange: (on: boolean) => void
  /** Pointer entered the control. */
  readonly onHover?: () => void
}

export type SoundToggle = {
  /** Reflect state that changed elsewhere — the N key, for instance. */
  readonly set: (on: boolean) => void
  readonly isOn: () => boolean
}

/** Two icons, drawn rather than fetched: an image request that 404s is a dead control. */
const SPEAKER = `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M4 9.5h3.2L12 5.4v13.2L7.2 14.5H4z" />
    <path class="sound-wave" d="M15.4 9a4.2 4.2 0 0 1 0 6" />
    <path class="sound-wave sound-wave--far" d="M18 6.6a7.6 7.6 0 0 1 0 10.8" />
    <path class="sound-cross" d="M15.5 9.2l5.2 5.6M20.7 9.2l-5.2 5.6" />
  </svg>
`

export function createSoundToggle(root: HTMLElement, options: SoundToggleOptions): SoundToggle {
  let on = false

  root.innerHTML = `
    <button class="sound-button" type="button" data-sound
            aria-pressed="false" aria-label="Turn sound on" title="Sound (N)">
      ${SPEAKER}
    </button>
  `

  const button = root.querySelector<HTMLButtonElement>('[data-sound]')
  if (button === null) throw new Error('sound: missing button')

  function paint(): void {
    root.classList.toggle('is-on', on)
    button?.setAttribute('aria-pressed', String(on))
    button?.setAttribute('aria-label', on ? 'Turn sound off' : 'Turn sound on')
  }

  button.addEventListener('click', () => {
    on = !on
    paint()
    options.onChange(on)
  })
  button.addEventListener('pointerenter', () => {
    // Only once it is on — a hover tick from the control that turns sound on is
    // a sound the player has not agreed to yet.
    if (on) options.onHover?.()
  })

  paint()

  return {
    set(next: boolean): void {
      if (next === on) return
      on = next
      paint()
    },
    isOn: () => on,
  }
}
