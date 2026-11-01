// Pure test-size inference, shared by vitest.config.ts (which must stay free of
// a vitest import) and its unit test. It reads a test file's source the same way
// FORKED_PROCESS_MARKER in vitest.config.ts does: on the raw text, matching
// import specifiers and call shapes so generic, aliased or namespace calls are
// found as well.
//
// The sizes follow Google's classification:
// - small: no real I/O at all — no database, no filesystem, no network, no
//   long real waits; runs in well under a second.
// - medium: touches a local resource (test database, filesystem, real short
//   waits) but never a third party.
// - large: spawns processes, drives docker or starts a server.
//
// A `@vitest-size small|medium|large` docblock in the file always wins: the
// author's classification overrides every heuristic. Everything below the
// docblock is matched against comment-stripped source, so a comment that
// happens to name `child_process` must not escalate a file.

export type TestSize = 'small' | 'medium' | 'large'

// Searched on the raw source: the marker only counts on a comment line, so a
// string literal in code that happens to contain the text is not a declaration.
const SIZE_DOCKBLOCK =
  /(?:\/\/|\/\*|\*)\s*@vitest-size\s+(small|medium|large)\b/

const stripComments = (source: string): string => {
  let out = ''
  let quote: string | null = null
  let index = 0
  while (index < source.length) {
    const ch = source[index]
    const next = source[index + 1]
    if (quote) {
      out += ch
      if (ch === '\\') {
        out += next ?? ''
        index += 2
        continue
      }
      if (ch === quote) quote = null
      index += 1
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      out += ch
      index += 1
      continue
    }
    if (ch === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1
      continue
    }
    if (ch === '/' && next === '*') {
      index += 2
      while (
        index < source.length &&
        !(source[index] === '*' && source[index + 1] === '/')
      ) {
        index += 1
      }
      index += 2
      out += ' '
      continue
    }
    out += ch
    index += 1
  }
  return out
}

// A literal setTimeout whose delay argument is a number literal of 100 or more
// (one level of nested call parentheses is tolerated: setTimeout(fn(), 500)).
const LONG_TIMEOUT = /setTimeout\(\s*[^,()]*(?:\([^()]*\)\s*)?,\s*(\d{3,})/

// Test database helpers: lib/database/testUtils.ts's entry points and the
// drivers tests reach past them.
const DATABASE_HELPERS =
  /createTestDatabase|getTest(?:SQL)?Database\w*|databaseBeforeAll|better-sqlite3|seedDatabase|testUtils/

const FILESYSTEM =
  /mkdtemp|writeFile|appendFile|mkdir|createWriteStream|readFile(Sync)?\(|readdir(Sync)?\(|globSync|\brm\(|\bunlink\(|\brename\(/

const REAL_WAITS = /waitFor\(|\bfindBy[A-Z]|\bfindAllBy/

const LARGE =
  /['"](?:node:)?child_process['"]|\bdocker\b|\.listen\(|createServer/

export const inferTestSize = (source: string): TestSize => {
  const declared = SIZE_DOCKBLOCK.exec(source)?.[1]
  if (declared === 'small' || declared === 'medium' || declared === 'large') {
    return declared
  }

  const code = stripComments(source)
  if (LARGE.test(code)) return 'large'
  if (
    DATABASE_HELPERS.test(code) ||
    FILESYSTEM.test(code) ||
    REAL_WAITS.test(code) ||
    LONG_TIMEOUT.test(code)
  ) {
    return 'medium'
  }
  return 'small'
}
