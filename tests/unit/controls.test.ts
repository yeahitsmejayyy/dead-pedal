/**
 * The controls table is the single source of truth for key bindings, and the
 * controls screen renders it directly. That only buys anything if the table
 * stays well-formed and stays the thing the input layer actually obeys — a
 * menu that lists a key nothing listens to is worse than no menu, because it
 * is believed.
 *
 * These tests guard the two ways that can rot: an entry that cannot be
 * rendered, and a binding the input layer no longer agrees with.
 */
import { describe, expect, it } from 'vitest'
import {
  BINDINGS,
  GROUP_LABELS,
  bindingFor,
  bindingsIn,
  isBound,
  keyLabel,
  keysFor,
  type ControlGroup,
} from '../../src/content/controls'

const GROUPS: readonly ControlGroup[] = ['driving', 'combat', 'system']

describe('the controls table', () => {
  it('gives every action a label and at least one key', () => {
    for (const binding of BINDINGS) {
      expect(binding.label.trim(), `${binding.action} has no label`).not.toBe('')
      expect(binding.keys.length, `${binding.action} has no keys`).toBeGreaterThan(0)
    }
  })

  it('binds each key code to only one action', () => {
    const seen = new Map<string, string>()
    for (const binding of BINDINGS) {
      for (const code of binding.keys) {
        const owner = seen.get(code)
        expect(owner, `${code} is bound to both ${owner} and ${binding.action}`).toBeUndefined()
        seen.set(code, binding.action)
      }
    }
  })

  it('names every action exactly once', () => {
    const names = BINDINGS.map((b) => b.action)
    expect(new Set(names).size).toBe(names.length)
  })

  it('puts every binding in a group that has a label', () => {
    for (const binding of BINDINGS) {
      expect(GROUPS, `${binding.action} is in an unknown group`).toContain(binding.group)
      expect(GROUP_LABELS[binding.group]).toBeTruthy()
    }
  })

  it('lists every binding under exactly one group', () => {
    const listed = GROUPS.flatMap((group) => bindingsIn(group))
    expect(listed).toHaveLength(BINDINGS.length)
  })

  it('finds a binding by action', () => {
    expect(bindingFor('handbrake').keys).toContain('Space')
    expect(keysFor('forward')).toContain('KeyW')
  })

  it('answers isBound against the table, not a copy', () => {
    expect(isBound('menu', 'Escape')).toBe(true)
    expect(isBound('menu', 'KeyP')).toBe(true)
    expect(isBound('menu', 'KeyW')).toBe(false)
  })
})

describe('key labels', () => {
  it('strips the code prefixes a player should never see', () => {
    expect(keyLabel('KeyW')).toBe('W')
    expect(keyLabel('ArrowUp')).toBe('Up arrow')
    expect(keyLabel('Escape')).toBe('Esc')
    expect(keyLabel('Space')).toBe('Space')
    expect(keyLabel('Tab')).toBe('Tab')
  })

  it('never renders a label that still looks like a code', () => {
    for (const binding of BINDINGS) {
      for (const code of binding.keys) {
        const label = keyLabel(code)
        expect(label, `${code} renders as ${label}`).not.toMatch(/^(Key|Digit|Arrow)/)
      }
    }
  })
})
