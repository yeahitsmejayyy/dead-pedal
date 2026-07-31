/**
 * L0 — deterministic state hashing.
 *
 * Used to compare two runs of the sim. It only has to be stable and cheap, not
 * cryptographic: two FNV-1a streams with different constants, giving 64 bits of
 * output, which is plenty for "did these 10,000 ticks come out the same".
 */

/**
 * Canonical string encoding of a value. Keys are sorted, so two structurally
 * identical worlds hash identically regardless of property insertion order.
 *
 * Non-finite numbers get their own tokens rather than `JSON.stringify`'s `null`.
 * NaN leaking into the sim is the single most likely determinism bug, and a hash
 * that quietly launders it into `null` is a hash that hides the thing you built
 * it to catch.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null'

  switch (typeof value) {
    case 'undefined':
      return 'undefined'
    case 'boolean':
      return value ? 'true' : 'false'
    case 'string':
      return JSON.stringify(value)
    case 'bigint':
      return `${value}n`
    case 'number':
      if (Number.isNaN(value)) return 'NaN'
      if (value === Number.POSITIVE_INFINITY) return 'Infinity'
      if (value === Number.NEGATIVE_INFINITY) return '-Infinity'
      // -0 and 0 are the same state; don't let them produce different hashes.
      return Object.is(value, -0) ? '0' : String(value)
    case 'function':
    case 'symbol':
      throw new TypeError(
        `canonicalJson: ${typeof value} is not serialisable — world state must be plain data`,
      )
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
}

/** 64-bit hash of a string, as 16 lowercase hex characters. */
export function hashString(text: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193)
    h2 = Math.imul(h2 ^ c, 0x85ebca6b)
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')
}

/** Hash of any plain-data value. Throws if the value isn't plain data. */
export function hashState(value: unknown): string {
  return hashString(canonicalJson(value))
}
