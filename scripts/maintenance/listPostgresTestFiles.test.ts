import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { selectPostgresTestFiles } from './listPostgresTestFiles'

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))

// Today's hand-written PostgreSQL list from the `test-pg` job in
// .github/workflows/ci.yml, copied verbatim (one path per line, quotes
// stripped). The workflow list is replaced by the generated one in a later
// step, so the assertion runs against this snapshot instead of ci.yml.
const LEGACY_LIST_PATH =
  'scripts/maintenance/__fixtures__/legacyPostgresTestFiles.txt'

const readLegacyList = () =>
  fs
    .readFileSync(path.join(REPO_ROOT, LEGACY_LIST_PATH), 'utf-8')
    .split('\n')
    .filter((line) => line !== '')

const gitTestFiles = () =>
  execFileSync('git', ['ls-files', '*.test.ts', '*.test.tsx'], {
    cwd: REPO_ROOT,
    encoding: 'utf-8'
  })
    .split('\n')
    .filter((file) => file !== '')

const writeFixture = (files: Record<string, string>): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-test-files-'))
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(root, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
  }
  return root
}

// Stand-ins for the two helper modules the selection keys on, at the paths the
// selection hard-codes, so the fixtures can exercise the real classification.
const CREATE_TEST_DATABASE_STUB = `export const createTestDatabase = (
  options?: { backend?: string }
) => ({ backend: options?.backend ?? 'pg' })
export const getTestDatabaseConfig = (backend: string) => ({ backend })
`

const TEST_UTILS_STUB = `import { createTestDatabase } from './testing/createTestDatabase'

export const getTestDatabaseTable = () => {
  const { backend, database, prepare } = createTestDatabase()
  return [[backend, database, prepare]]
}

export const getTestDatabaseWithInstance = () => createTestDatabase()

export const getTestSQLDatabaseWithInstance = () =>
  createTestDatabase({ backend: 'sqlite' })

export const getTestSQLDatabase = () =>
  getTestSQLDatabaseWithInstance().database
`

describe('selectPostgresTestFiles', () => {
  describe('unit', () => {
    it('selects a test file that imports a PG-capable helper directly', () => {
      const root = writeFixture({
        'lib/database/testing/createTestDatabase.ts': CREATE_TEST_DATABASE_STUB,
        'direct.test.ts': `import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'

const testDatabase = createTestDatabase()
export default testDatabase
`
      })
      const { postgres, sqliteOnly } = selectPostgresTestFiles({
        root,
        testFiles: ['direct.test.ts']
      })
      expect(postgres).toEqual(['direct.test.ts'])
      expect(sqliteOnly).toEqual([])
    })

    it('selects a test file that reaches a helper through a transitive non-test chain', () => {
      const root = writeFixture({
        'lib/database/testUtils.ts': TEST_UTILS_STUB,
        'lib/database/testing/createTestDatabase.ts': CREATE_TEST_DATABASE_STUB,
        'fixture.ts': `export { getTestDatabaseWithInstance } from './deeper'
`,
        'deeper.ts': `import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'

export { getTestDatabaseWithInstance }
`,
        'transitive.test.ts': `import { getTestDatabaseWithInstance } from './fixture'

const { database } = getTestDatabaseWithInstance()
export default database
`
      })
      const { postgres, sqliteOnly } = selectPostgresTestFiles({
        root,
        testFiles: ['transitive.test.ts']
      })
      expect(postgres).toEqual(['transitive.test.ts'])
      expect(sqliteOnly).toEqual([])
    })

    it('excludes a test file that only reaches SQLite-only helpers, directly and transitively', () => {
      const root = writeFixture({
        'lib/database/testUtils.ts': TEST_UTILS_STUB,
        'lib/database/testing/createTestDatabase.ts': CREATE_TEST_DATABASE_STUB,
        'sqliteFixture.ts': `import { getTestSQLDatabaseWithInstance } from '@/lib/database/testUtils'

export const database = getTestSQLDatabaseWithInstance().database
`,
        'direct.test.ts': `import { getTestSQLDatabase } from '@/lib/database/testUtils'

const database = getTestSQLDatabase()
export default database
`,
        'transitive.test.ts': `import { database } from './sqliteFixture'

export default database
`
      })
      const { postgres, sqliteOnly } = selectPostgresTestFiles({
        root,
        testFiles: ['direct.test.ts', 'transitive.test.ts']
      })
      expect(postgres).toEqual([])
      expect(sqliteOnly).toEqual(['direct.test.ts', 'transitive.test.ts'])
    })

    it('selects a file that mixes SQLite-only and PG-capable helpers', () => {
      const root = writeFixture({
        'lib/database/testUtils.ts': TEST_UTILS_STUB,
        'lib/database/testing/createTestDatabase.ts': CREATE_TEST_DATABASE_STUB,
        'mixed.test.ts': `import {
  getTestDatabaseWithInstance,
  getTestSQLDatabase
} from '@/lib/database/testUtils'

const sqliteDatabase = getTestSQLDatabase()
const database = getTestDatabaseWithInstance().database
export default { sqliteDatabase, database }
`
      })
      const { postgres, sqliteOnly } = selectPostgresTestFiles({
        root,
        testFiles: ['mixed.test.ts']
      })
      expect(postgres).toEqual(['mixed.test.ts'])
      expect(sqliteOnly).toEqual([])
    })

    it('excludes a file whose every createTestDatabase call forces SQLite, but selects one with a single env-driven call', () => {
      const root = writeFixture({
        'lib/database/testing/createTestDatabase.ts': CREATE_TEST_DATABASE_STUB,
        'forced.test.ts': `import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'

const first = createTestDatabase({
  backend: 'sqlite'
})
const second = createTestDatabase({ backend: 'sqlite' })
export default [first, second]
`,
        'mixedCalls.test.ts': `import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'

const forced = createTestDatabase({ backend: 'sqlite' })
const envDriven = createTestDatabase()
export default [forced, envDriven]
`
      })
      const { postgres, sqliteOnly } = selectPostgresTestFiles({
        root,
        testFiles: ['forced.test.ts', 'mixedCalls.test.ts']
      })
      expect(postgres).toEqual(['mixedCalls.test.ts'])
      expect(sqliteOnly).toEqual(['forced.test.ts'])
    })

    it('leaves files that never reach a database helper out of both groups', () => {
      const root = writeFixture({
        'plainHelper.ts': `export const one = 1
`,
        'plain.test.ts': `import { one } from './plainHelper'

export default one
`
      })
      const { postgres, sqliteOnly } = selectPostgresTestFiles({
        root,
        testFiles: ['plain.test.ts']
      })
      expect(postgres).toEqual([])
      expect(sqliteOnly).toEqual([])
    })
  })

  describe('repository', () => {
    const { postgres } = selectPostgresTestFiles({
      root: REPO_ROOT,
      testFiles: gitTestFiles()
    })
    const postgresSet = new Set(postgres)
    const legacyList = readLegacyList()

    // No exceptions to carve out: the candidates once named for exclusion use
    // `getTestDatabaseWithInstance` or env-driven `createTestDatabase()`, so
    // every hand-listed file is selected as-is.
    it('selects a superset of the hand-written PostgreSQL list', () => {
      const missing = legacyList.filter((file) => !postgresSet.has(file))
      expect(missing).toEqual([])
    })

    it('selects the database script suite, which has a real PostgreSQL case', () => {
      expect(postgresSet.has('lib/database/scriptDatabase.test.ts')).toBe(true)
    })

    it('returns sorted, repo-root-relative paths', () => {
      const sorted = [...postgres].sort()
      expect(postgres).toEqual(sorted)
      expect(
        postgres.every(
          (file) => !file.startsWith('/') && /\.test\.tsx?$/.test(file)
        )
      ).toBe(true)
    })
  })
})
