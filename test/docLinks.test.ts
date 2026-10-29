import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))

// GitHub-style slug: lowercase, drop punctuation, spaces become hyphens.
const githubSlug = (heading: string): string =>
  heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/ /g, '-')

// Slugs of every ATX heading, outside fenced code blocks, with the same
// duplicate suffixes GitHub applies (-1, -2, ...).
const headingSlugs = (content: string): Set<string> => {
  let fence = ''
  const seen = new Map<string, number>()
  const slugs = new Set<string>()
  for (const line of content.split('\n')) {
    const fenceMark = line.match(/^\s{0,3}(```|~~~)/)
    if (fenceMark) {
      fence = fence ? '' : fenceMark[1]
      continue
    }
    if (fence) continue
    const heading = line.match(/^#{1,6}\s+(.*)$/)
    if (!heading) continue
    const slug = githubSlug(heading[1].replace(/`/g, ''))
    const count = (seen.get(slug) ?? 0) + 1
    seen.set(slug, count)
    slugs.add(count === 1 ? slug : `${slug}-${count - 1}`)
  }
  return slugs
}

// Explicit `<a id="...">` / `<a name="...">` targets in a file.
const explicitAnchors = (content: string): Set<string> => {
  const ids = new Set<string>()
  for (const m of content.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) ids.add(m[1])
  return ids
}

// Inline links outside fenced code blocks and inline code spans.
const inlineLinks = (content: string): { line: number; target: string }[] => {
  let fence = ''
  const out: { line: number; target: string }[] = []
  content.split('\n').forEach((raw, i) => {
    const line = raw.replace(/`[^`]*`/g, '')
    const fenceMark = line.match(/^\s{0,3}(```|~~~)/)
    if (fenceMark) {
      fence = fence ? '' : fenceMark[1]
      return
    }
    if (fence) return
    for (const m of line.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g))
      out.push({ line: i + 1, target: m[1] })
  })
  return out
}

// files maps a repo-relative path to its content; every link in every file is
// checked against the map (Markdown targets) or the filesystem (other files).
const brokenLinks = (
  files: Map<string, string>,
  exists: (repoPath: string) => boolean = (p) =>
    fs.existsSync(path.join(ROOT, p))
): Failure[] => {
  const headings = new Map<string, Set<string>>(
    [...files].map(([p, c]) => [p, headingSlugs(c)])
  )
  const anchors = new Map<string, Set<string>>(
    [...files].map(([p, c]) => [p, explicitAnchors(c)])
  )
  const failures: Failure[] = []
  for (const [source, content] of files) {
    for (const { line, target } of inlineLinks(content)) {
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target)) continue // URI scheme
      const hash = target.indexOf('#')
      const filePart = hash === -1 ? target : target.slice(0, hash)
      const anchor = hash === -1 ? null : target.slice(hash + 1)
      const resolved =
        filePart === ''
          ? source
          : path.posix.normalize(
              path.posix.join(path.posix.dirname(source), filePart)
            )
      if (!exists(resolved)) {
        failures.push({
          source,
          line,
          target,
          reason: `${resolved} does not exist`
        })
        continue
      }
      if (anchor === null) continue
      const slugs = headings.get(resolved)
      if (slugs && !slugs.has(anchor) && !anchors.get(resolved)?.has(anchor)) {
        failures.push({
          source,
          line,
          target,
          reason: `#${anchor} not found in ${resolved}`
        })
      }
    }
  }
  return failures
}

type Failure = { source: string; line: number; target: string; reason: string }

const trackedMarkdown = (): string[] =>
  execFileSync('git', ['ls-files', '*.md'], { cwd: ROOT })
    .toString()
    .split('\n')
    .filter((p) => p !== '' && !p.startsWith('node_modules/'))

const docContent = (p: string): string =>
  fs.readFileSync(path.join(ROOT, p), 'utf8')

describe('documentation links', () => {
  const files = new Map<string, string>(
    trackedMarkdown().map((p) => [p, docContent(p)])
  )
  const failures = brokenLinks(files)

  it('every tracked-doc link resolves', () => {
    const report = failures
      .map((f) => `${f.source}:${f.line} -> ${f.target} (${f.reason})`)
      .join('\n')
    expect(report).toBe('')
  })

  it('the checker reports a broken link and passes a good one', () => {
    const sample = new Map([
      ['docs/a.md', 'See [good](b.md#section) and [bad](b.md#nope).\n'],
      ['docs/b.md', '## Section\n\nText.\n']
    ])
    expect(brokenLinks(sample, () => true)).toEqual([
      {
        source: 'docs/a.md',
        line: 1,
        target: 'b.md#nope',
        reason: '#nope not found in docs/b.md'
      }
    ])
  })
})
