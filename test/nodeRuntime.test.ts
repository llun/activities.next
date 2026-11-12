// @vitest-size medium
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const parseSemver = (version: string): [number, number, number] => {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim())
  if (!match) {
    throw new Error(`Invalid semver "${version}"`)
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

const isAtLeast = (
  actual: [number, number, number],
  minimum: [number, number, number]
): boolean => {
  for (let i = 0; i < 3; i++) {
    if (actual[i] > minimum[i]) return true
    if (actual[i] < minimum[i]) return false
  }
  return true
}

describe('Node.js 26 runtime and security baseline', () => {
  it('keeps rasterizeHeatmapSvg aligned with node:26-alpine', () => {
    const rasterizer = readFileSync(
      'lib/services/fitness-files/rasterizeHeatmapSvg.ts',
      'utf8'
    )

    expect(rasterizer).toContain('`node:26-alpine`')
    expect(rasterizer).not.toContain('node:24')
  })

  it('pins engines.node to 26.x and resolves undici (^8.12.1 / ^8.4.1) to >= 8.12.4', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      engines?: { node?: string }
    }
    const lockfile = readFileSync('yarn.lock', 'utf8')
    const undiciMatch =
      /"undici@npm:\^8\.12\.1, undici@npm:\^8\.4\.1":\n\s+version:\s+([^\n]+)/.exec(
        lockfile
      )

    expect(pkg.engines?.node).toBe('26.x')
    expect(undiciMatch).not.toBeNull()
    expect(
      isAtLeast(parseSemver(undiciMatch?.[1] ?? '0.0.0'), [8, 12, 4])
    ).toBe(true)
  })

  it.each([
    {
      description: 'CONTRIBUTING.md',
      path: 'CONTRIBUTING.md',
      expected: 'Node.js 26'
    },
    { description: 'README.md', path: 'README.md', expected: 'Node.js 26' },
    { description: 'docs/setup.md', path: 'docs/setup.md', expected: '26.x' },
    {
      description: 'docs/quickstart.md',
      path: 'docs/quickstart.md',
      expected: '26.x'
    },
    {
      description: 'docs/architecture.md',
      path: 'docs/architecture.md',
      expected: 'Node.js 26'
    }
  ])(
    'documents Node.js 26 without stale Node.js 24 pins in $description',
    ({ path, expected }) => {
      const doc = readFileSync(path, 'utf8')

      expect(doc).toContain(expected)
      expect(doc).not.toContain('Node.js 24')
      expect(doc).not.toContain('Node.js-24.x')
      expect(doc).not.toContain('`24.x`')
    }
  )
})
