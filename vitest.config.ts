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
    environment: 'node',
    // Component tests render against jsdom; pure logic tests stay on node.
    environmentMatchGlobs: [['**/*.test.tsx', 'jsdom']],
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
    server: {
      deps: {
        // These ship ESM that should be transformed/inlined by Vitest.
        inline: ['better-auth', '@better-auth', 'html-react-parser', 'uuid']
      }
    }
  }
})
