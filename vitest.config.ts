import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const resolvePath = (relativePath: string) =>
  fileURLToPath(new URL(relativePath, import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/app\/(.*)$/, replacement: `${resolvePath('./app')}/$1` },
      { find: /^@\/lib\/(.*)$/, replacement: `${resolvePath('./lib')}/$1` },
      { find: /^@\/pages\/(.*)$/, replacement: `${resolvePath('./pages')}/$1` },
      { find: /^@\/(.*)$/, replacement: `${resolvePath('.')}/$1` }
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
    env: { TZ: 'UTC' },
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
    include: ['**/*.test.{ts,tsx}'],
    exclude: [
      '**/node_modules/**',
      '**/.next/**',
      '**/.claude/**',
      '**/.claire/**',
      '**/coverage/**'
    ],
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
    }
  }
})
