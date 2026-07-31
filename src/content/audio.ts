/**
 * L2 — how the car sounds, as data.
 *
 * There are no audio assets in this project and there are not going to be, so
 * every sound is synthesised. That is a constraint rather than a preference —
 * but for an engine it is also the better answer: a sample loop has to be
 * pitch-shifted and crossfaded to follow revs, and it never quite tracks the
 * throttle. An oscillator bank driven straight from `forwardSpeed` does.
 *
 * Numbers here, graph in `src/audio/`. Same split as every other tuning file.
 */

export type EngineTuning = {
  /**
   * Gearbox ratios, in rpm per m/s, top of the ladder first.
   *
   * A real ratio ladder rather than per-gear speed bands, because ratios make
   * the drop-down rpm come out right on their own. Spaced by a constant 1.32,
   * an ordinary gearbox step.
   *
   * Five gears, not a continuous sweep, and that is the important decision.
   * Mapping 0 to 46 m/s onto one 3.17-octave rise takes about eleven seconds:
   * the rate of change is too slow to hear and the car sounds electric. Five
   * gears give five rises and four drops over the same run, and it is the
   * *drop* that carries the information — it says "you are accelerating hard"
   * regardless of how fast you already are.
   *
   * Measured on a full-throttle launch, every upshift lands at 74% of redline
   * (7006, 7020, 7030, 7038 rpm). That consistency is what makes four shifts
   * sound like one gearbox rather than four unrelated events. Top gear is sized
   * so redline and `maxSpeed` arrive together: 46 × 157 = 7222.
   */
  readonly ratios: readonly number[]
  readonly idleRpm: number
  readonly redlineRpm: number
  readonly upshiftRpm: number
  /**
   * Downshift well below the upshift, or the box hunts.
   *
   * With upshifts at 33.8 and 25.8 m/s, these give downshifts at 20.4 and 15.4
   * coming back down — a wide enough band that cruising near a shift point does
   * not oscillate.
   */
  readonly downshiftRpm: number
  /** A V8. Firing rate is (rpm / 60) × (cylinders / 2) for a four-stroke. */
  readonly cylinders: number

  /** Detune between the two pulse oscillators, cents. Beating, not chorus. */
  readonly detuneIdleCents: number
  readonly detuneRedlineCents: number

  /** Lowpass travel, Hz. Load opens it up; trailing throttle closes it down. */
  readonly cutoffFloorHz: number
  readonly cutoffCeilingHz: number
  /** Harmonics above the firing frequency the filter lets through, on and off load. */
  readonly cutoffHarmonicsOnLoad: number
  readonly cutoffHarmonicsOffLoad: number

  /** Output level, split so revs and load contribute separately. */
  readonly levelBase: number
  readonly levelFromRevs: number
  readonly levelFromLoad: number
  /** The filtered noise bed under the tone — wind and induction roar. */
  readonly roarLevel: number

  /** The gap in the power a shift punches, and how long it lasts. */
  readonly shiftCutDepth: number
  readonly shiftCutSeconds: number

  /**
   * Revs an airborne car flares to.
   *
   * Wheels off the ground means no load, so the engine runs away. Without this
   * a jump is silent in the one moment the player is most obviously in the air.
   */
  readonly airborneFlareRpm: number
}

export const DEFAULT_ENGINE: EngineTuning = {
  ratios: [475, 360, 273, 207, 157],
  idleRpm: 800,
  redlineRpm: 7200,
  upshiftRpm: 7000,
  downshiftRpm: 3200,
  cylinders: 8,

  detuneIdleCents: 14,
  detuneRedlineCents: 5,

  cutoffFloorHz: 260,
  cutoffCeilingHz: 5200,
  cutoffHarmonicsOnLoad: 11,
  cutoffHarmonicsOffLoad: 4,

  levelBase: 0.1,
  levelFromRevs: 0.16,
  levelFromLoad: 0.2,
  roarLevel: 0.07,

  shiftCutDepth: 0.55,
  shiftCutSeconds: 0.09,

  airborneFlareRpm: 6400,
}

export type MixTuning = {
  /** Master gain when armed and unmuted. */
  readonly master: number
  /** Concurrent one-shot voices. Oldest is stolen past this. */
  readonly voices: number
  /**
   * Metres past which a sound is not started at all.
   *
   * The arena is 180m across, so this is not "inaudible" — it is "not worth a
   * voice". Culling at the source is what keeps a four-car firefight inside the
   * voice budget without any ducking.
   */
  readonly maxAudible: number
  /** Stereo spread. 1 would be hard-panned, which is fatiguing on headphones. */
  readonly panWidth: number
  /**
   * Distance floor for the pan calculation, metres.
   *
   * The player's own bonnet guns are 2.2m ahead. Without a floor the pan is
   * dominated by sub-metre geometry and the gun flicks between speakers on
   * every volley.
   */
  readonly panFloor: number
  /**
   * Minimum gap between two instances of the same sound, seconds.
   *
   * Several events of one kind can land on a single tick — a rocket hitting
   * three cars raises three `damaged` events at once — and starting three
   * identical buffers in the same millisecond is a comb filter, not a louder
   * sound.
   */
  readonly repeatGuardSeconds: number
  /** Cap on how many voices of one sound may start in a single tick. */
  readonly startBudgetPer: number

  readonly targetLoudness: number
  readonly limiterThresholdDb: number
  readonly limiterKneeDb: number
  readonly limiterRatio: number
  readonly limiterAttack: number
  readonly limiterRelease: number
}

export const DEFAULT_MIX: MixTuning = {
  master: 0.75,
  voices: 24,
  maxAudible: 120,
  panWidth: 0.85,
  panFloor: 6,
  repeatGuardSeconds: 0.03,
  startBudgetPer: 3,

  targetLoudness: 0.7,
  // A limiter rather than trusting the sum. Sixteen rounds a second plus two
  // explosions will clip a naive mix, and clipping is the one artefact that
  // makes synthesis sound cheap.
  limiterThresholdDb: -10,
  limiterKneeDb: 6,
  limiterRatio: 12,
  limiterAttack: 0.003,
  limiterRelease: 0.25,
}
