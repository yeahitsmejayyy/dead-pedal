# Multiplayer spike — findings

Throwaway spike for the first multiplayer ticket: a Bun process runs the real sim
at 60Hz, two browsers send `InputFrame`s and render the snapshots that come back.
No lobby, no car select, no interpolation, no prediction, no reconnect.

The code lived in `spike/` and `spike.html` and is meant to be deleted. This file
is what survives it. Numbers below are measured, not estimated; where something
could not be measured that is said plainly rather than guessed.

## Did it work

Yes. Two browser tabs joined the same match, and driving one car moved it **40.9
metres as observed from the other player's tab**. The server never needed the sim
ported or changed: it imports `createWorld` and `step` from `src/sim` directly,
which is the payoff of the purity rule.

`InputFrame` held up as the only contract. The server does nothing cleverer than
building a `Map<EntityId, InputFrame>` and handing it to `step`, exactly as
`main.ts` does with bots.

## Snapshot size, and whether 60Hz is too much

A full `WorldState` for a two-car match, mid-fight, as JSON:

| part | bytes | share |
|---|---|---|
| arena | 2262 | 46.8% |
| vehicles | 1183 | 24.5% |
| pickups | 1055 | 21.8% |
| rules | 101 | 2.1% |
| match | 93 | 1.9% |
| projectiles / events | ~2 each when idle | 0% |
| **total** | **4829** | |

Live server measurement agreed: 4533–4633 B per snapshot with two clients
connected, 59–61 frames/s.

Per client, full snapshots:

| rate | bandwidth |
|---|---|
| 60Hz | 283 KB/s (2.3 Mbit/s) |
| 30Hz | 141 KB/s (1.2 Mbit/s) |
| 20Hz | 94 KB/s (0.8 Mbit/s) |
| 10Hz | 47 KB/s (0.4 Mbit/s) |

**60Hz full snapshots is obviously too much.** 2.3 Mbit/s per client means a
four-player match costs the server about 9 Mbit/s upstream, sustained, for one
match. That is fine on loopback and unreasonable on a hobby server, and it is
worse than it needs to be for two independent reasons:

1. **Half of every snapshot never changes.** `arena` plus `rules` is 2363 B,
   48.9% of the payload, and both are fixed for the whole match. Sending them
   60 times a second is 138 KB/s per client of pure repetition. Send them once
   at join and the payload halves before any cleverness.
2. **The rest is mostly idle.** `pickups` is 21.8% and changes rarely.

So the cheap wins, in order: send static state once, drop the snapshot rate to
about 20Hz and interpolate, and only then consider deltas or a binary encoding.
Do not reach for a binary format first — it is the fiddliest change and the
smallest of the three.

## What does not survive a JSON round-trip

Functionally, nothing. Checked with the project's own canonical hash on a busy
world (projectiles in flight, ten events that tick):

```
hash before: 55e2805049cc9bce
hash after : 55e2805049cc9bce
identical  : true
after one more step, identical: true
```

Stepping both the original and the round-tripped world forward one tick also
produced identical hashes, so the loss is not merely absent, it is not latent
either.

**One real difference, currently harmless: negative zero.** JSON turns `-0` into
`0`, and the busy world had eight of them — `vehicles[].vel.x`, `yawRate`, a
projectile velocity, several `events[].dir.x`. The hash is unaffected and the
sim did not care.

It would matter for lockstep. `1 / -0` is `-Infinity`, and `Math.sign`,
`Math.atan2` and friends distinguish the two. A client simulating from a
JSON-received world could therefore diverge from the server that sent it. That
cost is not paid under an authoritative server, because only one machine ever
simulates — which is a second, independent argument for the model already chosen,
alongside the cross-engine trig note in `src/sim/vehicle.ts`.

## What this spike could NOT answer

Two of the four questions asked. Both need a real, focused browser and neither
was answered honestly here, so they are still open:

- **How bad the remote car looks with no interpolation.**
- **How bad your own car feels with no prediction, on localhost and on a real
  connection.**

The automated browser used for this work does not run `requestAnimationFrame`
in a background tab, so nothing rendered and no input latency could be felt. The
only related number that IS real is the measured snapshot gap on loopback:
**14–19ms**, i.e. roughly one snapshot per display frame. That bounds the
localhost case as close to the best it can be and says nothing about a real
connection.

Run `bun spike/server.ts`, open `spike.html` in two real browser windows, and
drive. That is a five-minute answer for a human and was not available here.

## Incidental things the spike taught

- **A player with no input this tick must keep their last frame.** Falling back
  to `NEUTRAL_INPUT` on a late packet reads as the car braking by itself.
- **Do not send input from `requestAnimationFrame`.** An `InputFrame` is a
  sim-time value, and a backgrounded tab produces no animation frames at all —
  the first version of this client silently stopped driving. A fixed interval is
  both more correct and more robust.
- **Slot allocation must reclaim.** A join counter that never frees told the
  second tab the two-player spike was full on the first reload.
