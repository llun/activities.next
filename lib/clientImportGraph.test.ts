import { parseSync } from '@swc/core'
import fs from 'fs'
import { builtinModules } from 'module'
import path from 'path'

// Everything a `'use client'` module imports (statically or with `import()`)
// ends up in the browser bundle, transitively. Three kinds of server-side
// package must never get there:
//
// - Node builtins (`crypto`, `fs`, `stream`, `node:*` …): Next bundles
//   polyfills for them. `lib/utils/getHashFromString.ts` (`import crypto from
//   'crypto'`) once shipped ~130 KB gz of crypto/stream/buffer to /notifications.
// - The whole `lodash` package (`import _ from 'lodash'`, `import { x } from
//   'lodash'`): use `lodash/<method>` or plain JS.
// - `@/lib/utils/logger` (pino).
//
// The walk starts at every `'use client'` file under `app/` and `lib/`,
// follows `@/` and relative imports, skips type-only imports, and does not
// descend into `'use server'` files (client code only sees a server-action
// reference there). Only first-party modules are walked; a bare package
// specifier is checked and not followed.

const ROOT = process.cwd()
const MODULE_EXTENSIONS = ['.ts', '.tsx', '/index.ts', '/index.tsx']
const BUILTINS = new Set(builtinModules)
const FORBIDDEN_PACKAGES = new Set(['lodash'])
const FORBIDDEN_FILES = new Set([path.join(ROOT, 'lib/utils/logger.ts')])

const collectSourceFiles = (directory: string): string[] =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      return entry.name === 'node_modules' || entry.name.startsWith('.')
        ? []
        : collectSourceFiles(fullPath)
    }
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [fullPath]
      : []
  })

const resolveImport = (specifier: string, fromFile: string): string | null => {
  let base: string
  if (specifier.startsWith('@/')) {
    base = path.join(ROOT, specifier.slice(2))
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

const startsWithDirective = (source: string, directive: string) =>
  new RegExp(`^['"]${directive}['"]`).test(source.trimStart())

// Runtime imports of a file: static value imports, re-exports and `import()`.
const collectImports = (fileName: string, source: string): string[] => {
  const module = parseSync(source, {
    syntax: 'typescript',
    tsx: fileName.endsWith('.tsx'),
    decorators: true
  })

  const staticImports = module.body.flatMap((statement) => {
    if (statement.type === 'ImportDeclaration') {
      if (statement.typeOnly) return []
      const isEveryBindingTypeOnly =
        statement.specifiers.length > 0 &&
        statement.specifiers.every(
          (specifier) =>
            specifier.type === 'ImportSpecifier' && specifier.isTypeOnly
        )
      return isEveryBindingTypeOnly ? [] : [statement.source.value]
    }
    if (statement.type === 'ExportNamedDeclaration' && statement.source) {
      if (statement.typeOnly) return []
      const isEveryBindingTypeOnly = statement.specifiers.every(
        (specifier) =>
          specifier.type === 'ExportSpecifier' && specifier.isTypeOnly
      )
      return isEveryBindingTypeOnly ? [] : [statement.source.value]
    }
    if (statement.type === 'ExportAllDeclaration') {
      const isTypeOnly = 'typeOnly' in statement && statement.typeOnly === true
      return isTypeOnly ? [] : [statement.source.value]
    }
    return []
  })

  const dynamicImports = [
    ...source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)
  ].map((match) => match[1])

  return [...staticImports, ...dynamicImports]
}

const forbiddenReason = (specifier: string, resolved: string | null) => {
  const bare = specifier.replace(/^node:/, '')
  if (specifier.startsWith('node:') || BUILTINS.has(bare.split('/')[0])) {
    return 'Node builtin'
  }
  if (FORBIDDEN_PACKAGES.has(specifier)) return 'whole-package import'
  if (resolved && FORBIDDEN_FILES.has(resolved)) return 'server logger (pino)'
  return null
}

describe('client bundle imports', () => {
  it('never reach Node builtins, whole lodash or the pino logger from a use client module', () => {
    const files = [
      ...collectSourceFiles(path.join(ROOT, 'app')),
      ...collectSourceFiles(path.join(ROOT, 'lib'))
    ]
    const entries = files.filter((file) =>
      startsWithDirective(fs.readFileSync(file, 'utf-8'), 'use client')
    )

    const parents = new Map<string, string | null>()
    const queue: string[] = []
    for (const entry of entries) {
      parents.set(entry, null)
      queue.push(entry)
    }

    const chainOf = (file: string) => {
      const chain: string[] = []
      for (let current: string | null | undefined = file; current;) {
        chain.push(path.relative(ROOT, current))
        current = parents.get(current)
      }
      return chain.reverse().join(' -> ')
    }

    const violations: string[] = []
    while (queue.length > 0) {
      const file = queue.shift() as string
      const source = fs.readFileSync(file, 'utf-8')
      if (startsWithDirective(source, 'use server')) continue

      for (const specifier of collectImports(file, source)) {
        const resolved = resolveImport(specifier, file)
        const reason = forbiddenReason(specifier, resolved)
        if (reason) {
          violations.push(`${specifier} (${reason}) via ${chainOf(file)}`)
          continue
        }
        if (resolved && !parents.has(resolved)) {
          parents.set(resolved, file)
          queue.push(resolved)
        }
      }
    }

    expect(violations).toEqual([])
  })
})
