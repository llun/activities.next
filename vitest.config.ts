import { globSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

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

const TEST_FILES = ['**/*.test.{ts,tsx}']
const EXCLUDED = [
  '**/node_modules/**',
  '**/.next/**',
  '**/.claude/**',
  '**/.claire/**',
  '**/coverage/**'
]

// Runs in both projects, so the UTC pin is checked on a worker thread and in a
// forked process.
const TIME_ZONE_PIN_GUARD = 'test/vitest.config.test.ts'

// Test files that need a process of their own, because Node only honours the
// call on the main thread: `process.chdir()` ("process.chdir() is not
// supported in workers") and the `lib/testing/withTimeZone` helper, which
// moves the process's zone for one test. The helper is matched by its import
// specifier, so a generic, aliased or namespace call is found as well. They
// run in the forked-process project; everything else runs on worker threads,
// which start much faster than a process per file. A file this scan misses
// fails loudly rather than passing wrongly: `process.chdir()` throws that
// error, and the helper throws when the zone did not move.
const FORKED_PROCESS_MARKER = /process\.chdir\(|['"][^'"]*\/withTimeZone['"]/
const ROOT = resolvePath('.')
const FORKED_PROCESS_FILES = globSync(TEST_FILES, {
  cwd: ROOT,
  exclude: (name) => name === 'node_modules' || name.startsWith('.')
}).filter(
  (file) =>
    // The guard is listed in both projects already; a comment that happens to
    // contain a marker must not drop it from `threads`.
    file !== TIME_ZONE_PIN_GUARD &&
    // globSync returns paths relative to ROOT; read them from there too, not
    // from process.cwd(), so Vitest can be launched from any directory.
    FORKED_PROCESS_MARKER.test(readFileSync(path.join(ROOT, file), 'utf8'))
)

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
    setupFiles: ['./test/setup/jest-global.ts', './test/setup/vitest.setup.ts'],
    // `include` is set per project below: with `extends: true` a project's
    // arrays are appended to the root's, so a root `include` would pull every
    // test file into the forks project too.
    exclude: EXCLUDED,
    testTimeout: 30000,
    // Match testTimeout. Vitest's 10s default is too tight for the
    // `TEST_DATABASE_TYPE=pg` harness: every test file's `beforeAll` drops and
    // recreates its worker's database and replays the whole of
    // `migrations/schema.sql`, and one worker per core doing that at once
    // against a cold PostgreSQL overran 10s. SQLite hooks finish in
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
      {
        extends: true,
        test: {
          name: 'threads',
          pool: 'threads',
          include: TEST_FILES,
          exclude: FORKED_PROCESS_FILES
        }
      },
      {
        extends: true,
        test: {
          name: 'forks',
          pool: 'forks',
          include: [...FORKED_PROCESS_FILES, TIME_ZONE_PIN_GUARD]
        }
      }
    ]
  }
})
