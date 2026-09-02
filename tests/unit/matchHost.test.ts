/**
 * The authoritative match, driven by scripted clients and no browser at all.
 *
 * The point of the host owning no clock and no socket is that this file can
 * exist: a whole match runs to completion in milliseconds, and every claim
 * about who drives what is checkable without rendering a frame.
 */
import { describe, expect, it } from 'vitest'
import { MatchHost } from '../../src/net/matchHost'
import { mergeSnapshot } from '../../src/net/protocol'
import { QUICK_RULES, DEATHMATCH } from '../../src/content/match'
import { hashState } from '../../src/core/hash'
import { NEUTRAL_INPUT, type InputFrame } from '../../src/sim'

const frame = (over: Partial<InputFrame> = {}): InputFrame => ({ ...NEUTRAL_INPUT, ...over })

/** Run the host until the match ends, or fail loudly rather than hanging. */
function runToCompletion(host: MatchHost, drive?: (tick: number) => void): number {
  const limit = 60 * 60 * 10 // ten minutes of sim; QUICK_RULES needs ~21s
  for (let i = 0; i < limit; i++) {
    drive?.(i)
    host.tick()
    if (host.over) return i + 1
  }
  throw new Error(`the match did not finish within ${limit} ticks`)
}

describe('a match run by scripted clients', () => {
  it('runs to completion with nobody connected at all', () => {
    // Every seat is a bot when no one has joined, so an empty room still plays
    // a real match rather than sitting frozen.
    const host = new MatchHost({ slots: 4, rules: QUICK_RULES, seed: 3 })
    const ticks = runToCompletion(host)

    expect(host.over).toBe(true)
    expect(ticks).toBeGreaterThan(QUICK_RULES.roundSeconds * 60)
    expect(host.state.match.phase).toBe('matchOver')
  })

  it('runs to completion with two scripted players driving', () => {
    const host = new MatchHost({ slots: 4, rules: QUICK_RULES, seed: 5 })
    const a = host.join('a')
    const b = host.join('b')
    expect(a).toBe(0)
    expect(b).toBe(1)

    const ticks = runToCompletion(host, (i) => {
      host.input(a!, frame({ tick: i, throttle: 1, steer: Math.sin(i / 40) }))
      host.input(b!, frame({ tick: i, throttle: 1, steer: Math.cos(i / 30), fire: true }))
    })

    expect(host.over).toBe(true)
    // The scripted cars actually went somewhere, rather than the match merely
    // timing out around two parked cars.
    const start = new MatchHost({ slots: 4, rules: QUICK_RULES, seed: 5 }).state
    const movedA = host.state.vehicles[0]!.pos
    expect(Math.hypot(movedA.x - start.vehicles[0]!.pos.x, movedA.z - start.vehicles[0]!.pos.z))
      .toBeGreaterThan(5)
    expect(ticks).toBeGreaterThan(0)
  })
})

describe('seats', () => {
  it('hands out the lowest free seat and refuses when full', () => {
    const host = new MatchHost({ slots: 2 })
    expect(host.join()).toBe(0)
    expect(host.join()).toBe(1)
    expect(host.join()).toBeNull()
  })

  it('gives a seat back when a player leaves', () => {
    // A counter that never frees would report the room full while it is empty —
    // the exact bug the spike hit on its first reload.
    const host = new MatchHost({ slots: 2 })
    host.join()
    host.join()
    host.leave(0)
    expect(host.join()).toBe(0)
  })

  it('ignores input for a seat nobody holds', () => {
    const host = new MatchHost({ slots: 2, rules: DEATHMATCH, seed: 9 })
    const held = new MatchHost({ slots: 2, rules: DEATHMATCH, seed: 9 })

    // Seat 1 was never joined, so flooring it must change nothing.
    for (let i = 0; i < 120; i++) {
      host.input(1, frame({ tick: i, throttle: 1 }))
      host.tick()
      held.tick()
    }
    expect(hashState(host.state)).toBe(hashState(held.state))
  })

  it('lets a bot take the seat back when a player leaves', () => {
    const host = new MatchHost({ slots: 2, rules: DEATHMATCH, seed: 11 })
    const id = host.join()!
    for (let i = 0; i < 240; i++) host.tick()
    host.leave(id)
    expect(host.seated()).toHaveLength(0)

    // The car keeps being driven — by a bot now — rather than going inert.
    const before = host.state.vehicles[id]!.pos
    for (let i = 0; i < 240; i++) host.tick()
    const after = host.state.vehicles[id]!.pos
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(1)
  })
})

describe('a player whose input does not arrive', () => {
  it('keeps their last frame rather than dropping to neutral', () => {
    // The failure this guards is subtle and gets blamed on the handling: a
    // dropped packet reading as a released throttle means the car brakes by
    // itself exactly when the network is worst.
    const host = new MatchHost({ slots: 2, rules: DEATHMATCH, seed: 13 })
    const id = host.join()!

    // Hold the throttle for long enough to be moving, then go quiet.
    for (let i = 0; i < 200; i++) {
      host.input(id, frame({ tick: i, throttle: 1 }))
      host.tick()
    }
    const movingAt = Math.hypot(host.state.vehicles[id]!.vel.x, host.state.vehicles[id]!.vel.z)
    expect(movingAt, 'the car should be moving before the silence starts').toBeGreaterThan(5)

    // Silence. No input at all for a second.
    for (let i = 0; i < 60; i++) host.tick()
    const stillMoving = Math.hypot(host.state.vehicles[id]!.vel.x, host.state.vehicles[id]!.vel.z)

    // Rolling resistance takes a little off; a released throttle would take far
    // more, and a brake would take nearly all of it.
    expect(stillMoving).toBeGreaterThan(movingAt * 0.8)
  })
})

describe('what goes on the wire', () => {
  it('setup plus snapshot reconstructs exactly the world the host holds', () => {
    const host = new MatchHost({ slots: 4, rules: DEATHMATCH, seed: 17 })
    const id = host.join()!
    for (let i = 0; i < 300; i++) {
      host.input(id, frame({ tick: i, throttle: 1, steer: 0.4, fire: true }))
      host.tick()
    }

    const rebuilt = mergeSnapshot(host.setup(), host.snapshot())
    expect(hashState(rebuilt)).toBe(hashState(host.state))
  })

  it('survives JSON, which is what actually happens to it', () => {
    const host = new MatchHost({ slots: 4, rules: DEATHMATCH, seed: 19 })
    for (let i = 0; i < 200; i++) host.tick()

    const setup = JSON.parse(JSON.stringify(host.setup())) as ReturnType<MatchHost['setup']>
    const snap = JSON.parse(JSON.stringify(host.snapshot())) as ReturnType<MatchHost['snapshot']>
    expect(hashState(mergeSnapshot(setup, snap))).toBe(hashState(host.state))
  })
})

describe('determinism', () => {
  it('two hosts given identical input produce byte-identical worlds', () => {
    // The property the whole authoritative model rests on. If this can fail,
    // replays and the world hash are lying about something.
    const build = (): MatchHost => new MatchHost({ slots: 4, rules: DEATHMATCH, seed: 23 })
    const one = build()
    const two = build()
    const a = one.join()!
    const b = two.join()!

    for (let i = 0; i < 600; i++) {
      const f = frame({ tick: i, throttle: 1, steer: Math.sin(i / 25), fire: i % 7 === 0 })
      one.input(a, f)
      two.input(b, f)
      one.tick()
      two.tick()
    }

    expect(hashState(one.state)).toBe(hashState(two.state))
  })

  it('restart produces a different match, not the same one again', () => {
    const host = new MatchHost({ slots: 4, rules: DEATHMATCH, seed: 29 })
    const first = hashState(host.state)
    for (let i = 0; i < 120; i++) host.tick()
    host.restart()
    expect(host.state.tick).toBe(0)
    expect(hashState(host.state)).not.toBe(first)
  })
})
