import { parseSync } from '@swc/core'
import type { Expression, Module } from '@swc/core'
import fs from 'fs'
import path from 'path'

// Shared by the source-level import guards (`lib/clientModuleBoundary.test.ts`,
// `lib/clientImportGraph.test.ts`). Both read first-party imports from the
// TypeScript AST, so they agree on what counts as a runtime import.

export const ROOT = process.cwd()

export const MODULE_EXTENSIONS = ['.ts', '.tsx', '/index.ts', '/index.tsx']

// Non-test `.ts` / `.tsx` files under `directory`, recursively. A missing
// directory yields nothing; `node_modules` and dot-directories are skipped.
export const collectSourceFiles = (directory: string): string[] => {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
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
}

// Resolves an `@/...` or relative `./...` specifier to the file it points at,
// or null when it does not resolve to a first-party module. Bare package
// specifiers (`react`, `node:fs`) are never first-party and return null.
export const resolveImport = (
  specifier: string,
  fromFile: string
): string | null => {
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

// Every `import('x')` call with a string-literal argument. Walking the AST
// (rather than matching source text) skips comments and string contents, and
// swc parses a TypeScript import type (`typeof import('x')`,
// `import('./types').Foo`) as `TsImportType`, not a call, so those are erased
// type positions and never collected.
const collectDynamicImports = (node: unknown, found: string[]): string[] => {
  if (Array.isArray(node)) {
    for (const child of node) collectDynamicImports(child, found)
    return found
  }
  if (node === null || typeof node !== 'object') return found

  const record = node as Record<string, unknown>
  if (record.type === 'CallExpression') {
    const callee = record.callee as { type?: string } | undefined
    const [first] = (record.arguments as { expression?: Expression }[]) ?? []
    if (
      callee?.type === 'Import' &&
      first?.expression?.type === 'StringLiteral'
    ) {
      found.push(first.expression.value)
    }
  }
  for (const value of Object.values(record)) collectDynamicImports(value, found)
  return found
}

type CollectOptions = {
  // Keep `import 'x'` (no bindings). They read no value, so a guard about
  // values drops them; a guard about what ends up in a bundle keeps them.
  includeSideEffects: boolean
}

// One runtime import site with the names it pulls in. `side-effect` entries
// (`import 'x'`), `import('x')` and `export * from` carry no names;
// `import * as x` carries the wildcard so a caller that needs to know which
// bindings flow can tell. Type-only statements are dropped entirely, as are
// import statements whose every specifier is type-only.
export type ImportEntry = {
  specifier: string
  names: string[]
  kind: 'runtime' | 'side-effect'
}

// The imported name of a specifiers: what the module asks the source module
// for (`a` in `import { a as b }`, `default` for a default import, `*` for a
// namespace).
const importedName = (specifier: {
  type: string
  imported?: { value?: string; type?: string }
  local: { value: string }
}): string => {
  if (specifier.type === 'ImportDefaultSpecifier') return 'default'
  if (specifier.type === 'ImportNamespaceSpecifier') return '*'
  const imported = specifier.imported
  if (imported && typeof imported.value === 'string') return imported.value
  return specifier.local.value
}

// Every runtime import site of the file with its imported names, in source
// order (static imports and re-exports first, dynamic imports last). Type-only
// imports and exports — erased by TypeScript — are left out.
export const collectImportEntries = (
  fileName: string,
  source: string
): ImportEntry[] => {
  const module: Module = parseSync(source, {
    syntax: 'typescript',
    tsx: fileName.endsWith('.tsx'),
    decorators: true
  })

  const staticEntries = module.body.flatMap((statement): ImportEntry[] => {
    if (statement.type === 'ImportDeclaration') {
      if (statement.typeOnly) return []
      if (statement.specifiers.length === 0) {
        return [
          {
            specifier: statement.source.value,
            names: [],
            kind: 'side-effect'
          }
        ]
      }
      const names = statement.specifiers
        .filter(
          (specifier) =>
            !(specifier.type === 'ImportSpecifier' && specifier.isTypeOnly)
        )
        .map(importedName)
      return names.length > 0
        ? [{ specifier: statement.source.value, names, kind: 'runtime' }]
        : []
    }

    if (statement.type === 'ExportNamedDeclaration' && statement.source) {
      if (statement.typeOnly) return []
      const names = statement.specifiers
        .filter(
          (specifier) =>
            !(specifier.type === 'ExportSpecifier' && specifier.isTypeOnly)
        )
        .map((specifier) => {
          const orig = (specifier as { orig?: { value?: string } }).orig
          return typeof orig?.value === 'string' ? orig.value : ''
        })
        .filter((name) => name !== '')
      return names.length > 0
        ? [{ specifier: statement.source.value, names, kind: 'runtime' }]
        : []
    }

    if (statement.type === 'ExportAllDeclaration') {
      // `export type * from` is parsed with `typeOnly: true`; @swc/types does
      // not declare the field on this node yet, hence the `in` check.
      const isTypeOnly = 'typeOnly' in statement && statement.typeOnly === true
      return isTypeOnly
        ? []
        : [{ specifier: statement.source.value, names: [], kind: 'runtime' }]
    }

    return []
  })

  const dynamicEntries = collectDynamicImports(module.body, []).map(
    (specifier): ImportEntry => ({
      specifier,
      names: [],
      kind: 'runtime'
    })
  )

  return [...staticEntries, ...dynamicEntries]
}

// Every module specifier the file imports or re-exports at runtime: static
// value imports, `export … from` and `import('x')`. Type-only imports and
// exports are erased by TypeScript and excluded.
//
// Parsed with @swc/core rather than the `typescript` package: TypeScript 7's
// npm package is a CLI with no compiler API, and these guards have to keep
// working across that upgrade. The syntax flag follows the extension: parsing
// a `.ts` file as TSX turns a generic arrow (`<T>(x: T) => x`) into JSX and
// drops every statement after it, which would blind the check to anything
// declared below one.
export const collectImports = (
  fileName: string,
  source: string,
  { includeSideEffects }: CollectOptions
): string[] =>
  collectImportEntries(fileName, source)
    .filter((entry) => entry.kind === 'runtime' || includeSideEffects)
    .map((entry) => entry.specifier)
