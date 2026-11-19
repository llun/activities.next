import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  check,
  historyHit,
  main,
  parseAdded,
  routeLinks,
  sectionBytes,
  slug
} from './contextBudget'

let root: string
const write = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
  fs.writeFileSync(path.join(root, file), text)
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'context-budget-'))
})
afterEach(() => {
  vi.unstubAllEnvs()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('contextBudget history patterns', () => {
  it('flags PR, issue and phase numbers and dated "since"', () => {
    for (const line of [
      'Fixed in #2837.',
      'See (#12)',
      'Added by PR 15b',
      'PR #4 moved it',
      'Phase 2 of the plan',
      'true since 12 November 2026',
      'since 2026-11-19'
    ])
      expect(historyHit(line), line).toBe(true)
  })

  it('leaves anchors, colours and ordinary numbers alone', () => {
    for (const line of [
      '[Setup](docs/setup.md#agents-build-test-and-development-commands)',
      'color: #1f2937',
      'Node.js 26 and 20 rounds',
      'since the last release'
    ])
      expect(historyHit(line), line).toBe(false)
  })
})

describe('contextBudget sections and routes', () => {
  it('matches GitHub heading slugs', () => {
    expect(slug('Status Posts & Actions')).toBe('status-posts--actions')
  })

  it('measures from an anchor to the next heading of the same level', () => {
    const text = '# A\n<a id="x"></a>\n## X\nbody\n### Sub\nmore\n## Y\nrest'
    expect(sectionBytes(text, 'x')).toBe(
      Buffer.byteLength('<a id="x"></a>\n## X\nbody\n### Sub\nmore')
    )
    expect(sectionBytes(text, 'y')).toBe(Buffer.byteLength('## Y\nrest'))
    expect(sectionBytes(text, 'missing')).toBeNull()
  })

  it('collects relative Markdown links per line and skips URLs', () => {
    expect(
      routeLinks(
        'a [s](docs/setup.md#one) [c](CONTRIBUTING.md)\nnone\n[x](https://e.com/a.md)',
        'AGENTS.md'
      )
    ).toEqual([
      {
        line: 1,
        links: [
          { file: 'docs/setup.md', anchor: 'one' },
          { file: 'CONTRIBUTING.md', anchor: null }
        ]
      }
    ])
  })
})

describe('contextBudget check', () => {
  it('fails a file over its ceiling and a ceiling left above size and target', () => {
    write('AGENTS.md', 'x'.repeat(100))
    write('BIG.md', 'x'.repeat(300))
    const { errors, ceilings } = check(root, {
      target: 50,
      files: { 'AGENTS.md': 90, 'BIG.md': 400 }
    })
    expect(errors).toHaveLength(2)
    expect(errors[0]).toContain('over its ceiling of 90')
    expect(errors[1]).toContain('must come down to 300')
    expect(ceilings['BIG.md']).toBe(300)
  })

  it('lets a file under its target keep the target as its ceiling', () => {
    write('AGENTS.md', 'small')
    const result = check(root, { target: 100, files: { 'AGENTS.md': 400 } })
    expect(result.errors).toEqual([
      expect.stringContaining('must come down to 100')
    ])
    expect(result.ceilings['AGENTS.md']).toBe(100)
    expect(
      check(root, { target: 100, files: { 'AGENTS.md': 100 } }).errors
    ).toEqual([])
  })

  it('defaults the target to 12288 bytes', () => {
    write('AGENTS.md', 'small')
    expect(
      check(root, { files: { 'AGENTS.md': 12289 } }).ceilings['AGENTS.md']
    ).toBe(12288)
    expect(check(root, { files: { 'AGENTS.md': 12288 } }).errors).toEqual([])
  })

  it('--update writes lowered ceilings and still fails other errors', () => {
    // CI's pull_request event would otherwise send main() to HEAD^1.
    vi.stubEnv('GITHUB_EVENT_NAME', '')
    execFileSync('git', ['init', '-q'], { cwd: root })
    write('A.md', 'x'.repeat(10))
    write('B.md', 'x'.repeat(30))
    const config = { target: 5, files: { 'A.md': 40, 'B.md': 20 } }
    write('context-budget.json', JSON.stringify(config))
    const log = console.log
    console.log = () => {}
    try {
      expect(main([], root)).toBe(1)
      write('B.md', 'x'.repeat(20))
      expect(main([], root)).toBe(1)
      expect(main(['--update'], root)).toBe(0)
    } finally {
      console.log = log
    }
    expect(
      JSON.parse(
        fs.readFileSync(path.join(root, 'context-budget.json'), 'utf8')
      ).files
    ).toEqual({ 'A.md': 10, 'B.md': 20 })
    expect(main([], root)).toBe(0)
  })

  it('reports a route link to a missing anchor', () => {
    write('AGENTS.md', '[g](docs/g.md#nope)')
    write('docs/g.md', '## Real\ntext')
    expect(check(root, { routes: ['AGENTS.md'] }).errors[0]).toContain(
      'which has no such anchor'
    )
  })

  it('fails added history lines in budgeted and linked files only', () => {
    write('AGENTS.md', '[g](docs/g.md)')
    write('docs/g.md', 'text')
    write('other.md', 'text')
    const { errors } = check(
      root,
      { files: { 'AGENTS.md': 12288 }, routes: ['AGENTS.md'] },
      {
        base: 'main',
        diff: (files) =>
          [
            { file: 'docs/g.md', line: 3, text: 'Changed in #2837' },
            { file: 'AGENTS.md', line: 1, text: 'Fixed in #2840' },
            { file: 'AGENTS.md', line: 2, text: 'Plain rule' },
            { file: 'other.md', line: 1, text: 'Changed in #2837' }
          ].filter((entry) => files.includes(entry.file))
      }
    )
    expect(errors).toEqual([
      expect.stringContaining('docs/g.md:3 adds history'),
      expect.stringContaining('AGENTS.md:1 adds history')
    ])
  })
})

describe('contextBudget parseAdded', () => {
  it('keeps added lines with their numbers and drops lines moved elsewhere', () => {
    const diff = [
      'diff --git a/AGENTS.md b/AGENTS.md',
      '--- a/AGENTS.md',
      '+++ b/AGENTS.md',
      '@@ -3,1 +3,2 @@',
      '-Moved rule (#1)',
      '+New rule',
      '+Second',
      'diff --git a/docs/g.md b/docs/g.md',
      '--- /dev/null',
      '+++ b/docs/g.md',
      '@@ -0,0 +1,1 @@',
      '+Moved rule (#1)'
    ].join('\n')
    expect(parseAdded(diff, ['AGENTS.md', 'docs/g.md'])).toEqual([
      { file: 'AGENTS.md', line: 3, text: 'New rule' },
      { file: 'AGENTS.md', line: 4, text: 'Second' }
    ])
  })
})

describe('contextBudget edge cases', () => {
  it('ignores # lines inside code fences when measuring a section', () => {
    const text = '## A\n```bash\n# comment\n```\nafter\n## B'
    expect(sectionBytes(text, 'a')).toBe(
      Buffer.byteLength('## A\n```bash\n# comment\n```\nafter')
    )
  })

  it('reads an added "++ " line inside a hunk as content, not a header', () => {
    const diff = [
      'diff --git a/AGENTS.md b/AGENTS.md',
      '--- a/AGENTS.md',
      '+++ b/AGENTS.md',
      '@@ -0,0 +1,2 @@',
      '+++ counter',
      '+Fixed in #12'
    ].join('\n')
    expect(parseAdded(diff, ['AGENTS.md'])).toEqual([
      { file: 'AGENTS.md', line: 1, text: '++ counter' },
      { file: 'AGENTS.md', line: 2, text: 'Fixed in #12' }
    ])
  })

  it('fails a route link to a missing file', () => {
    write('AGENTS.md', '[g](docs/gone.md)')
    expect(check(root, { routes: ['AGENTS.md'] }).errors[0]).toContain(
      'docs/gone.md, which is not a file here'
    )
  })

  it('separates ceilings --update can lower from other failures', () => {
    write('A.md', 'x'.repeat(10))
    write('B.md', 'x'.repeat(30))
    const { errors, stale } = check(root, {
      target: 5,
      files: { 'A.md': 40, 'B.md': 20 }
    })
    expect(errors).toHaveLength(2)
    expect(stale).toEqual([
      expect.stringContaining('A.md is 10 bytes, so its ceiling of 40')
    ])
    expect(errors).toContainEqual(
      expect.stringContaining('B.md is 30 bytes, over')
    )
  })
})

describe('contextBudget code fences', () => {
  it('closes a fence only on the same marker, at least as long, bare', () => {
    expect(sectionBytes('## A\n```\n~~~\n```\n## B\nbody', 'b')).toBe(
      Buffer.byteLength('## B\nbody')
    )
    const nested = '## A\n````\n```\n# x\n```\n````\nend\n## B'
    expect(sectionBytes(nested, 'a')).toBe(
      Buffer.byteLength('## A\n````\n```\n# x\n```\n````\nend')
    )
  })

  it('ignores an anchor inside a fence but finds one after an inline code span', () => {
    expect(sectionBytes('```\n<a id="x"></a>\n```', 'x')).toBeNull()
    expect(sectionBytes('```js``` <a id="x"></a>\ntext', 'x')).toBe(
      Buffer.byteLength('```js``` <a id="x"></a>\ntext')
    )
  })
})
