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

export type Ears = { readonly x: number; readonly z: number; readonly yaw: number }

export type Audio = {
  arm(): void
  armed(): boolean
  muted(): boolean
  toggleMute(): boolean
  consume(events: readonly SimEvent[], ears: Ears, playerId: number): void
  update(drive: EngineDrive, dt: number): void
  state(): { engine: string; voices: number; loaded: string }
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
  | 'countdownBeep'

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
  // Five genuinely different shots, not one file retriggered — pairwise
  // correlation 0.80-0.88. Only 0.0-0.4% of each shot's energy runs past 62.5ms,
  // which is why sixteen a second rattles instead of smearing into a drone.
  gunFire: {
    files: ['machinegun_fire_a', 'machinegun_fire_b', 'machinegun_fire_c', 'machinegun_fire_d', 'machinegun_fire_e'],
    bus: 'weapons',
    level: 0.85,
    priority: 1,
  },
  // The sound the owner asked for by name. Five variants, pairwise correlation
  // below 0.16 — genuinely distinct — with spectral centroids of 2.4-5.2 kHz,
  // which is exactly the band that cuts through an engine rather than under it.
  bulletMetal: {
    files: ['bullet_impact_metal_a', 'bullet_impact_metal_b', 'bullet_impact_metal_c', 'bullet_impact_metal_d', 'bullet_impact_metal_e'],
    bus: 'impacts',
    level: 0.7,
    priority: 2,
  },
  rocketLaunch: { files: ['rocket_launch_a', 'rocket_launch_b'], bus: 'weapons', level: 1, priority: 4 },
  explosionNear: { files: ['explosion_near_a', 'explosion_near_b'], bus: 'weapons', level: 1, priority: 5 },
  explosionFar: { files: ['explosion_far_a', 'explosion_far_b'], bus: 'weapons', level: 0.75, priority: 3 },
  carImpact: { files: ['car_impact_a', 'car_impact_b', 'car_impact_c', 'car_impact_d'], bus: 'impacts', level: 0.9, priority: 3 },
  wreck: { files: ['vehicle_wreck_a', 'vehicle_wreck_b'], bus: 'weapons', level: 1, priority: 5 },
  mineArm: { files: ['mineArm'], bus: 'ui', level: 0.8, priority: 2 },
  mineBeep: { files: ['mineBeep'], bus: 'ui', level: 0.45, priority: 1 },
  pickup: { files: ['pickup'], bus: 'ui', level: 0.8, priority: 2 },
  lockOn: { files: ['lockOn'], bus: 'ui', level: 0.5, priority: 2 },
  countdownBeep: { files: ['countdownBeep'], bus: 'ui', level: 0.9, priority: 6 },
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
}

const SILENT: Audio = Object.freeze({
  arm: () => {},
  armed: () => false,
  muted: () => true,
  toggleMute: () => true,
  consume: () => {},
  update: () => {},
  state: () => ({ engine: 'silent', voices: 0, loaded: 'silent' }),
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
  let isMuted = false
  let loadState = 'loading'

  /**
   * Fetch and decode every sample, without blocking the game.
   *
   * Deliberately fire-and-forget: the car has to be drivable while this runs,
   * so anything triggered before its buffer lands is simply skipped. Missing a
   * gunshot in the first second is better than a loading screen for 300KB.
   */
  void (async (): Promise<void> => {
    const names = [...new Set(Object.values(SOUNDS).flatMap((s) => s.files))]
    const results = await Promise.allSettled(
      names.map(async (name) => {
        const response = await fetch(`audio/${name}.ogg`)
        if (!response.ok) throw new Error(`${name}: ${response.status}`)
        buffers.set(name, await ctx.decodeAudioData(await response.arrayBuffer()))
      }),
    )
    const failed = results.filter((r) => r.status === 'rejected').length
    loadState = failed === 0 ? `${names.length} loaded` : `${names.length - failed}/${names.length}`
  })()

  const level = (): number => (isArmed && !isMuted ? mix.master : 0)

  /** Duck the engine briefly so a launch or a blast cuts through it. */
  function duck(depth: number): void {
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

    // Round-robin rather than random: random repeats itself audibly, and with
    // five variants a cycle is inaudible while a repeat is not.
    const turn = (cursor.get(id) ?? 0) % spec.files.length
    cursor.set(id, turn + 1)
    const buffer = buffers.get(spec.files[turn]!)
    if (buffer === undefined) return // still decoding

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
    const rate = 0.93 + Math.random() * 0.14
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
    arm(): void {
      if (isArmed) return
      isArmed = true
      void ctx.resume().catch(() => undefined)
      master.gain.setTargetAtTime(level(), ctx.currentTime, 0.05)
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
            if (event.id === playerId) play('gunFire', 1, 0)
            else placed('gunFire', event.from, ears, 0.9)
            if (event.hit !== null) placed('bulletMetal', event.to, ears)
            break

          case 'explosion': {
            const near = Math.hypot(event.pos.x - ears.x, event.pos.z - ears.z) < 26
            placed(near ? 'explosionNear' : 'explosionFar', event.pos, ears)
            if (near) duck(0.5)
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
            play('countdownBeep', 1, 0)
            break

          default:
            break
        }
      }
    },

    update(drive, dt): void {
      engine.update(isArmed && !isMuted ? drive : { ...drive, alive: false }, dt)
    },

    state: () => ({
      engine: `${Math.round(engine.revs())} rpm  g${engine.currentGear()}`,
      voices: voices.filter((v) => v.until > ctx.currentTime).length,
      loaded: loadState,
    }),
  }
}

export type { EngineDrive }
