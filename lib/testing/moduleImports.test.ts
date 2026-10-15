import { collectImports } from '@/lib/testing/moduleImports'

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
})
