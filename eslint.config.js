// @ts-check
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

/**
 * The layering rules live here.
 *
 * PLAN.md §1 calls the sim-purity rule "the single most valuable line of config
 * in the project". This is that config. Everything below the divider exists to
 * make the five contracts checkable rather than aspirational.
 */

const PURE = ['src/core/**/*.ts', 'src/sim/**/*.ts']

/**
 * Layers L0/L1 may not reach upward into anything that renders, plays or reads.
 * `content` is absent on purpose: contract 5 requires the sim to read its tunables
 * from there, so content is a sibling data layer, not a layer above.
 */
const UPWARD = ['view', 'input', 'audio', 'ui', 'bots']

const NON_DETERMINISTIC_GLOBALS = [
  'window',
  'document',
  'navigator',
  'location',
  'localStorage',
  'sessionStorage',
  'requestAnimationFrame',
  'performance',
  'fetch',
  'self',
  'globalThis',
]

export default tseslint.config(
  { ignores: ['node_modules/**', 'dist/**', 'coverage/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },

  // ───────────────────────── contract 1: the sim is pure ─────────────────────
  {
    files: PURE,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['three', 'three/*'],
              message:
                'L0/L1 may not import three. The sim runs headless in Node; rendering is a projection of it (PLAN.md §1).',
            },
            {
              group: UPWARD.flatMap((layer) => [`**/${layer}`, `**/${layer}/**`]),
              message:
                'Dependencies point downward, always. L0/L1 may not import from a layer above them (PLAN.md §1).',
            },
          ],
        },
      ],

      'no-restricted-globals': [
        'error',
        ...NON_DETERMINISTIC_GLOBALS.map((name) => ({
          name,
          message: `\`${name}\` is not available to the sim. It must run identically in Node, in a test, and on a server (PLAN.md §1).`,
        })),
      ],

      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message:
            'Use the seeded PRNG in core/rng and thread `rngState` through the world. Math.random makes replays diverge.',
        },
        {
          object: 'Date',
          property: 'now',
          message: 'The sim measures time in ticks. Nothing here may read the wall clock.',
        },
        {
          object: 'performance',
          property: 'now',
          message: 'The sim measures time in ticks. Nothing here may read the wall clock.',
        },
      ],

      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date']",
          message: 'The sim measures time in ticks. Nothing here may read the wall clock.',
        },
        {
          selector: "MemberExpression[object.name='Date']",
          message: 'The sim measures time in ticks. Nothing here may read the wall clock.',
        },
      ],
    },
  },

  // Tools and tests are above the line: they may read clocks and print things.
  {
    files: ['tools/**/*.ts', 'tests/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
)
