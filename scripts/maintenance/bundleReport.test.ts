import { describe, expect, it } from 'vitest'

import {
  compareRoutes,
  formatComparison,
  parseArgs,
  summarize
} from './bundleReport'

const sizes: Record<string, number> = { a: 100, b: 200, c: 50 }
const sizeOf = (chunk: string) => ({
  rawBytes: sizes[chunk] * 3,
  gzipBytes: sizes[chunk]
})

describe('bundleReport summarize', () => {
  it('sorts routes by gzip size and finds chunks shared by every route', () => {
    const summary = summarize(
      [
        {
          route: '/x',
          firstLoadUncompressedJsBytes: 300,
          firstLoadChunkPaths: ['a']
        },
        {
          route: '/y',
          firstLoadUncompressedJsBytes: 900,
          firstLoadChunkPaths: ['a', 'b', 'b']
        },
        {
          route: '/z',
          firstLoadUncompressedJsBytes: 450,
          firstLoadChunkPaths: ['a', 'c']
        }
      ],
      sizeOf
    )
    expect(summary.routes.map((r) => [r.route, r.gzipBytes])).toEqual([
      ['/y', 300],
      ['/z', 150],
      ['/x', 100]
    ])
    expect(summary.sharedChunkCount).toBe(1)
    expect(summary.sharedGzipBytes).toBe(100)
    expect(summary.sharedRawBytes).toBe(300)
  })

  it('handles an empty route list', () => {
    expect(summarize([], sizeOf).sharedChunkCount).toBe(0)
  })
})

describe('bundleReport compareRoutes', () => {
  const r = (route: string, gzipBytes: number) => ({
    route,
    rawBytes: 0,
    gzipBytes
  })

  it('reports deltas, additions and removals', () => {
    const c = compareRoutes(
      [r('/same', 10), r('/grew', 10), r('/shrank', 100), r('/gone', 5)],
      [r('/same', 10), r('/grew', 30), r('/shrank', 40), r('/new', 7)]
    )
    expect(c.changed.map((d) => [d.route, d.deltaGzipBytes])).toEqual([
      ['/shrank', -60],
      ['/grew', 20]
    ])
    expect(c.unchanged).toBe(1)
    expect(c.added.map((x) => x.route)).toEqual(['/new'])
    expect(c.removed.map((x) => x.route)).toEqual(['/gone'])
    expect(c.totalDeltaGzipBytes).toBe(-40)
    expect(formatComparison(c)).toContain('removed: /gone')
  })
})

describe('bundleReport parseArgs', () => {
  it('parses options and rejects unknown ones', () => {
    expect(
      parseArgs(['--json', 'a.json', '--compare=b.json', '--limit', '5'])
    ).toMatchObject({
      json: 'a.json',
      compare: 'b.json',
      limit: 5
    })
    expect(() => parseArgs(['--nope'])).toThrow('Unknown argument')
    expect(() => parseArgs(['--json'])).toThrow('needs a value')
  })
})
