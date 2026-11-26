import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

// The @atproto packages still depend on zod 3, which has no release fixing
// GHSA-mrhx-c7xc-m3w5 (an oversized array is parsed element by element and
// collects one issue per bad element). patches/zod-npm-3.25.76-*.patch
// backports zod 4.6.6's fix, applied through the `zod@npm:^3.23.8`
// resolution in package.json. If an @atproto upgrade moves to another zod 3
// range, that resolution stops matching and this test fails: extend it to the
// new range, or drop the patch once @atproto is on zod 4.6.6 or later.
const requireFromAtproto = createRequire(
  createRequire(import.meta.url).resolve('@atproto/lexicon')
)
const zodDirectory = path.dirname(
  requireFromAtproto.resolve('zod/package.json')
)

type ZodV3 = typeof import('zod/v3')

const oversized = Array.from({ length: 10_000 }, () => 1)

const expectOversizedRejectedEarly = ({ z }: ZodV3) => {
  const max = z.array(z.string()).max(2).safeParse(oversized)
  expect(max.success).toBe(false)
  expect(max.error?.issues).toHaveLength(1)
  expect(max.error?.issues[0].code).toBe('too_big')

  const exact = z.array(z.string()).length(2).safeParse(oversized)
  expect(exact.error?.issues).toHaveLength(1)

  const set = z.set(z.string()).max(2).safeParse(new Set(oversized.keys()))
  expect(set.error?.issues).toHaveLength(1)
}

describe('zod 3 used by @atproto', () => {
  it('is the patched 3.25.76', () => {
    expect(requireFromAtproto('zod/package.json').version).toBe('3.25.76')
  })

  it('rejects an oversized constrained collection before parsing its elements (CommonJS)', () => {
    expectOversizedRejectedEarly(requireFromAtproto('zod'))
  })

  it('rejects an oversized constrained collection before parsing its elements (ESM)', async () => {
    expectOversizedRejectedEarly(
      await import(pathToFileURL(path.join(zodDirectory, 'index.js')).href)
    )
  })

  it('still reports every bad element of an array within its limit', () => {
    const { z } = requireFromAtproto('zod') as ZodV3
    const result = z.array(z.string()).max(5).safeParse([1, 2, 3])
    expect(result.error?.issues).toHaveLength(3)
  })
})
