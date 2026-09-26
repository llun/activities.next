import { globSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

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

// Test files that call `process.chdir()`, which Node refuses inside a worker
// thread ("process.chdir() is not supported in workers"). They run in the
// forked-process project; everything else runs on worker threads, which start
// much faster than a process per file. A file this scan misses fails loudly
// with that error rather than passing wrongly.
const ROOT = resolvePath('.')
const PROCESS_CHDIR_FILES = globSync(TEST_FILES, {
  cwd: ROOT,
  exclude: (name) => name === 'node_modules' || name.startsWith('.')
}).filter((file) =>
  // globSync returns paths relative to ROOT; read them from there too, not
  // from process.cwd(), so Vitest can be launched from any directory.
  readFileSync(path.join(ROOT, file), 'utf8').includes('process.chdir(')
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
    // Pin the suite's clock to UTC. CI already runs in UTC, so a date
    // assertion that only holds there passes review and then fails on the
    // first developer machine set to anything else — a component rendering a
    // UTC-midnight timestamp through a local-time formatter read a day early
    // in `America/Los_Angeles` and a day late in `Asia/Tokyo`. Formatters that
    // must be zone-independent say so themselves (`timeZone: 'UTC'`); this
    // only stops the runner's zone from deciding whether the suite is green.
    //
    // LOG_LEVEL=silent keeps the server logger's JSON lines out of the run
    // output, where hundreds of expected warn/error entries from failure-path
    // tests buried the real failures. Tests that assert logging spy on
    // `logger.*`, which records calls whatever the level.
    env: { TZ: 'UTC', LOG_LEVEL: 'silent' },
    // Default environment is node; component tests opt into jsdom per file via
    // a `@vitest-environment jsdom` docblock (vitest 4 removed
    // `environmentMatchGlobs`). `environmentOptions` still applies to whichever
    // environment a test selects, so jsdom tests get the localhost:3000 URL.
    environment: 'node',
    environmentOptions: {
      jsdom: { url: 'http://localhost:3000' }
    },
    // jest-global.ts must run first: it installs the minimal global `jest`
    // shim that jest-fetch-mock (imported by vitest.setup.ts) relies on.
    setupFiles: ['./vitest-shims/jest-global.ts', './vitest.setup.ts'],
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
          exclude: PROCESS_CHDIR_FILES
        }
      },
      {
        extends: true,
        test: {
          name: 'forks',
          pool: 'forks',
          include: PROCESS_CHDIR_FILES
        }
      }
    ]
  }
})
