/**
 * L4 — the soundtrack.
 *
 * Three tracks, cycled with M, plus an off position — so one key covers "give me
 * a different song" and "give me no song", which is most of what anyone wants
 * from game music.
 *
 * LAZY, and that is the important part. The three loops are 3.7MB between them
 * against 370KB for every sound effect in the game combined. Fetching all three
 * at boot would multiply the startup payload by ten to have two tracks ready
 * that the player may never select. Each one is fetched the first time it is
 * chosen and kept after that, so switching is instant from the second time on.
 *
 * It ducks. See `duck` — music that does not get out of the way of a rocket is
 * music the player turns off.
 */
import { clamp } from '../core/scalar'

export const TRACKS = ['music-1', 'music-2', 'music-3'] as const
export type Track = (typeof TRACKS)[number]

/** Seconds to fade between tracks, and in and out of silence. */
const SWAP = 0.9

export class Music {
  private readonly ctx: AudioContext
  private readonly out: GainNode
  /** Ducking rides on its own node so it cannot fight the volume fader. */
  private readonly duckGain: GainNode
  private readonly buffers = new Map<Track, AudioBuffer>()

  private source: AudioBufferSourceNode | null = null
  private voice: GainNode | null = null
  /** -1 is off. Otherwise an index into TRACKS. */
  private index = -1
  private loading: Track | null = null

  constructor(ctx: AudioContext, destination: AudioNode, level: number) {
    this.ctx = ctx
    this.duckGain = new GainNode(ctx, { gain: 1 })
    this.out = new GainNode(ctx, { gain: level })
    this.out.connect(this.duckGain)
    this.duckGain.connect(destination)
  }

  /** Which track is playing, or null when the cycle is on its off position. */
  current(): Track | null {
    return this.index < 0 ? null : (TRACKS[this.index] ?? null)
  }

  /** Advance: track 1 → 2 → 3 → off → 1. Returns what is now playing. */
  cycle(): Track | null {
    this.index = this.index + 1 >= TRACKS.length ? -1 : this.index + 1
    const track = this.current()
    if (track === null) this.stop()
    else void this.play(track)
    return track
  }

  private stop(): void {
    if (this.voice === null || this.source === null) return
    const now = this.ctx.currentTime
    const { voice, source } = this
    voice.gain.cancelScheduledValues(now)
    voice.gain.setValueAtTime(voice.gain.value, now)
    voice.gain.linearRampToValueAtTime(0, now + SWAP)
    // Stopped rather than left running: a paused-but-connected source keeps a
    // decoder thread alive for a track nobody is listening to.
    source.stop(now + SWAP + 0.05)
    this.voice = null
    this.source = null
  }

  private async play(track: Track): Promise<void> {
    if (this.buffers.get(track) === undefined) {
      if (this.loading === track) return // already on its way
      this.loading = track
      try {
        const response = await fetch(`audio/${track}.opus`)
        if (!response.ok) throw new Error(String(response.status))
        this.buffers.set(track, await this.ctx.decodeAudioData(await response.arrayBuffer()))
      } catch {
        // A track that will not load should cost you that track, not the game.
        this.loading = null
        return
      }
      this.loading = null
      // The player may have cycled on while this was in flight.
      if (this.current() !== track) return
    }

    const buffer = this.buffers.get(track)
    if (buffer === undefined) return

    this.stop()
    const now = this.ctx.currentTime
    const voice = new GainNode(this.ctx, { gain: 0 })
    const source = new AudioBufferSourceNode(this.ctx, { buffer, loop: true })
    source.connect(voice)
    voice.connect(this.out)
    source.start()
    voice.gain.linearRampToValueAtTime(1, now + SWAP)
    this.voice = voice
    this.source = source
  }

  /**
   * Get out of the way of something louder.
   *
   * `depth` is how far down, 0..1. Retriggering extends rather than restarts, so
   * sustained machine-gun fire holds the music down for as long as it lasts
   * instead of pumping once per round at sixteen a second.
   */
  duck(depth: number, seconds: number): void {
    const now = this.ctx.currentTime
    const to = clamp(1 - depth, 0, 1)
    const g = this.duckGain.gain
    // Only ever duck further, never lift early — otherwise a quiet sound landing
    // during a loud one would pull the music back up over the top of it.
    if (to >= g.value) return
    g.cancelScheduledValues(now)
    g.setValueAtTime(g.value, now)
    g.linearRampToValueAtTime(to, now + 0.05)
    g.linearRampToValueAtTime(1, now + 0.05 + seconds)
  }

  setLevel(level: number): void {
    this.out.gain.setTargetAtTime(level, this.ctx.currentTime, 0.1)
  }

  /** How far the music is currently ducked, 0..1. For tuning and the readout. */
  ducked(): number {
    return 1 - this.duckGain.gain.value
  }

  state(): string {
    const track = this.current()
    if (track === null) return 'off'
    return this.buffers.has(track) ? track : `${track} (loading)`
  }
}
