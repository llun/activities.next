import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  STATS_PATH,
  compareRoutes,
  formatComparison,
  loadEarlierRoutes,
  loadStats,
  main,
  makeChunkSizer,
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

describe('bundleReport formatComparison', () => {
  const r = (route: string, gzipBytes: number) => ({
    route,
    rawBytes: 0,
    gzipBytes
  })

  it.each([
    [12, '+12 B'],
    [-30, '-30 B'],
    [2048, '+2.0'],
    [-2048, '-2.0']
  ])('prints a %d byte change as %s', (delta, text) => {
    const out = formatComparison(
      compareRoutes([r('/a', 5000)], [r('/a', 5000 + delta)])
    )
    expect(out).toContain(text)
    expect(out).not.toMatch(/[+-]0\.0/)
  })
})

describe('bundleReport parseArgs', () => {
  it('parses --json and --compare in both spellings', () => {
    expect(parseArgs(['--json', 'a.json', '--compare=b.json'])).toMatchObject({
      json: 'a.json',
      compare: 'b.json'
    })
  })

  it('parses --limit and --root', () => {
    expect(parseArgs(['--limit', '5', '--root', '/x'])).toMatchObject({
      limit: 5,
      root: '/x'
    })
  })

  it('recognises --help and -h', () => {
    expect(parseArgs(['--help']).help).toBe(true)
    expect(parseArgs(['-h']).help).toBe(true)
  })

  it.each([
    [['--nope'], 'Unknown argument: --nope'],
    [['--json'], '--json needs a value'],
    [['--compare'], '--compare needs a value'],
    [['--root'], '--root needs a value'],
    [['--limit'], '--limit needs a value'],
    [['--limit', '0'], '--limit needs a positive integer'],
    [['--limit', '-1'], '--limit needs a positive integer'],
    [['--limit', '1.5'], '--limit needs a positive integer'],
    [['--limit', 'abc'], '--limit needs a positive integer']
  ])('rejects %j', (args, message) => {
    expect(() => parseArgs(args)).toThrow(message)
  })
})

describe('bundleReport IO', () => {
  let root: string
  const chunkA = Buffer.from('console.log("a");'.repeat(200))
  const chunkB = Buffer.from('console.log("b");'.repeat(50))
  const stats = [
    {
      route: '/one',
      firstLoadUncompressedJsBytes: 1,
      firstLoadChunkPaths: [
        '.next/static/chunks/a.js',
        '.next/static/chunks/b.js'
      ]
    },
    {
      route: '/two',
      firstLoadUncompressedJsBytes: 1,
      firstLoadChunkPaths: ['.next/static/chunks/a.js']
    }
  ]
  const write = (rel: string, content: string | Buffer) => {
    const file = path.join(root, rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
    return file
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-report-'))
    write('.next/static/chunks/a.js', chunkA)
    write('.next/static/chunks/b.js', chunkB)
    write(STATS_PATH, JSON.stringify(stats))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(root, { recursive: true, force: true })
  })

  describe('loadStats', () => {
    it('returns the route list', () => {
      expect(loadStats(root)).toEqual(stats)
    })

    it('fails on a missing file and says to build', () => {
      fs.rmSync(path.join(root, STATS_PATH))
      expect(() => loadStats(root)).toThrow('Run `yarn build` first.')
    })

    it('fails on a file that is not an array', () => {
      write(STATS_PATH, '{"routes":[]}')
      expect(() => loadStats(root)).toThrow('is not a route list')
    })

    it('fails on invalid JSON', () => {
      write(STATS_PATH, '{nope')
      expect(() => loadStats(root)).toThrow('is not valid JSON')
    })
  })

  describe('loadEarlierRoutes', () => {
    it('returns the routes of a --json report', () => {
      const file = write('earlier.json', '{"routes":[{"route":"/x"}]}')
      expect(loadEarlierRoutes(file)).toEqual([{ route: '/x' }])
    })

    it('fails on a missing file', () => {
      expect(() => loadEarlierRoutes(path.join(root, 'none.json'))).toThrow(
        'Cannot read'
      )
    })

    it('fails on a file without a routes list', () => {
      const file = write('earlier.json', '{"other":1}')
      expect(() => loadEarlierRoutes(file)).toThrow('has no "routes" list')
    })
  })

  describe('makeChunkSizer', () => {
    it('resolves the chunk path against the root and reports raw size', () => {
      const sizeOf = makeChunkSizer(root)
      expect(sizeOf('.next/static/chunks/a.js').rawBytes).toBe(chunkA.length)
    })

    it('reports the level 9 gzip size', () => {
      const sizeOf = makeChunkSizer(root)
      expect(sizeOf('.next/static/chunks/a.js').gzipBytes).toBe(
        zlib.gzipSync(chunkA, { level: 9 }).length
      )
    })

    it('caches a size, so a deleted file still answers', () => {
      const sizeOf = makeChunkSizer(root)
      const first = sizeOf('.next/static/chunks/b.js')
      fs.rmSync(path.join(root, '.next/static/chunks/b.js'))
      expect(sizeOf('.next/static/chunks/b.js')).toBe(first)
    })

    it('throws for a chunk that is not on disk', () => {
      expect(() => makeChunkSizer(root)('.next/static/chunks/zz.js')).toThrow()
    })
  })

  describe('main', () => {
    const printed = () =>
      vi.spyOn(console, 'log').mockImplementation(() => undefined)

    it('prints the table and writes --json', () => {
      const log = printed()
      const json = path.join(root, 'out.json')
      expect(main(['--root', root, '--json', json])).toBe(0)
      const output = log.mock.calls.map((c) => c[0]).join('\n')
      expect(output).toContain('Routes: 2')
      expect(output).toContain('/one')
      const written = JSON.parse(fs.readFileSync(json, 'utf8'))
      expect(written.routes.map((r: { route: string }) => r.route)).toEqual([
        '/one',
        '/two'
      ])
    })

    it('prints the comparison with an earlier report', () => {
      const log = printed()
      const earlier = write(
        'earlier.json',
        JSON.stringify({
          routes: [{ route: '/two', rawBytes: 0, gzipBytes: 1 }]
        })
      )
      main(['--root', root, '--compare', earlier])
      const output = log.mock.calls.map((c) => c[0]).join('\n')
      expect(output).toContain('Compared with the earlier report')
      expect(output).toContain('added:   /one')
    })

    it('prints only the usage for --help', () => {
      const log = printed()
      expect(main(['--help'])).toBe(0)
      expect(log).toHaveBeenCalledTimes(1)
      expect(log.mock.calls[0][0]).toContain('Usage:')
    })

    it('fails on a missing --compare file before printing anything', () => {
      const log = printed()
      expect(() =>
        main(['--root', root, '--compare', path.join(root, 'none.json')])
      ).toThrow('Cannot read')
      expect(log).not.toHaveBeenCalled()
    })

    it('does not write --json when --compare is bad', () => {
      printed()
      const json = path.join(root, 'out.json')
      const earlier = write('earlier.json', '{bad')
      expect(() =>
        main(['--root', root, '--compare', earlier, '--json', json])
      ).toThrow('is not valid JSON')
      expect(fs.existsSync(json)).toBe(false)
    })
  })
})
