/**
 * L4 — the socket surface over a `MatchHost`.
 *
 * This file translates WebSocket frames into host calls and back, and owns
 * nothing else. Every rule about who may drive what lives in `MatchHost`, and
 * every rule about what may be said lives in `protocol` — which is why the
 * match can be tested to completion without any of this existing.
 *
 * Run it with `npm run serve`.
 *
 * Node and `ws`, which is the one runtime dependency this adds. Bun was tried
 * first and rejected: its server types are not visible to the project's
 * `tsc --noEmit` pass, so the whole file would have gone unchecked to save an
 * install. Nothing above the transport depends on the choice either way —
 * `MatchHost` never learns what a socket is.
 */
import { MatchHost } from './matchHost'
import { startTickLoop } from './tickLoop'
import {
  PROTOCOL_VERSION,
  checkProtocol,
  decodeClientMessage,
  encode,
  errorMessage,
  type ServerMessage,
} from './protocol'
import { WebSocketServer, type WebSocket } from 'ws'
import type { EntityId } from '../sim'

const PORT = Number(process.env['PORT'] ?? 5210)
const SLOTS = Number(process.env['SLOTS'] ?? 4)
/**
 * Snapshots per second, deliberately below the tick rate.
 *
 * The sim runs at 60Hz because that is what it is; the wire does not have to.
 * The spike measured 2153B per snapshot, so 60Hz is 124 KB/s per client and
 * 20Hz is 43 KB/s for a difference no one can see once the client interpolates.
 * Interpolation is a later ticket, so this defaults to 60 for now and the knob
 * exists ready for it.
 */
const SNAPSHOT_HZ = Number(process.env['SNAPSHOT_HZ'] ?? 60)

const host = new MatchHost({ slots: SLOTS })

/** Which seat a socket holds, if it has completed a join. */
const seatOf = new WeakMap<WebSocket, EntityId>()
const clients = new Map<EntityId, WebSocket>()

function send(seat: EntityId, message: ServerMessage): void {
  const socket = clients.get(seat)
  if (socket !== undefined && socket.readyState === socket.OPEN) socket.send(encode(message))
}

const server = new WebSocketServer({ port: PORT })

server.on('connection', (socket: WebSocket) => {
  // Nothing is granted until a join arrives and its protocol checks out.

  socket.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
    const decoded = decodeClientMessage(String(raw))
    if (!decoded.ok) {
      socket.send(encode(decoded.error))
      return
    }
    const msg = decoded.message

    if (msg.type === 'join') {
      const mismatch = checkProtocol(msg.protocol)
      if (mismatch !== null) {
        // Refused loudly and then closed. A peer that cannot be understood must
        // not be left half-connected sending things nobody can read.
        console.log(`refused: ${mismatch.message}`)
        socket.send(encode(mismatch))
        socket.close()
        return
      }

      const seat = host.join(msg.name ?? 'player')
      if (seat === null) {
        socket.send(
          encode(errorMessage('E_ROOM_FULL', `This match is full (${host.capacity} cars). Try again when someone leaves.`)),
        )
        socket.close()
        return
      }

      seatOf.set(socket, seat)
      clients.set(seat, socket)
      console.log(`seat ${seat} joined as ${msg.name ?? 'player'} (${clients.size}/${host.capacity})`)
      // Static half once, here. The dynamic half follows every tick.
      send(seat, { type: 'matchStart', you: seat, setup: host.setup(), snapshot: host.snapshot() })
      return
    }

    const seat = seatOf.get(socket)
    if (seat === undefined) {
      socket.send(encode(errorMessage('E_NOT_JOINED', 'Send a join message before anything else.')))
      return
    }
    if (msg.type === 'input') host.input(seat, msg.input)
    // chooseCar and ready belong to the lobby, which is a later ticket. They are
    // accepted and ignored rather than rejected, so a client built against the
    // full protocol is not broken by arriving early.
  })

  socket.on('close', () => {
    const seat = seatOf.get(socket)
    if (seat === undefined) return
    clients.delete(seat)
    host.leave(seat)
    console.log(`seat ${seat} left — a bot has it now (${clients.size}/${host.capacity})`)
  })
})

// ── the loop ─────────────────────────────────────────────────────────────────

const everyNthTick = Math.max(1, Math.round(60 / SNAPSHOT_HZ))
let sinceSnapshot = 0

startTickLoop(
  () => {
    host.tick()

    if (host.over) {
      console.log(`match over at tick ${host.state.tick} — starting another`)
      host.restart()
      for (const seat of clients.keys()) {
        send(seat, { type: 'matchStart', you: seat, setup: host.setup(), snapshot: host.snapshot() })
      }
      sinceSnapshot = 0
      return
    }

    if (++sinceSnapshot < everyNthTick) return
    sinceSnapshot = 0

    const frame = encode({ type: 'snapshot', snapshot: host.snapshot() })
    for (const client of clients.values()) {
      if (client.readyState === client.OPEN) client.send(frame)
    }
  },
  {
    hz: 60,
    onLag: (missed) => console.warn(`fell ${missed} ticks behind — that time is gone, not banked`),
  },
)

console.log(
  `dead-pedal match server on ws://localhost:${PORT} — protocol ${PROTOCOL_VERSION}, ` +
    `${SLOTS} cars, ${SNAPSHOT_HZ}Hz snapshots`,
)
