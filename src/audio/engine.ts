/**
 * L4 — the engine voice.
 *
 * One oscillator bank, alive for the whole session, whose pitch is driven
 * straight from the car's speed through a gearbox. Nothing here is triggered;
 * it is a continuous voice that is steered, which is why it can track the
 * throttle exactly in a way a pitch-shifted sample loop cannot.
 */
import { clamp } from '../core/scalar'
import type { EngineTuning } from '../content/audio'

/** What the engine needs to know about the car, per frame. */
export type EngineDrive = {
  /** m/s along the car's nose. Sign is ignored — reverse revs too. */
  readonly speed: number
  readonly maxSpeed: number
  /** -1..1. Load, and the thing that decides whether the filter is open. */
  readonly throttle: number
  readonly grounded: boolean
  /** A wreck makes no noise. */
  readonly alive: boolean
}

/**
 * The harmonic series of a narrow pulse.
 *
 * `sin(pi*n*d)/(pi*n)` is the Fourier series of a rectangular pulse of duty
 * `d`, and the exponential rolls the top off so it is not painfully bright.
 * A sawtooth was the obvious choice and it sounds like a synthesiser; a narrow
 * pulse is physically what leaves an exhaust port, and it is the difference
 * between "engine" and "buzzer".
 */
function pulseWave(ctx: BaseAudioContext, duty: number, harmonics: number): PeriodicWave {
  const real = new Float32Array(harmonics + 1)
  const imag = new Float32Array(harmonics + 1)
  for (let n = 1; n <= harmonics; n++) {
    imag[n] = (Math.sin(Math.PI * n * duty) / (Math.PI * n)) * Math.exp(-n / 11)
  }
  return ctx.createPeriodicWave(real, imag, { disableNormalization: false })
}

export class EngineVoice {
  private readonly ctx: BaseAudioContext
  private readonly t: EngineTuning

  private readonly pulseA: OscillatorNode
  private readonly pulseB: OscillatorNode
  private readonly growl: OscillatorNode
  private readonly top: OscillatorNode
  private readonly roar: AudioBufferSourceNode
  private readonly roarBand: BiquadFilterNode
  private readonly roarGain: GainNode
  private readonly tone: BiquadFilterNode
  private readonly out: GainNode

  /** Index into `ratios`. Held between frames — this is the whole gearbox. */
  private gear = 0
  /** Seconds left of the power cut a shift punches in. */
  private cut = 0
  private rpm: number

  constructor(ctx: BaseAudioContext, tuning: EngineTuning, destination: AudioNode) {
    this.ctx = ctx
    this.t = tuning
    this.rpm = tuning.idleRpm

    const wave = pulseWave(ctx, 0.17, 24)

    this.out = new GainNode(ctx, { gain: 0 })
    this.tone = new BiquadFilterNode(ctx, { type: 'lowpass', Q: 0.9, frequency: tuning.cutoffFloorHz })
    this.tone.connect(this.out)
    this.out.connect(destination)

    const bus = new GainNode(ctx, { gain: 1 })
    bus.connect(this.tone)

    this.pulseA = new OscillatorNode(ctx, { frequency: 60 })
    this.pulseA.setPeriodicWave(wave)
    this.pulseA.connect(bus)

    // Detuned against A rather than a different waveform. Two near-identical
    // pulses beat against each other, and that slow throb is most of what makes
    // an engine sound like a physical object rather than a tone generator.
    this.pulseB = new OscillatorNode(ctx, { frequency: 60, detune: tuning.detuneIdleCents })
    this.pulseB.setPeriodicWave(wave)
    this.pulseB.connect(bus)

    // An octave down, for weight. Without it the whole thing sits too high to
    // feel like it is moving a car.
    this.growl = new OscillatorNode(ctx, { frequency: 30 })
    this.growl.setPeriodicWave(wave)
    const growlGain = new GainNode(ctx, { gain: 0.5 })
    this.growl.connect(growlGain)
    growlGain.connect(bus)

    this.top = new OscillatorNode(ctx, { type: 'sawtooth', frequency: 120 })
    const topGain = new GainNode(ctx, { gain: 0.12 })
    this.top.connect(topGain)
    topGain.connect(bus)

    // Induction and wind, as a band of noise that opens with speed. One second
    // of noise looped forever: baking more buys nothing you can hear.
    const seconds = 1
    const frames = Math.floor(ctx.sampleRate * seconds)
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    let last = 0
    for (let i = 0; i < frames; i++) {
      // Lightly lowpassed white noise. Pure white is hiss; this is air.
      last = last * 0.72 + (Math.random() * 2 - 1) * 0.28
      data[i] = last
    }
    this.roar = new AudioBufferSourceNode(ctx, { buffer, loop: true })
    this.roarBand = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 400, Q: 0.7 })
    this.roarGain = new GainNode(ctx, { gain: 0 })
    this.roar.connect(this.roarBand)
    this.roarBand.connect(this.roarGain)
    this.roarGain.connect(this.tone)

    for (const osc of [this.pulseA, this.pulseB, this.growl, this.top]) osc.start()
    this.roar.start()
  }

  /**
   * Steer the voice from one frame of car state.
   *
   * Everything is a `setTargetAtTime` ramp rather than a direct assignment:
   * `forwardSpeed` is a sim value that can move a long way in a single tick, and
   * writing it straight to a frequency is the audio equivalent of the FOV snap
   * that had to be fixed in the camera.
   */
  update(drive: EngineDrive, dt: number): void {
    const t = this.t
    const now = this.ctx.currentTime
    const speed = Math.abs(drive.speed)
    const load = clamp(Math.abs(drive.throttle), 0, 1)

    if (this.cut > 0) this.cut = Math.max(0, this.cut - dt)

    // ── the gearbox ──────────────────────────────────────────────────────────
    // Ratios, not speed bands, so the rpm the box drops to after a shift falls
    // out of the arithmetic instead of being a second table to keep in sync.
    const revsIn = (gear: number): number =>
      clamp(speed * (t.ratios[gear] ?? 1), t.idleRpm, t.redlineRpm)

    if (drive.grounded) {
      if (revsIn(this.gear) >= t.upshiftRpm && this.gear < t.ratios.length - 1) {
        this.gear++
        this.cut = t.shiftCutSeconds
      } else if (revsIn(this.gear) <= t.downshiftRpm && this.gear > 0) {
        // Hysteresis: downshift is far below the upshift, so cruising near a
        // shift point does not hunt between two gears.
        this.gear--
      }
    }

    // Wheels off the ground is no load, so the engine runs away. Without this a
    // jump is silent in the one moment the player is most obviously airborne.
    const wanted = drive.grounded
      ? revsIn(this.gear)
      : Math.max(revsIn(this.gear), t.airborneFlareRpm * load)

    // Revs chase; they do not teleport. Faster up than down, like an engine.
    const chase = wanted > this.rpm ? 9 : 4
    this.rpm += (wanted - this.rpm) * Math.min(1, chase * dt)

    // ── pitch ────────────────────────────────────────────────────────────────
    // Four-stroke firing rate: each cylinder fires once every two revolutions.
    const firing = (this.rpm / 60) * (t.cylinders / 2)
    const ramp = 0.02
    this.pulseA.frequency.setTargetAtTime(firing, now, ramp)
    this.pulseB.frequency.setTargetAtTime(firing, now, ramp)
    this.growl.frequency.setTargetAtTime(firing / 2, now, ramp)
    this.top.frequency.setTargetAtTime(firing * 2, now, ramp)

    const revRatio = clamp(
      (this.rpm - t.idleRpm) / Math.max(1, t.redlineRpm - t.idleRpm),
      0,
      1,
    )

    // Beating tightens as the revs rise, which is what stops a high-rpm engine
    // sounding like two engines.
    const detune = t.detuneIdleCents + (t.detuneRedlineCents - t.detuneIdleCents) * revRatio
    this.pulseB.detune.setTargetAtTime(detune, now, 0.05)

    // ── filter ───────────────────────────────────────────────────────────────
    // Load opens the exhaust. Trailing throttle at the same revs is a different
    // sound, and this one parameter is most of that difference.
    const harmonics =
      t.cutoffHarmonicsOffLoad + (t.cutoffHarmonicsOnLoad - t.cutoffHarmonicsOffLoad) * load
    const cutoff = clamp(firing * harmonics, t.cutoffFloorHz, t.cutoffCeilingHz)
    this.tone.frequency.setTargetAtTime(cutoff, now, 0.04)

    this.roarBand.frequency.setTargetAtTime(
      300 + 900 * clamp(speed / drive.maxSpeed, 0, 1),
      now,
      0.06,
    )
    this.roarGain.gain.setTargetAtTime(
      t.roarLevel * clamp(speed / drive.maxSpeed, 0, 1),
      now,
      0.06,
    )

    // ── level ────────────────────────────────────────────────────────────────
    const cut = this.cut > 0 ? 1 - t.shiftCutDepth : 1
    const level = drive.alive
      ? (t.levelBase + t.levelFromRevs * revRatio + t.levelFromLoad * load) * cut
      : 0
    this.out.gain.setTargetAtTime(level, now, drive.alive ? 0.03 : 0.12)
  }

  /** Current revs, for the debug readout. */
  revs(): number {
    return this.rpm
  }

  /** Current gear, 1-based, for the debug readout. */
  currentGear(): number {
    return this.gear + 1
  }
}
