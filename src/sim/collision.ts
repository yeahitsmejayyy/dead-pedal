/**
 * L1 — collision shapes and the tests between them.
 *
 * PLAN.md §3: "the sim never sees a mesh." Everything here is a rectangle or a
 * circle in the XZ plane, plus a Y interval. Cars only ever yaw, so a box is a
 * rotated rectangle extruded vertically — which turns 3D box-vs-box (SAT over
 * fifteen axes) into 2D rect-vs-rect (four axes) plus an interval overlap.
 *
 * Cars use their rectangle against the world and a circle against each other,
 * exactly as the plan specifies: circles make ramming stable and cheap, because
 * the contact normal is always the line of centres and can never flip between
 * ticks the way a box corner can.
 */

/** A yaw-rotated rectangle in the XZ plane. `halfZ` is along the car's nose. */
export type Rect = {
  readonly x: number
  readonly z: number
  readonly halfX: number
  readonly halfZ: number
  readonly yaw: number
}

/** Vertical extent, kept separate so a low kerb doesn't hit an airborne car. */
export type Span = { readonly minY: number; readonly maxY: number }

export type Contact = {
  /** Unit normal in XZ, pointing the way `a` must move to separate. */
  readonly nx: number
  readonly nz: number
  /** How far along the normal `a` is buried. Always > 0. */
  readonly depth: number
}

/** Local axes, matching the compass convention in `vehicle.ts`. */
function forwardX(yaw: number): number {
  return -Math.sin(yaw)
}
function forwardZ(yaw: number): number {
  return Math.cos(yaw)
}
function rightX(yaw: number): number {
  return -Math.cos(yaw)
}
function rightZ(yaw: number): number {
  return -Math.sin(yaw)
}

/** Half-width of `r`'s shadow on a unit axis. */
export function radiusOn(r: Rect, nx: number, nz: number): number {
  return (
    r.halfX * Math.abs(rightX(r.yaw) * nx + rightZ(r.yaw) * nz) +
    r.halfZ * Math.abs(forwardX(r.yaw) * nx + forwardZ(r.yaw) * nz)
  )
}

export function spansOverlap(a: Span, b: Span): boolean {
  return a.minY < b.maxY && b.minY < a.maxY
}

/**
 * Separating-axis test. Returns the minimum translation that frees `a` from
 * `b`, or null when they are apart.
 *
 * Only four axes need testing: each rectangle's two local axes. Any gap between
 * two convex shapes shows up on one of them.
 */
export function rectContact(a: Rect, b: Rect): Contact | null {
  const dx = a.x - b.x
  const dz = a.z - b.z

  let bestDepth = Number.POSITIVE_INFINITY
  let bestNx = 0
  let bestNz = 0

  const axes = [
    [rightX(a.yaw), rightZ(a.yaw)],
    [forwardX(a.yaw), forwardZ(a.yaw)],
    [rightX(b.yaw), rightZ(b.yaw)],
    [forwardX(b.yaw), forwardZ(b.yaw)],
  ] as const

  for (const axis of axes) {
    const nx = axis[0]
    const nz = axis[1]

    const centreGap = dx * nx + dz * nz
    const overlap = radiusOn(a, nx, nz) + radiusOn(b, nx, nz) - Math.abs(centreGap)

    // A gap on any axis means no contact — bail immediately, which is also what
    // makes this cheap for the overwhelmingly common non-colliding case.
    if (overlap <= 0) return null

    if (overlap < bestDepth) {
      bestDepth = overlap
      // Point the normal from b toward a, so it always pushes a out.
      const sign = centreGap < 0 ? -1 : 1
      bestNx = nx * sign
      bestNz = nz * sign
    }
  }

  return { nx: bestNx, nz: bestNz, depth: bestDepth }
}

/** One circle of a car's contact body, offset along its own forward axis. */
export type BodyCircle = { readonly offset: number; readonly radius: number }

/**
 * A car's contact shape: a chain of circles laid down its length.
 *
 * PLAN.md §3 says "a sphere for car-vs-car", and the reason it gives is
 * stability — a circle's normal is the line of centres and can never flip
 * between ticks the way a box corner can. That reasoning is right; one circle
 * is simply the wrong number of them. A single 1.5m circle on a 4.2 × 1.9m body
 * overhangs the nose by 0.6m and stands 0.55m proud of each flank, so cars
 * visibly interpenetrate end-on and stop short of touching side-on.
 *
 * A chain sized to the body fixes both without giving up the smooth normal:
 * radius is the car's half-width, so flanks are exact, and the end circles sit
 * a radius in from the nose and tail, so the length is exact too. The only
 * approximation left is the four corners, which the chain undercuts by about
 * 0.4m — far less than the error it replaces, and on a rounded car body it is
 * arguably the more honest shape anyway.
 *
 * Three circles also make a flat side-by-side contact resolve at three points
 * instead of one, which is what stops two parked cars slowly rotating against
 * each other.
 */
export function bodyCircles(halfX: number, halfZ: number, count = 3): BodyCircle[] {
  const radius = halfX
  // Wider than it is long, or a degenerate count: one circle is the honest answer.
  if (halfZ <= radius || count < 2) {
    return [{ offset: 0, radius: Math.max(halfX, halfZ) }]
  }

  const span = halfZ - radius
  const step = (2 * span) / (count - 1)
  return Array.from({ length: count }, (_, i) => ({ offset: -span + i * step, radius }))
}

/**
 * Yaw inertia of a solid rectangular slab about its vertical axis.
 * Derived from the body, so it can never disagree with the shape being drawn.
 */
export function yawInertia(mass: number, halfX: number, halfZ: number): number {
  const width = halfX * 2
  const length = halfZ * 2
  return (mass * (width * width + length * length)) / 12
}

/**
 * Distance along a ray to the near side of a circle, or null for a miss.
 *
 * `dx`/`dz` must be unit length. A ray starting inside the circle reports the
 * far exit rather than a negative distance, so a muzzle sitting inside its own
 * car cannot register a hit behind the shooter.
 */
export function rayCircle(
  ox: number,
  oz: number,
  dx: number,
  dz: number,
  maxDistance: number,
  cx: number,
  cz: number,
  radius: number,
): number | null {
  const mx = ox - cx
  const mz = oz - cz

  const b = mx * dx + mz * dz
  const c = mx * mx + mz * mz - radius * radius
  // Pointing away from a circle we are already outside of.
  if (c > 0 && b > 0) return null

  const discriminant = b * b - c
  if (discriminant < 0) return null

  const root = Math.sqrt(discriminant)
  let t = -b - root
  if (t < 0) t = -b + root
  if (t < 0 || t > maxDistance) return null
  return t
}

/**
 * Distance along a ray to a yaw-rotated box, or null for a miss.
 * Slab test in the box's own frame, which is why only two axes are needed.
 */
export function rayRect(
  ox: number,
  oz: number,
  dx: number,
  dz: number,
  maxDistance: number,
  rect: Rect,
): number | null {
  const px = ox - rect.x
  const pz = oz - rect.z

  const rx = rightX(rect.yaw)
  const rz = rightZ(rect.yaw)
  const fx = forwardX(rect.yaw)
  const fz = forwardZ(rect.yaw)

  const local = [
    { o: px * rx + pz * rz, d: dx * rx + dz * rz, half: rect.halfX },
    { o: px * fx + pz * fz, d: dx * fx + dz * fz, half: rect.halfZ },
  ]

  let near = 0
  let far = maxDistance

  for (const axis of local) {
    if (Math.abs(axis.d) < 1e-9) {
      // Parallel to this slab: a miss unless we already start between its faces.
      if (Math.abs(axis.o) > axis.half) return null
      continue
    }
    const inverse = 1 / axis.d
    let t1 = (-axis.half - axis.o) * inverse
    let t2 = (axis.half - axis.o) * inverse
    if (t1 > t2) [t1, t2] = [t2, t1]
    near = Math.max(near, t1)
    far = Math.min(far, t2)
    if (near > far) return null
  }

  return near <= far ? near : null
}

/** Circle-vs-circle in XZ. Used for car-vs-car only. */
export function circleContact(
  ax: number,
  az: number,
  ar: number,
  bx: number,
  bz: number,
  br: number,
): Contact | null {
  const dx = ax - bx
  const dz = az - bz
  const reach = ar + br
  const distSq = dx * dx + dz * dz

  if (distSq >= reach * reach) return null

  const dist = Math.sqrt(distSq)
  if (dist < 1e-6) {
    // Exactly co-located. Any direction is as good as any other, and picking a
    // fixed one keeps the result deterministic.
    return { nx: 1, nz: 0, depth: reach }
  }

  return { nx: dx / dist, nz: dz / dist, depth: reach - dist }
}
