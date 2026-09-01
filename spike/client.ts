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
    // previous === current: no interpolation whatsoever.
    renderer.render(world, world, 1, elapsed, me, false)

    if (now - lastReport >= 500 && refused === null) {
      const seconds = (now - lastReport) / 1000
      const kb = (bytesIn / 1024 / seconds).toFixed(0)
      readout.textContent =
        `you are car ${me} · tick ${world.tick} · ${(snapshots / seconds).toFixed(0)}/s snapshots · ` +
        `${kb} KB/s in · last gap ${gapMs.toFixed(1)}ms`
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
