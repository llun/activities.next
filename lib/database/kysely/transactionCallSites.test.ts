import { parseSync } from '@swc/core'
import fs from 'fs'
import path from 'path'

// The guard that refuses the root instance inside a transaction
// (lib/database/kysely/guard.ts) only knows about transactions `inTransaction`
// opened. A transaction opened with `db.transaction()`, a controlled
// transaction (`db.startTransaction()`) or a held connection
// (`db.connection()`) would leave a root query inside it unguarded: a silent
// deadlock on SQLite, work outside the transaction on PostgreSQL. So
// application code opens transactions with `inTransaction` only, and those
// calls are allowed under lib/database/kysely/ and in the connection itself.
//
// Read from the AST, so comments and strings do not count. Test files are not
// scanned: tests open transactions directly on purpose.

const GUARDED_METHODS = new Set([
  'transaction',
  'startTransaction',
  'connection'
])

const SCANNED_ROOTS = ['app', 'lib', 'scripts'].map((root) =>
  path.join(process.cwd(), root)
)

const ALLOWED = new Map<string, string>([
  // inTransaction itself, and the helpers built on it.
  ['lib/database/kysely/', 'the transaction helpers'],
  // executeScript holds SQLite's only connection while a script runs.
  ['lib/database/connection.ts', 'the connection'],
  // Keeps a transaction open across a race test on purpose, outside the
  // callback the guard would cover.
  ['lib/database/testing/heldTransaction.ts', 'a test helper']
])

const collectSourceFiles = (directory: string): string[] => {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      return entry.name === 'node_modules' ? [] : collectSourceFiles(fullPath)
    }
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [fullPath]
      : []
  })
}

const walkNodes = (
  node: unknown,
  visit: (node: Record<string, unknown>) => void
): void => {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    node.forEach((child) => walkNodes(child, visit))
    return
  }
  visit(node as Record<string, unknown>)
  Object.values(node as Record<string, unknown>).forEach((child) =>
    walkNodes(child, visit)
  )
}

// SWC reports UTF-8 byte offsets on a counter that continues across every
// file parsed in the process, and a module's span starts at its first token,
// after any leading comments. So each file is parsed with a leading `;` (a
// shebang already starts the span at the first byte), which pins the span
// start to the file's first byte, and the line is counted in bytes from there.
const lineOfOffset = (source: string, offset: number, fileStart: number) =>
  Buffer.from(source, 'utf8')
    .subarray(0, Math.max(0, offset - fileStart))
    .toString('utf8')
    .split('\n').length

const findCalls = (file: string, source: string) => {
  const hasShebang = source.startsWith('#!')
  const module = parseSync(hasShebang ? source : `;${source}`, {
    syntax: 'typescript',
    tsx: file.endsWith('.tsx'),
    target: 'es2022'
  })
  const spanStart = (module as { span: { start: number } }).span.start
  const base = hasShebang ? spanStart : spanStart + 1
  const calls: string[] = []
  walkNodes(module, (node) => {
    if (node.type !== 'CallExpression') return
    const callee = node.callee as
      | {
          type?: string
          property?: {
            type?: string
            value?: string
            span?: { start: number }
          }
        }
      | undefined
    if (callee?.type !== 'MemberExpression') return
    const name = callee.property?.value
    if (callee.property?.type !== 'Identifier' || !name) return
    if (!GUARDED_METHODS.has(name)) return
    // The method name's own line: a chained call starts lines earlier.
    const offset = callee.property.span?.start ?? 0
    calls.push(`${file}:${lineOfOffset(source, offset, base)} .${name}()`)
  })
  return calls
}

describe('transaction call sites', () => {
  const files = SCANNED_ROOTS.flatMap(collectSourceFiles).map((fullPath) =>
    path.relative(process.cwd(), fullPath).split(path.sep).join('/')
  )
  const isAllowed = (file: string) =>
    [...ALLOWED.keys()].some((allowed) =>
      allowed.endsWith('/') ? file.startsWith(allowed) : file === allowed
    )

  it('scans the application sources', () => {
    expect(files).toContain('lib/database/kysely/index.ts')
    expect(files.length).toBeGreaterThan(500)
  })

  it('opens transactions and connections only through lib/database/kysely', () => {
    const offenders = files
      .filter((file) => !isAllowed(file))
      .flatMap((file) => findCalls(file, fs.readFileSync(file, 'utf8')))
    expect(offenders).toEqual([])
  })

  it('finds the calls it is looking for', () => {
    expect(
      findCalls(
        'example.ts',
        [
          '// db.transaction() in a comment does not count',
          "const text = 'db.connection() — non-ASCII bytes: ü, 日本'",
          'await db.transaction().execute(async () => {})',
          'await db',
          '  .startTransaction()',
          '  .execute()',
          'await db.connection().execute(async () => {})'
        ].join('\n')
      )
    ).toEqual([
      'example.ts:3 .transaction()',
      'example.ts:5 .startTransaction()',
      'example.ts:7 .connection()'
    ])
  })

  it('still allows every listed file because it still makes such a call', () => {
    for (const allowed of ALLOWED.keys()) {
      const matching = files.filter((file) =>
        allowed.endsWith('/') ? file.startsWith(allowed) : file === allowed
      )
      const calls = matching.flatMap((file) =>
        findCalls(file, fs.readFileSync(file, 'utf8'))
      )
      expect({ allowed, calls: calls.length > 0 }).toEqual({
        allowed,
        calls: true
      })
    }
  })
})
