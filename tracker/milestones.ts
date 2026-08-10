/**
 * The plan, as data.
 *
 * PLAN.md lives outside this git repository, which means the milestone list has
 * never actually been version-controlled alongside the code it describes. This
 * file is that record: the same milestones, in the repo, next to the thing they
 * are about.
 *
 * `done` here is the *shipped* state at the time of writing — the checkboxes in
 * the UI are stored per-browser and override it, so ticking something off does
 * not require an edit. When a milestone genuinely lands, update it here so a
 * fresh clone starts from the truth rather than from an empty slate.
 */

export type Task = {
  readonly id: string
  readonly label: string
  readonly done: boolean
  /** Shown under the task. For why something is not done, or what it cost. */
  readonly note?: string
  /**
   * Known, decided, and deliberately not being done yet.
   *
   * Distinct from "not done". A deferred task is still visible and still counts
   * against the total, but it does not drive "up next" — otherwise the tracker
   * points at work that was parked on purpose and the ordering stops meaning
   * anything.
   */
  readonly deferred?: boolean
}

export type Milestone = {
  readonly id: string
  readonly title: string
  /** PLAN.md's own done-when line, verbatim where one exists. */
  readonly doneWhen: string
  readonly tasks: readonly Task[]
}

export const MILESTONES: readonly Milestone[] = [
  {
    id: 'M0',
    title: 'The harness',
    doneWhen: 'A grey box renders at a locked 60Hz and the loop is provably deterministic.',
    tasks: [
      { id: 'm0-clock', label: 'Fixed 60Hz timestep with interpolated rendering', done: true },
      { id: 'm0-rng', label: 'Seeded PRNG carried inside world state', done: true },
      { id: 'm0-hash', label: 'Canonical-JSON world hashing', done: true },
      { id: 'm0-replay', label: 'Replay fixtures, regenerated with `npm run record`', done: true },
      {
        id: 'm0-layers',
        label: 'Layering enforced by ESLint and a second tsc pass',
        done: true,
        note: 'Enforced for L0/L1 only — nothing stops view importing ui.',
      },
    ],
  },
  {
    id: 'M1',
    title: 'Driving feel',
    doneWhen: 'You can drive a box around and it feels good enough to keep doing it.',
    tasks: [
      { id: 'm1-tyres', label: 'Longitudinal and lateral tyre model', done: true },
      { id: 'm1-slip', label: 'Slip-dependent steering authority and handbrake', done: true },
      { id: 'm1-cam', label: 'Chase camera with a snap look-back', done: true },
    ],
  },
  {
    id: 'M2',
    title: 'Collision and contact',
    doneWhen: 'You can ram a stationary car across the arena and it feels like weight moved.',
    tasks: [
      { id: 'm2-sat', label: '2D SAT for yaw-rotated rectangles', done: true },
      { id: 'm2-body', label: 'Chain-of-circles car bodies', done: true },
      { id: 'm2-impulse', label: 'Sequential-impulse resolution with angular impulse', done: true },
      { id: 'm2-arena', label: 'First arena and its collision model, authored together', done: true },
      {
        id: 'm2-ramps',
        label: 'Ramps reshaped into tents with boost chevrons',
        done: true,
        note: 'The old vertical back face teleported cars 3.6m in one tick.',
      },
    ],
  },
  {
    id: 'M3',
    title: 'Weapons and damage',
    doneWhen: 'A fight is a fight.',
    tasks: [
      { id: 'm3-gun', label: 'Twin hood machine guns with tracer fire', done: true },
      { id: 'm3-rocket', label: 'Rockets with blast damage', done: true },
      { id: 'm3-mine', label: 'Mines', done: true },
      { id: 'm3-respawn', label: 'Destruction and respawn', done: true },
    ],
  },
  {
    id: 'M4',
    title: 'Lock-on, specials and pickups',
    doneWhen: 'Weapon choice matters.',
    tasks: [
      { id: 'm4-lock', label: 'Targeting scored on proximity AND bearing', done: true },
      { id: 'm4-manual', label: 'Manual target cycling with T', done: true },
      { id: 'm4-homing', label: 'Homing missiles', done: true },
      { id: 'm4-pickups', label: 'Weapon crates with respawn timers', done: true },
      {
        id: 'm4-crates',
        label: 'Crates colour-coded to the HUD',
        done: true,
        note: 'One palette feeds both the crate and the HUD pip.',
      },
    ],
  },
  {
    id: 'M5',
    title: 'Bots',
    doneWhen: 'A match against bots is worth playing.',
    tasks: [
      { id: 'm5-inputs', label: 'Bots emit InputFrames only, never touch world state', done: true },
      { id: 'm5-tiers', label: 'Three difficulty tiers, as data', done: true },
      { id: 'm5-bars', label: 'Health bars over cars and a player HUD bar', done: true },
      {
        id: 'm5-baseform',
        label: 'Base Form engages without being a threat',
        done: true,
        note: 'Against a moving player it gets you in 8/12 matches, 1.3 deaths each — a light spar, as specified. The earlier "barely engages" reading came from bot-vs-bot with no player in the arena, which nobody plays.',
      },
    ],
  },
  {
    id: 'M6',
    title: 'The match',
    doneWhen:
      'You can start a match, lose it, and immediately start another without reloading the page.',
    tasks: [
      { id: 'm6-mode', label: 'Timed deathmatch: 5 minutes, most kills, always respawn', done: true },
      { id: 'm6-kills', label: 'Kill scoring with draws as a real outcome', done: true },
      { id: 'm6-hud', label: 'HUD: ammo, current special, opponent radar, round state', done: true },
      { id: 'm6-restart', label: 'Restart from the result board or with R', done: true },
      { id: 'm6-tests', label: 'Match state machine tests, including PLAN edge cases', done: true },
      { id: 'm6-headless', label: 'Full match headless in under a second', done: true, note: '365ms.' },
      {
        id: 'm6-rounds',
        label: 'Decide a round on that round’s kills, not the match’s',
        done: false,
        deferred: true,
        note: 'Unreachable in a one-round mode. Left as a todo for whoever builds mode two.',
      },
      {
        id: 'm6-roundone',
        label: 'Announce round one in a zero-countdown world',
        done: false,
        deferred: true,
        note: 'Inert today: nothing consumes roundStarted in sandbox.',
      },
    ],
  },
  {
    id: 'M7',
    title: 'Feel, art, audio',
    doneWhen: 'You’d send the link to someone without apologising for it.',
    tasks: [
      { id: 'm7-budget', label: 'Draw-call budget back inside 100', done: true, note: 'Peak 104-106 → 58.' },
      { id: 'm7-fov', label: 'Speed-scaled FOV, smoothed', done: true, note: 'Was snapping 12-14°.' },
      { id: 'm7-shake', label: 'Camera shake scaled by impulse', done: true },
      { id: 'm7-hitstop', label: 'Hit-stop on big impacts', done: true, note: 'Camera-only; the sim never stops.' },
      { id: 'm7-smoke', label: 'Tyre smoke', done: true },
      { id: 'm7-sparks', label: 'Damage sparks', done: true },
      { id: 'm7-debris', label: 'Wreck debris', done: true },
      {
        id: 'm7-engine',
        label: 'Engine audio driven by RPM and load',
        done: true,
        note: 'Two implementations, E toggles them: three crossfaded sample loops, or the oscillator bank.',
      },
      {
        id: 'm7-sfx',
        label: 'Weapon, impact and UI sounds',
        done: true,
        note: 'ElevenLabs-generated, conditioned and wired. No third-party audio, no attribution.',
      },
      { id: 'm7-sfx-wire', label: 'Every sim event that should make a sound now does', done: true },
      {
        id: 'm7-skid',
        label: 'Tyre skid, as a loop driven by slip',
        done: true,
        note: 'A slide runs 1.05-3.70s under player control, so a one-shot could not work.',
      },
      { id: 'm7-pause', label: 'Pause on P — freezes sim, match clock and audio', done: true },

      // Remaining work, in the order it should be picked up.
      {
        id: 'm7-perf',
        label: 'CI perf assertion: 8 vehicles under 2ms',
        done: true,
        note: '60us median against a 2ms budget. The bound that actually catches a regression is the 4→8 scaling ratio, calibrated against an injected O(n²): clean 2.0x, regression 3.9x, bounded at 3.0.',
      },
      {
        id: 'm7-visual',
        label: 'Playwright visual regression on a fixed camera and seeded state',
        done: true,
        note: 'Clock pinned frame-by-frame, canvas only. Catches a maxSpeed change at 9261 pixels; not sensitive to sub-degree camera tweaks.',
      },
      {
        id: 'm7-sfx-variants',
        label: 'Five variants each for the gun and bullet impacts',
        done: true,
        note: 'Loudness-matched to a 0.0 dB spread — the raw takes spanned 17.5 dB, and variants at different levels rotate as a volume wobble. Most-similar pair correlates 0.11, so they are genuinely different rounds.',
      },
      {
        id: 'm7-art',
        label: 'Art pass: vehicle models, arena dressing, one atlas',
        done: false,
        note: 'Blocked on a decision: push procedural geometry further, or wire real glTF models.',
      },
      {
        id: 'm7-music',
        label: 'Music — three tracks, cycled with M',
        done: true,
        note: 'Lazy-loaded (3.7MB vs 370KB of SFX), own bus at 0.30, ducks 31% under sustained fire and 55% on a near blast. M cycles 1→2→3→off; mute moved to N.',
      },
    ],
  },
  {
    id: 'M8',
    title: 'Multiplayer',
    doneWhen: 'Four people in four cities finish a match and want another.',
    tasks: [
      { id: 'm8-server', label: 'Authoritative server running the same sim package', done: false },
      { id: 'm8-predict', label: 'Client-side prediction and input replay', done: false },
      { id: 'm8-interp', label: 'Remote vehicles interpolated ~100ms in the past', done: false },
      { id: 'm8-lobby', label: 'Lobby and room codes', done: false },
    ],
  },
]
