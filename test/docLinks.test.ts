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

// A fence opens on a run of 3+ backticks or tildes (up to 3 leading spaces)
// and closes only on a run of the same character at least as long, so a ```
// line inside a ```` block does not close it.
const fenceMark = (line: string): string =>
  line.match(/^ {0,3}(`{3,}|~{3,})/)?.[1] ?? ''

// CommonMark: a fence closes only on a line that is the same-character run
// of at least the opener's length plus optional whitespace; a trailing info
// string ("``` js") leaves the fence open.
const nextFence = (fence: string, mark: string, line: string): string => {
  if (!mark) return fence
  if (!fence) return mark
  const close = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/)?.[1]
  return close !== undefined &&
    close[0] === fence[0] &&
    close.length >= fence.length
    ? ''
    : fence
}

// Strip inline code spans: a run of N backticks ends on the next run of N
// (``a`b`` is one span), so a link inside one is not checked.
const stripInlineCode = (line: string): string => line.replace(/(`+).*?\1/g, '')

// Lines of a document, dropping a trailing \r so CRLF files behave like LF.
const contentLines = (content: string): string[] =>
  content.split('\n').map((line) => line.replace(/\r$/, ''))

// Target of `[text](url)`, `[text](<url>)` or `[text](url "title")`.
// shortcut: reference-style links and parentheses inside targets are not
// parsed; upgrade when a doc actually uses either.
const TARGET = String.raw`(?:<([^>]*)>|([^)\s]+))(?:\s+(?:"[^"]*"|'[^']*'))?\)`
const LINK = new RegExp(String.raw`\[([^\]]*)\]\(` + TARGET, 'g')
const IMAGE = new RegExp(String.raw`!\[([^\]]*)\]\(` + TARGET, 'g')

// Targets of every link and image on a line. Images are matched first and
// replaced by their alt text, so a badge `[![i](img.png)](link.md)` checks
// both targets.
const linkTargets = (line: string): string[] => {
  const targets: string[] = []
  const push = (m: RegExpExecArray) => targets.push(m[2] ?? m[3] ?? '')
  for (const m of line.matchAll(IMAGE)) push(m)
  const bare = line.replace(IMAGE, '$1')
  for (const m of bare.matchAll(LINK)) push(m)
  return targets
}

// Slugs of every ATX heading (up to 3 leading spaces), outside fenced code
// blocks, with the same duplicate suffixes GitHub applies (-1, -2, ...).
// Links and images collapse to their text, so `## [Link](x.md) text` slugs
// as `link-text`.
const headingSlugs = (content: string): Set<string> => {
  let fence = ''
  const seen = new Map<string, number>()
  const slugs = new Set<string>()
  for (const line of contentLines(content)) {
    const mark = fenceMark(line)
    fence = nextFence(fence, mark, line)
    if (fence || mark) continue
    const heading = line.match(/^ {0,3}#{1,6}\s+(.*)$/)
    if (!heading) continue
    const text = heading[1].replace(IMAGE, '$1').replace(LINK, '$1')
    const slug = githubSlug(text.replace(/`/g, ''))
    const count = (seen.get(slug) ?? 0) + 1
    seen.set(slug, count)
    slugs.add(count === 1 ? slug : `${slug}-${count - 1}`)
  }
  return slugs
}

// Explicit `<a id="...">` / `<a name="...">` targets in a file, outside
// fenced code blocks like headings are.
const explicitAnchors = (content: string): Set<string> => {
  let fence = ''
  const ids = new Set<string>()
  for (const line of contentLines(content)) {
    const mark = fenceMark(line)
    fence = nextFence(fence, mark, line)
    if (fence || mark) continue
    for (const m of line.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) ids.add(m[1])
  }
  return ids
}

// Inline links and images outside fenced code blocks and inline code spans.
const inlineLinks = (content: string): { line: number; target: string }[] => {
  let fence = ''
  const out: { line: number; target: string }[] = []
  contentLines(content).forEach((raw, i) => {
    const mark = fenceMark(raw)
    fence = nextFence(fence, mark, raw)
    if (fence || mark) return
    for (const target of linkTargets(stripInlineCode(raw)))
      out.push({ line: i + 1, target })
  })
  return out
}

// files maps a repo-relative path to its content; every link in every file is
// checked against the map (Markdown anchors) and the tracked-path set.
// symlinked maps a symlink path to its target's content, so anchors resolve
// through links like CLAUDE.md#x even though the symlink is not a source.
const brokenLinks = (
  files: Map<string, string>,
  symlinked: Map<string, string> = new Map(),
  exists: (repoPath: string) => boolean = (p) => trackedPathSet().has(p)
): Failure[] => {
  const headings = new Map<string, Set<string>>(
    [...files, ...symlinked].map(([p, c]) => [p, headingSlugs(c)])
  )
  const anchors = new Map<string, Set<string>>(
    [...files, ...symlinked].map(([p, c]) => [p, explicitAnchors(c)])
  )
  const failures: Failure[] = []
  for (const [source, content] of files) {
    for (const { line, target } of inlineLinks(content)) {
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target)) continue // URI scheme
      const hash = target.indexOf('#')
      const filePart = (hash === -1 ? target : target.slice(0, hash))
        .split('?')[0]
        .replace(/\/+$/, '')
      const anchor = hash === -1 ? null : target.slice(hash + 1)
      // GitHub resolves issue/PR template links from the repo root, not the
      // template's directory.
      const fromRoot = filePart.startsWith('/') || templateFile(source)
      const resolved = fromRoot
        ? path.posix.normalize(filePart).replace(/^\//, '')
        : filePart === ''
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

// GitHub issue/PR templates under .github/.
const templateFile = (source: string): boolean =>
  source.startsWith('.github/') && /TEMPLATE\.md$/.test(source)

// Every path git tracks plus its parent directories, so a link to a folder
// resolves; compared case-sensitively, so a wrong-case link fails on macOS too.
let trackedPaths: Set<string> | null = null
const trackedPathSet = (): Set<string> => {
  if (trackedPaths) return trackedPaths
  trackedPaths = new Set()
  for (const p of execFileSync('git', ['ls-files'], { cwd: ROOT })
    .toString()
    .split('\n')) {
    if (p === '' || p.startsWith('node_modules/')) continue
    trackedPaths.add(p)
    for (
      let dir = path.posix.dirname(p);
      dir !== '.';
      dir = path.posix.dirname(dir)
    )
      trackedPaths.add(dir)
  }
  return trackedPaths
}

// Tracked Markdown files split into link sources and symlinks (CLAUDE.md ->
// AGENTS.md); symlinks are not sources so a failure is not reported twice,
// but their target's content is kept for anchor lookups.
const trackedMarkdown = (): [string[], Map<string, string>] => {
  const sources: string[] = []
  const symlinked = new Map<string, string>()
  for (const p of execFileSync('git', ['ls-files', '*.md'], { cwd: ROOT })
    .toString()
    .split('\n')) {
    if (p === '' || p.startsWith('node_modules/')) continue
    if (fs.lstatSync(path.join(ROOT, p)).isSymbolicLink()) {
      try {
        symlinked.set(
          p,
          docContent(path.relative(ROOT, fs.realpathSync(path.join(ROOT, p))))
        )
      } catch {
        // Dangling or unreadable (e.g. directory) symlink: skip it, so a link
        // into it fails with the normal not-found/anchor reason instead.
      }
    } else sources.push(p)
  }
  return [sources, symlinked]
}

const docContent = (p: string): string =>
  fs.readFileSync(path.join(ROOT, p), 'utf8')

describe('documentation links', () => {
  const [sources, symlinked] = trackedMarkdown()
  const files = new Map<string, string>(sources.map((p) => [p, docContent(p)]))
  const failures = brokenLinks(files, symlinked)

  it('every tracked-doc link resolves', () => {
    const report = failures
      .map((f) => `${f.source}:${f.line} -> ${f.target} (${f.reason})`)
      .join('\n')
    expect(report).toBe('')
  })

  it('reports a broken link and passes fenced, titled and badge ones', () => {
    const sample = new Map([
      [
        'docs/a.md',
        [
          'See [good](b.md#section) and [bad](b.md#nope).',
          '```md',
          '[fenced](b.md#nope)',
          '```',
          '````',
          '```',
          '[fenced](b.md#nope)',
          '```',
          '````',
          '```',
          '``` js',
          '[info closer](b.md#nope)',
          '```',
          'Pass [titled](b.md#section "t"), [single](b.md#section \'t\'),',
          '[angle](<b.md#section>), [root](/docs/b.md#section), [q](b.md?raw#section),',
          '[![i](nope.png)](b.md#section), [c](c.md#link-text) and [d](c.md#indented).',
          'Inline `[x](b.md#nope)` code is not a link.',
          'Symlinked anchors: [ok](CLAUDE.md#real-section) resolves while',
          '[missing](CLAUDE.md#missing) does not; of the explicit anchors',
          '[real](b.md#real) is outside fences while [fenced](b.md#fenced) sits in one.',
          ''
        ].join('\n')
      ],
      [
        'docs/b.md',
        '## Section\n\n<a id="real"></a>\n\n```html\n<a id="fenced"></a>\n```\n'
      ],
      ['docs/c.md', '## [Link](a.md) text\n\n   ## Indented\n'],
      [
        'docs/crlf.md',
        [
          'See [crlf good](b.md#section) and [crlf bad](b.md#nope).',
          '```md',
          '[fenced crlf](b.md#nope)',
          '```',
          ''
        ].join('\r\n')
      ]
    ])
    const symlinked = new Map([
      ['docs/CLAUDE.md', '## Real Section\n\nText.\n']
    ])
    expect(
      brokenLinks(sample, symlinked, (p) => p !== 'docs/nope.png')
    ).toEqual([
      {
        source: 'docs/a.md',
        line: 1,
        target: 'b.md#nope',
        reason: '#nope not found in docs/b.md'
      },
      {
        source: 'docs/a.md',
        line: 16,
        target: 'nope.png',
        reason: 'docs/nope.png does not exist'
      },
      {
        source: 'docs/a.md',
        line: 19,
        target: 'CLAUDE.md#missing',
        reason: '#missing not found in docs/CLAUDE.md'
      },
      {
        source: 'docs/a.md',
        line: 20,
        target: 'b.md#fenced',
        reason: '#fenced not found in docs/b.md'
      },
      {
        source: 'docs/crlf.md',
        line: 1,
        target: 'b.md#nope',
        reason: '#nope not found in docs/b.md'
      }
    ])
  })
})
