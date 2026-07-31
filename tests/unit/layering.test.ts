/**
 * Contract 1, proven mechanically.
 *
 * PLAN.md §1: "Enforce them with lint rules and a CI check, not with willpower."
 * A lint rule nobody tests is willpower with extra steps — this runs ESLint over
 * source that violates each contract and asserts it is rejected inside `src/sim/`
 * and accepted outside it.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { beforeAll, describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../..', import.meta.url))

let eslint: ESLint

beforeAll(() => {
  eslint = new ESLint({ cwd: root })
})

const RESTRICTION_RULES = new Set([
  'no-restricted-imports',
  'no-restricted-globals',
  'no-restricted-properties',
  'no-restricted-syntax',
])

async function restrictionsFor(code: string, relativePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, {
    filePath: path.join(root, relativePath),
    warnIgnored: false,
  })
  return (result?.messages ?? [])
    .filter((m) => m.ruleId !== null && RESTRICTION_RULES.has(m.ruleId))
    .map((m) => `${m.ruleId}: ${m.message}`)
}

const VIOLATIONS: ReadonlyArray<readonly [name: string, code: string]> = [
  ['importing three', `import * as THREE from 'three'\nexport const x = THREE`],
  ['importing a three submodule', `import { GLTFLoader } from 'three/examples/x'\nexport const x = GLTFLoader`],
  ['importing from the view layer', `import { render } from '../view/renderer'\nexport const x = render`],
  ['importing from the bots layer', `import { drive } from '../bots/hunter'\nexport const x = drive`],
  ['calling Math.random', `export const x = Math.random()`],
  ['calling Date.now', `export const x = Date.now()`],
  ['constructing a Date', `export const x = new Date()`],
  ['calling performance.now', `export const x = performance.now()`],
  ['touching document', `export const x = document.title`],
  ['touching window', `export const x = window.innerWidth`],
  ['reaching through globalThis', `export const x = globalThis`],
  ['calling fetch', `export const x = fetch('/arena.json')`],
]

describe('the sim is pure — enforced by lint, not by memory', () => {
  it.each(VIOLATIONS)('rejects %s inside src/sim/', async (_name, code) => {
    expect(await restrictionsFor(code, 'src/sim/probe.ts')).not.toHaveLength(0)
  })

  it.each(VIOLATIONS)('rejects %s inside src/core/', async (_name, code) => {
    expect(await restrictionsFor(code, 'src/core/probe.ts')).not.toHaveLength(0)
  })

  it.each(VIOLATIONS)('allows %s inside src/view/', async (_name, code) => {
    // The rules must be scoped to L0/L1. A view that cannot import three is a
    // config bug, and one that would only show up at M1b.
    expect(await restrictionsFor(code, 'src/view/probe.ts')).toHaveLength(0)
  })

  it('allows the sim to read its tunables from content/', async () => {
    // Contract 5: every tunable number lives in content/, so sim → content is
    // required, not a layering violation.
    const code = `import { CHASSIS } from '../content/vehicles'\nexport const x = CHASSIS`
    expect(await restrictionsFor(code, 'src/sim/probe.ts')).toHaveLength(0)
  })

  it('allows the sim to import core/', async () => {
    const code = `import { next } from '../core/rng'\nexport const x = next`
    expect(await restrictionsFor(code, 'src/sim/probe.ts')).toHaveLength(0)
  })

  it('reports the actual sim sources as clean', async () => {
    const results = await eslint.lintFiles([path.join(root, 'src/sim/**/*.ts')])
    const errors = results.flatMap((r) => r.messages.filter((m) => m.severity === 2))
    expect(errors).toEqual([])
  })
})
