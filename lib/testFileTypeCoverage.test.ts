import { execFileSync } from 'node:child_process'
import path from 'node:path'

// Every test file Vitest runs must also be visible to `yarn typecheck` — either
// inside tsconfig.typecheck.json's program, or explicitly listed in its ratchet.
//
// A file can fall out of the program silently. TypeScript resolves a wildcard
// `include` by preferring one extension per basename, so when `foo.test.ts` and
// `foo.test.tsx` sit side by side the `.tsx` is dropped from the program
// entirely — while Vitest, which globs `**/*.test.{ts,tsx}`, still runs it. The
// result is a live test file that no compiler ever reads: a blatant type error
// in it passes `yarn typecheck`, `yarn build` and `yarn test` alike. That is
// exactly what happened to `lib/utils/text/cleanClassName.test.tsx` (15 tests,
// checked by nothing) until it was renamed to `cleanClassName.dom.test.tsx`.
//
// Checking basenames rather than shelling out to `tsc --listFiles` keeps this
// test fast; the collision is the only way a test file goes missing without
// someone editing an `exclude` list on purpose.
// Every tracked test file, repo-root-relative. Reads the git INDEX, so an
// untracked colliding pair passes locally until it is staged — CI always sees a
// full checkout, so that only delays local feedback.
const trackedTestFiles = () =>
  execFileSync('git', ['ls-files', '*.test.ts', '*.test.tsx'], {
    encoding: 'utf-8'
  })
    .split('\n')
    .filter(Boolean)

describe('test file type coverage', () => {
  it('never lets a .ts and .tsx test file share a basename', () => {
    const byBasename = new Map<string, string[]>()
    for (const file of trackedTestFiles()) {
      const key = file.replace(/\.tsx?$/, '')
      byBasename.set(key, [...(byBasename.get(key) ?? []), file])
    }

    const collisions = [...byBasename.values()]
      .filter((files) => files.length > 1)
      .map((files) => files.sort().join(' + '))

    // Rename one of them — the repo's convention for a second test file over
    // the same module is a qualifier, e.g. `cleanClassName.dom.test.tsx`.
    expect(collisions).toEqual([])
  })

  it('places every test file under a directory the typecheck config reaches', () => {
    // tsconfig.typecheck.json inherits tsconfig.json's `include`
    // (`**/*.ts`, `**/*.tsx`) and only narrows it through `exclude`. A test
    // file outside the repo root — or under one of the base excludes — would
    // never be type-checked, so assert every one lives at a normal path.
    const unreachable = trackedTestFiles().filter(
      (file) =>
        path.isAbsolute(file) ||
        file.startsWith('..') ||
        file.startsWith('node_modules/') ||
        file.startsWith('vitest-shims/')
    )

    expect(unreachable).toEqual([])
  })
})
