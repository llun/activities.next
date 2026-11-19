#!/usr/bin/env -S node scripts/run.cjs
// Keeps the instruction files agents read from growing and keeps history out
// of them. See CONTRIBUTING.md ("Documentation Maintenance").
//
//   yarn context:budget [--base <git ref>] [--update]
//
// Reads context-budget.json at the repository root:
//   target   bytes a budgeted file may grow to once it is under it.
//   files    { path: ceiling } in bytes. A file may never be bigger than its
//            ceiling, and a ceiling may never be above max(size, target): when
//            a file shrinks its ceiling comes down with it (--update writes
//            the lowered ceilings).
//   routes   files whose links to other Markdown files are required reading.
//            Only reported: how much each line makes a reader open.
// Lines a change adds to a budgeted file, or to a file a route links to, may
// not carry PR or issue numbers, phase numbers or "since <date>". A line the
// same change removes elsewhere was moved, not added. Needs --base; on a pull
// request in CI the base is the merge commit's first parent.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export interface BudgetConfig {
  target?: number
  targets?: Record<string, number>
  files?: Record<string, number>
  routes?: string[]
  history?: string[]
}

export interface AddedLine {
  file: string
  line: number
  text: string
}

export const HISTORY = [
  /(^|[\s([])#\d{1,5}(?![\w-])/,
  /\bPRs? ?#?\d+[a-z]?\d*\b/i,
  /\bphase \d+/i,
  /\bsince (\d{1,2} )?(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* (\d{1,2},? )?\d{4}\b/i,
  /\bsince \d{4}-\d{2}-\d{2}\b/i
]

export const historyHit = (line: string) =>
  HISTORY.some((pattern) => pattern.test(line))

// GitHub's heading slug: lower case, punctuation dropped, spaces to hyphens.
export const slug = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-')

// Bytes from an anchor (an `<a id>` or a heading's slug) to the next heading
// of the same or a higher level.
export function sectionBytes(text: string, anchor: string): number | null {
  const lines = text.split('\n')
  // A `#` line inside a code fence is a comment, not a heading. A fence
  // closes on its opening character, at least as long, with nothing after it.
  let fence: string | null = null
  const inFence: boolean[] = []
  const headings = lines.map((row, index) => {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(row)
    const opens =
      fence === null &&
      marker !== null &&
      !(marker[1][0] === '`' && marker[2].includes('`'))
    inFence[index] = fence !== null || opens
    if (opens && marker) fence = marker[1]
    else if (
      fence !== null &&
      marker &&
      marker[1][0] === fence[0] &&
      marker[1].length >= fence.length &&
      !marker[2].trim()
    )
      fence = null
    else if (fence === null) return /^(#{1,6})\s+(.*)$/.exec(row)
    return null
  })
  let start = -1
  for (let i = 0; i < lines.length && start < 0; i++) {
    if (!inFence[i] && lines[i].includes(`id="${anchor}"`)) start = i
    const heading = headings[i]
    if (heading && slug(heading[2]) === anchor) start = i
  }
  if (start < 0) return null
  let level = 7
  let end = lines.length
  for (let i = start; i < lines.length; i++) {
    const heading = headings[i]
    if (!heading) continue
    if (level === 7) level = heading[1].length
    else if (heading[1].length <= level) {
      end = i
      break
    }
  }
  return Buffer.byteLength(lines.slice(start, end).join('\n'))
}

export function routeLinks(text: string, from: string) {
  const out: {
    line: number
    links: { file: string; anchor: string | null }[]
  }[] = []
  text.split('\n').forEach((line, index) => {
    const links: { file: string; anchor: string | null }[] = []
    for (const match of line.matchAll(/\]\(([^)\s#]+\.md)(?:#([^)\s]+))?\)/g)) {
      if (/^[a-z]+:/i.test(match[1])) continue
      links.push({
        file: path.normalize(path.join(path.dirname(from), match[1])),
        anchor: match[2] ?? null
      })
    }
    if (links.length) out.push({ line: index + 1, links })
  })
  return out
}

export function parseAdded(diffText: string, files: string[]): AddedLine[] {
  const wanted = new Set(files)
  const added: AddedLine[] = []
  const removed = new Set<string>()
  let file: string | null = null
  let line = 0
  // `+++ ` and `--- ` are file headers only between `diff --git` and the
  // first hunk; inside a hunk they are an added `++ ` or removed `-- ` line.
  let header = false
  for (const row of diffText.split('\n')) {
    if (row.startsWith('diff --git ')) {
      header = true
      file = null
    } else if (header && row.startsWith('+++ '))
      file = row.startsWith('+++ b/') ? row.slice(6).replace(/\t$/, '') : null
    else if (header && row.startsWith('--- ')) continue
    else if (row.startsWith('@@ ')) {
      header = false
      line = Number(/\+(\d+)/.exec(row)?.[1] ?? 0)
    } else if (header) continue
    else if (row.startsWith('-')) removed.add(row.slice(1).trim())
    else if (row.startsWith('+')) {
      if (file && wanted.has(file))
        added.push({ file, line, text: row.slice(1) })
      line++
    }
  }
  return added.filter((entry) => !removed.has(entry.text.trim()))
}

const isFile = (root: string, file: string) => {
  const full = path.join(root, file)
  if (!fs.existsSync(full)) return false
  const stat = fs.lstatSync(full)
  return stat.isFile() && !stat.isSymbolicLink()
}

export function check(
  root: string,
  config: BudgetConfig,
  options: {
    base?: string | null
    diff?: (files: string[]) => AddedLine[]
  } = {}
) {
  const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')
  const errors: string[] = []
  // Ceilings left above max(size, target): the errors --update fixes.
  const stale: string[] = []
  const notes: string[] = []
  const target = config.target ?? 12288
  const ceilings: Record<string, number> = { ...config.files }
  for (const [file, ceiling] of Object.entries(ceilings)) {
    if (!isFile(root, file)) {
      errors.push(`${file} is in context-budget.json but is not a file here.`)
      continue
    }
    const size = Buffer.byteLength(read(file))
    const goal = config.targets?.[file] ?? target
    const allowed = Math.max(size, goal)
    if (size > ceiling)
      errors.push(
        `${file} is ${size} bytes, over its ceiling of ${ceiling}. Replace or move text instead of adding it (a rule a test can check becomes the test), or raise the ceiling in context-budget.json and say why in the PR.`
      )
    else if (ceiling > allowed) {
      const error = `${file} is ${size} bytes, so its ceiling of ${ceiling} must come down to ${allowed}: run yarn context:budget --update.`
      errors.push(error)
      stale.push(error)
    } else
      notes.push(
        `${file}: ${size} of ${ceiling} bytes${size > goal ? ` (target ${goal})` : ''}`
      )
    ceilings[file] = Math.min(ceiling, allowed)
  }

  const required = new Set<string>()
  for (const route of config.routes ?? []) {
    if (!isFile(root, route)) {
      errors.push(`route ${route} is not a file here.`)
      continue
    }
    const totals: { line: number; bytes: number }[] = []
    for (const { line, links } of routeLinks(read(route), route)) {
      let bytes = 0
      for (const { file, anchor } of links) {
        if (!isFile(root, file)) {
          errors.push(
            `${route}:${line} links to ${file}, which is not a file here.`
          )
          continue
        }
        required.add(file)
        const text = read(file)
        const part = anchor
          ? sectionBytes(text, anchor)
          : Buffer.byteLength(text)
        if (part === null)
          errors.push(
            `${route}:${line} links to ${file}#${anchor}, which has no such anchor.`
          )
        else bytes += part
      }
      totals.push({ line, bytes })
    }
    if (totals.length) {
      const sorted = totals.map((total) => total.bytes).sort((a, b) => a - b)
      const top = [...totals].sort((a, b) => b.bytes - a.bytes).slice(0, 3)
      notes.push(
        `${route}: required reading per line, median ${sorted[Math.floor(sorted.length / 2)]} bytes, largest ${top.map((total) => `${total.bytes} (line ${total.line})`).join(', ')}`
      )
    }
  }

  if (options.base) {
    const files = [
      ...new Set([
        ...Object.keys(config.files ?? {}),
        ...required,
        ...(config.history ?? [])
      ])
    ].filter((file) => isFile(root, file))
    const added = options.diff
      ? options.diff(files)
      : addedLines(root, options.base, files)
    for (const { file, line, text } of added)
      if (historyHit(text))
        errors.push(
          `${file}:${line} adds history to an instruction file ("${text.trim().slice(0, 80)}"). Say what is true now; the PR and git keep the history.`
        )
  } else notes.push('no base ref, so added lines were not checked for history')

  return { errors, stale, notes, ceilings }
}

function addedLines(root: string, base: string, files: string[]) {
  if (!files.length) return []
  const git = (args: string[]) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 256 << 20
    })
  const mergeBase = git(['merge-base', base, 'HEAD']).trim()
  return parseAdded(
    git([
      '-c',
      'core.quotePath=false',
      'diff',
      '--no-color',
      '--no-ext-diff',
      '--no-renames',
      '--src-prefix=a/',
      '--dst-prefix=b/',
      '-U0',
      mergeBase
    ]),
    files
  )
}

export function main(argv: string[], cwd = process.cwd()) {
  let base: string | null = null
  let update = false
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base') {
      base = argv[++i] ?? ''
      if (!base || base.startsWith('--')) {
        console.error('--base needs a git ref')
        return 2
      }
    } else if (argv[i] === '--update') update = true
    else {
      console.error(`unknown argument ${argv[i]}`)
      return 2
    }
  }
  if (!base && process.env.GITHUB_EVENT_NAME === 'pull_request') base = 'HEAD^1'
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    encoding: 'utf8'
  }).trim()
  const configPath = path.join(root, 'context-budget.json')
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as BudgetConfig
  const { errors, stale, notes, ceilings } = check(root, config, { base })
  for (const note of notes) console.log(`ok   ${note}`)
  const failures = update
    ? errors.filter((error) => !stale.includes(error))
    : errors
  if (update) {
    fs.writeFileSync(
      configPath,
      `${JSON.stringify({ ...config, files: ceilings }, null, 2)}\n`
    )
    console.log('wrote lowered ceilings to context-budget.json')
  }
  for (const error of failures) console.log(`FAIL ${error}`)
  return failures.length ? 1 : 0
}

if (require.main === module) process.exit(main(process.argv.slice(2)))
