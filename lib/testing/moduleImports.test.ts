import {
  collectImportEntries,
  collectImports
} from '@/lib/testing/moduleImports'

const both = { includeSideEffects: true }

describe('collectImports', () => {
  it('follows real dynamic imports', () => {
    const source = `const load = () => import('./real')\nasync function f() { await import("pkg") }`
    expect(collectImports('a.ts', source, both)).toEqual(['./real', 'pkg'])
  })

  it('skips import types and commented-out import() calls', () => {
    const source = [
      `type A = typeof import('./type-query')`,
      `type B = import('./type-ref').Foo`,
      `// const x = import('./line-comment')`,
      `/* import('./block-comment') */`,
      `const s = "import('./in-string')"`,
      `export const load = () => import('./real')`
    ].join('\n')
    expect(collectImports('a.ts', source, both)).toEqual(['./real'])
  })

  it('skips type-only static imports and exports', () => {
    const source = [
      `import type { A } from './a'`,
      `import { type B } from './b'`,
      `export type { C } from './c'`,
      `export type * from './d'`,
      `import { e } from './e'`,
      `export * from './f'`
    ].join('\n')
    expect(collectImports('a.ts', source, both)).toEqual(['./e', './f'])
  })

  it('keeps side-effect imports only when asked', () => {
    const source = `import './effect'\nimport { v } from './value'`
    expect(collectImports('a.ts', source, both)).toEqual([
      './effect',
      './value'
    ])
    expect(
      collectImports('a.ts', source, { includeSideEffects: false })
    ).toEqual(['./value'])
  })

  it('keeps `export * as ns` re-exports', () => {
    const source = [
      `export * as ns from './namespace'`,
      `export * as inner from './outer/inner'`
    ].join('\n')
    expect(collectImports('a.ts', source, both)).toEqual([
      './namespace',
      './outer/inner'
    ])
  })

  it('reports the names each import site pulls in', () => {
    const source = [
      `import def from './default'`,
      `import * as ns from './namespace'`,
      `import { a as b } from './aliased'`,
      `import { type T, value } from './mixed'`
    ].join('\n')
    expect(collectImportEntries('a.ts', source)).toEqual([
      { specifier: './default', names: ['default'], kind: 'runtime' },
      { specifier: './namespace', names: ['*'], kind: 'runtime' },
      { specifier: './aliased', names: ['a'], kind: 'runtime' },
      { specifier: './mixed', names: ['value'], kind: 'runtime' }
    ])
  })

  it('marks `export * as ns` with the wildcard name', () => {
    const source = `export * as ns from './namespace'`
    expect(collectImportEntries('a.ts', source)).toEqual([
      { specifier: './namespace', names: ['*'], kind: 'runtime' }
    ])
  })

  // `collectImportEntries` maps an `ExportDefaultSpecifier` node to the name
  // `default`, but no source text reaches that branch: @swc/core's TypeScript
  // parser rejects `export x from './mod'` outright, so this only pins the
  // behaviour the defensive branch guards against.
  it('rejects `export x from` — the parser never emits ExportDefaultSpecifier', () => {
    expect(() =>
      collectImportEntries('a.ts', `export x from './default'`)
    ).toThrow()
  })
})
