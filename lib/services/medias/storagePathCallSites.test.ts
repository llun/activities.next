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
// WHAT THIS CATCHES: the obvious spelling of that mistake, written plainly.
// Nothing subtler. It does NOT catch `const { resolve } = path`, `path?.resolve`,
// a renamed import, or a helper module that resolves on a driver's behalf, and
// it makes no claim to. Every one of those needs to know what a name refers to,
// which is scope resolution — an AST rule in `lint/agentsRules.mjs`
// (`no-component-fetch` is the precedent) is the right home for it, and is a
// filed follow-up. Until then a reviewer is the enforcement for those shapes.
//
// The narrowness is the lesson, not modesty. Five review rounds each broke a
// cleverer version of this file, in both directions: alias tracking fell to a
// destructured rename, to a nested call, and to prettier wrapping a call across
// lines; a substring ban fell to `path['resolve']`; an extracted-variable
// heuristic failed on an unrelated `const resolvedArchivePath = 'database.'` in
// `scripts/backup/productionArchive.ts`; a regex over the import line matched
// NOTHING on a wrapped import and passed vacuously; and a comment-stripping
// pass read the `/*` inside the MIME string `'*/*'` as opening a comment,
// blanking two thousand characters of `lib/services/link-previews/` so the scan
// silently stopped covering them.
//
// So both assertions below read RAW source with a plain substring or a fixed
// regex. There is no interpolation to escape, no stripping pass to corrupt, and
// no way for either to pass VACUOUSLY — the failure mode that made the earlier
// versions worse than nothing. A comment that names one of these patterns will
// fail the test; reword the comment. That is loud, and loud beats silent.

const DRIVER_FILES = [
  'lib/services/medias/localFile.ts',
  'lib/services/fitness-files/localFile.ts'
]

const SOURCE_ROOTS = ['app', 'lib', 'scripts']

// Neither driver needs either one: their only `path` calls are `extname` and
// `dirname`, which read a path rather than build one.
const BANNED_IN_DRIVERS = ['path.resolve', 'path.join']

// The containment idiom the helper replaced. It is missing the separator
// boundary, so a sibling directory whose name the root prefixes passes it —
// root `/srv/uploads` accepts `/srv/uploads-backup/x`. This guarded an
// `fs.unlink` in `scripts/maintenance/cleanupMediaStorage.ts` until this rule
// landed, and it reads as correct at a glance.
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

describe('storage path call sites', () => {
  it('names no path builder in a local storage driver', () => {
    const offenders = DRIVER_FILES.flatMap((relative) => {
      const source = fs.readFileSync(path.join(process.cwd(), relative), 'utf8')
      // Guard against a moved or renamed driver making this vacuous.
      expect(source).toMatch(/(?:resolve|assert)StorageFilePath/)

      return BANNED_IN_DRIVERS.flatMap((pattern) => {
        const found: string[] = []
        for (
          let at = source.indexOf(pattern);
          at !== -1;
          at = source.indexOf(pattern, at + 1)
        ) {
          found.push(
            `${relative}:${lineOf(source, at)} — ${pattern} should be resolveStorageFilePath/assertStorageFilePath`
          )
        }
        return found
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
