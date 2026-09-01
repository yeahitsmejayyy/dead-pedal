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

## How it feels with no interpolation and no prediction

Answered by Jayyy driving it in two real browsers on localhost, which is the
only way it could be answered — see the note below on why the automated browser
could not.

**Smooth at low and moderate speed. Jitter appears at full speed, and the car
gets shaky.**

That is the expected shape of the fault and it is worth writing down why, because
it tells the interpolation ticket where to aim. With no interpolation the client
draws whatever discrete snapshot it last received, and snapshots arrive every
14–19ms while the display refreshes every 16.7ms. The two are not phase-locked,
so some frames repeat the previous snapshot and others skip one. The *timing*
error is constant, but the *positional* error it produces scales with speed:

- at 10 km/h a 3ms timing wobble is about 8mm of car — invisible
- at 165 km/h (top speed is 46 m/s) the same wobble is about 14cm, every frame,
  in a direction that keeps changing

So "it is fine until you go fast" is not a separate bug. It is the same error the
whole time, becoming visible once the car covers enough ground per frame for it
to exceed a pixel. Interpolating between the last two snapshots, deliberately
rendering slightly in the past, removes it — and it must be done for the local
car as well as remote ones, because the shakiness Jayyy saw was on the car he was
driving.

Latency on localhost was not perceptible, so **local prediction is not what this
observation is asking for.** Prediction hides round-trip delay, which is roughly
zero on loopback; the jitter here is a sampling artefact and would persist at
zero latency. The two problems are genuinely separate and the interpolation
ticket should not conflate them: interpolation fixes this, prediction fixes
something that cannot be felt until there is a real server on the other end.

### The real cause: a 120Hz display against a 60Hz world

The first theory here was wrong and is worth recording as wrong, because the
correction is the whole finding.

The theory was that `setInterval(1000/60)` produced 16.92ms rather than 16.67ms,
so the server ran at 59.1Hz against a 60Hz display and the two beat about once a
second. The tick timing was measured and the numbers are real:

```
naive setInterval    mean 16.92ms   sd 0.40ms   p99 18.9
drift-corrected      mean 16.67ms   sd 0.61ms   p99 18.1
```

But counting what the client actually drew disproved it as the cause. On Jayyy's
machine, at rest, both clients reported:

```
60/s snapshots · repeated frames 60.0/s · skipped ticks 0.0/s
```

Sixty new frames plus sixty repeats is **120 frames per second**: the display is
120Hz. Zero skips means nothing is sliding or drifting. It is not a beat at all,
it is a clean 2:1 ratio — **every second frame shows a stale position**.

That is why it looks smooth slowly and shaky fast. At top speed the car covers
about 0.77m per snapshot, and each of those positions is held for two refreshes,
so the eye sees a stair-step rather than a slide. At 10 km/h the same stair is
sub-millimetre.

Consequences for the tickets:

- **Interpolation must run at display rate, not snapshot rate**, and must not
  assume 60Hz. A 120Hz or 144Hz display is ordinary now, and any design that
  ties rendering to the snapshot rate reproduces exactly this artefact.
- **It applies to the local car too.** The shake Jayyy saw was on the car he was
  driving, not a remote one.
- **The tick-rate correction is still worth doing** in the authoritative server —
  16.92ms is a genuinely wrong mean and two nominally-60Hz clocks on different
  machines will always drift — but it is hygiene, not the fix. Even a perfect
  60Hz server produces this on a 120Hz display.
- **Prediction is not what this is asking for.** Loopback latency is ~0 and the
  artefact would persist at zero latency. Interpolation and prediction solve
  genuinely different problems and the tickets should not merge them.

## What this spike could NOT answer

- **How your own car feels with no prediction, over a REAL connection.** Only
  localhost was available, where the round trip is close to zero. This stays
  open until the deploy ticket puts a server at a real distance.

The automated browser used for this work does not run `requestAnimationFrame`
in a background tab, so nothing rendered and no input latency could be felt —
which is why the section above is Jayyy's observation rather than a measurement.
The one number that IS mine is the snapshot gap on loopback: **14–19ms**.

## Incidental things the spike taught

- **A player with no input this tick must keep their last frame.** Falling back
  to `NEUTRAL_INPUT` on a late packet reads as the car braking by itself.
- **Do not send input from `requestAnimationFrame`.** An `InputFrame` is a
  sim-time value, and a backgrounded tab produces no animation frames at all —
  the first version of this client silently stopped driving. A fixed interval is
  both more correct and more robust.
- **Slot allocation must reclaim.** A join counter that never frees told the
  second tab the two-player spike was full on the first reload.
