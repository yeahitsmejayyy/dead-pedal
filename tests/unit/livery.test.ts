/**
 * M8: the vehicle-id → paint mapping the select screen writes into.
 *
 * This is the whole of what choosing a car does. The sim never learns about it —
 * vehicles stay ids — so the only thing standing between "the player picked the
 * green truck" and the player driving something else is this function.
 *
 * The property that actually matters is the LAST one: all four liveries always
 * present, never a duplicate. The four were chosen to be told apart at speed on
 * a 6px radar blip, and that whole argument collapses the moment two cars share
 * one. A naive implementation — say, swapping ids 0 and n — passes every
 * obvious test and still hands you two red cars when the player picks red.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { LIVERIES, liveryOf, playerLivery, setPlayerLivery } from '../../src/view/palette'

const VEHICLES = [0, 1, 2, 3]

describe('livery assignment', () => {
  beforeEach(() => {
    setPlayerLivery(0)
  })

  it('is identity before anyone chooses', () => {
    expect(VEHICLES.map(liveryOf)).toEqual([0, 1, 2, 3])
  })

  it('gives the player whatever they picked', () => {
    for (const pick of VEHICLES) {
      setPlayerLivery(pick)
      expect(liveryOf(0), `vehicle 0 wears livery ${String(pick)}`).toBe(pick)
      expect(playerLivery()).toBe(pick)
    }
  })

  it('never repeats a livery, whichever car is picked', () => {
    for (const pick of VEHICLES) {
      setPlayerLivery(pick)
      const worn = VEHICLES.map(liveryOf)
      expect(new Set(worn).size, `picking ${String(pick)} gave duplicates: ${worn.join()}`).toBe(
        LIVERIES.length,
      )
      // Every livery on the field, not merely four distinct numbers.
      expect([...worn].sort()).toEqual([0, 1, 2, 3])
    }
  })

  it('keeps the opponents in a stable order around the gap', () => {
    setPlayerLivery(2)
    // 2 is taken by the player, so the rest fill 0, 1, 3 in order.
    expect(VEHICLES.map(liveryOf)).toEqual([2, 0, 1, 3])
  })

  it('wraps out-of-range picks rather than producing an undefined livery', () => {
    setPlayerLivery(LIVERIES.length + 1)
    expect(liveryOf(0)).toBe(1)
    setPlayerLivery(-1)
    expect(liveryOf(0)).toBe(LIVERIES.length - 1)
  })

  it('handles more vehicles than liveries by cycling the opponents', () => {
    setPlayerLivery(0)
    // Vehicle 4 is beyond the three remaining liveries and must still land on
    // one of them rather than on undefined.
    expect(LIVERIES[liveryOf(4)]).toBeDefined()
    expect(liveryOf(4)).not.toBe(0)
  })
})
