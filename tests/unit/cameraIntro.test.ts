/**
 * M8: the arrival shot.
 *
 * A camera move is easy to eyeball and easy to get subtly wrong, and the way it
 * goes wrong is always the same — it looks fine in isolation and POPS on the
 * frame it hands back to the normal follow. That is one bad frame in a hundred
 * and fifty, which is exactly the kind of thing you stop noticing after the
 * tenth viewing and a player notices immediately.
 *
 * So the assertion that matters here is not "it looks cinematic", which no test
 * can hold. It is that the path is CONTINUOUS: the shot must end on the
 * ordinary chase pose exactly, not near it, and no single frame anywhere in the
 * sequence may move the camera further than its neighbours do.
 */
import { describe, expect, it } from 'vitest'
import { ChaseCamera, DEFAULT_CAMERA, type CameraTarget } from '../../src/view/camera'
import { forwardOf } from '../../src/sim/vehicle'

const DT = 1 / 60

/** A car sitting still at the origin, facing +Z. */
const parked = (yaw = 0): CameraTarget => ({
  x: 0,
  y: 0,
  z: 0,
  yaw,
  headingYaw: null,
  speed: 0,
  maxSpeed: 46,
  lookBack: false,
})

/** Run `seconds` of frames and return the camera position after each one. */
function run(camera: ChaseCamera, seconds: number, target = parked()): { x: number; y: number; z: number }[] {
  const path: { x: number; y: number; z: number }[] = []
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    camera.update(target, DT)
    path.push({ x: camera.camera.position.x, y: camera.camera.position.y, z: camera.camera.position.z })
  }
  return path
}

/** Where the ordinary chase camera belongs for a parked car at the origin. */
function restingPose(yaw = 0): { x: number; y: number; z: number } {
  const forward = forwardOf(yaw)
  return {
    x: -forward.x * DEFAULT_CAMERA.distance,
    y: DEFAULT_CAMERA.height,
    z: -forward.z * DEFAULT_CAMERA.distance,
  }
}

describe('the arrival shot', () => {
  it('opens wide and low, off the car front quarter', () => {
    const camera = new ChaseCamera(16 / 9)
    camera.playIntro(2.9)
    const [first] = run(camera, 0.05)

    const forward = forwardOf(0)
    const range = Math.hypot(first!.x, first!.z)
    // Positive dot with the car's forward means the camera is AHEAD of it.
    const ahead = (first!.x * forward.x + first!.z * forward.z) / range

    expect(ahead, 'the shot opens in front of the car').toBeGreaterThan(0)
    expect(
      ahead,
      'but off to one side — dead ahead is a flat elevation with no length to it',
    ).toBeLessThan(0.96)
    expect(first!.y, 'low, looking slightly up at the car').toBeLessThan(1.5)
    expect(range, 'and wide, well outside the resting distance').toBeGreaterThan(
      DEFAULT_CAMERA.distance * 1.4,
    )
  })

  it('travels most of a half circle', () => {
    const camera = new ChaseCamera(16 / 9)
    camera.playIntro(2.9)
    const path = run(camera, 2.9)
    const bearing = (p: { x: number; z: number }): number => Math.atan2(p.x, p.z)
    // Unwrapped total turn around the car, in degrees.
    let turned = 0
    for (let i = 1; i < path.length; i++) {
      let d = bearing(path[i]!) - bearing(path[i - 1]!)
      if (d > Math.PI) d -= 2 * Math.PI
      if (d < -Math.PI) d += 2 * Math.PI
      turned += Math.abs(d)
    }
    expect((turned * 180) / Math.PI).toBeGreaterThan(120)
    expect((turned * 180) / Math.PI).toBeLessThan(180)
  })

  it('closes the lens as it comes in', () => {
    const camera = new ChaseCamera(16 / 9)
    camera.playIntro(2.9)
    run(camera, 0.05)
    const opening = camera.camera.fov
    run(camera, 3.2)
    expect(opening, 'starts wider than the resting lens').toBeGreaterThan(DEFAULT_CAMERA.baseFov + 5)
    expect(camera.camera.fov, 'and lands exactly on it').toBeCloseTo(DEFAULT_CAMERA.baseFov, 2)
  })

  it('lands exactly on the resting chase pose', () => {
    const camera = new ChaseCamera(16 / 9)
    camera.playIntro(2.9)
    const path = run(camera, 3.2)
    const last = path.at(-1)!
    const rest = restingPose()

    expect(camera.introducing, 'the shot is over by then').toBe(false)
    expect(last.x).toBeCloseTo(rest.x, 3)
    expect(last.y).toBeCloseTo(rest.y, 3)
    expect(last.z).toBeCloseTo(rest.z, 3)
  })

  it('never jumps, least of all on the frame it hands back', () => {
    const camera = new ChaseCamera(16 / 9)
    camera.playIntro(2.9)
    const path = run(camera, 3.2)

    const steps = path.slice(1).map((p, i) => {
      const q = path[i]!
      return Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z)
    })

    // The handoff is the suspect frame. Compare the largest step in the second
    // half — which contains the end of the shot and the first normal follow
    // frames — against the median step of the whole path. A pop shows up as an
    // outlier here and nowhere else.
    const sorted = [...steps].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]!
    const secondHalf = steps.slice(Math.floor(steps.length / 2))
    const worstLate = Math.max(...secondHalf)

    expect(worstLate, `late frames must not spike (median step ${median.toFixed(4)}m)`).toBeLessThan(
      Math.max(median * 3, 0.02),
    )
  })

  it('spends its whole duration moving, and decelerates into place', () => {
    const camera = new ChaseCamera(16 / 9)
    camera.playIntro(2.9)
    const path = run(camera, 2.9)
    const steps = path.slice(1).map((p, i) => {
      const q = path[i]!
      return Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z)
    })
    const sum = (a: number[]): number => a.reduce((x, y) => x + y, 0)
    const third = Math.floor(steps.length / 3)
    const [start, middle, end] = [
      sum(steps.slice(0, third)),
      sum(steps.slice(third, third * 2)),
      sum(steps.slice(third * 2)),
    ]

    // Symmetric easing: the middle third does the most work. A hard ease-out —
    // which this used to have — front-loads everything, and a two-second shot
    // that finishes travelling in half a second reads as underwhelming however
    // far it moved.
    expect(middle, 'the middle third travels furthest').toBeGreaterThan(start!)
    expect(middle, 'the middle third travels furthest').toBeGreaterThan(end!)
    expect(end, 'and it is still slowing when it arrives').toBeLessThan(middle! * 0.75)
  })

  it('does nothing at all when it was never asked for', () => {
    const camera = new ChaseCamera(16 / 9)
    expect(camera.introducing).toBe(false)
    // First frame cuts straight to the resting pose, as it always did.
    const [first] = run(camera, 0.05)
    const rest = restingPose()
    expect(first!.x).toBeCloseTo(rest.x, 3)
    expect(first!.z).toBeCloseTo(rest.z, 3)
  })
})
