/**
 * L2 — the wire contract. The one definition both ends import.
 *
 * Pure data and pure functions: no sockets, no DOM, no Node. It describes what
 * may be said, not how it travels, which is what lets the same file be imported
 * by a browser client and a server process without either learning about the
 * other.
 *
 * It does NOT restate `InputFrame` or `WorldState`. Those live in `src/sim` and
 * are the sim's business; a second copy here would be a second thing to keep in
 * step, and keeping it in step is exactly what nobody would do.
 *
 * JSON, deliberately, until something measured says otherwise. The spike
 * measured a full snapshot at 4.8KB and found the cost was repetition rather
 * than encoding — see `docs/multiplayer-spike.md` — so the saving taken here is
 * structural, not a binary format.
 */
import type { Arena, EntityId, InputFrame, WorldState } from '../sim'
import type { MatchRules } from '../content/match'

/**
 * Bumped whenever a message changes shape in a way an older peer would
 * misread. A client and server that disagree must not proceed: the failures
 * from a silent skew are absurd — a car that steers when you brake — and they
 * are attributed to the physics, not to the wire.
 */
export const PROTOCOL_VERSION = 1

export type PlayerId = number

// ---------------------------------------------------------------------------
// Static setup vs per-tick snapshot
// ---------------------------------------------------------------------------

/**
 * The half of the world that never changes once a match starts.
 *
 * Measured, not assumed: `arena` is 46.8% of a full snapshot and `rules` a
 * further 2.1%, and neither moves for the whole five minutes. Re-sending them
 * sixty times a second was 138 KB/s per client of pure repetition. They are
 * sent once, in `matchStart`.
 */
export type MatchSetup = {
  readonly arena: Arena
  readonly rules: MatchRules
}

/** Everything that DOES change. A snapshot is a world minus its setup. */
export type WorldSnapshot = Omit<WorldState, 'arena' | 'rules'>

export function setupOf(world: WorldState): MatchSetup {
  return { arena: world.arena, rules: world.rules }
}

export function snapshotOf(world: WorldState): WorldSnapshot {
  const { arena: _arena, rules: _rules, ...dynamic } = world
  return dynamic
}

/** Put the two halves back together. The client's whole reassembly cost. */
export function mergeSnapshot(setup: MatchSetup, snapshot: WorldSnapshot): WorldState {
  return { ...snapshot, arena: setup.arena, rules: setup.rules }
}

// ---------------------------------------------------------------------------
// Client → server
// ---------------------------------------------------------------------------

export type JoinMessage = {
  readonly type: 'join'
  /** Checked before anything else happens. See `checkProtocol`. */
  readonly protocol: number
  readonly name?: string
}

export type ChooseCarMessage = {
  readonly type: 'chooseCar'
  /** A key of `VEHICLES`. Duplicates between players are allowed by design. */
  readonly archetype: string
}

export type ReadyMessage = {
  readonly type: 'ready'
  readonly ready: boolean
}

export type InputMessage = {
  readonly type: 'input'
  /** The tick the client believed it was on. Advisory: the server owns time. */
  readonly tick: number
  readonly input: InputFrame
}

export type ClientMessage = JoinMessage | ChooseCarMessage | ReadyMessage | InputMessage

// ---------------------------------------------------------------------------
// Server → client
// ---------------------------------------------------------------------------

export type LobbyPlayer = {
  readonly id: PlayerId
  readonly name: string
  readonly archetype: string | null
  readonly ready: boolean
}

export type LobbyStateMessage = {
  readonly type: 'lobbyState'
  readonly you: PlayerId
  readonly players: readonly LobbyPlayer[]
  readonly minimumToStart: number
}

export type MatchStartMessage = {
  readonly type: 'matchStart'
  /** Which vehicle in the world is yours. */
  readonly you: EntityId
  readonly setup: MatchSetup
  readonly snapshot: WorldSnapshot
}

export type SnapshotMessage = {
  readonly type: 'snapshot'
  readonly snapshot: WorldSnapshot
}

export type MatchEndMessage = {
  readonly type: 'matchEnd'
  readonly scores: readonly number[]
  /** Null is a draw, which is a real outcome rather than an error. */
  readonly winner: EntityId | null
}

/** Always fatal to the current attempt, and always says what to do about it. */
export type ErrorMessage = {
  readonly type: 'error'
  readonly code: ProtocolErrorCode
  /** Written for a confused human, not for the developer who wrote it. */
  readonly message: string
}

export type ServerMessage =
  | LobbyStateMessage
  | MatchStartMessage
  | SnapshotMessage
  | MatchEndMessage
  | ErrorMessage

export const PROTOCOL_ERROR_CODES = [
  'E_PROTOCOL_MISMATCH',
  'E_BAD_MESSAGE',
  'E_ROOM_FULL',
  'E_NOT_JOINED',
  'E_UNKNOWN_CAR',
] as const
export type ProtocolErrorCode = (typeof PROTOCOL_ERROR_CODES)[number]

export function errorMessage(code: ProtocolErrorCode, message: string): ErrorMessage {
  return { type: 'error', code, message }
}

// ---------------------------------------------------------------------------
// The version handshake
// ---------------------------------------------------------------------------

/**
 * Refuse a mismatch loudly, and say which side is behind.
 *
 * "Reload" is the fix roughly always, because the client is the half that gets
 * cached — but only when the client is the older one. Telling a user to reload
 * when the SERVER is stale sends them round a loop that cannot terminate, so
 * the two cases get different sentences.
 */
export function checkProtocol(theirs: unknown): ErrorMessage | null {
  if (typeof theirs !== 'number' || !Number.isInteger(theirs)) {
    return errorMessage(
      'E_PROTOCOL_MISMATCH',
      `This client did not say which protocol version it speaks. The server speaks ${PROTOCOL_VERSION}. Reload the page to get the current build.`,
    )
  }
  if (theirs === PROTOCOL_VERSION) return null

  return errorMessage(
    'E_PROTOCOL_MISMATCH',
    theirs < PROTOCOL_VERSION
      ? `This page is running protocol ${theirs} and the server speaks ${PROTOCOL_VERSION}. Reload the page to get the current build.`
      : `This page is running protocol ${theirs} and the server only speaks ${PROTOCOL_VERSION}. The server is out of date and needs redeploying.`,
  )
}

// ---------------------------------------------------------------------------
// Encoding, and validating what arrives
// ---------------------------------------------------------------------------

export function encode(message: ClientMessage | ServerMessage): string {
  return JSON.stringify(message)
}

export type Decoded<T> = { readonly ok: true; readonly message: T } | { readonly ok: false; readonly error: ErrorMessage }

function bad(detail: string): { ok: false; error: ErrorMessage } {
  return { ok: false, error: errorMessage('E_BAD_MESSAGE', detail) }
}

function parse(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/**
 * Validate an InputFrame off the wire.
 *
 * This is the one place untrusted data reaches the sim, and the sim has no
 * defences of its own — it is pure arithmetic, so a `throttle` of `NaN` does not
 * throw, it quietly turns a car's position into NaN and every value derived from
 * it after that. Numbers are checked for finiteness and clamped to the range the
 * input layer itself produces.
 */
function readInputFrame(value: unknown): InputFrame | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>

  const axis = (key: string): number | null => {
    const n = v[key]
    if (typeof n !== 'number' || !Number.isFinite(n)) return null
    return Math.max(-1, Math.min(1, n))
  }
  const flag = (key: string): boolean | null => {
    const b = v[key]
    return typeof b === 'boolean' ? b : null
  }

  const throttle = axis('throttle')
  const steer = axis('steer')
  const tick = typeof v['tick'] === 'number' && Number.isFinite(v['tick']) ? v['tick'] : null
  const handbrake = flag('handbrake')
  const fire = flag('fire')
  const special = flag('special')
  const cycleWeapon = flag('cycleWeapon')
  const cycleTarget = flag('cycleTarget')
  const lookBack = flag('lookBack')

  if (
    throttle === null || steer === null || tick === null || handbrake === null ||
    fire === null || special === null || cycleWeapon === null || cycleTarget === null ||
    lookBack === null
  ) {
    return null
  }

  return { tick, throttle, steer, handbrake, fire, special, cycleWeapon, cycleTarget, lookBack }
}

/** Server side: everything here arrives from a browser and is untrusted. */
export function decodeClientMessage(raw: string): Decoded<ClientMessage> {
  const value = parse(raw)
  if (value === null) return bad('That message was not a JSON object.')

  switch (value['type']) {
    case 'join': {
      const name = value['name']
      if (name !== undefined && typeof name !== 'string') return bad('join.name must be a string.')
      return { ok: true, message: { type: 'join', protocol: value['protocol'] as number, ...(name === undefined ? {} : { name }) } }
    }
    case 'chooseCar': {
      const archetype = value['archetype']
      if (typeof archetype !== 'string' || archetype === '') return bad('chooseCar.archetype must be a non-empty string.')
      return { ok: true, message: { type: 'chooseCar', archetype } }
    }
    case 'ready': {
      const ready = value['ready']
      if (typeof ready !== 'boolean') return bad('ready.ready must be a boolean.')
      return { ok: true, message: { type: 'ready', ready } }
    }
    case 'input': {
      const tick = value['tick']
      if (typeof tick !== 'number' || !Number.isFinite(tick)) return bad('input.tick must be a finite number.')
      const input = readInputFrame(value['input'])
      if (input === null) return bad('input.input was not a valid InputFrame.')
      return { ok: true, message: { type: 'input', tick, input } }
    }
    default:
      return bad(`Unknown message type ${JSON.stringify(value['type'])}.`)
  }
}

/**
 * Client side. Lighter than its counterpart on purpose: this data comes from
 * the server, which is the authority — validating it here would be the client
 * second-guessing the only thing it is allowed to trust. The discriminant is
 * checked so a malformed frame is dropped rather than crashing the loop.
 */
export function decodeServerMessage(raw: string): Decoded<ServerMessage> {
  const value = parse(raw)
  if (value === null) return bad('That message was not a JSON object.')

  switch (value['type']) {
    case 'lobbyState':
    case 'matchStart':
    case 'snapshot':
    case 'matchEnd':
    case 'error':
      return { ok: true, message: value as unknown as ServerMessage }
    default:
      return bad(`Unknown message type ${JSON.stringify(value['type'])}.`)
  }
}
