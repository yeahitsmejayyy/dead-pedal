# Sound inventory

Every sound dead-pedal can make, what triggers it, and a prompt to generate it.

**Drop finished files into `public/audio/` using the exact filename in the table.** Names match
what `src/audio/index.ts` already looks for, so a correctly-named file needs no code change at
all — it just starts playing. `.ogg` or `.mp3` both fine; I'll convert.

Numbered files are **variants** of one sound. They matter: a single file retriggered sixteen times
a second is a drone, not a machine gun. Where a row says ×5, generate five separate takes.

---

## How to prompt

Append this to **every** prompt:

```
realistic field recording, dry, close-mic, no reverb, no musical tone, gritty and mechanical
```

That suffix is doing the heavy lifting. Library SFX are pre-sweetened and reverb-tailed, and that
polish is exactly what reads as cartoony. `dry` and `no reverb` matter most on anything repeated —
the machine gun fires 16 rounds a second, and any tail smears into a wall of noise.

Three more rules that hold across all of these:

1. **Name the material, not the object.** "Bullet striking a car body panel, hollow sheet-metal
   ring" beats "gunshot impact". The model has heard far more sheet metal than it has "impacts".
2. **State the perspective.** Close, distant, inside, outside. Distance is *dullness*, not just
   quietness — a far explosion needs "muffled, no high frequencies", not a lower volume.
3. **Say what you don't want.** "no music", "no voices", "no debris tail", "no glass". Negative
   constraints work well here.

---

## Weapons

| File | ×  | Length | Trigger | Prompt |
|---|---|---|---|---|
| `gun-1` … `gun-5` | 5 | 0.15 s | Every machine-gun round | Single shot from a heavy machine gun mounted on a car, sharp percussive crack with a metallic bolt clack underneath, recorded close in the open, abrupt cutoff with no tail and no echo |
| `hit-1` … `hit-5` | 5 | 0.2 s | A round connects with a car | Bullet striking a thin steel car body panel, bright metallic ping with a short hollow ring as the panel flexes, tight and close, no debris and no echo |
| `rkt-1`, `rkt-2` | 2 | 1.5 s | Rocket or homing missile fired | Rocket launching from a vehicle-mounted tube, hard percussive ignition thump then a fast pressurised hiss receding into the distance, aggressive and full-bodied |

## Explosions and destruction

| File | ×  | Length | Trigger | Prompt |
|---|---|---|---|---|
| `boom-1`, `boom-2` | 2 | 1.0 s | Blast within 26 m | Explosion heard from close range, deep concussive low-frequency thump with a sharp cracking transient at the front and a short gritty debris tail, physical and chest-hitting |
| `boomfar-1`, `boomfar-2` | 2 | 1.5 s | Blast beyond 26 m | Explosion heard from far across open ground, muffled low-frequency boom with the high frequencies rolled off completely, dull and rolling with a slow decay, no sharp transient |
| `wreck-1`, `wreck-2` | 2 | 2.0 s | A car is destroyed | Car destroyed by an explosion, heavy blast followed by tearing sheet metal and scattering debris skittering across tarmac, violent and layered |
| `crash-1` … `crash-4` | 4 | 0.25 s | Car-on-car or car-on-wall | Two cars colliding at speed, heavy metallic crunch and panel deformation with a low structural thud, close and dry, no glass and no tyre squeal |

## Mine

| File | ×  | Length | Trigger | Prompt |
|---|---|---|---|---|
| `mine-arm` | 1 | 0.4 s | Mine dropped and arms | Small explosive device arming itself, rising electronic charging whine building over a third of a second and ending in a hard mechanical click, tense and menacing |
| `mine-tick` | 1 | 0.15 s | Repeats while a mine is live | Single short electronic beep from an armed landmine, clean and dry with a slight metallic edge, one isolated tick with silence around it |

`mine-tick` repeats on a slow pulse the whole time the mine sits on the floor, so keep it small and
unobtrusive — it will be heard hundreds of times.

## Feedback and interface

| File | ×  | Length | Trigger | Prompt |
|---|---|---|---|---|
| `pickup` | 1 | 0.3 s | Weapon crate collected | Picking up a weapon crate, mechanical latch snapping open followed by a short confident metallic chime, satisfying and clean |
| `lock-on` | 1 | 0.15 s | Missile lock acquired | Missile lock acquired, single sharp electronic tone from a military targeting system, clean and urgent, no reverb |
| `lock-off` | 1 | 0.2 s | Lock breaks | Missile lock breaking, short descending two-note electronic tone, targeting system disengaging, dry and flat |
| `beep` | 1 | 0.15 s | Each countdown tick | Motorsport start countdown beep, single short flat electronic tone, one isolated pip from a starting light gantry |
| `go` | 1 | 0.4 s | Countdown hits zero | Motorsport race start signal, sustained higher-pitched electronic tone as the starting lights go green, clean and bright |
| `horn` | 1 | 1.5 s | Match ends | End of match signal, descending two-tone electronic horn like a sports arena buzzer, flat and final, not a whistle |
| `respawn` | 1 | 0.6 s | A car comes back | Vehicle materialising back into play, quick mechanical whoosh with an electrical power-up surge underneath, short and forward-moving |

## Currently silent

The sim raises these and nothing plays. Worth filling.

| File | ×  | Length | Trigger | Prompt |
|---|---|---|---|---|
| `land-1`, `land-2` | 2 | 0.4 s | Car lands after a jump | Car landing hard after a jump, suspension compressing with a heavy damped thud and tyres slapping onto tarmac, weighty and close, no skid |
| `dmg-1`, `dmg-2` | 2 | 0.5 s | Taking heavy damage | Vehicle body taking heavy damage, steel buckling and tearing with a low structural groan, stressed metal under load, no explosion |

---

## Engine

Three steady loops, crossfaded live by rpm. Different rules from everything above — read this
section before generating.

**Generate 4–6 seconds, not the loop length.** I cut the cleanest loop out of the middle, which is
far more reliable than asking for a short perfect one.

**Every take must be STEADY.** Constant rpm, no rise, no fall, no gear change. The model badly
wants to hand you a rev-up — it is the most common engine recording in existence — so fight it in
every prompt. A take that sweeps is unusable: I can trim a sweep but I cannot un-sweep one.

**Drop `no reverb` from the suffix for these three.** A little air around an engine helps it sit
outside the car. Keep the rest.

| File | ×  | Length | Record at | Prompt |
|---|---|---|---|---|
| `eng-idle` | 1 | 4–6 s | ~800 rpm, no load | V8 muscle car engine idling at rest, steady low rumble with a slow uneven lope between cylinder firings, recorded from outside the car close to the exhaust, constant with no revving and no change in pitch, no music, no voices |
| `eng-low` | 1 | 4–6 s | ~2500–3000 rpm | V8 muscle car engine held at a steady low-mid rpm under light load, constant pitch throbbing exhaust note, recorded outside near the exhaust, no revving, no acceleration, no gear change, no change in pitch, no music |
| `eng-high` | 1 | 4–6 s | ~6000 rpm | V8 muscle car engine held flat out at high rpm under heavy load, aggressive constant roar with hard exhaust pulses, recorded outside near the exhaust, held steady with no rise or fall in pitch, no gear change, no music |

### Why three, and why not a sweep

The rev range is 800–7200 rpm — **3.17 octaves**. A sample pitch-shifts acceptably about ±0.4
octaves before it turns into a chipmunk or a lawnmower, so each loop covers roughly 0.8.

The gearbox buys most of that back: above first gear every shift resets the revs, so a gear only
sweeps ~0.4 octaves, comfortably inside one sample. **First gear is the problem child** — it runs
idle to redline on its own, the full 3.1 octaves. That is what `eng-low` is for.

An acceleration *sweep* cannot work at all, and it is worth knowing why. A sweep is a fixed
recording on a fixed timeline; the car is not. It gets rammed, hits ramps, lifts off, beaches on a
wall. Seconds after launch the sweep and the car have desynced, there is nothing to play when it
ends, and lifting off mid-sweep has no route back to idle. What sells acceleration here is the
crossfade plus a live pitch-bend driven from real speed — which is why steady loops are the thing
to record.

### Start with two

Generate `eng-idle` and `eng-high` first. If it sounds right we stop there and skip `eng-low`
entirely; the only place two loops strain is first gear.

### What happens to them after

You send raw files and stop thinking about it. On my side: find the loop point at the two
zero-crossings that minimise the wrap discontinuity, crossfade 5–10 ms across the join, measure the
seam and report the number, then encode as **Opus — never Vorbis**. That last one is measured, not
cautious: Vorbis re-encoding blew a test loop's wrap discontinuity from 0.00415 to **0.45452**, a
loud click on every cycle, at idle roughly 1.5 times a second.

It then goes in **behind a toggle** so we A/B it against the oscillator engine rather than deleting
the synth on faith. The synth's one real advantage is that it tracks the throttle perfectly with no
artefacts ever; sampled loops sound better when they work and worse when the pitch-shift strains.
Your ears decide.

## Not this way

**Music.** Not generated here. Different problem, different tool.

---

## Checklist

38 files across 21 slots.

**One-shots** — 0.15–2 s, dry, `no reverb` in the suffix:

- [ ] `gun-1` … `gun-5`
- [ ] `hit-1` … `hit-5`
- [ ] `rkt-1`, `rkt-2`
- [ ] `boom-1`, `boom-2`
- [ ] `boomfar-1`, `boomfar-2`
- [ ] `wreck-1`, `wreck-2`
- [ ] `crash-1` … `crash-4`
- [ ] `mine-arm`, `mine-tick`
- [ ] `pickup`, `lock-on`, `lock-off`
- [ ] `beep`, `go`, `horn`, `respawn`
- [ ] `land-1`, `land-2`
- [ ] `dmg-1`, `dmg-2`

**Engine loops** — 4–6 s, steady, drop `no reverb`:

- [ ] `eng-idle`
- [ ] `eng-high`
- [ ] `eng-low` *(only if two loops strain in first gear — generate the other two first)*

Everything except `lock-off`, `go`, `horn`, `respawn`, `land-*`, `dmg-*` and the three `eng-*`
currently has a placeholder in `public/audio/` — dropping a new file over the same name replaces
it. The engine files are new wiring rather than a swap, so they land behind a toggle.
