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
// the bound is the whole design. Every earlier version of it was wrong in one
// direction or the other, and each rewrite that reached for more cleverness
// sprang a new leak: alias tracking was defeated by a destructured rename, by a
// nested call in the argument list and by prettier wrapping the call across
// lines (which made `prettier --write`, step 1 of the commit gate, able to
// disarm the guard); a substring ban was defeated by `path['resolve']` and by a
// renamed named import; an extracted-variable heuristic matched a bare
// identifier with no scope awareness and failed on an unrelated
// `const resolvedArchivePath = 'database.'` in `scripts/backup/productionArchive.ts`;
// and a regex over the import line matched NOTHING when the import was wrapped,
// passing vacuously. A false positive is worse than a gap, because the fix is
// to weaken the guard — and a gap sold as completeness is worse than both.
//
// So this version does not chase the general case. It pins the ONE import shape
// the drivers use, which makes the member-access bans below exhaustive for
// them, and it scans with comments removed so documenting the rule in a driver
// cannot trip it. What it does NOT do is follow an identifier to its
// declaration; that is the residual, it is named here and in AGENTS.md, and its
// home is an AST rule in `lint/agentsRules.mjs` (`no-component-fetch` is the
// precedent), where formatting and aliasing are invisible by construction.

const DRIVER_FILES = [
  'lib/services/medias/localFile.ts',
  'lib/services/fitness-files/localFile.ts'
]

const SOURCE_ROOTS = ['app', 'lib', 'scripts']

// With the import pinned below to exactly `import path from 'path'`, member
// access is the only route to these functions, so banning it is exhaustive for
// these two files. Computed access is banned because `path['resolve'](…)` is
// otherwise a plain substring away.
const BANNED_IN_DRIVERS = [
  { pattern: 'path.resolve', reason: 'resolves a path outside the helper' },
  { pattern: 'path.join', reason: 'builds a path outside the helper' },
  { pattern: 'path[', reason: 'computed access can spell `path["resolve"]`' }
]

// Pinning the import EXACTLY, rather than matching its shape, is deliberate: a
// regex over the import line answered "no offenders" for a wrapped import, so
// the assertion passed while the file called a bare `resolve(…)`. Counting
// every reference to the module instead has no such blind spot — a second
// import, a `require('path')`, a dynamic `import('path')` or a replacement of
// the default import all move the count off one or drop the exact line.
const ALLOWED_PATH_IMPORT = "import path from 'path'"
const PATH_MODULE_REFERENCE = /['"](?:node:)?path['"]/g

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

// Comments are stripped before scanning so that documenting this very rule in a
// driver does not fail it — the landmine a reviewer walked onto by writing
// "do not use path.resolve here" in a comment. Replaced with spaces rather than
// removed so reported line numbers stay true. It does not parse strings, which
// is a knowing simplification: a string literal holding `path.resolve` would be
// a false positive, and no file has one.
const stripComments = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (line) => ' '.repeat(line.length))

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
  it('reaches the path module only through one default import in the drivers', () => {
    const offenders = DRIVER_FILES.flatMap((relative) => {
      const source = readDriver(relative)
      const references = [...source.matchAll(PATH_MODULE_REFERENCE)]
      if (source.includes(ALLOWED_PATH_IMPORT) && references.length === 1) {
        return []
      }
      return [
        `${relative} — must reach the path module through exactly one \`${ALLOWED_PATH_IMPORT}\`, found ${references.length} reference(s); a named, namespace, wrapped or dynamic import hands out resolve/join under a name the bans cannot see`
      ]
    })

    expect(offenders).toEqual([])
  })

  it('builds no path in a local storage driver outside the shared helper', () => {
    const offenders = DRIVER_FILES.flatMap((relative) => {
      const source = stripComments(readDriver(relative))
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
      const source = stripComments(fs.readFileSync(file, 'utf8'))
      const relative = path.relative(process.cwd(), file)
      return [...source.matchAll(INLINE_CONTAINMENT)].map(
        (match) =>
          `${relative}:${lineOf(source, match.index)} — ${match[0].trim()} accepts a sibling directory the root's name prefixes`
      )
    })

    expect(offenders).toEqual([])
  })
})
