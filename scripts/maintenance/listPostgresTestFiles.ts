#!/usr/bin/env -S node scripts/run.cjs
// Lists every git-tracked `*.test.ts(x)` file whose import graph reaches a
// PostgreSQL-capable database test helper, so CI's PostgreSQL job can run the
// generated list instead of a hand-written one.
//
// A test file reaches PostgreSQL when it — or any non-test module it imports,
// transitively through `@/` and relative imports — calls one of the helpers
// that honour `TEST_DATABASE_TYPE`:
//
//   createTestDatabase / getTestDatabaseConfig
//     (lib/database/testing/createTestDatabase.ts)
//   getTestDatabaseTable / getTestDatabaseWithInstance / databaseBeforeAll
//     (lib/database/testUtils.ts)
//
// A file that only reaches the SQLite-only helpers (`getTestSQLDatabase`,
// `getTestSQLDatabaseWithInstance`, or `createTestDatabase` called with an
// explicit `backend: 'sqlite'` in every call) never opens a PostgreSQL
// connection and is left out. A `getTestDatabaseConfig('sqlite')` call is not
// detected: only `createTestDatabase` is matched for an explicit
// `backend: 'sqlite'`, so a file calling `getTestDatabaseConfig('sqlite')` is
// kept in the PostgreSQL list — a safe over-inclusion, since the run must not
// drop a suite that in fact opens a PostgreSQL connection. The selection
// reports both groups so the test suite can pin the SQLite-only ones down as
// explicit exceptions.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import {
  MODULE_EXTENSIONS,
  collectImportEntries
} from '@/lib/testing/moduleImports'

// Modules that exist to hand out PostgreSQL-capable test databases.
const PG_TEST_HELPER_MODULES = [
  'lib/database/testing/createTestDatabase.ts',
  'lib/database/testing/postgres.ts'
]

// The shared test-utils module whose exports are split: most honour
// `TEST_DATABASE_TYPE`, the `getTestSQLDatabase*` pair forces SQLite.
const TEST_UTILS_MODULE = 'lib/database/testUtils.ts'

// Exports of `testUtils.ts` that honour `TEST_DATABASE_TYPE`.
const PG_TEST_HELPER_NAMES = new Set([
  'databaseBeforeAll',
  'getTestDatabaseTable',
  'getTestDatabaseWithInstance',
  'getTestPgConnection',
  'getTestPgPort'
])

// Exports of `testUtils.ts` that force SQLite regardless of the environment.
const SQLITE_ONLY_TEST_HELPER_NAMES = new Set([
  'getTestSQLDatabase',
  'getTestSQLDatabaseWithInstance'
])

const isTestFile = (file: string) => /\.test\.tsx?$/.test(file)

const toPosix = (file: string) => file.split(path.sep).join('/')

export type SelectPostgresTestFilesOptions = {
  /** Repository root the test file paths are relative to. */
  root: string
  /** Git-tracked test files, repo-root-relative, as `git ls-files` reports them. */
  testFiles: string[]
}

export type PostgresTestFileSelection = {
  /** Test files that reach a PostgreSQL-capable helper, sorted. */
  postgres: string[]
  /**
   * Test files that reach the database test helpers only through SQLite-only
   * calls, sorted. Disjoint from `postgres`.
   */
  sqliteOnly: string[]
}

// Resolves an `@/...` or relative specifier to the file it points at, or null
// for bare package specifiers and unresolvable paths. Same extension rules as
// `resolveImport` in `lib/testing/moduleImports.ts`, with an injectable root
// so the selection can run against a temporary fixture tree.
const resolveSpecifier = (
  specifier: string,
  fromFile: string,
  root: string
): string | null => {
  let base: string
  if (specifier.startsWith('@/')) {
    base = path.join(root, specifier.slice(2))
  } else if (specifier.startsWith('.')) {
    base = path.resolve(path.dirname(fromFile), specifier)
  } else {
    return null
  }
  for (const extension of MODULE_EXTENSIONS) {
    const candidate = `${base}${extension}`
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate
    }
  }
  return null
}

// The argument text of every `callee(` call in `source`, parentheses balanced
// across lines. Used to tell a `createTestDatabase({ backend: 'sqlite' })`
// call from one that honours `TEST_DATABASE_TYPE`.
const callArguments = (source: string, callee: string): string[] => {
  const arguments_: string[] = []
  const call = `${callee}(`
  let index = source.indexOf(call)
  while (index !== -1) {
    let depth = 0
    let end = index + call.length - 1
    for (; end < source.length; end += 1) {
      const character = source[end]
      if (character === '(') depth += 1
      else if (character === ')') {
        depth -= 1
        if (depth === 0) break
      }
    }
    arguments_.push(source.slice(index + call.length, end))
    index = source.indexOf(call, end + 1)
  }
  return arguments_
}

// Whether every `callee(...)` call in `source` passes `backend: 'sqlite'`.
// A call without the option, with `backend: 'pg'`, or with a non-literal
// backend honours `TEST_DATABASE_TYPE`, so the file counts as PostgreSQL.
const onlySqliteBackendCalls = (source: string, callee: string): boolean => {
  const calls = callArguments(source, callee)
  if (calls.length === 0) return false
  return calls.every((argument) => /backend\s*:\s*'sqlite'/.test(argument))
}

type EdgeKind = 'pg' | 'sqlite-only' | 'follow'

type Edge = { kind: EdgeKind; target: string | null }

// Classifies one import edge. `pg` and `sqlite-only` edges decide; `follow`
// edges are walked further. Sink modules are terminal: their own imports
// (`testUtils.ts` pulls in `createTestDatabase`) say nothing about the
// importer, which is why the classification is per binding and per call.
const classifyEdge = (
  source: string,
  specifier: string,
  names: string[],
  fromFile: string,
  root: string
): Edge => {
  const target = resolveSpecifier(specifier, fromFile, root)
  if (!target || isTestFile(target)) return { kind: 'follow', target: null }
  const relativeTarget = toPosix(path.relative(root, target))

  if (PG_TEST_HELPER_MODULES.includes(relativeTarget)) {
    // `createTestDatabase` and `getTestDatabaseConfig` honour the environment
    // unless every call forces `backend: 'sqlite'`.
    const sqliteOnly =
      names.includes('createTestDatabase') &&
      onlySqliteBackendCalls(source, 'createTestDatabase') &&
      (names.includes('getTestDatabaseConfig')
        ? onlySqliteBackendCalls(source, 'getTestDatabaseConfig')
        : true)
    return { kind: sqliteOnly ? 'sqlite-only' : 'pg', target: null }
  }

  if (relativeTarget === TEST_UTILS_MODULE) {
    if (names.some((name) => PG_TEST_HELPER_NAMES.has(name))) {
      return { kind: 'pg', target: null }
    }
    if (
      names.length > 0 &&
      names.every((name) => SQLITE_ONLY_TEST_HELPER_NAMES.has(name))
    ) {
      return { kind: 'sqlite-only', target: null }
    }
    // An unrecognized or namespace import of the shared test utils: keep the
    // file in the PostgreSQL run rather than silently dropping a suite.
    return { kind: 'pg', target: null }
  }

  return { kind: 'follow', target }
}

const readSource = (file: string): string | null => {
  try {
    return fs.readFileSync(file, 'utf-8')
  } catch {
    return null
  }
}

// Builds the import edges of one file. Files that cannot be read (deleted
// between `git ls-files` and the walk) yield no edges.
const edgesOf = (file: string, root: string): Edge[] => {
  const source = readSource(file)
  if (source === null) return []
  return collectImportEntries(file, source).map((entry) =>
    classifyEdge(source, entry.specifier, entry.names, file, root)
  )
}

/**
 * Splits the given test files into the ones whose import graph reaches a
 * PostgreSQL-capable database helper and the ones that only reach the
 * SQLite-only helpers. Files that reach neither are left out of both.
 */
export const selectPostgresTestFiles = ({
  root,
  testFiles
}: SelectPostgresTestFilesOptions): PostgresTestFileSelection => {
  // Every non-test module reachable from the test files, with its edges.
  const adjacency = new Map<string, Edge[]>()
  const collect = (file: string) => {
    if (adjacency.has(file)) return
    adjacency.set(file, [])
    const edges = edgesOf(file, root)
    adjacency.set(file, edges)
    for (const edge of edges) {
      if (edge.kind === 'follow' && edge.target) collect(edge.target)
    }
  }
  const testFilePaths = testFiles.map((file) => path.join(root, file))
  testFilePaths.forEach(collect)

  // Fixpoint propagation: a file reaches PostgreSQL when it has a direct `pg`
  // edge or follows one into a file that does. Iterating to a fixed point
  // settles import cycles without assuming an acyclic graph.
  const reaches = (kind: EdgeKind) => {
    const reached = new Set<string>()
    for (const [file, edges] of adjacency) {
      if (edges.some((edge) => edge.kind === kind)) reached.add(file)
    }
    let changed = true
    while (changed) {
      changed = false
      for (const [file, edges] of adjacency) {
        if (reached.has(file)) continue
        if (
          edges.some(
            (edge) =>
              edge.kind === 'follow' && edge.target && reached.has(edge.target)
          )
        ) {
          reached.add(file)
          changed = true
        }
      }
    }
    return (file: string) => reached.has(file)
  }
  const reachesPg = reaches('pg')
  const reachesSqliteOnly = reaches('sqlite-only')

  const postgres: string[] = []
  const sqliteOnly: string[] = []
  for (const [index, file] of testFilePaths.entries()) {
    if (reachesPg(file)) postgres.push(testFiles[index])
    else if (reachesSqliteOnly(file)) sqliteOnly.push(testFiles[index])
  }
  return {
    postgres: postgres.sort(),
    sqliteOnly: sqliteOnly.sort()
  }
}

// The git-tracked test files of this repository, repo-root-relative.
const gitTestFiles = (root: string): string[] =>
  execFileSync('git', ['ls-files', '*.test.ts', '*.test.tsx'], {
    cwd: root,
    encoding: 'utf-8'
  })
    .split('\n')
    .filter((file) => file !== '')

export const main = () => {
  const root = process.cwd()
  const { postgres } = selectPostgresTestFiles({
    root,
    testFiles: gitTestFiles(root)
  })
  for (const file of postgres) console.log(file)
}

if (process.argv[1]?.includes('listPostgresTestFiles')) main()
