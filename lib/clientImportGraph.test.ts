import fs from 'fs'
import { builtinModules } from 'module'
import path from 'path'

import {
  ROOT,
  collectImports,
  collectSourceFiles,
  resolveImport
} from '@/lib/testing/moduleImports'

// Everything a `'use client'` module imports (statically or with `import()`)
// ends up in the browser bundle, transitively. Three kinds of server-side
// package must never get there:
//
// - Node builtins (`crypto`, `fs`, `stream`, `node:*` …): Next bundles
//   polyfills for them. `lib/utils/getHashFromString.ts` (`import crypto from
//   'crypto'`) once shipped ~130 KB gz of crypto/stream/buffer to /notifications.
// - The whole `lodash` package (`import _ from 'lodash'`, `import { x } from
//   'lodash'`): use `lodash/<method>` or plain JS.
// - `@/lib/utils/logger` (pino).
//
// The walk starts at every `'use client'` file under `app/` and `lib/`,
// follows `@/` and relative imports, skips type-only imports, and does not
// descend into `'use server'` files (client code only sees a server-action
// reference there). Only first-party modules are walked; a bare package
// specifier is checked and not followed.

const BUILTINS = new Set(builtinModules)
const FORBIDDEN_PACKAGES = new Set(['lodash'])
const FORBIDDEN_FILES = new Set([path.join(ROOT, 'lib/utils/logger.ts')])

const startsWithDirective = (source: string, directive: string) =>
  new RegExp(`^['"]${directive}['"]`).test(source.trimStart())

const forbiddenReason = (specifier: string, resolved: string | null) => {
  const bare = specifier.replace(/^node:/, '')
  if (specifier.startsWith('node:') || BUILTINS.has(bare.split('/')[0])) {
    return 'Node builtin'
  }
  if (FORBIDDEN_PACKAGES.has(specifier)) return 'whole-package import'
  if (resolved && FORBIDDEN_FILES.has(resolved)) return 'server logger (pino)'
  return null
}

describe('client bundle imports', () => {
  it('never reach Node builtins, whole lodash or the pino logger from a use client module', () => {
    const files = [
      ...collectSourceFiles(path.join(ROOT, 'app')),
      ...collectSourceFiles(path.join(ROOT, 'lib'))
    ]
    const entries = files.filter((file) =>
      startsWithDirective(fs.readFileSync(file, 'utf-8'), 'use client')
    )

    const parents = new Map<string, string | null>()
    const queue: string[] = []
    for (const entry of entries) {
      parents.set(entry, null)
      queue.push(entry)
    }

    const chainOf = (file: string) => {
      const chain: string[] = []
      for (let current: string | null | undefined = file; current;) {
        chain.push(path.relative(ROOT, current))
        current = parents.get(current)
      }
      return chain.reverse().join(' -> ')
    }

    const violations: string[] = []
    while (queue.length > 0) {
      const file = queue.shift() as string
      const source = fs.readFileSync(file, 'utf-8')
      if (startsWithDirective(source, 'use server')) continue

      for (const specifier of collectImports(file, source, {
        includeSideEffects: true
      })) {
        const resolved = resolveImport(specifier, file)
        const reason = forbiddenReason(specifier, resolved)
        if (reason) {
          violations.push(`${specifier} (${reason}) via ${chainOf(file)}`)
          continue
        }
        if (resolved && !parents.has(resolved)) {
          parents.set(resolved, file)
          queue.push(resolved)
        }
      }
    }

    expect(violations).toEqual([])
  })
})
