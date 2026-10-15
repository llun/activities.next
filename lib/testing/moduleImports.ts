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
): string[] => {
  const module: Module = parseSync(source, {
    syntax: 'typescript',
    tsx: fileName.endsWith('.tsx'),
    decorators: true
  })

  const staticImports = module.body.flatMap((statement) => {
    if (statement.type === 'ImportDeclaration') {
      if (statement.typeOnly) return []
      if (statement.specifiers.length === 0) {
        return includeSideEffects ? [statement.source.value] : []
      }
      const isEveryBindingTypeOnly = statement.specifiers.every(
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
      // `export type * from` is parsed with `typeOnly: true`; @swc/types does
      // not declare the field on this node yet, hence the `in` check.
      const isTypeOnly = 'typeOnly' in statement && statement.typeOnly === true
      return isTypeOnly ? [] : [statement.source.value]
    }

    return []
  })

  return [...staticImports, ...collectDynamicImports(module.body, [])]
}
