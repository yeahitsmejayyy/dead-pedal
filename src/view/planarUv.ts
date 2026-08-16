/**
 * L3 — world-space UVs for geometry that has none worth using.
 *
 * The arena is built from collision data, not authored in a modeller, so the
 * wedges and boxes it produces carry either no UVs or UVs that mean nothing at
 * world scale. This projects a texture onto them from the world axes, at a
 * fixed metres-per-tile, which has two useful consequences: every surface in
 * the arena is tiled at the same density however big it is, and adjacent
 * surfaces line up because they are all reading from the same world grid.
 *
 * PER FACE, NOT PER MESH. A single top-down projection is a one-liner and it
 * was the first attempt — but it stretches anything vertical into streaks, and
 * a ramp is mostly slope. Choosing the projection plane per triangle from its
 * own normal costs a de-index and one cross product per face, and the vertical
 * faces come out as clean as the horizontal ones.
 *
 * This is the cheap CPU-side cousin of triplanar mapping. Real triplanar blends
 * all three projections in the shader and has no seams at all; this picks one
 * and can show a seam where a curved surface crosses 45°. The arena is made of
 * flat faces meeting at hard edges, so there is nothing for that seam to appear
 * on.
 */
import { BufferAttribute, type BufferGeometry, Vector3 } from 'three'

const a = new Vector3()
const b = new Vector3()
const c = new Vector3()
const edge1 = new Vector3()
const edge2 = new Vector3()
const normal = new Vector3()

/**
 * Project `geometry` onto the world axes at `tile` metres per texture repeat.
 *
 * Returns a NEW geometry — the input is de-indexed, because per-face UVs cannot
 * be expressed on a mesh where faces share vertices.
 */
export function planarUvs(geometry: BufferGeometry, tile: number): BufferGeometry {
  const flat = geometry.index === null ? geometry : geometry.toNonIndexed()
  const position = flat.getAttribute('position')
  const uv = new Float32Array(position.count * 2)

  for (let i = 0; i < position.count; i += 3) {
    a.fromBufferAttribute(position, i)
    b.fromBufferAttribute(position, i + 1)
    c.fromBufferAttribute(position, i + 2)
    edge1.subVectors(b, a)
    edge2.subVectors(c, a)
    normal.crossVectors(edge1, edge2)

    const ax = Math.abs(normal.x)
    const ay = Math.abs(normal.y)
    const az = Math.abs(normal.z)

    for (let v = 0; v < 3; v++) {
      const p = v === 0 ? a : v === 1 ? b : c
      let u: number
      let w: number
      if (ay >= ax && ay >= az) {
        // Facing up or down: project from above. Floors, ramp tops.
        u = p.x
        w = p.z
      } else if (ax >= az) {
        // Facing along X: project from the side.
        u = p.z
        w = p.y
      } else {
        // Facing along Z.
        u = p.x
        w = p.y
      }
      uv[(i + v) * 2] = u / tile
      uv[(i + v) * 2 + 1] = w / tile
    }
  }

  flat.setAttribute('uv', new BufferAttribute(uv, 2))
  return flat
}
