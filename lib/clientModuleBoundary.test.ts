import { parseSync } from '@swc/core'
import fs from 'fs'
import path from 'path'

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
const MODULE_EXTENSIONS = ['.ts', '.tsx', '/index.ts', '/index.tsx']

const collectServerFiles = (directory: string): string[] => {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return collectServerFiles(fullPath)
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [fullPath]
      : []
  })
}

// Resolves an `@/...` or same-directory `./...` specifier to the file it points
// at, or null when it does not resolve to a first-party module.
const resolveImport = (specifier: string, fromFile: string): string | null => {
  const base = specifier.startsWith('@/')
    ? path.join(process.cwd(), specifier.replace(/^@\//, ''))
    : path.resolve(path.dirname(fromFile), specifier)
  for (const extension of MODULE_EXTENSIONS) {
    const candidate = `${base}${extension}`
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate
    }
  }
  return null
}

const isClientModule = (filePath: string) =>
  /^['"]use client['"]/.test(fs.readFileSync(filePath, 'utf-8').trimStart())

// Every module specifier the file imports or re-exports a RUNTIME value from.
// Side-effect imports (`import 'x'`) are excluded: they read no value.
//
// Parsed with @swc/core rather than the `typescript` package: TypeScript 7's
// npm package is a CLI with no compiler API, and this guard has to keep working
// across that upgrade. The syntax flag follows the extension: parsing a `.ts`
// file as TSX turns a generic arrow (`<T>(x: T) => x`) into JSX and drops every
// statement after it, which would blind this check to anything declared below
// one.
const collectValueImports = (fileName: string, source: string): string[] => {
  const module = parseSync(source, {
    syntax: 'typescript',
    tsx: fileName.endsWith('.tsx'),
    decorators: true
  })

  return module.body.flatMap((statement) => {
    if (statement.type === 'ImportDeclaration') {
      if (statement.typeOnly || statement.specifiers.length === 0) return []
      const isEveryBindingTypeOnly = statement.specifiers.every(
        (specifier) =>
          specifier.type === 'ImportSpecifier' && specifier.isTypeOnly
      )
      return isEveryBindingTypeOnly ? [] : [statement.source.value]
    }

    if (statement.type === 'ExportNamedDeclaration' && statement.source) {
      if (statement.typeOnly) return []
      const isEveryBindingTypeOnly = statement.specifiers.every(
        (specifier) =>
          specifier.type === 'ExportSpecifier' && specifier.isTypeOnly
      )
      return isEveryBindingTypeOnly ? [] : [statement.source.value]
    }

    if (statement.type === 'ExportAllDeclaration') {
      // `export type * from` is parsed with `typeOnly: true`; @swc/types does
      // not declare the field on this node yet, hence the `in` check.
      const isTypeOnly = 'typeOnly' in statement && statement.typeOnly === true
      return isTypeOnly ? [] : [statement.source.value]
    }

    return []
  })
}

describe('server-only modules', () => {
  it('never import a runtime value from a use client module', () => {
    const violations = SERVER_ROOTS.flatMap(collectServerFiles).flatMap(
      (serverFile) => {
        const source = fs.readFileSync(serverFile, 'utf-8')
        return collectValueImports(serverFile, source)
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
