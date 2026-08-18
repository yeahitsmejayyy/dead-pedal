/**
 * L5 — the in-game menu.
 *
 * The pause screen and the settings screen are the same screen. There used to be
 * two ways to stop the game that looked different and meant the same thing — a
 * PAUSED card on the HUD, and a tweakpane panel that shipped to players and sat
 * over the arena whether or not anyone wanted it. This replaces both.
 *
 * DOM over the canvas, like the title and select screens and for the same
 * reasons: text the browser lays out stays crisp at any pixel ratio and costs no
 * draw call. It follows their shape too — `createMenu(root, options)` returning
 * show/hide/visible — so all three menus are read the same way.
 *
 * Opening it freezes the world. That is main's job, not this file's; this only
 * reports that it opened.
 */
import {
  GROUP_LABELS,
  bindingsIn,
  keyLabel,
  type ControlGroup,
} from '../content/controls'
import { DIFFICULTIES } from '../content/bots'

export type MenuOptions = {
  /** Closed, by any route. Main unfreezes the world here. */
  readonly onClose: () => void
  /** Opened. Main freezes the world here. */
  readonly onOpen: () => void
  /** Start the match again from the countdown, same car, same arena. */
  readonly onRestart: () => void
  /** Abandon the match and go back to the title screen. */
  readonly onQuit: () => void
  readonly onDifficultyChange: (key: string) => void
  readonly onSoundToggle: (on: boolean) => void
  readonly onMusicCycle: () => void
  /** Pointer entered something interactive. Already debounced. */
  readonly onHover?: () => void
  /** Reads current state at open time, so the menu never shows a stale value. */
  readonly state: () => { difficulty: string; sound: boolean }
}

export type Menu = {
  readonly open: () => void
  readonly close: () => void
  readonly toggle: () => void
  readonly visible: () => boolean
}

/** Ignore hover retriggers closer together than this. Matches the title screen. */
const HOVER_DEBOUNCE_MS = 140

const GROUPS: readonly ControlGroup[] = ['driving', 'combat', 'system']

export function createMenu(root: HTMLElement, options: MenuOptions): Menu {
  /**
   * Nothing is built until the menu is first opened.
   *
   * This used to run at boot, and it cost more than it looks like it should:
   * a full-viewport fixed layer with a blurred scrim, plus the whole controls
   * list, parsed and styled while the page was still coming up. It was enough
   * to delay the AudioContext's `resume` past the point the autoplay spec
   * checks it, and that spec was right to fail — a menu nobody has opened has
   * no business competing with the game's own startup.
   *
   * The deferred work lands on the first Escape instead, where the world is
   * frozen anyway and a few milliseconds of DOM cannot be perceived. Same
   * instinct as the deferred music fetch and the unrendered arena.
   */
  let built = false
  let difficulty: HTMLSelectElement
  let soundBtn: HTMLButtonElement
  const views = new Map<string, HTMLElement>()

  function build(): void {
    if (built) return
    built = true
    root.innerHTML = MARKUP

    for (const view of root.querySelectorAll<HTMLElement>('[data-view]')) {
      views.set(view.dataset['view'] ?? '', view)
    }

    // Built from the literal above, so a null means the markup and this code
    // have gone out of step — a programming error, not a case to handle.
    const difficultyEl = root.querySelector<HTMLSelectElement>('[data-difficulty]')
    const soundEl = root.querySelector<HTMLButtonElement>('[data-menu-sound]')
    if (difficultyEl === null || soundEl === null) throw new Error('menu: markup did not build')
    difficulty = difficultyEl
    soundBtn = soundEl

    difficulty.addEventListener('change', () => {
      options.onDifficultyChange(difficulty.value)
      // The match restarts underneath, which is exactly what you asked for by
      // changing it — so get out of the way and let the countdown be visible.
      close()
    })

    // Clicking the scrim is the same as Resume. A modal you cannot dismiss by
    // clicking away from is a modal people get stuck in.
    root.querySelector('.menu-scrim')?.addEventListener('click', close)
  }

  const MARKUP = `
    <div class="menu-scrim"></div>
    <div class="menu-panel" role="dialog" aria-modal="true" aria-label="Game menu">
      <div class="menu-view" data-view="root">
        <h2 class="menu-title">Paused</h2>

        <div class="menu-actions">
          <button class="menu-btn menu-btn--primary" type="button" data-act="resume">Resume</button>
          <button class="menu-btn" type="button" data-act="controls">Controls</button>
          <button class="menu-btn" type="button" data-act="restart">Restart match</button>
          <button class="menu-btn menu-btn--quiet" type="button" data-act="quit">Quit to title</button>
        </div>

        <div class="menu-settings">
          <div class="menu-setting">
            <label class="menu-setting__label" for="menu-difficulty">Difficulty</label>
            <select class="menu-select" id="menu-difficulty" data-difficulty>
              ${Object.entries(DIFFICULTIES)
                .map(([key, tier]) => `<option value="${key}">${tier.label}</option>`)
                .join('')}
            </select>
          </div>
          <p class="menu-setting__note">Changing difficulty restarts the match.</p>

          <div class="menu-setting">
            <span class="menu-setting__label">Sound</span>
            <button class="menu-toggle" type="button" data-menu-sound aria-pressed="false">Off</button>
          </div>

          <div class="menu-setting">
            <span class="menu-setting__label">Music</span>
            <button class="menu-toggle" type="button" data-menu-music>Next track</button>
          </div>
        </div>
      </div>

      <div class="menu-view" data-view="controls" hidden>
        <h2 class="menu-title">Controls</h2>
        <div class="menu-controls">
          ${GROUPS.map(
            (group) => `
            <section class="menu-group">
              <h3 class="menu-group__title">${GROUP_LABELS[group]}</h3>
              <dl class="menu-binds">
                ${bindingsIn(group)
                  .map(
                    (b) => `
                  <div class="menu-bind">
                    <dt class="menu-bind__label">${b.label}${
                      b.note === undefined ? '' : ` <i class="menu-bind__note">${b.note}</i>`
                    }</dt>
                    <dd class="menu-bind__keys">
                      ${b.keys.map((k) => `<kbd>${keyLabel(k)}</kbd>`).join('<span class="menu-bind__or">/</span>')}
                      ${b.pad === undefined ? '' : `<span class="menu-bind__pad">${b.pad}</span>`}
                    </dd>
                  </div>`,
                  )
                  .join('')}
              </dl>
            </section>`,
          ).join('')}
        </div>
        <div class="menu-actions">
          <button class="menu-btn menu-btn--primary" type="button" data-act="back">Back</button>
        </div>
      </div>
    </div>
  `

  let shown = false

  function showView(name: string): void {
    for (const [key, view] of views) view.hidden = key !== name
    // Focus the first control in the view that just arrived, so a keyboard
    // player is never left with focus on a button that is now hidden.
    views.get(name)?.querySelector<HTMLElement>('button, select')?.focus()
  }

  function syncFromState(): void {
    const state = options.state()
    difficulty.value = state.difficulty
    soundBtn.textContent = state.sound ? 'On' : 'Off'
    soundBtn.setAttribute('aria-pressed', String(state.sound))
  }

  function open(): void {
    if (shown) return
    shown = true
    build()
    syncFromState()
    showView('root')
    root.classList.add('is-shown')
    options.onOpen()
  }

  function close(): void {
    if (!shown) return
    shown = false
    root.classList.remove('is-shown')
    options.onClose()
  }

  function toggle(): void {
    if (shown) close()
    else open()
  }

  // ── wiring ─────────────────────────────────────────────────────────────────

  root.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return

    const act = target.closest<HTMLElement>('[data-act]')?.dataset['act']
    if (act === 'resume') close()
    else if (act === 'controls') showView('controls')
    else if (act === 'back') showView('root')
    else if (act === 'restart') {
      close()
      options.onRestart()
    } else if (act === 'quit') {
      close()
      options.onQuit()
    }

    if (target.closest('[data-menu-sound]') !== null) {
      const next = soundBtn.getAttribute('aria-pressed') !== 'true'
      options.onSoundToggle(next)
      syncFromState()
    }
    if (target.closest('[data-menu-music]') !== null) options.onMusicCycle()
  })

  let lastHover = 0
  root.addEventListener('pointerenter', (event) => {
    if (!shown) return
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    if (target.closest('button, select') === null) return
    const now = performance.now()
    if (now - lastHover < HOVER_DEBOUNCE_MS) return
    lastHover = now
    options.onHover?.()
  }, true)

  return { open, close, toggle, visible: () => shown }
}
