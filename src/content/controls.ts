/**
 * L1 — every key the game listens to, in one table.
 *
 * Bindings used to live in three places that had no way of knowing about each
 * other: `KEYS` in the input layer, loose `event.code` comparisons in main, and
 * a hand-written strip of markup under the canvas. Nothing kept them honest, so
 * the on-screen list was only ever accurate until the next time a binding moved.
 *
 * This is the source. The input layer derives its lookups from it, main reads
 * its global keys off it, and the menu renders it — so a rebind is one edit and
 * the controls screen cannot drift from what the game actually does.
 *
 * Content, not logic: it holds no behaviour, and every layer above may read it.
 */

/** Which screen a binding belongs to, and therefore where it is listed. */
export type ControlGroup = 'driving' | 'combat' | 'system'

export type Binding = {
  /** Stable identifier. What the code refers to; never shown to a player. */
  readonly action: string
  /** Shown in the controls list. Sentence case, no trailing period. */
  readonly label: string
  /** `KeyboardEvent.code` values. First is the one the list leads with. */
  readonly keys: readonly string[]
  /** How the same action reads on a pad. Absent when the pad has no binding. */
  readonly pad?: string
  /** Shown next to the binding when it needs a caveat. */
  readonly note?: string
  readonly group: ControlGroup
}

/**
 * Order matters: this is display order in the controls list, and the two
 * driving rows are first because they are what a player needs within a second
 * of arriving.
 */
export const BINDINGS = [
  { action: 'forward', label: 'Throttle', keys: ['KeyW', 'ArrowUp'], pad: 'Right trigger', group: 'driving' },
  { action: 'back', label: 'Brake / reverse', keys: ['KeyS', 'ArrowDown'], pad: 'Left trigger', group: 'driving' },
  { action: 'left', label: 'Steer left', keys: ['KeyA', 'ArrowLeft'], pad: 'Left stick', group: 'driving' },
  { action: 'right', label: 'Steer right', keys: ['KeyD', 'ArrowRight'], pad: 'Left stick', group: 'driving' },
  { action: 'handbrake', label: 'Handbrake', keys: ['Space'], pad: 'A', group: 'driving' },
  { action: 'lookBack', label: 'Look back', keys: ['KeyC'], pad: 'B', group: 'driving' },
  { action: 'reset', label: 'Reset car', keys: ['KeyR'], group: 'driving' },

  { action: 'fire', label: 'Machine gun', keys: ['KeyJ'], pad: 'X', note: 'or left click', group: 'combat' },
  { action: 'special', label: 'Fire special', keys: ['KeyK'], pad: 'Y', note: 'or right click', group: 'combat' },
  { action: 'cycle', label: 'Cycle special', keys: ['KeyL'], pad: 'RB', group: 'combat' },
  {
    action: 'cycleTarget',
    label: 'Next target',
    keys: ['KeyT', 'Tab'],
    pad: 'LB',
    note: 'homing missile only',
    group: 'combat',
  },

  { action: 'menu', label: 'Menu', keys: ['Escape', 'KeyP'], pad: 'Start', group: 'system' },
  { action: 'mute', label: 'Sound on / off', keys: ['KeyN'], group: 'system' },
  { action: 'music', label: 'Next music track', keys: ['KeyM'], group: 'system' },
] as const satisfies readonly Binding[]

export type ActionName = (typeof BINDINGS)[number]['action']

/**
 * Every binding, keyed by action.
 *
 * A Map rather than a Record built from `Object.fromEntries`: that returns an
 * index signature, and asserting it into a Record of the exact action names is
 * a cast TypeScript rightly refuses. `ActionName` is derived from this same
 * array, so a miss is impossible — hence the throw rather than a nullable
 * return that every caller would have to answer for.
 */
const byAction = new Map<string, Binding>(BINDINGS.map((b) => [b.action, b]))

export function bindingFor(action: ActionName): Binding {
  const found = byAction.get(action)
  if (found === undefined) throw new Error(`controls: no binding for "${action}"`)
  return found
}

/** The key codes for one action. The input layer's whole view of this table. */
export function keysFor(action: ActionName): readonly string[] {
  return bindingFor(action).keys
}

/** True when a `KeyboardEvent.code` is bound to this action. */
export function isBound(action: ActionName, code: string): boolean {
  return bindingFor(action).keys.includes(code)
}

export const GROUP_LABELS: Record<ControlGroup, string> = {
  driving: 'Driving',
  combat: 'Combat',
  system: 'System',
}

/**
 * How a key code reads to a person.
 *
 * `KeyboardEvent.code` is a physical-key name, so it is full of prefixes no
 * player should ever be shown — "KeyW" and "ArrowUp" are implementation detail.
 */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code.startsWith('Arrow')) return `${code.slice(5)} arrow`
  if (code === 'Space') return 'Space'
  if (code === 'Escape') return 'Esc'
  return code
}

export function bindingsIn(group: ControlGroup): readonly Binding[] {
  return BINDINGS.filter((b) => b.group === group)
}
