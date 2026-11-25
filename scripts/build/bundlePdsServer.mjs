import { build } from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'

const rootDir = process.cwd()
const standaloneDir = path.join(rootDir, '.next', 'standalone')

if (!fs.existsSync(standaloneDir)) {
  console.log(
    'Skipping PDS server bundle: .next/standalone does not exist (non-standalone build).'
  )
  process.exit(0)
}

const entryPoint = path.join(
  rootDir,
  'lib',
  'services',
  'pds',
  'server',
  'index.ts'
)
const outfile = path.join(standaloneDir, 'pds-server.js')

const externalNextEntryPlugin = {
  name: 'external-next-entry',
  setup(pluginBuild) {
    // Externalize only the bare `next` package entry, not `next/*` subpaths
    // such as `next/dist/shared/lib/constants` (which lack `.js` extensions
    // and would fail Node's strict ESM resolver if left external).
    pluginBuild.onResolve({ filter: /^next$/ }, (args) => ({
      path: args.path,
      external: true
    }))
  }
}

await build({
  entryPoints: [entryPoint],
  outfile,
  bundle: true,
  platform: 'node',
  target: 'node26',
  // Root and standalone package.json declare "type": "module", so Node loads
  // `.next/standalone/pds-server.js` as ESM (matching Next's own `server.js`).
  // A createRequire banner lets bundled CommonJS modules and external CJS/native
  // dependencies resolve through standalone node_modules.
  format: 'esm',
  tsconfig: path.join(rootDir, 'tsconfig.build.json'),
  plugins: [externalNextEntryPlugin],
  banner: {
    js: [
      "import { createRequire as __pdsCreateRequire } from 'node:module';",
      'const require = __pdsCreateRequire(import.meta.url);'
    ].join('\n')
  },
  external: [
    'better-sqlite3',
    'sharp',
    '@img/*',
    'bcrypt',
    'bufferutil',
    'utf-8-validate',
    'pino',
    'pino-pretty',
    'thread-stream',
    '@activities/pg',
    'pg',
    'pg-native',
    '@activities/cloudtasks',
    '@google-cloud/tasks',
    '@activities/qstash',
    '@upstash/qstash',
    '@activities/nodemailer',
    'nodemailer',
    '@activities/resend',
    'resend',
    '@activities/ses',
    '@aws-sdk/client-ses'
  ]
})

const { size } = fs.statSync(outfile)
console.log(
  `Bundled PDS server to ${path.relative(rootDir, outfile)} (${Math.round(size / 1024)} KiB)`
)
