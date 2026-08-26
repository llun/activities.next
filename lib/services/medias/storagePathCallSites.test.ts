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
// 1. In the local storage drivers, building a filesystem path out of the
//    configured storage root by hand — `path.resolve(this._config.path, x)` —
//    instead of going through the helper. The alias spelling counts too: both
//    write paths bind `const uploadPath = this._config.path` first, so the rule
//    follows any local name assigned from the config path.
// 2. Anywhere, the containment idiom the helper replaced:
//    `fullPath.startsWith(path.resolve(root))`. It is missing the separator
//    boundary, so a sibling directory whose name the root prefixes passes it —
//    root `/srv/uploads` accepts `/srv/uploads-backup/x`. That form guarded an
//    `fs.unlink` in `scripts/maintenance/cleanupMediaStorage.ts` until this rule
//    landed, and it reads as correct at a glance, which is why it needs a test
//    rather than a reviewer.
const STORAGE_ROOT_EXPRESSION = 'this._config.path'

const DRIVER_FILES = [
  'lib/services/medias/localFile.ts',
  'lib/services/fitness-files/localFile.ts'
]

const SOURCE_ROOTS = ['app', 'lib', 'scripts']

// `const uploadPath = this._config.path` — the alias a hand-rolled resolve
// would most naturally reach for.
const ALIAS_ASSIGNMENT = new RegExp(
  `(?:const|let)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*${STORAGE_ROOT_EXPRESSION.replace(/\./g, '\\.')}\\b`,
  'g'
)

const UNGUARDED_CONTAINMENT = /\.startsWith\(\s*path\.(?:resolve|join)\(/g

const collectSourceFiles = (directory: string): string[] =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return collectSourceFiles(entryPath)
    if (!/\.tsx?$/.test(entry.name)) return []
    if (/\.test\.tsx?$/.test(entry.name)) return []
    return [entryPath]
  })

describe('storage path call sites', () => {
  it('builds no driver path from the storage root without the shared helper', () => {
    const offenders = DRIVER_FILES.flatMap((relative) => {
      const source = fs.readFileSync(path.join(process.cwd(), relative), 'utf8')
      // Guard against a moved or renamed driver making this vacuous.
      expect(source).toContain(STORAGE_ROOT_EXPRESSION)

      const rootNames = [
        STORAGE_ROOT_EXPRESSION,
        ...[...source.matchAll(ALIAS_ASSIGNMENT)].map(([, alias]) => alias)
      ]
      const handRolled = new RegExp(
        `path\\.(?:resolve|join)\\([^)]*(?:${rootNames
          .map((name) => name.replace(/[.$]/g, '\\$&'))
          .join('|')})`,
        'g'
      )

      return source
        .split('\n')
        .flatMap((line, index) =>
          [...line.matchAll(handRolled)].map(
            ([match]) =>
              `${relative}:${index + 1} — ${match.trim()}… should go through resolveStorageFilePath/assertStorageFilePath`
          )
        )
    })

    expect(offenders).toEqual([])
  })

  it('compares no resolved path against a storage root without a separator boundary', () => {
    const files = SOURCE_ROOTS.flatMap((root) =>
      collectSourceFiles(path.join(process.cwd(), root))
    )
    // Guard against the walker silently finding nothing and passing vacuously.
    expect(files.length).toBeGreaterThan(100)

    const offenders = files.flatMap((file) =>
      fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, index) =>
          [...line.matchAll(UNGUARDED_CONTAINMENT)].map(([match]) => {
            const relative = path.relative(process.cwd(), file)
            return `${relative}:${index + 1} — ${match.trim()} accepts a sibling directory the root's name prefixes`
          })
        )
    )

    expect(offenders).toEqual([])
  })
})
