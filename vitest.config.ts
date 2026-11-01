import { globSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

import { inferTestSize } from './test/setup/testSizes'

// Pin the suite's clock to UTC. CI runners default to UTC, so a date assertion
// that only holds there passes review and then fails on the first developer
// machine set to anything else — a component rendering a UTC-midnight
// timestamp through a local-time formatter read a day early in
// `America/Los_Angeles` and a day late in `Asia/Tokyo`. Formatters that must
// be zone-independent say so themselves (`timeZone: 'UTC'`); this only stops
// the runner's zone from deciding whether the suite is green.
//
// It is assigned here, in Vitest's main process and before any worker exists,
// because that is the only place it reaches every pool. `test.env` is applied
// inside each worker, and on a worker thread assigning `process.env.TZ`
// changes the variable but not the zone `Date` and `Intl` use: Node re-reads
// the zone only for the main thread. An externally supplied `TZ` is replaced
// too — the pin is not a default. `test/vitest.config.test.ts` guards it.
process.env.TZ = 'UTC'

const resolvePath = (relativePath: string) =>
  fileURLToPath(new URL(relativePath, import.meta.url))

// `**` never descends into a dot directory in `fs.globSync`, so `.github` —
// whose workflow guard tests must run — gets its own pattern.
const TEST_FILES = ['**/*.test.{ts,tsx}', '.github/**/*.test.{ts,tsx}']
const EXCLUDED = [
  '**/node_modules/**',
  '**/.next/**',
  '**/.claude/**',
  '**/.claire/**',
  '**/coverage/**'
]

// Runs in the small project on both pools, so the UTC pin is checked on a
// worker thread and in a forked process.
const TIME_ZONE_PIN_GUARD = 'test/vitest.config.test.ts'

// Test files that need a process of their own:
// - `process.chdir()` ("process.chdir() is not supported in workers") and the
//   `lib/testing/withTimeZone` helper, which moves the process's zone for one
//   test, because Node only honours those on the main thread.
// - `@swc/core` (and `lib/testing/moduleImports`, which wraps it), because its
//   self-extracting native N-API binary segfaults (`SIGSEGV` in
//   `napi_register_module_v1`) when a worker thread unloads it on exit and a
//   later worker thread in the same process loads it again.
// Helpers are matched by their import specifiers, so generic, aliased or
// namespace calls are found as well. They run in the `-forks` variant of their
// size's project; everything else runs on worker threads, which start much
// faster than a process per file.
const FORKED_PROCESS_MARKER =
  /process\.chdir\(|['"](?:@swc\/core|[^'"]*\/(?:withTimeZone|moduleImports))['"]/
const ROOT = resolvePath('.')

// Google-style test sizes as projects. The size is inferred per file by
// test/setup/testSizes.ts; a `@vitest-size small|medium|large` docblock in the
// file always wins over the heuristics. Each size has its own guard setup file
// (test/setup/guardSmall.ts, test/setup/guardMedium.ts; large runs the root
// setup files only) and its own timeouts, doubled on CI where runners are
// slower. `yarn test` still runs everything: every file lands in exactly one
// of the six size × pool projects.
const SIZE_TIMEOUTS = {
  small: 2000,
  medium: 15000,
  large: 30000
} as const
const CI_MULTIPLIER = process.env.CI ? 2 : 1
const GUARD_SETUP_FILES: Record<keyof typeof SIZE_TIMEOUTS, string[]> = {
  small: ['./test/setup/guardSmall.ts'],
  medium: ['./test/setup/guardMedium.ts'],
  large: []
}

// The file scan was already reading every test file for the forked-process
// split; the size inference reuses the same single read per file.
const ALL_TEST_FILES = globSync(TEST_FILES, {
  cwd: ROOT,
  // `.github` is scanned on purpose: the workflow guard tests live there.
  // Every other dot directory (.next, .claude, .claire, …) plus node_modules
  // and coverage stay out, matching EXCLUDED above. The callback receives
  // both bare names and paths, so judge the last segment.
  exclude: (name) => {
    const base = name.slice(name.lastIndexOf('/') + 1)
    return (
      base === 'coverage' ||
      base === 'node_modules' ||
      (base.startsWith('.') && base !== '.github')
    )
  }
})
const sources = new Map(
  ALL_TEST_FILES.map((file) => [
    file,
    readFileSync(path.join(ROOT, file), 'utf8')
  ])
)

// The guard is listed in both projects already; a comment that happens to
// contain a marker must not drop it from `threads`.
const FORKED_PROCESS_FILES = new Set(
  ALL_TEST_FILES.filter(
    (file) =>
      file !== TIME_ZONE_PIN_GUARD &&
      FORKED_PROCESS_MARKER.test(sources.get(file) ?? '')
  )
)

type TestSize = keyof typeof SIZE_TIMEOUTS
const filesBySize: Record<TestSize, string[]> = {
  small: [],
  medium: [],
  large: []
}
for (const file of ALL_TEST_FILES) {
  filesBySize[inferTestSize(sources.get(file) ?? '')].push(file)
}

const sizeProject = (size: TestSize, forked: boolean) => {
  const include = forked
    ? [
        // The UTC pin guard is small and must be checked in a forked process
        // too, even though it never carries the forked-process markers.
        ...(size === 'small' ? [TIME_ZONE_PIN_GUARD] : []),
        ...filesBySize[size].filter((file) => FORKED_PROCESS_FILES.has(file))
      ]
    : filesBySize[size].filter((file) => !FORKED_PROCESS_FILES.has(file))
  return {
    extends: true,
    test: {
      name: forked ? `${size}-forks` : size,
      pool: forked ? ('forks' as const) : ('threads' as const),
      include,
      setupFiles: GUARD_SETUP_FILES[size],
      testTimeout: SIZE_TIMEOUTS[size] * CI_MULTIPLIER,
      hookTimeout: SIZE_TIMEOUTS[size] * CI_MULTIPLIER
    }
  }
}

export default defineConfig({
  // Resolve setupFiles and the project file lists against this directory even
  // when Vitest is launched from elsewhere (e.g. `--config ../vitest.config.ts`).
  root: ROOT,
  resolve: {
    alias: [
      { find: /^@\/app\/(.*)$/, replacement: `${resolvePath('./app')}/$1` },
      { find: /^@\/lib\/(.*)$/, replacement: `${resolvePath('./lib')}/$1` },
      { find: /^@\/pages\/(.*)$/, replacement: `${resolvePath('./pages')}/$1` },
      { find: /^@\/(.*)$/, replacement: `${ROOT}/$1` }
    ]
  },
  test: {
    globals: true,
    // LOG_LEVEL=silent keeps the server logger's JSON lines out of the run
    // output, where hundreds of expected warn/error entries from failure-path
    // tests buried the real failures. Tests that assert logging spy on
    // `logger.*`, which records calls whatever the level.
    env: { LOG_LEVEL: 'silent' },
    // Default environment is node; component tests opt into jsdom per file via
    // a `@vitest-environment jsdom` docblock (vitest 4 removed
    // `environmentMatchGlobs`). `environmentOptions` still applies to whichever
    // environment a test selects, so jsdom tests get the localhost:3000 URL.
    environment: 'node',
    environmentOptions: {
      jsdom: { url: 'http://localhost:3000' }
    },
    // jest-global.ts must run first: it installs the minimal global `jest`
    // shim that jest-fetch-mock (imported by test/setup/vitest.setup.ts) relies on.
    // blockOutboundNetwork.ts arms the outbound network trap before
    // vitest.setup.ts turns fetch mocking on, so no setup code can slip a
    // real request through. Per-project guard setup files (guardSmall.ts,
    // guardMedium.ts) are appended after these.
    setupFiles: [
      './test/setup/jest-global.ts',
      './test/setup/blockOutboundNetwork.ts',
      './test/setup/vitest.setup.ts'
    ],
    // `include` is set per project below: with `extends: true` a project's
    // arrays are appended to the root's, so a root `include` would pull every
    // test file into every project. Each file belongs to exactly one project,
    // so no per-project exclude is needed.
    exclude: EXCLUDED,
    // Fallback ceiling; each size project sets its own tighter limits.
    testTimeout: 30000,
    // Setup-file and top-level after-hooks run in definition order, not
    // Vitest's default reverse ('stack'). @testing-library/react registers
    // afterEach(cleanup) on the file suite at import, so it runs before a
    // file's own top-level afterEach and the tree unmounts first. A describe's
    // own afterEach is a child hook and still runs before the unmount under
    // either order, so teardown there that resets shared state calls cleanup()
    // itself first.
    sequence: { hooks: 'list' },
    // Match testTimeout. Vitest's 10s default is too tight for the
    // `TEST_DATABASE_TYPE=pg` harness: every test file's `beforeAll` empties
    // its worker's database — replaying the whole of `migrations/schema.sql`
    // only when the schema fingerprint says it must be rebuilt; a match just
    // truncates the tables with rows — and one worker per core doing that at
    // once against a cold PostgreSQL overran 10s. SQLite hooks finish in
    // milliseconds, so this only raises the ceiling before a hung hook is
    // declared failed — it does not slow a passing run down.
    hookTimeout: 30000,
    server: {
      deps: {
        // These ship ESM that should be transformed/inlined by Vitest.
        inline: ['better-auth', '@better-auth', 'html-react-parser', 'uuid']
      }
    },
    projects: [
      sizeProject('small', false),
      sizeProject('small', true),
      sizeProject('medium', false),
      sizeProject('medium', true),
      sizeProject('large', false),
      sizeProject('large', true)
    ]
  }
})
