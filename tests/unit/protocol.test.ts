/**
 * The wire contract.
 *
 * Two things are worth testing here and they are not the same thing. One is
 * that a version skew is refused with something a human can act on — the whole
 * reason the field exists. The other is that a malformed InputFrame cannot
 * reach the sim, because the sim is pure arithmetic with no defences: a NaN
 * throttle does not throw, it silently turns a car into NaN and everything
 * computed from it afterwards.
 */
import { describe, expect, it } from 'vitest'
import { createWorld } from '../../src/sim'
import { DEATHMATCH } from '../../src/content/match'
import { hashState } from '../../src/core/hash'
import {
  PROTOCOL_VERSION,
  checkProtocol,
  decodeClientMessage,
  decodeServerMessage,
  encode,
  mergeSnapshot,
  setupOf,
  snapshotOf,
  type ClientMessage,
} from '../../src/net/protocol'

const world = createWorld({ seed: 1, vehicles: 2, health: () => 200, rules: DEATHMATCH })

describe('the version handshake', () => {
  it('accepts a peer speaking the same version', () => {
    expect(checkProtocol(PROTOCOL_VERSION)).toBeNull()
  })

  it('refuses an older client and tells it to reload', () => {
    const error = checkProtocol(PROTOCOL_VERSION - 1)
    expect(error?.code).toBe('E_PROTOCOL_MISMATCH')
    expect(error?.message).toContain('Reload')
    // Both numbers named, so the report says what actually disagreed.
    expect(error?.message).toContain(String(PROTOCOL_VERSION - 1))
    expect(error?.message).toContain(String(PROTOCOL_VERSION))
  })

  it('refuses a newer client WITHOUT telling it to reload', () => {
    // Reloading cannot fix a stale server, and sending someone round a loop
    // that cannot terminate is worse than saying nothing.
    const error = checkProtocol(PROTOCOL_VERSION + 1)
    expect(error?.code).toBe('E_PROTOCOL_MISMATCH')
    expect(error?.message).not.toContain('Reload')
    expect(error?.message).toContain('out of date')
  })

  it('refuses a client that did not state a version at all', () => {
    for (const nonsense of [undefined, null, 'one', 1.5, Number.NaN]) {
      expect(checkProtocol(nonsense)?.code).toBe('E_PROTOCOL_MISMATCH')
    }
  })
})

describe('decoding what a client sends', () => {
  it('round-trips every client message', () => {
    const messages: ClientMessage[] = [
      { type: 'join', protocol: PROTOCOL_VERSION, name: 'jayyy' },
      { type: 'chooseCar', archetype: 'sports' },
      { type: 'ready', ready: true },
      {
        type: 'input',
        tick: 42,
        input: { tick: 42, throttle: 1, steer: -0.5, handbrake: false, fire: true, special: false, cycleWeapon: false, cycleTarget: false, lookBack: false },
      },
    ]

    for (const message of messages) {
      const decoded = decodeClientMessage(encode(message))
      expect(decoded.ok, `${message.type} failed to decode`).toBe(true)
      if (decoded.ok) expect(decoded.message).toEqual(message)
    }
  })

  it('rejects rubbish rather than throwing', () => {
    for (const raw of ['', 'not json', '[]', '{}', '{"type":"nope"}', 'null']) {
      const decoded = decodeClientMessage(raw)
      expect(decoded.ok, `${JSON.stringify(raw)} was accepted`).toBe(false)
      if (!decoded.ok) expect(decoded.error.code).toBe('E_BAD_MESSAGE')
    }
  })

  it('refuses a non-finite axis, which the sim cannot defend itself against', () => {
    // NaN and Infinity do not survive JSON, so they arrive as null — but a
    // string or a missing field does, and each is a way to poison the sim.
    for (const throttle of [null, 'fast', undefined]) {
      const raw = JSON.stringify({
        type: 'input',
        tick: 1,
        input: { tick: 1, throttle, steer: 0, handbrake: false, fire: false, special: false, cycleWeapon: false, cycleTarget: false, lookBack: false },
      })
      expect(decodeClientMessage(raw).ok, `throttle ${String(throttle)} was accepted`).toBe(false)
    }
  })

  it('clamps an axis to the range the input layer itself produces', () => {
    const raw = JSON.stringify({
      type: 'input',
      tick: 1,
      input: { tick: 1, throttle: 999, steer: -999, handbrake: false, fire: false, special: false, cycleWeapon: false, cycleTarget: false, lookBack: false },
    })
    const decoded = decodeClientMessage(raw)
    expect(decoded.ok).toBe(true)
    if (decoded.ok && decoded.message.type === 'input') {
      expect(decoded.message.input.throttle).toBe(1)
      expect(decoded.message.input.steer).toBe(-1)
    }
  })

  it('refuses a flag that is not a boolean', () => {
    const raw = JSON.stringify({
      type: 'input',
      tick: 1,
      input: { tick: 1, throttle: 0, steer: 0, handbrake: 'yes', fire: false, special: false, cycleWeapon: false, cycleTarget: false, lookBack: false },
    })
    expect(decodeClientMessage(raw).ok).toBe(false)
  })
})

describe('decoding what a server sends', () => {
  it('accepts each server message type', () => {
    const raws = [
      JSON.stringify({ type: 'lobbyState', you: 0, players: [], minimumToStart: 2 }),
      JSON.stringify({ type: 'snapshot', snapshot: snapshotOf(world) }),
      JSON.stringify({ type: 'matchEnd', scores: [1, 0], winner: 0 }),
      JSON.stringify({ type: 'error', code: 'E_ROOM_FULL', message: 'full' }),
    ]
    for (const raw of raws) expect(decodeServerMessage(raw).ok).toBe(true)
  })

  it('drops a frame it cannot identify instead of crashing the loop', () => {
    expect(decodeServerMessage('{"type":"surprise"}').ok).toBe(false)
    expect(decodeServerMessage('garbage').ok).toBe(false)
  })
})

describe('splitting static setup from the per-tick snapshot', () => {
  it('loses nothing: setup plus snapshot reconstructs the world exactly', () => {
    const rebuilt = mergeSnapshot(setupOf(world), snapshotOf(world))
    // The project hash is the arbiter of "the same world", not a deep-equal.
    expect(hashState(rebuilt)).toBe(hashState(world))
  })

  it('survives the wire, not just the function call', () => {
    const setup = JSON.parse(JSON.stringify(setupOf(world))) as ReturnType<typeof setupOf>
    const snap = JSON.parse(JSON.stringify(snapshotOf(world))) as ReturnType<typeof snapshotOf>
    expect(hashState(mergeSnapshot(setup, snap))).toBe(hashState(world))
  })

  it('actually removes the static half, which is the point', () => {
    const full = JSON.stringify(world).length
    const dynamic = JSON.stringify(snapshotOf(world)).length
    // Measured at ~49% in the spike. Asserting a floor rather than a figure, so
    // this fails if the saving disappears without pinning it to today's arena.
    expect(dynamic).toBeLessThan(full * 0.75)
  })
})
