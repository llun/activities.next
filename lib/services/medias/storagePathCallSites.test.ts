import fs from 'fs'
import path from 'path'

// A stored path is confined to its storage root by `resolveStorageFilePath` /
// `assertStorageFilePath` (`lib/services/medias/storagePath.ts`). The tests
// beside this one prove that helper is correct and that today's call sites use
// it; neither can catch a call site added tomorrow. That matters here because
// the bug this rule exists for was precisely a missing call site:
// `LocalFileStorage.getFile` carried the check inline while `deleteFile` right
// below it resolved and `unlink`ed with none, so containment was an invariant
// of the CALLERS rather than of the driver.
//
// This guard reads source text, which bounds what it can honestly promise, and
// the bound is the whole design. Two earlier versions tried to be cleverer and
// were wrong in both directions: one tracked `this._config.path` and its
// aliases and was defeated by a destructured rename, a nested call in the
// argument list and — decisively — prettier wrapping the call across lines,
// which made `prettier --write`, step 1 of the commit gate, able to disarm the
// guard; the next added an extracted-variable heuristic that matched a bare
// identifier with no scope awareness and failed on an unrelated
// `const resolvedArchivePath = 'database.'` in `scripts/backup/productionArchive.ts`.
// A false positive in a guard is worse than a missing one, because the fix is
// to weaken the guard.
//
// So each assertion below is scoped to what a text scan can decide correctly,
// and the residual is named rather than papered over. Anything needing scope
// resolution — following an identifier back to its declaration — belongs in an
// AST rule in `lint/agentsRules.mjs` (`no-component-fetch` is the precedent for
// a filename-scoped ban), which would also be immune to formatting by
// construction. That is a follow-up, not something to fake here with a regex.

const DRIVER_FILES = [
  'lib/services/medias/localFile.ts',
  'lib/services/fitness-files/localFile.ts'
]

const SOURCE_ROOTS = ['app', 'lib', 'scripts']

// Every way of reaching `path.resolve`/`path.join` from a module that imports
// `path` as a default binding, which is what both drivers do. Banning the
// member access alone is not enough: `path['resolve'](…)` and
// `import { resolve as pathResolve } from 'path'` both walk straight past it,
// and either reintroduces an unrooted resolve. Together with the import-shape
// assertion below, these leave no spelling open in these two files.
const BANNED_IN_DRIVERS = [
  { pattern: 'path.resolve', reason: 'resolves a path outside the helper' },
  { pattern: 'path.join', reason: 'builds a path outside the helper' },
  {
    pattern: 'path[',
    reason: 'computed access can spell `path["resolve"]`'
  }
]

// A default import is the only shape that keeps the bans above complete — a
// named or namespace import hands out `resolve`/`join` under a name no
// substring can predict.
const PATH_IMPORT = /^import\s+(.+?)\s+from\s+['"](?:node:)?path['"]/gm

// The containment idiom the helper replaced, in the one spelling a text scan
// can identify without guessing: the resolve written inline inside the
// comparison. It is missing the separator boundary, so a sibling directory
// whose name the root prefixes passes it — root `/srv/uploads` accepts
// `/srv/uploads-backup/x`. This form guarded an `fs.unlink` in
// `scripts/maintenance/cleanupMediaStorage.ts` until this rule landed.
//
// KNOWN RESIDUAL: pulling the resolved root into a variable first
// (`const root = path.resolve(base); … startsWith(root)`) carries the identical
// bug and is NOT caught. Deciding that needs to know which declaration a name
// refers to, which is the AST rule's job, not this one's.
const INLINE_CONTAINMENT = /\.startsWith\(\s*path\.(?:resolve|join)\(/g

const lineOf = (source: string, index: number) =>
  source.slice(0, index).split('\n').length

const collectSourceFiles = (directory: string): string[] =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return collectSourceFiles(entryPath)
    if (!/\.tsx?$/.test(entry.name)) return []
    if (/\.test\.tsx?$/.test(entry.name)) return []
    return [entryPath]
  })

const readDriver = (relative: string) => {
  const source = fs.readFileSync(path.join(process.cwd(), relative), 'utf8')
  // Guard against a moved or renamed driver making these vacuous.
  expect(source).toMatch(/(?:resolve|assert)StorageFilePath/)
  return source
}

describe('storage path call sites', () => {
  it('imports path only as a default binding in the local storage drivers', () => {
    const offenders = DRIVER_FILES.flatMap((relative) => {
      const source = readDriver(relative)
      return [...source.matchAll(PATH_IMPORT)]
        .filter(([, binding]) => !/^[A-Za-z_$][\w$]*$/.test(binding.trim()))
        .map(
          (match) =>
            `${relative}:${lineOf(source, match.index)} — ${match[0].trim()} hands out resolve/join under a name the bans below cannot see`
        )
    })

    expect(offenders).toEqual([])
  })

  it('builds no path in a local storage driver outside the shared helper', () => {
    const offenders = DRIVER_FILES.flatMap((relative) => {
      const source = readDriver(relative)
      return BANNED_IN_DRIVERS.flatMap(({ pattern, reason }) => {
        const occurrences: number[] = []
        for (
          let at = source.indexOf(pattern);
          at !== -1;
          at = source.indexOf(pattern, at + 1)
        ) {
          occurrences.push(at)
        }
        return occurrences.map(
          (at) =>
            `${relative}:${lineOf(source, at)} — ${pattern} ${reason}; use resolveStorageFilePath/assertStorageFilePath`
        )
      })
    })

    expect(offenders).toEqual([])
  })

  it('compares no inline-resolved path against a storage root with startsWith', () => {
    const files = SOURCE_ROOTS.flatMap((root) =>
      collectSourceFiles(path.join(process.cwd(), root))
    )
    // Guard against the walker silently finding nothing and passing vacuously.
    expect(files.length).toBeGreaterThan(100)

    const offenders = files.flatMap((file) => {
      const source = fs.readFileSync(file, 'utf8')
      const relative = path.relative(process.cwd(), file)
      return [...source.matchAll(INLINE_CONTAINMENT)].map(
        (match) =>
          `${relative}:${lineOf(source, match.index)} — ${match[0].trim()} accepts a sibling directory the root's name prefixes`
      )
    })

    expect(offenders).toEqual([])
  })
})
