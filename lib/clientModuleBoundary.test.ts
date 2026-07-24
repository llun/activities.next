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
// `import type` is exempt: types are erased, so they never reach the runtime
// boundary.

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

describe('server-only modules', () => {
  it('never import a runtime value from a use client module', () => {
    const violations = SERVER_ROOTS.flatMap(collectServerFiles).flatMap(
      (serverFile) => {
        const source = fs.readFileSync(serverFile, 'utf-8')
        return [
          ...source.matchAll(
            /(^|\n)\s*import\s+(type\s+)?[^;]*?from\s+'([^']+)'/g
          )
        ]
          .filter(([, , typeOnly]) => !typeOnly)
          .map(([, , , specifier]) => ({
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
