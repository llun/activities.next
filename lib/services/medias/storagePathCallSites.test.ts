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
// Two shapes are forbidden.
//
// 1. `path.resolve` or `path.join` anywhere in a local storage driver. Neither
//    driver needs either one — every path they build comes from the helper, and
//    the only `path` calls they make are `extname`/`dirname`, which read a path
//    rather than build one. Banning the constructors outright is deliberate:
//    the first version of this test tracked `this._config.path` and its
//    aliases, and three ordinary refactors walked straight through it — a
//    destructured rename, a nested call in the argument list, and, worst,
//    prettier wrapping the call across lines. `prettier --write` is step 1 of
//    the commit gate, so that last one meant a formatting pass could disarm the
//    guard. A driver that genuinely needs to build a path outside a storage
//    root should fail this test and have the exemption discussed, not slip past
//    a cleverer pattern.
// 2. Comparing a resolved path against a storage root with `startsWith`,
//    anywhere. That form is missing the separator boundary, so a sibling
//    directory whose name the root prefixes passes it — root `/srv/uploads`
//    accepts `/srv/uploads-backup/x`. It guarded an `fs.unlink` in
//    `scripts/maintenance/cleanupMediaStorage.ts` until this rule landed, and it
//    reads as correct at a glance, which is why it needs a test rather than a
//    reviewer. Both the inline spelling and the extract-a-variable spelling are
//    caught, and the whole file is scanned as one string so a wrapped call
//    cannot hide in the gap between two lines.
const DRIVER_FILES = [
  'lib/services/medias/localFile.ts',
  'lib/services/fitness-files/localFile.ts'
]

const SOURCE_ROOTS = ['app', 'lib', 'scripts']

const PATH_BUILDERS = ['path.resolve(', 'path.join(']

// `const storageRoot = path.resolve(basePath)` — the variable an extracted
// containment check compares against.
const RESOLVED_PATH_BINDING =
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*path\.(?:resolve|join)\(/g

const INLINE_CONTAINMENT = /\.startsWith\(\s*path\.(?:resolve|join)\(/g

// Complete escaping, not just the metacharacters that happen to show up: a
// captured identifier can contain `$`, and a partial escape in the code that
// builds this guard is the same class of not-quite-right as the bug it guards.
const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

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

describe('storage path call sites', () => {
  it('builds no path in a local storage driver outside the shared helper', () => {
    const offenders = DRIVER_FILES.flatMap((relative) => {
      const source = fs.readFileSync(path.join(process.cwd(), relative), 'utf8')
      // Guard against a moved or renamed driver making this vacuous.
      expect(source).toMatch(/(?:resolve|assert)StorageFilePath/)

      return PATH_BUILDERS.flatMap((builder) => {
        const occurrences = [
          ...source.matchAll(new RegExp(escapeRegExp(builder), 'g'))
        ]
        return occurrences.map(
          (match) =>
            `${relative}:${lineOf(source, match.index)} — ${builder}…) should be resolveStorageFilePath/assertStorageFilePath`
        )
      })
    })

    expect(offenders).toEqual([])
  })

  it('compares no resolved path against a storage root without a separator boundary', () => {
    const files = SOURCE_ROOTS.flatMap((root) =>
      collectSourceFiles(path.join(process.cwd(), root))
    )
    // Guard against the walker silently finding nothing and passing vacuously.
    expect(files.length).toBeGreaterThan(100)

    const offenders = files.flatMap((file) => {
      const source = fs.readFileSync(file, 'utf8')
      const relative = path.relative(process.cwd(), file)

      const inline = [...source.matchAll(INLINE_CONTAINMENT)].map(
        (match) =>
          `${relative}:${lineOf(source, match.index)} — ${match[0].trim()} accepts a sibling directory the root's name prefixes`
      )

      // The same bug one refactor away: pull the resolved root into a variable
      // and the inline pattern above never sees it.
      const extracted = [...source.matchAll(RESOLVED_PATH_BINDING)].flatMap(
        ([, binding]) => {
          const comparison = new RegExp(
            `\\.startsWith\\(\\s*${escapeRegExp(binding)}\\s*[,)]`,
            'g'
          )
          return [...source.matchAll(comparison)].map(
            (match) =>
              `${relative}:${lineOf(source, match.index)} — .startsWith(${binding}) compares against a resolved root with no separator boundary`
          )
        }
      )

      return [...inline, ...extracted]
    })

    expect(offenders).toEqual([])
  })
})
