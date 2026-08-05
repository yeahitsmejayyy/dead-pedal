/**
 * L4 — the engine, as three recorded loops.
 *
 * The alternative to the oscillator bank in `engine.ts`, and the two are meant
 * to be compared rather than one silently replacing the other. Press E in the
 * browser to switch.
 *
 * THE SHAPE. Three steady loops play continuously from the moment the context
 * arms, and revs are expressed two ways at once: a crossfade between the layers
 * and a pitch bend within whichever layer is loudest. Neither alone is enough —
 * crossfading without bending gives you three fixed notes, and bending without
 * crossfading gives you one sample stretched across three octaves, which is the
 * lawnmower.
 *
 * WHY NOT AN ACCELERATION SWEEP. A sweep is a recording on a fixed timeline and
 * a car is not: it gets rammed, hits ramps, lifts off, beaches on a wall. A
 * sweep desyncs within seconds, has nothing to play when it ends, and offers no
 * route back to idle if the player lifts. Steady loops plus a live bend stay
 * glued to the car whatever happens to it.
 */
import { clamp } from '../core/scalar'
import type { EngineTuning } from '../content/audio'
import type { EngineDrive } from './engine'

/** Where each layer sits on the 0..1 rev axis, and how far it may be bent. */
const LAYERS = [
  { file: 'eng-idle', at: 0.0, lo: 0.82, hi: 1.5 },
  { file: 'eng-low', at: 0.42, lo: 0.78, hi: 1.45 },
  { file: 'eng-high', at: 1.0, lo: 0.7, hi: 1.35 },
] as const

type Layer = {
  readonly source: AudioBufferSourceNode
  readonly gain: GainNode
  readonly at: number
  readonly lo: number
  readonly hi: number
}

export class SampledEngine {
  private readonly ctx: BaseAudioContext
  private readonly t: EngineTuning
  private readonly out: GainNode
  private readonly layers: Layer[] = []

  private gear = 0
  private rpm: number
  private cut = 0

  /** True once every loop is decoded and running. Silent until then. */
  readonly ready: boolean

  constructor(
    ctx: BaseAudioContext,
    tuning: EngineTuning,
    destination: AudioNode,
    buffers: Map<string, AudioBuffer>,
  ) {
    this.ctx = ctx
    this.t = tuning
    this.rpm = tuning.idleRpm
    this.out = new GainNode(ctx, { gain: 0 })
    this.out.connect(destination)

    this.ready = LAYERS.every((l) => buffers.has(l.file))
    if (!this.ready) return

    for (const spec of LAYERS) {
      const gain = new GainNode(ctx, { gain: 0 })
      const source = new AudioBufferSourceNode(ctx, {
        buffer: buffers.get(spec.file)!,
        loop: true,
      })
      source.connect(gain)
      gain.connect(this.out)
      source.start()
      this.layers.push({ source, gain, at: spec.at, lo: spec.lo, hi: spec.hi })
    }
  }

  update(drive: EngineDrive, dt: number): void {
    if (!this.ready) return
    const t = this.t
    const now = this.ctx.currentTime
    const speed = Math.abs(drive.speed)
    const load = clamp(Math.abs(drive.throttle), 0, 1)

    if (this.cut > 0) this.cut = Math.max(0, this.cut - dt)

    // Same gearbox as the synthesised voice, deliberately. It is already tuned,
    // every shift lands at 74% of redline, and the drop is most of what says
    // "accelerating" — none of that should change just because the timbre did.
    const revsIn = (gear: number): number =>
      clamp(speed * (t.ratios[gear] ?? 1), t.idleRpm, t.redlineRpm)

    if (drive.grounded) {
      if (revsIn(this.gear) >= t.upshiftRpm && this.gear < t.ratios.length - 1) {
        this.gear++
        this.cut = t.shiftCutSeconds
      } else if (revsIn(this.gear) <= t.downshiftRpm && this.gear > 0) {
        this.gear--
      }
    }

    const wanted = drive.grounded
      ? revsIn(this.gear)
      : Math.max(revsIn(this.gear), t.airborneFlareRpm * load)
    this.rpm += (wanted - this.rpm) * Math.min(1, (wanted > this.rpm ? 9 : 4) * dt)

    const revs = clamp((this.rpm - t.idleRpm) / Math.max(1, t.redlineRpm - t.idleRpm), 0, 1)

    // Triangular crossfade. Weights are normalised so the total stays constant —
    // without that the engine dips every time it crosses between two layers.
    let total = 0
    const weights = this.layers.map((l) => {
      const reach = 0.55
      const w = Math.max(0, 1 - Math.abs(revs - l.at) / reach)
      total += w
      return w
    })
    if (total <= 0) {
      total = 1
      weights[revs < 0.5 ? 0 : this.layers.length - 1] = 1
    }

    const cut = this.cut > 0 ? 1 - t.shiftCutDepth : 1
    const level = drive.alive ? (0.55 + 0.45 * load) * cut : 0

    for (let i = 0; i < this.layers.length; i++) {
      const layer = this.layers[i]!
      layer.gain.gain.setTargetAtTime((weights[i]! / total) * level, now, 0.05)

      // Bend within the layer, by how far the revs sit from where it lives.
      // Clamped per layer so the top loop never chipmunks and the idle loop
      // never turns into a boat.
      const bend = clamp(1 + (revs - layer.at) * 1.1, layer.lo, layer.hi)
      layer.source.playbackRate.setTargetAtTime(bend, now, 0.04)
    }

    this.out.gain.setTargetAtTime(drive.alive ? 1 : 0, now, drive.alive ? 0.05 : 0.15)
  }

  revs(): number {
    return this.rpm
  }

  currentGear(): number {
    return this.gear + 1
  }

  /** Silence without tearing the graph down, so switching back is instant. */
  setActive(active: boolean): void {
    this.out.gain.setTargetAtTime(active ? 1 : 0, this.ctx.currentTime, 0.06)
  }
}
