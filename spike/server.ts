/**
 * SPIKE — throwaway, now speaking the real protocol.
 *
 * Rewritten to import `src/net/protocol` so the wire contract is proved over a
 * real socket rather than only in tests. Everything else is still cheated:
 * exactly two players, no lobby, no reconnect.
 *
 * Run with `bun spike/server.ts`.
 */
import { createWorld, step, type InputFrame, type Inputs, type WorldState } from '../src/sim'
import { NEUTRAL_INPUT } from '../src/sim'
import { DEATHMATCH } from '../src/content/match'
import { tuningFor, DEFAULT_VEHICLE } from '../src/content/vehicles'
import {
  PROTOCOL_VERSION,
  checkProtocol,
  decodeClientMessage,
  encode,
  errorMessage,
  setupOf,
  snapshotOf,
} from '../src/net/protocol'

const PORT = 5210
const TICK_MS = 1000 / 60
const PLAYERS = 2

const maxHealth = tuningFor(DEFAULT_VEHICLE).maxHealth

let world: WorldState = createWorld({
  seed: 1,
  vehicles: PLAYERS,
  health: () => maxHealth,
  rules: DEATHMATCH,
})

const latest = new Map<number, InputFrame>()
type Client = { send: (data: string) => void; close: () => void }
const sockets = new Map<number, Client>()
/** Joined AND accepted. A socket that has not handshaken gets no snapshots. */
const joined = new Set<number>()

function freeSlot(): number | null {
  for (let id = 0; id < PLAYERS; id++) if (!sockets.has(id)) return id
  return null
}

let bytesSent = 0
let framesSent = 0
let lastReport = Date.now()

const server = Bun.serve<{ id: number }, Record<string, never>>({
  port: PORT,
  fetch(req, srv) {
    const id = freeSlot()
    if (id === null) return new Response('spike is full (2 players)', { status: 503 })
    if (srv.upgrade(req, { data: { id } })) return undefined as unknown as Response
    return new Response('expected a websocket', { status: 400 })
  },
  websocket: {
    open(ws) {
      sockets.set(ws.data.id, ws)
      console.log(`socket ${ws.data.id} open — waiting for join`)
    },
    message(ws, raw) {
      const decoded = decodeClientMessage(String(raw))
      if (!decoded.ok) {
        ws.send(encode(decoded.error))
        console.log(`socket ${ws.data.id}: ${decoded.error.message}`)
        return
      }
      const msg = decoded.message

      if (msg.type === 'join') {
        const mismatch = checkProtocol(msg.protocol)
        if (mismatch !== null) {
          // Loudly, and then gone. A peer that cannot be understood must not be
          // left half-connected sending things nobody can read.
          console.log(`socket ${ws.data.id} REFUSED: ${mismatch.message}`)
          ws.send(encode(mismatch))
          ws.close()
          return
        }
        joined.add(ws.data.id)
        console.log(`player ${ws.data.id} joined on protocol ${msg.protocol} (${joined.size}/${PLAYERS})`)
        ws.send(encode({ type: 'matchStart', you: ws.data.id, setup: setupOf(world), snapshot: snapshotOf(world) }))
        return
      }

      if (!joined.has(ws.data.id)) {
        ws.send(encode(errorMessage('E_NOT_JOINED', 'Send a join message before anything else.')))
        return
      }
      if (msg.type === 'input') latest.set(ws.data.id, msg.input)
    },
    close(ws) {
      sockets.delete(ws.data.id)
      joined.delete(ws.data.id)
      latest.delete(ws.data.id)
      console.log(`socket ${ws.data.id} closed`)
    },
  },
})

setInterval(() => {
  const inputs: Inputs = new Map(
    Array.from({ length: PLAYERS }, (_, id) => [
      id,
      // Last frame, not neutral: zeroing throttle on a late packet reads as the
      // car braking by itself.
      latest.get(id) ?? { ...NEUTRAL_INPUT, tick: world.tick },
    ]),
  )

  world = step(world, inputs)

  if (world.match.phase === 'matchOver') {
    console.log(`match over at tick ${world.tick} — starting a fresh one`)
    world = createWorld({ seed: world.tick, vehicles: PLAYERS, health: () => maxHealth, rules: DEATHMATCH })
    const restart = encode({ type: 'matchStart', you: 0, setup: setupOf(world), snapshot: snapshotOf(world) })
    for (const [id, ws] of sockets) if (joined.has(id)) ws.send(restart)
    return
  }

  // Only the dynamic half goes on the wire now — the arena and rules went once,
  // in matchStart. That is the spike's main finding, applied.
  const frame = encode({ type: 'snapshot', snapshot: snapshotOf(world) })
  bytesSent += frame.length
  framesSent++
  for (const [id, ws] of sockets) if (joined.has(id)) ws.send(frame)

  const now = Date.now()
  if (now - lastReport >= 1000) {
    const perFrame = framesSent === 0 ? 0 : Math.round(bytesSent / framesSent)
    console.log(
      `tick ${world.tick} | ${framesSent} frames/s | ${perFrame}B per snapshot | ` +
        `${((perFrame * framesSent) / 1024).toFixed(0)} KB/s per client | phase ${world.match.phase}`,
    )
    bytesSent = 0
    framesSent = 0
    lastReport = now
  }
}, TICK_MS)

console.log(`spike server on ws://localhost:${server.port} — protocol ${PROTOCOL_VERSION}`)
