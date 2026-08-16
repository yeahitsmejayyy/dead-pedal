/**
 * L4 — sound, driven by the same `SimEvent`s everything else reads.
 *
 * Contract 4 applies exactly as it does to the view: the sim has already decided
 * what happened, so audio is free to be non-deterministic, pooled, rate-limited
 * and dropped under load. Nothing here can reach a `WorldState`, and `src/sim`
 * cannot import it — `audio` is in eslint's `UPWARD` list, so that direction is
 * enforced rather than merely intended.
 *
 * ONE-SHOTS ARE RECORDINGS. Everything that hits, fires or beeps is a real CC0
 * sample under `public/audio` (see CREDITS.md). The synthesised versions these
 * replaced were, in the owner's words, cheesy, and they were right.
 *
 * THE ENGINE IS STILL SYNTHESISED, and that is a measured decision rather than
 * a leftover. The best CC0 engine loops available span 0.84 octaves; this
 * gearbox spans 3.17, so reaching redline off a sample means pitch-shifting up
 * 2.3 octaves, which is the lawnmower every sampled arcade engine turns into.
 * An oscillator bank tracks the throttle exactly and never has that problem.
 */
import { clamp } from '../core/scalar'
import { rightOf, type SimEvent } from '../sim'
import { DEFAULT_ENGINE, DEFAULT_MIX, type MixTuning } from '../content/audio'
import { EngineVoice, type EngineDrive } from './engine'
import { SampledEngine } from './sampled'
import { Music } from './music'

export type Ears = { readonly x: number; readonly z: number; readonly yaw: number }

export type Audio = {
  arm(): void
  armed(): boolean
  muted(): boolean
  /** Silence everything while the game is paused. Independent of mute. */
  setPaused(paused: boolean): void
  toggleMute(): boolean
  consume(events: readonly SimEvent[], ears: Ears, playerId: number): void
  /**
   * Per-tick clock, for the one sound no event covers: the pulse of a live mine.
   *
   * The 3-2-1 countdown pips used to live here too and were cut — a metronome
   * over the three seconds before a match reads as a menu, not as a start line.
   * The GO on `roundStarted` carries the moment on its own.
   */
  tick(liveMines: number): void
  update(drive: EngineDrive, dt: number): void
  /** Swap between the sampled loops and the oscillator bank. Returns true if sampled. */
  toggleEngine(): boolean
  /** Next track, or off. Returns what is now playing, or null for silence. */
  /**
   * Play a menu sound directly.
   *
   * Everything else reaches the mixer through `consume`, which reads sim
   * events — but a menu is not the sim, and inventing a fake event so a button
   * can click would put UI concerns inside the world state.
   */
  playUi(id: 'menuHover' | 'menuStart'): void
  cycleMusic(): string | null
  /** Start the menu track. Safe to call repeatedly. */
  startMusic(): string | null
  state(): { engine: string; voices: number; loaded: string; music: string }
}

type SoundId =
  | 'gunFire'
  | 'bulletMetal'
  | 'rocketLaunch'
  | 'explosionNear'
  | 'explosionFar'
  | 'carImpact'
  | 'wreck'
  | 'mineArm'
  | 'mineBeep'
  | 'pickup'
  | 'lockOn'
  | 'lockLost'
  | 'countdownGo'
  | 'matchEnd'
  | 'respawn'
  | 'land'
  | 'damage'
  | 'menuHover'
  | 'menuStart'

/** Which bus a sound belongs to. The buses are the mix. */
type Bus = 'weapons' | 'impacts' | 'ui'

type Spec = {
  readonly files: readonly string[]
  readonly bus: Bus
  /** Trim, in linear gain. Set from measured RMS, not by ear. */
  readonly level: number
  /** Higher wins a voice when the pool is full. */
  readonly priority: number
}

/**
 * The roster, and the gain staging that is the whole point of this pass.
 *
 * The owner's complaint was the mix, and it turned out to be a measurable fact:
 * the source recordings run from -8 dBFS RMS (engine) to -22.5 (machine gun), a
 * 14 dB spread that at unity gain buries every weapon under the engine. These
 * trims pull each family onto roughly the same footing so the bus faders below
 * are doing the balancing rather than fighting the source material.
 */
const SOUNDS: Readonly<Record<SoundId, Spec>> = {
  // Five genuinely different shots, not one file exported five times — the
  // most-similar pair correlates 0.11. Capped at 200ms so a round is over
  // before the next one lands at sixteen a second, and loudness-matched to a
  // 0.0 dB spread across the family: variants whose levels differ rotate as an
  // audible volume wobble, which is worse than the repetition they fix.
  gunFire: {
    files: ['gun-1', 'gun-2', 'gun-3', 'gun-4', 'gun-5'],
    bus: 'weapons',
    level: 0.85,
    priority: 1,
  },
  // Five variants, most-similar pair correlating 0.04, loudness-matched the
  // same way. Only fires where a round actually connects, so it is less exposed
  // than the gun — but it is the sound that says you are hitting something.
  bulletMetal: {
    files: ['hit-1', 'hit-2', 'hit-3', 'hit-4', 'hit-5'],
    bus: 'impacts',
    level: 0.7,
    priority: 2,
  },
  rocketLaunch: { files: ['rkt-1'], bus: 'weapons', level: 1, priority: 4 },
  explosionNear: { files: ['boom-1'], bus: 'weapons', level: 1, priority: 5 },
  explosionFar: { files: ['boomfar-1'], bus: 'weapons', level: 0.75, priority: 3 },
  carImpact: { files: ['crash-1'], bus: 'impacts', level: 0.9, priority: 3 },
  wreck: { files: ['wreck-1'], bus: 'weapons', level: 1, priority: 5 },
  mineArm: { files: ['mine-arm'], bus: 'ui', level: 0.8, priority: 2 },
  mineBeep: { files: ['mine-tick'], bus: 'ui', level: 0.45, priority: 1 },
  pickup: { files: ['pickup'], bus: 'ui', level: 0.8, priority: 2 },
  /**
   * Three variants because a hover is retriggered constantly — the pointer
   * crosses the button on the way to anywhere. The raw takes spanned 24.2 dB
   * peak to peak and were matched to -3.0 dB before encoding; unmatched
   * variants rotate as a volume wobble rather than as variety, which is the
   * same lesson the gun learned.
   *
   * Lowest priority in the map. A menu tick is the first thing that should be
   * dropped if anything else wants a voice.
   */
  menuHover: { files: ['menu-hover-1', 'menu-hover-2', 'menu-hover-3'], bus: 'ui', level: 0.42, priority: 1 },
  /** Two seconds, and the outro is choreographed to it. See `ui/title.ts`. */
  menuStart: { files: ['menu-start'], bus: 'ui', level: 0.95, priority: 6 },
  lockOn: { files: ['lock-on'], bus: 'ui', level: 0.5, priority: 2 },
  lockLost: { files: ['lock-off'], bus: 'ui', level: 0.5, priority: 2 },
  countdownGo: { files: ['go'], bus: 'ui', level: 0.6, priority: 6 },
  matchEnd: { files: ['horn'], bus: 'ui', level: 0.8, priority: 6 },
  respawn: { files: ['respawn'], bus: 'ui', level: 0.7, priority: 3 },
  land: { files: ['land-1'], bus: 'impacts', level: 0.8, priority: 2 },
  damage: { files: ['dmg-1'], bus: 'impacts', level: 0.65, priority: 3 },
}

type Voice = {
  gain: GainNode
  pan: StereoPannerNode
  source: AudioBufferSourceNode | null
  until: number
  priority: number
  bus: Bus
}

export type AudioOptions = {
  readonly silent?: boolean
  readonly mix?: MixTuning
  /**
   * Start muted, so the page makes no sound until the player asks for it.
   *
   * Different from `silent`, which builds no AudioContext at all and cannot be
   * undone. This is a real mixer that happens to be turned down, ready to come
   * up the instant the sound button is pressed.
   */
  readonly startMuted?: boolean
}

const SILENT: Audio = Object.freeze({
  arm: () => {},
  armed: () => false,
  muted: () => true,
  setPaused: () => {},
  toggleMute: () => true,
  consume: () => {},
  tick: () => {},
  update: () => {},
  toggleEngine: () => false,
  playUi: () => {},
  cycleMusic: () => null,
  startMusic: () => null,
  state: () => ({ engine: 'silent', voices: 0, loaded: 'silent', music: 'silent' }),
})

export function createAudio(options: AudioOptions = {}): Audio {
  // A real off switch, not a muted one: no AudioContext, no fetches, no decode.
  // The e2e suite runs with this so 27 tests do not each pull 27 files for a
  // path no assertion observes — and a player deserves a genuine off too.
  if (options.silent === true) return SILENT

  const mix = options.mix ?? DEFAULT_MIX
  const ctx = new AudioContext()

  const limiter = new DynamicsCompressorNode(ctx, {
    threshold: mix.limiterThresholdDb,
    knee: mix.limiterKneeDb,
    ratio: mix.limiterRatio,
    attack: mix.limiterAttack,
    release: mix.limiterRelease,
  })
  const master = new GainNode(ctx, { gain: 0 })
  master.connect(limiter)
  limiter.connect(ctx.destination)

  /**
   * Four buses, because the complaint was a mix problem and a mix problem is
   * not solved by nudging individual sounds.
   *
   * The engine sits ~13 dB below the weapons at source, which is what "in the
   * foreground but not swamping everything" actually costs: it is the loudest
   * continuous thing, so it wins by being always-on rather than by being loud.
   */
  const buses: Record<Bus | 'engine', GainNode> = {
    engine: new GainNode(ctx, { gain: 0.42 }),
    weapons: new GainNode(ctx, { gain: 1 }),
    impacts: new GainNode(ctx, { gain: 0.95 }),
    ui: new GainNode(ctx, { gain: 0.8 }),
  }
  for (const bus of Object.values(buses)) bus.connect(master)

  const engine = new EngineVoice(ctx, DEFAULT_ENGINE, buses.engine)

  /**
   * Music, on its own bus and deliberately quiet.
   *
   * 0.30 is not timidity, it is arithmetic. The tracks measure -14.7 dB RMS
   * against roughly -18 dB for the effects — but the effects are transients
   * that occupy a frame, while music is continuous, so equal RMS is nowhere
   * near equal presence. Worse, 25-35% of each track's energy sits in 2-5 kHz,
   * which is precisely the band the gun and bullet impacts were chosen to cut
   * through. Level alone would not fix that overlap; the ducking below is what
   * actually does.
   */
  const music = new Music(ctx, master, 0.3)

  /**
   * Tyre slide, as a loop rather than a one-shot.
   *
   * Measured on the real car: a handbrake slide at 147 km/h runs 3.70s with the
   * throttle on and 1.05s out of a hard grip turn, and the player decides which.
   * A fixed-length screech would cut off mid-slide or squeal after the car had
   * straightened up, so the loop runs forever and only its gain moves.
   *
   * Built lazily, once the buffer has decoded.
   */
  let skid: { source: AudioBufferSourceNode; gain: GainNode } | null = null

  function buildSkid(): void {
    const buffer = buffers.get('skid')
    if (buffer === undefined || skid !== null) return
    const gain = new GainNode(ctx, { gain: 0 })
    const source = new AudioBufferSourceNode(ctx, { buffer, loop: true })
    source.connect(gain)
    gain.connect(buses.impacts)
    source.start()
    skid = { source, gain }
  }

  const voices: Voice[] = []
  for (let i = 0; i < mix.voices; i++) {
    const gain = new GainNode(ctx, { gain: 0 })
    const pan = new StereoPannerNode(ctx, { pan: 0 })
    gain.connect(pan)
    pan.connect(buses.weapons)
    voices.push({ gain, pan, source: null, until: 0, priority: 0, bus: 'weapons' })
  }

  const buffers = new Map<string, AudioBuffer>()
  const cursor = new Map<SoundId, number>()
  const lastStarted = new Map<SoundId, number>()
  let isArmed = false
  let isMuted = options.startMuted === true
  let isPaused = false
  let loadState = 'loading'
  let lastMineTick = 0
  let sampled: SampledEngine | null = null
  /** Which engine you are hearing. Toggled with E so the two can be compared. */
  let useSampled = true

  function applyEngineChoice(): void {
    sampled?.setActive(useSampled)
  }

  /**
   * Fetch and decode every sample, without blocking the game.
   *
   * Deliberately fire-and-forget: the car has to be drivable while this runs,
   * so anything triggered before its buffer lands is simply skipped. Missing a
   * gunshot in the first second is better than a loading screen for 300KB.
   */
  void (async (): Promise<void> => {
    const oneShots = [...new Set(Object.values(SOUNDS).flatMap((s) => s.files))]
    // Loops ship as Opus. Vorbis re-encoding was measured destroying the seam —
    // wrap discontinuity 0.00415 -> 0.45452, a click on every single cycle.
    const loops = ['eng-idle', 'eng-low', 'eng-high', 'skid']
    const names = [
      ...oneShots.map((n) => [n, 'ogg'] as const),
      ...loops.map((n) => [n, 'opus'] as const),
    ]
    const results = await Promise.allSettled(
      names.map(async ([name, ext]) => {
        const response = await fetch(`audio/${name}.${ext}`)
        if (!response.ok) throw new Error(`${name}: ${response.status}`)
        buffers.set(name, await ctx.decodeAudioData(await response.arrayBuffer()))
      }),
    )
    const failed = results.filter((r) => r.status === 'rejected').length
    // Declared-but-absent variants are expected, not an error: the roster lists
    // five gun takes and however many exist get used.
    loadState = `${names.length - failed}/${names.length} loaded`

    // The sampled engine can only be built once its loops exist, so it is made
    // here rather than in the constructor. Until then the synth carries it.
    buildSkid()
    sampled = new SampledEngine(ctx, DEFAULT_ENGINE, buses.engine, buffers)
    if (!sampled.ready) sampled = null
    applyEngineChoice()
  })()

  const level = (): number => (isArmed && !isMuted && !isPaused ? mix.master : 0)

  /**
   * Get the continuous sounds out of the way of a loud one.
   *
   * Music ducks roughly twice as hard as the engine and holds longer. The engine
   * is the car you are driving and should stay present; the music is furniture.
   */
  function duck(depth: number): void {
    music.duck(Math.min(0.85, depth * 1.6), 0.5)
    const now = ctx.currentTime
    const bus = buses.engine.gain
    bus.cancelScheduledValues(now)
    bus.setValueAtTime(bus.value, now)
    bus.linearRampToValueAtTime(0.42 * (1 - depth), now + 0.02)
    bus.linearRampToValueAtTime(0.42, now + 0.35)
  }

  function play(id: SoundId, gain: number, pan: number): void {
    if (!isArmed || isMuted) return
    const spec = SOUNDS[id]
    const now = ctx.currentTime

    // Several events of one kind can land on a single tick — a rocket hitting
    // three cars raises three `damaged` events at once — and starting three
    // identical buffers in the same millisecond is a comb filter, not a louder
    // sound. Shorter than it was, because real variants do most of this job now.
    if (now - (lastStarted.get(id) ?? -1) < mix.repeatGuardSeconds) return
    lastStarted.set(id, now)

    // Round-robin over what actually LOADED, not over what was declared.
    // Cycling the declared list means a slot with five names and three files on
    // disk drops two shots in five on the floor — silently, because a missing
    // buffer is indistinguishable from one still decoding. Filtering here makes
    // variant count a delivery detail rather than a correctness one: ship two
    // takes or five and the gun sounds right either way.
    const ready = spec.files.filter((f) => buffers.has(f))
    if (ready.length === 0) return // nothing decoded for this sound yet
    const turn = (cursor.get(id) ?? 0) % ready.length
    cursor.set(id, turn + 1)
    const buffer = buffers.get(ready[turn]!)!

    let slot = voices.find((v) => v.until <= now)
    if (slot === undefined) {
      let weakest = voices[0]!
      for (const v of voices) if (v.priority < weakest.priority) weakest = v
      if (weakest.priority > spec.priority) return
      weakest.source?.stop()
      slot = weakest
    }

    if (slot.bus !== spec.bus) {
      slot.pan.disconnect()
      slot.pan.connect(buses[spec.bus])
      slot.bus = spec.bus
    }

    // Pitch scatter on top of variants. Five files cycled at sixteen rounds a
    // second still lands on the same file three times a second.
    const rate = 0.88 + Math.random() * 0.24
    const source = new AudioBufferSourceNode(ctx, { buffer, playbackRate: rate })
    source.connect(slot.gain)
    slot.gain.gain.setValueAtTime(gain * spec.level, now)
    slot.pan.pan.setValueAtTime(pan, now)
    slot.source = source
    slot.priority = spec.priority
    slot.until = now + buffer.duration / rate
    source.start()
  }

  /**
   * Place a world-space sound relative to the listener.
   *
   * Manual pan and distance gain rather than a `PannerNode`: a third-person
   * camera in a flat arena gets the same information from a dot product as it
   * would from an HRTF convolution per voice. Pan is set once at trigger time —
   * a one-shot lives a few hundred milliseconds and the geometry does not move
   * enough to hear.
   */
  function placed(id: SoundId, at: { x: number; z: number }, ears: Ears, scale = 1): void {
    const dx = at.x - ears.x
    const dz = at.z - ears.z
    const distance = Math.hypot(dx, dz)
    if (distance > mix.maxAudible) return

    const fade = 1 - distance / mix.maxAudible
    const right = rightOf(ears.yaw)
    // The floor matters: the player's own guns are ~2m ahead, and without it the
    // pan is dominated by sub-metre geometry and flicks between speakers.
    const pan =
      clamp((dx * right.x + dz * right.z) / Math.max(distance, mix.panFloor), -1, 1) * mix.panWidth
    play(id, fade * fade * scale, pan)
  }

  return {
    /**
     * Try to bring the AudioContext up. Safe — and necessary — to call often.
     *
     * A context built without a prior user gesture starts `suspended`, and
     * `resume()` only succeeds from inside a real user activation. So this is
     * called speculatively at boot AND from every keydown and pointerdown, and
     * the first one that happens to be a gesture is the one that works.
     *
     * IT LATCHES ON SUCCESS, NOT ON BEING CALLED, and that distinction is the
     * whole bug this replaced. The old version set `isArmed = true` on entry
     * and early-returned ever after: the speculative boot call burned the flag,
     * its `resume()` was rejected by the autoplay policy and swallowed, and
     * every later gesture returned immediately without retrying. The game was
     * silent for the entire session with no way back. It never showed up in
     * development because the dev browser permits autoplay, so the context was
     * already `running` and the retry was never needed.
     *
     * `resume()` is called synchronously here, before any await. Safari only
     * honours it while the activation is still on the stack.
     */
    arm(): void {
      if (isArmed && ctx.state === 'running') return

      const settle = (): void => {
        if (ctx.state !== 'running') return
        isArmed = true
        master.gain.setTargetAtTime(level(), ctx.currentTime, 0.05)
      }

      // Already permitted — nothing to wait for.
      if (ctx.state === 'running') {
        settle()
        return
      }
      void ctx.resume().then(settle, () => undefined)
    },
    setPaused(next: boolean): void {
      isPaused = next
      master.gain.setTargetAtTime(level(), ctx.currentTime, 0.08)
    },

    armed: () => isArmed && ctx.state === 'running',
    muted: () => isMuted,
    toggleMute(): boolean {
      isMuted = !isMuted
      master.gain.setTargetAtTime(level(), ctx.currentTime, 0.05)
      return isMuted
    },

    consume(events, ears, playerId): void {
      if (!isArmed || isMuted) return

      for (const event of events) {
        switch (event.type) {
          case 'weaponFired':
            if (event.weapon === 'rocket' || event.weapon === 'homingMissile') {
              // "When I shoot a rocket out of a car, I want to hear that."
              if (event.id === playerId) {
                play('rocketLaunch', 1, 0)
                duck(0.45)
              } else placed('rocketLaunch', event.pos, ears)
            }
            break

          case 'tracer':
            // Two sounds per round, and they are different events in the world:
            // the gun going off at the muzzle, and — only when it connects —
            // metal on metal at the far end.
            if (event.id === playerId) {
              play('gunFire', 1, 0)
              // A light, constantly-retriggered duck rather than a pulse per
              // round: at sixteen a second a per-shot dip would pump audibly,
              // whereas extending one shallow duck just holds the music down
              // for as long as the trigger is held.
              music.duck(0.35, 0.25)
            } else placed('gunFire', event.from, ears, 0.9)
            if (event.hit !== null) placed('bulletMetal', event.to, ears)
            break

          case 'explosion': {
            const near = Math.hypot(event.pos.x - ears.x, event.pos.z - ears.z) < 26
            placed(near ? 'explosionNear' : 'explosionFar', event.pos, ears)
            duck(near ? 0.55 : 0.3)
            break
          }

          case 'impact':
            placed('carImpact', event.pos, ears, clamp(event.magnitude / 25, 0.25, 1))
            break

          case 'mineArmed':
            // "A small little explosives beeping sound, almost charging it."
            placed('mineArm', event.pos, ears)
            break

          case 'pickedUp':
            play('pickup', event.id === playerId ? 1 : 0.3, 0)
            break

          case 'vehicleDestroyed':
            placed('wreck', event.pos, ears)
            duck(0.4)
            break

          case 'roundStarted':
            // The round going live is the GO, not a tick. The 3-2-1 pips are
            // driven from the countdown clock in `tick` below, because the sim
            // raises no event per second.
            play('countdownGo', 1, 0)
            break

          case 'lockAcquired':
            if (event.id === playerId) play('lockOn', 1, 0)
            break

          case 'lockLost':
            if (event.id === playerId) play('lockLost', 1, 0)
            break

          case 'landed':
            placed('land', event.pos, ears, clamp(event.magnitude / 12, 0.3, 1))
            break

          case 'damaged':
            // Only heavy hits. A machine-gun round already makes its own noise
            // at the point of impact; doubling it up on every bullet is mush.
            if (event.amount > 12) placed('damage', event.pos, ears, clamp(event.amount / 40, 0.4, 1))
            break

          case 'matchEnded':
            play('matchEnd', 1, 0)
            break

          case 'vehicleRespawned':
            if (event.id === playerId) play('respawn', 1, 0)
            break

          default:
            break
        }
      }
    },

    tick(liveMines): void {
      if (!isArmed || isMuted) return
      const now = ctx.currentTime

      // A live mine ticks. Slow enough to be a warning rather than a nuisance,
      // and one pulse for the field however many are down — a minefield should
      // not sound like a smoke alarm.
      if (liveMines > 0 && now - lastMineTick > 1.1) {
        lastMineTick = now
        play('mineBeep', 0.7, 0)
      }
    },

    update(drive, dt): void {
      const live = isArmed && !isMuted ? drive : { ...drive, alive: false }
      // Both run; only one is audible. Keeping the silent one stepping means
      // switching is instant and lands at the revs you were already at, rather
      // than spinning up from idle mid-corner.
      engine.update(useSampled && sampled !== null ? { ...live, alive: false } : live, dt)
      sampled?.update(live, dt)

      if (skid !== null) {
        const now = ctx.currentTime
        // Squared, so a car merely leaning on its tyres stays quiet and only a
        // genuine slide gets loud. Fades out slower than in: rubber stops
        // screeching the instant it grips, but cutting it dead sounds like a
        // dropped sample.
        const want = live.alive && live.grounded ? live.slip * live.slip : 0
        skid.gain.gain.setTargetAtTime(want * 0.9, now, want > 0.05 ? 0.05 : 0.12)
        // A little pitch with speed, so a slide at 40 m/s is not the same note
        // as one at 12.
        const rate = clamp(0.85 + (Math.abs(live.speed) / live.maxSpeed) * 0.4, 0.85, 1.25)
        skid.source.playbackRate.setTargetAtTime(rate, now, 0.08)
      }
    },

    playUi(id: 'menuHover' | 'menuStart'): void {
      play(id, 1, 0)
    },
    cycleMusic(): string | null {
      return music.cycle()
    },
    startMusic(): string | null {
      return music.select(0)
    },

    toggleEngine(): boolean {
      useSampled = !useSampled
      applyEngineChoice()
      return useSampled
    },

    state: () => ({
      engine: `${useSampled && sampled !== null ? 'sampled' : 'synth'} ${Math.round((useSampled && sampled !== null ? sampled : engine).revs())} rpm  g${(useSampled && sampled !== null ? sampled : engine).currentGear()}`,
      voices: voices.filter((v) => v.until > ctx.currentTime).length,
      loaded: loadState,
      music: `${music.state()} duck ${Math.round(music.ducked() * 100)}%`,
    }),
  }
}

export type { EngineDrive }
