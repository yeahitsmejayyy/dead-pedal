/**
 * SPIKE — throwaway, now speaking the real protocol.
 *
 * Imports the same `src/net/protocol` the server does, which is the point of
 * this pass: one definition, both ends. It still never calls `step`, and still
 * has no interpolation and no prediction.
 *
 * `?protocol=N` forces a bogus version, to watch the handshake refuse it.
 */
import { InputSource } from '../src/input'
import { Renderer } from '../src/view/renderer'
import { DEFAULT_CAMERA } from '../src/view/camera'
import { TICK_DT } from '../src/core/clock'
import type { InputFrame, WorldState } from '../src/sim'
import {
  PROTOCOL_VERSION,
  decodeServerMessage,
  encode,
  mergeSnapshot,
  type MatchSetup,
} from '../src/net/protocol'

const canvas = document.getElementById('scene')
if (!(canvas instanceof HTMLCanvasElement)) throw new Error('missing #scene')
const readout = document.getElementById('readout')
if (readout === null) throw new Error('missing #readout')

const input = new InputSource(window)
let me = 0
let setup: MatchSetup | null = null
let world: WorldState | null = null
let renderer: Renderer | null = null
let refused: string | null = null

let bytesIn = 0
let snapshots = 0
let lastReport = performance.now()
let lastSnapshotAt = 0
let gapMs = 0

/**
 * The beat, counted rather than squinted at.
 *
 * With no interpolation the client draws whatever tick it last received. If the
 * server ticks at 59.1Hz and the display refreshes at 60Hz, then roughly once a
 * second there is no new tick to draw and the previous one is drawn again — a
 * repeat — or two arrive between frames and one is never drawn — a skip. Both
 * are the same fault seen from opposite sides, and both are invisible to a
 * screenshot, so they get counters.
 */
let renderedTick = -1
let repeats = 0
let skips = 0
/** Display refresh rate. The reason the repeat counter reads the way it does. */
let framesDrawn = 0

/** `?protocol=2` to prove the handshake refuses a skew. */
const claimed = Number(new URLSearchParams(location.search).get('protocol') ?? PROTOCOL_VERSION)

const socket = new WebSocket(`ws://${location.hostname}:5210`)

socket.addEventListener('open', () => {
  socket.send(encode({ type: 'join', protocol: claimed }))
})

socket.addEventListener('message', (event) => {
  const text = String(event.data)
  bytesIn += text.length

  const decoded = decodeServerMessage(text)
  if (!decoded.ok) return // a frame we cannot read is dropped, not fatal
  const msg = decoded.message

  if (msg.type === 'error') {
    refused = `${msg.code}: ${msg.message}`
    readout.textContent = refused
    return
  }
  if (msg.type === 'matchStart') {
    me = msg.you
    setup = msg.setup
    world = mergeSnapshot(msg.setup, msg.snapshot)
    renderer ??= new Renderer(canvas, world.arena, { ...DEFAULT_CAMERA })
    return
  }
  if (msg.type !== 'snapshot' || setup === null) return

  const now = performance.now()
  if (lastSnapshotAt !== 0) gapMs = now - lastSnapshotAt
  lastSnapshotAt = now
  snapshots++
  world = mergeSnapshot(setup, msg.snapshot)
})

socket.addEventListener('close', () => {
  readout.textContent = refused ?? 'disconnected'
})

window.addEventListener('resize', () => renderer?.resize())

/** Input on a fixed interval, never from rAF — a hidden tab produces no frames. */
let lastSent: InputFrame | null = null
setInterval(() => {
  if (socket.readyState !== WebSocket.OPEN || world === null) return
  lastSent = input.sample(world.tick, TICK_DT)
  socket.send(encode({ type: 'input', tick: world.tick, input: lastSent }))
}, 1000 / 60)

let lastFrame = performance.now()

function frame(now: number): void {
  const elapsed = Math.min((now - lastFrame) / 1000, 0.25)
  lastFrame = now

  if (renderer !== null && world !== null) {
    framesDrawn++
    if (renderedTick >= 0) {
      const advanced = world.tick - renderedTick
      if (advanced === 0) repeats++
      else if (advanced > 1) skips += advanced - 1
    }
    renderedTick = world.tick

    // previous === current: no interpolation whatsoever.
    renderer.render(world, world, 1, elapsed, me, false)

    if (now - lastReport >= 500 && refused === null) {
      const seconds = (now - lastReport) / 1000
      const kb = (bytesIn / 1024 / seconds).toFixed(0)
      // Where is everyone else? The spike has no HUD and no radar, and the two
      // cars spawn 48m apart in a 180m arena — which is far enough that "I only
      // ever saw one car" is the obvious first experience without this line.
      const mine = world.vehicles.find((v) => v.id === me)
      const others = world.vehicles
        .filter((v) => v.id !== me)
        .map((v) => {
          if (mine === undefined) return `car ${v.id}`
          const dx = v.pos.x - mine.pos.x
          const dz = v.pos.z - mine.pos.z
          // Bearing relative to where you are pointing, so it reads as a
          // direction to steer rather than a compass heading to convert.
          const rel = ((Math.atan2(dx, dz) - mine.yaw) * 180) / Math.PI
          const deg = Math.round(((rel % 360) + 540) % 360 - 180)
          const side = Math.abs(deg) < 12 ? 'ahead' : deg > 0 ? `${Math.abs(deg)}° right` : `${Math.abs(deg)}° left`
          return `car ${v.id} ${Math.hypot(dx, dz).toFixed(0)}m ${side}`
        })
        .join(' · ')

      const speed = mine === undefined ? 0 : Math.hypot(mine.vel.x, mine.vel.z) * 3.6

      readout.textContent =
        `you are car ${me} · ${speed.toFixed(0)} km/h · tick ${world.tick} · ` +
        `${(snapshots / seconds).toFixed(0)}/s snapshots · ${kb} KB/s in · gap ${gapMs.toFixed(1)}ms\n` +
        `${(framesDrawn / seconds).toFixed(0)} fps display vs ${(snapshots / seconds).toFixed(0)} Hz world · ` +
        `repeated frames ${(repeats / seconds).toFixed(1)}/s · skipped ticks ${(skips / seconds).toFixed(1)}/s\n` +
        (others === '' ? 'waiting for another player' : others)
      repeats = 0
      skips = 0
      framesDrawn = 0
      bytesIn = 0
      snapshots = 0
      lastReport = now
    }
  }

  requestAnimationFrame(frame)
}

;(window as unknown as { __spike: unknown }).__spike = {
  me: () => me,
  tick: () => world?.tick ?? -1,
  car: (id: number) => {
    const v = world?.vehicles.find((x) => x.id === id)
    return v === undefined ? null : { x: v.pos.x, z: v.pos.z, yaw: v.yaw }
  },
  gapMs: () => gapMs,
  lastSent: () => lastSent,
  refused: () => refused,
  match: () => world?.match ?? null,
}

requestAnimationFrame(frame)
