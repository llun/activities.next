import fs from 'fs'
import path from 'path'

import {
  collectImports,
  collectSourceFiles,
  resolveImport
} from '@/lib/testing/moduleImports'

// A `'use client'` module imported from server code resolves to a client
// reference, not the module itself: components still render, but a plain
// runtime value read out of it (a constant object, a lookup table) is empty.
// That failure is invisible to unit tests, which have no RSC boundary — it only
// shows up at runtime.
//
// This bit `app/api/v1/accounts/outbox/types.ts`, whose Zod schema validated
// `durationInSeconds` against `SecondsToDurationText` imported from the
// `'use client'` poll editor. On the server the table came back empty, so every
// poll the composer could create was rejected with a 400. The durations now
// live in `lib/services/statuses/pollDurations.ts`, which is not a client
// module.
//
// Type-only bindings are exempt (`import type …`, `export type …`, and a brace
// list whose every binding is `type X`): TypeScript erases them, so they never
// reach the runtime boundary. `export … from` re-exports are NOT exempt — they
// resolve through the same client reference. Statements are read from the
// TypeScript AST rather than matched with a regex, because a regex clause has
// to span newlines and can then merge a `from`-less `export type { … }` block
// with the next statement — silently exempting a real violation.
//
// Known limitation: only direct imports are checked. A server module reaching a
// client module through a non-client intermediary (a barrel that re-exports it)
// is invisible here, and would need real module-graph resolution.

// Server-only trees. `app/**/page.tsx` and `layout.tsx` are excluded because a
// Server Component importing a Client Component is the normal composition
// pattern; these directories have no such reason.
const SERVER_ROOTS = [
  path.join(process.cwd(), 'app', 'api'),
  path.join(process.cwd(), 'lib', 'services'),
  path.join(process.cwd(), 'lib', 'actions'),
  path.join(process.cwd(), 'lib', 'jobs'),
  path.join(process.cwd(), 'lib', 'database'),
  path.join(process.cwd(), 'lib', 'config')
]

const isClientModule = (filePath: string) =>
  /^['"]use client['"]/.test(fs.readFileSync(filePath, 'utf-8').trimStart())

describe('server-only modules', () => {
  it('never import a runtime value from a use client module', () => {
    const violations = SERVER_ROOTS.flatMap(collectSourceFiles).flatMap(
      (serverFile) => {
        const source = fs.readFileSync(serverFile, 'utf-8')
        return collectImports(serverFile, source, { includeSideEffects: false })
          .map((specifier) => ({
            specifier,
            resolved: resolveImport(specifier, serverFile)
          }))
          .filter(
            ({ resolved }) => resolved !== null && isClientModule(resolved)
          )
          .map(
            ({ specifier }) =>
              `${path.relative(process.cwd(), serverFile)} -> ${specifier}`
          )
      }
    )

    expect(violations).toEqual([])
  })
})
