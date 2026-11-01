// @vitest-size medium
// The source strings below name forbidden modules (child_process, …), so the
// docblock stops the inference from filing this test file as large; it reads
// the repository's test files, which the medium guard permits.
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import config from '../vitest.config'
import { inferTestSize } from './setup/testSizes'

describe('inferTestSize', () => {
  it('returns small for a file with no medium or large signal', () => {
    expect(
      inferTestSize(`
        import { expect, it } from 'vitest'
        it('adds', () => {
          expect(1 + 1).toBe(2)
        })
      `)
    ).toBe('small')
  })

  it.each(['small', 'medium', 'large'])(
    'lets a @vitest-size %s docblock win over any heuristic',
    (size) => {
      const source = `
        /**
         * @vitest-size ${size}
         */
        import { execSync } from 'node:child_process'
        it('runs', () => {})
      `
      expect(inferTestSize(source)).toBe(size)
    }
  )

  it.each([
    ['importing child_process', `import { exec } from 'node:child_process'`],
    [
      'importing the un-prefixed child_process',
      `import { exec } from 'child_process'`
    ],
    ['starting a server with listen', `server.listen(3000)`],
    ['creating a server', `import { createServer } from 'node:http'`],
    ['using docker', `execSync('docker compose up -d')`]
  ])('marks %s as large', (_name, source) => {
    expect(inferTestSize(source)).toBe('large')
  })

  it.each([
    [
      'createTestDatabase',
      `import { createTestDatabase } from '@/lib/database/testUtils'`
    ],
    [
      'getTestDatabase variants',
      `import { getTestDatabaseHandle } from '@/lib/database/testUtils'`
    ],
    [
      'getTestSQLDatabase variants',
      `import { getTestSQLDatabasePool } from './helpers'`
    ],
    ['databaseBeforeAll', `databaseBeforeAll(async () => {})`],
    ['better-sqlite3', `import Database from 'better-sqlite3'`],
    ['seedDatabase', `import { seedDatabase } from '@/lib/database/testUtils'`],
    ['testUtils', `import { testUtils } from '@/test/next.config.testUtils'`],
    ['mkdtemp', `const dir = await mkdtemp(join(tmpdir(), 'x'))`],
    ['writeFile', `await writeFile(path, body)`],
    ['readFileSync', `const raw = readFileSync(file, 'utf8')`],
    ['readdirSync', `const names = readdirSync(dir)`],
    ['globSync', `const files = globSync('**/*.json')`],
    ['readFile call', `const text = await readFile(file, 'utf8')`],
    ['waitFor', `await waitFor(() => expect(el).toBeVisible())`],
    ['findBy', `await screen.findByText('loaded')`],
    ['findAllBy', `await screen.findAllByRole('listitem')`],
    [
      'a literal setTimeout of 100ms or more',
      `await new Promise(r => setTimeout(r, 250))`
    ]
  ])('marks %s as medium', (_name, source) => {
    expect(inferTestSize(source)).toBe('medium')
  })

  it('does not match readFile as a prefix of readFileSync twice or miss readFile( in names', () => {
    expect(inferTestSize(`const x = readFileLater()`)).toBe('small')
  })

  it('ignores markers in comments', () => {
    expect(
      inferTestSize(`
        // someone mentioned child_process and mkdtemp here
        /* createServer is also referenced in this note */
        it('adds', () => expect(1).toBe(1))
      `)
    ).toBe('small')
  })

  it('does not treat a size marker inside a string literal as a declaration', () => {
    expect(inferTestSize(`const marker = '@vitest-size large'`)).toBe('small')
  })

  it('does not treat a size marker in a comment after the code started as a declaration', () => {
    expect(
      inferTestSize(`
        it('adds', () => expect(1).toBe(1))
        // @vitest-size large
      `)
    ).toBe('small')
  })

  it('does not treat a short setTimeout as a real wait', () => {
    expect(inferTestSize(`setTimeout(fn, 99)`)).toBe('small')
  })
})

// Regression guard for vitest.config.ts's file scan: every *.test.{ts,tsx}
// file on disk must be listed in a project's include, or it silently never
// runs (the .github/workflows guard tests were lost that way once). Walks the
// tree with the same skips the config's scan uses — node_modules, coverage,
// and every dot directory except .github — so the two can never drift apart
// on what exists. child_process (git ls-files) is blocked in medium tests,
// hence the walk.
describe('every test file on disk is in a vitest project', () => {
  // Kept in both small projects on purpose (the UTC pin must be checked on a
  // worker thread and in a forked process), so it is the one file allowed to
  // appear twice. Must match TIME_ZONE_PIN_GUARD in vitest.config.ts.
  const IN_TWO_PROJECTS = 'test/vitest.config.test.ts'

  const walkTestFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      if (
        entry.name === 'node_modules' ||
        entry.name === 'coverage' ||
        (entry.name.startsWith('.') && entry.name !== '.github')
      ) {
        return []
      }
      const resolved = path.join(dir, entry.name)
      if (entry.isDirectory()) return walkTestFiles(resolved)
      return /\.test\.tsx?$/.test(entry.name)
        ? [path.relative(process.cwd(), resolved)]
        : []
    })

  it('lists each test file in exactly one project, the UTC pin guard in two', () => {
    // This config only uses inline project objects, so the cast is exact.
    type InlineProject = { test?: { include?: string[] } }
    const includes = ((config.test?.projects ?? []) as InlineProject[]).flatMap(
      (project) => project.test?.include ?? []
    )
    const unlisted: string[] = []
    const overListed: string[] = []
    for (const file of walkTestFiles(process.cwd())) {
      const projectCount = includes.filter((include) => include === file).length
      const expected = file === IN_TWO_PROJECTS ? 2 : 1
      if (projectCount < expected) unlisted.push(file)
      if (projectCount > expected) overListed.push(file)
    }

    expect(unlisted, 'test files on disk that no project runs').toEqual([])
    expect(overListed, 'test files listed in too many projects').toEqual([])
  })
})
