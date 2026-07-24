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
// live in `lib/components/post-box/poll-durations.ts`, which is not a client
// module.

const API_ROOT = path.join(process.cwd(), 'app', 'api')
const MODULE_EXTENSIONS = ['.ts', '.tsx', '/index.ts', '/index.tsx']

const collectRouteFiles = (directory: string): string[] =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return collectRouteFiles(fullPath)
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [fullPath]
      : []
  })

// Resolves an `@/...` specifier to the file it points at, or null when it does
// not resolve to a first-party module (a directory without an index, say).
const resolveAliasImport = (specifier: string): string | null => {
  const base = path.join(process.cwd(), specifier.replace(/^@\//, ''))
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

describe('API route modules', () => {
  it('never import a use client module', () => {
    const violations = collectRouteFiles(API_ROOT).flatMap((routeFile) => {
      const source = fs.readFileSync(routeFile, 'utf-8')
      return [...source.matchAll(/from '(@\/[^']+)'/g)]
        .map((match) => match[1])
        .map((specifier) => ({
          specifier,
          resolved: resolveAliasImport(specifier)
        }))
        .filter(({ resolved }) => resolved !== null && isClientModule(resolved))
        .map(
          ({ specifier }) =>
            `${path.relative(process.cwd(), routeFile)} -> ${specifier}`
        )
    })

    expect(violations).toEqual([])
  })
})
