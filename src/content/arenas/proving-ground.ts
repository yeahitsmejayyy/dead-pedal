/**
 * L2 — the M2 arena: a bounded floor with blocks to hit and ramps to jump.
 *
 * This is the "first real arena and its collision model, authored together"
 * that M2 asks for, read as literally as possible: there is no mesh and no
 * export step. The sim collides against this data and the renderer builds
 * geometry from the same data, so the two cannot drift apart. A Blender
 * pipeline is the M7 version of this problem and is not worth its cost until
 * an arena needs shapes a box cannot express.
 *
 * Layout: an open middle for ramming, a jump line down the west side, and
 * scattered cover so there is something to slide a car into.
 */
import type { Arena } from '../../sim/types'

const WALL_HEIGHT = 4

export const PROVING_GROUND: Arena = {
  id: 'proving-ground',
  label: 'Proving Ground',
  groundY: 0,
  halfExtents: { x: 90, z: 90 },
  wallHeight: WALL_HEIGHT,

  blocks: [
    // Pillars to learn to drift around. Kept off the x=0 line so the ram lane
    // between spawns 0 and 1 stays clear — M2 is judged on that run.
    { id: 'pillar-n', pos: { x: 22, y: 0, z: 26 }, halfExtents: { x: 3, y: 2.5, z: 3 }, yaw: 0.4 },
    { id: 'pillar-s', pos: { x: -22, y: 0, z: -26 }, halfExtents: { x: 3, y: 2.5, z: 3 }, yaw: -0.4 },

    // Long barriers you have to commit to going round.
    { id: 'barrier-e', pos: { x: 42, y: 0, z: 8 }, halfExtents: { x: 1.4, y: 1.6, z: 16 }, yaw: 0.22 },
    { id: 'barrier-w', pos: { x: -46, y: 0, z: -30 }, halfExtents: { x: 1.4, y: 1.6, z: 14 }, yaw: -0.15 },

    // Crates. Low enough that a ramp launch clears them, which is the point.
    { id: 'crate-a', pos: { x: 24, y: 0, z: -44 }, halfExtents: { x: 2.2, y: 1.1, z: 2.2 }, yaw: 0.7 },
    { id: 'crate-b', pos: { x: 31, y: 0, z: -50 }, halfExtents: { x: 2.2, y: 1.1, z: 2.2 }, yaw: 0.2 },
    { id: 'crate-c', pos: { x: 18, y: 0, z: -52 }, halfExtents: { x: 2.2, y: 1.1, z: 2.2 }, yaw: -0.5 },
    { id: 'crate-d', pos: { x: -30, y: 0, z: 52 }, halfExtents: { x: 2.6, y: 1.3, z: 2.6 }, yaw: 0.3 },
  ],

  // Each ramp is a tent: a long gentle approach up to the ridge, and a short
  // steep boost incline down the far side.
  //
  // The back slope was added without touching the approach. Rather than
  // compress the climb into the existing footprint — which would have steepened
  // it and quietly made the main jump a third bigger — every ramp grew by its
  // own `backRun` at the tall end, and its centre slid half that distance the
  // same way. The approach therefore starts where it always started, at the
  // angle it always had, and launches from a ridge in the same world position
  // as the old front edge. The jump is unchanged; only the far side is new.
  ramps: [
    // Facing +Z: drive north up the west side and take off. Approach still runs
    // z = -5 → 17 at 9.3°, with 8m of boost incline beyond it.
    { id: 'jump-w', pos: { x: -58, y: 0, z: 10 }, halfExtents: { x: 7, z: 15 }, yaw: 0, rise: 3.6, backRun: 8 },
    // Facing -Z, so the pair makes a two-way line.
    { id: 'jump-e', pos: { x: -30, y: 0, z: -18 }, halfExtents: { x: 7, z: 15 }, yaw: Math.PI, rise: 3.6, backRun: 8 },
    // A gentler kicker near the middle, for testing landings without commitment.
    // Shorter rise, so a shorter boost incline holds the same 24° pitch.
    { id: 'kicker', pos: { x: 49.5, y: 0, z: -20 }, halfExtents: { x: 6, z: 11.5 }, yaw: Math.PI / 2, rise: 2.2, backRun: 5 },
  ],

  // Crates sit away from the spawns and away from each other, so restocking is
  // a detour you choose rather than something that happens by accident.
  pickups: [
    { id: 0, kind: 'weapon', weapon: 'homingMissile', pos: { x: 0, y: 0, z: 34 } },
    { id: 1, kind: 'weapon', weapon: 'homingMissile', pos: { x: 0, y: 0, z: -66 } },
    { id: 2, kind: 'weapon', weapon: 'rocket', pos: { x: -46, y: 0, z: 22 } },
    { id: 3, kind: 'weapon', weapon: 'rocket', pos: { x: 46, y: 0, z: -40 } },
    { id: 4, kind: 'weapon', weapon: 'mine', pos: { x: 58, y: 0, z: 44 } },
    { id: 5, kind: 'weapon', weapon: 'mine', pos: { x: -58, y: 0, z: -50 } },
    { id: 6, kind: 'weapon', weapon: 'machineGun', pos: { x: 30, y: 0, z: 12 } },
    { id: 7, kind: 'weapon', weapon: 'machineGun', pos: { x: -30, y: 0, z: -12 } },

    // Health sits in the open where taking it costs you cover. Armour is
    // further out still, because an overcharge should be a commitment.
    { id: 8, kind: 'health', pos: { x: -34, y: 0, z: 40 } },
    { id: 9, kind: 'health', pos: { x: 34, y: 0, z: -40 } },
    { id: 10, kind: 'armour', pos: { x: 0, y: 0, z: 74 } },
    { id: 11, kind: 'armour', pos: { x: 0, y: 0, z: -78 } },
  ],

  spawns: [
    { pos: { x: 0, y: 0, z: -42 }, yaw: 0 },
    // Dead ahead of spawn 0, 45m of clear run away: the ram M2 is judged on.
    // Far enough to reach ~30 m/s, which is where a hit starts to read as
    // weight rather than a nudge.
    { pos: { x: 0, y: 0, z: 6 }, yaw: 0 },
    { pos: { x: 16, y: 0, z: -6 }, yaw: -Math.PI / 2 },
    { pos: { x: -16, y: 0, z: -6 }, yaw: Math.PI / 2 },
  ],
}
