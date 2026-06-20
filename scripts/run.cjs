// CommonJS bootstrap for the TypeScript scripts under `scripts/`.
//
// The project is ESM-only (`"type": "module"`), which forces Node to load a
// `.ts` entry through the ESM loader. `@swc-node/register` then compiles every
// module to ESNext, so the whole import graph is evaluated as ESM and Node's
// strict ESM resolver rejects the bundler-style imports the app relies on:
// extensionless `node_modules` subpaths (e.g. `lodash/memoize`) and named
// imports from CommonJS packages whose exports aren't statically detectable
// (e.g. `loadEnvConfig` from `@next/env`).
//
// Loading the script from this `.cjs` file instead runs `@swc-node/register` in
// CommonJS mode: the target `.ts` and its graph are compiled to CommonJS and
// pulled in via `require()`, whose resolver handles extensionless subpaths and
// whose interop exposes CommonJS named exports — so the scripts run unchanged.
//
// Each script's shebang invokes this bootstrap and `env -S` appends the script
// path as the final argument:
//   #!/usr/bin/env -S node scripts/run.cjs
require('@swc-node/register')

const { resolve } = require('node:path')

const target = process.argv[2]
if (!target) {
  console.error('Usage: node scripts/run.cjs <script.ts>')
  process.exit(1)
}

require(resolve(target))
