#!/usr/bin/env -S node scripts/run.cjs
// Per-route first-load JavaScript report, read from the stats `next build`
// writes to `.next/diagnostics/route-bundle-stats.json`. See
// docs/maintenance.md ("Bundle Size Report").
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

export interface RouteBundleStat {
  route: string
  firstLoadUncompressedJsBytes: number
  firstLoadChunkPaths: string[]
}

export interface RouteSize {
  route: string
  rawBytes: number
  gzipBytes: number
}

export interface BundleSummary {
  routes: RouteSize[]
  sharedChunkCount: number
  sharedRawBytes: number
  sharedGzipBytes: number
}

export interface ChunkSize {
  rawBytes: number
  gzipBytes: number
}

export interface RouteDelta {
  route: string
  beforeGzipBytes: number
  afterGzipBytes: number
  deltaGzipBytes: number
}

export interface BundleComparison {
  changed: RouteDelta[]
  unchanged: number
  added: RouteSize[]
  removed: RouteSize[]
  totalDeltaGzipBytes: number
}

export interface RouteBudget {
  gzipBytes: number
  rawBytes: number
}

export interface RouteBudgetViolation {
  route: string
  reason: 'missing' | 'gzip' | 'raw'
  actualBytes?: number
  budgetBytes?: number
  message: string
}

export interface ReportOptions {
  json?: string
  compare?: string
  root: string
  limit?: number
  check: boolean
  help: boolean
}

export const STATS_PATH = '.next/diagnostics/route-bundle-stats.json'

const kib = (n: number) => n * 1024

// Current build plus 15 KiB gzip / 45 KiB raw rounded up to the next KiB: build-to-build variance of these numbers is 0 bytes over 5 identical builds, normal feature drift between recent commits was ~7.5 KiB gzip, and the smallest regression to catch (losing the composer/reaction-picker split on /tags/[tag]) is ~29 KiB gzip; profile/status splits ~74–82 KiB.
export const PUBLIC_ROUTE_JS_BUDGETS: Record<string, RouteBudget> = {
  '/': { gzipBytes: kib(560), rawBytes: kib(1723) },
  '/[actor]': { gzipBytes: kib(513), rawBytes: kib(1584) },
  '/[actor]/[status]': { gzipBytes: kib(514), rawBytes: kib(1586) },
  '/tags/[tag]': { gzipBytes: kib(510), rawBytes: kib(1573) },
  '/[actor]/followers': { gzipBytes: kib(402), rawBytes: kib(1260) },
  '/[actor]/following': { gzipBytes: kib(402), rawBytes: kib(1260) },
  '/[actor]/albums/[id]': { gzipBytes: kib(397), rawBytes: kib(1257) }
}

export function parseArgs(args: string[]): ReportOptions {
  const options: ReportOptions = {
    root: process.cwd(),
    check: false,
    help: false
  }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const value = () => {
      const next = args[++i]
      if (next === undefined) throw new Error(`${arg} needs a value`)
      return next
    }
    if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--check') options.check = true
    else if (arg === '--json') options.json = value()
    else if (arg.startsWith('--json=')) options.json = arg.slice(7)
    else if (arg === '--compare') options.compare = value()
    else if (arg.startsWith('--compare=')) options.compare = arg.slice(10)
    else if (arg === '--root') options.root = value()
    else if (arg === '--limit') {
      const limit = Number(value())
      if (!Number.isInteger(limit) || limit < 1)
        throw new Error('--limit needs a positive integer')
      options.limit = limit
    } else throw new Error(`Unknown argument: ${arg}`)
  }
  return options
}

export function summarize(
  stats: RouteBundleStat[],
  sizeOf: (chunkPath: string) => ChunkSize
): BundleSummary {
  const counts = new Map<string, number>()
  for (const stat of stats) {
    for (const chunk of new Set(stat.firstLoadChunkPaths)) {
      counts.set(chunk, (counts.get(chunk) ?? 0) + 1)
    }
  }
  const shared =
    stats.length === 0
      ? []
      : [...counts].filter(([, n]) => n === stats.length).map(([c]) => c)
  const routes = stats
    .map((stat) => ({
      route: stat.route,
      rawBytes: stat.firstLoadUncompressedJsBytes,
      gzipBytes: [...new Set(stat.firstLoadChunkPaths)].reduce(
        (sum, chunk) => sum + sizeOf(chunk).gzipBytes,
        0
      )
    }))
    .sort((a, b) => b.gzipBytes - a.gzipBytes || a.route.localeCompare(b.route))
  return {
    routes,
    sharedChunkCount: shared.length,
    sharedRawBytes: shared.reduce((s, c) => s + sizeOf(c).rawBytes, 0),
    sharedGzipBytes: shared.reduce((s, c) => s + sizeOf(c).gzipBytes, 0)
  }
}

export function compareRoutes(
  before: RouteSize[],
  after: RouteSize[]
): BundleComparison {
  const beforeByRoute = new Map(before.map((r) => [r.route, r]))
  const afterByRoute = new Map(after.map((r) => [r.route, r]))
  const changed: RouteDelta[] = []
  let unchanged = 0
  for (const route of after) {
    const old = beforeByRoute.get(route.route)
    if (!old) continue
    const delta = route.gzipBytes - old.gzipBytes
    if (delta === 0) unchanged++
    else
      changed.push({
        route: route.route,
        beforeGzipBytes: old.gzipBytes,
        afterGzipBytes: route.gzipBytes,
        deltaGzipBytes: delta
      })
  }
  changed.sort(
    (a, b) =>
      Math.abs(b.deltaGzipBytes) - Math.abs(a.deltaGzipBytes) ||
      a.route.localeCompare(b.route)
  )
  return {
    changed,
    unchanged,
    added: after.filter((r) => !beforeByRoute.has(r.route)),
    removed: before.filter((r) => !afterByRoute.has(r.route)),
    totalDeltaGzipBytes: changed.reduce((s, r) => s + r.deltaGzipBytes, 0)
  }
}

const kb = (bytes: number) => (bytes / 1024).toFixed(1)
// Every delta carries its unit: bytes under 1 KB (so a nonzero delta never
// reads as 0.0 KB), KB otherwise, and "0 B" for no change.
const signedKb = (bytes: number) => {
  if (bytes === 0) return '0 B'
  const sign = bytes > 0 ? '+' : '-'
  const size = Math.abs(bytes)
  return size < 1024 ? `${sign}${size} B` : `${sign}${kb(size)} KB`
}

export function formatSummary(summary: BundleSummary, limit?: number): string {
  const rows = limit ? summary.routes.slice(0, limit) : summary.routes
  const lines = [
    `Routes: ${summary.routes.length}`,
    `Shared by every route: ${summary.sharedChunkCount} chunks, ${kb(summary.sharedGzipBytes)} KB gzip, ${kb(summary.sharedRawBytes)} KB raw`,
    '',
    `${'gzip KB'.padStart(9)} ${'raw KB'.padStart(9)}  route`
  ]
  for (const r of rows) {
    lines.push(
      `${kb(r.gzipBytes).padStart(9)} ${kb(r.rawBytes).padStart(9)}  ${r.route}`
    )
  }
  if (rows.length < summary.routes.length) {
    lines.push(`... ${summary.routes.length - rows.length} more routes`)
  }
  return lines.join('\n')
}

export function formatComparison(c: BundleComparison): string {
  const lines = [
    `Compared with the earlier report: total gzip ${signedKb(c.totalDeltaGzipBytes)} across ${c.changed.length} changed routes (${c.unchanged} unchanged)`
  ]
  if (c.changed.length) {
    lines.push('', `${'delta'.padStart(9)} ${'now KB'.padStart(9)}  route`)
    for (const r of c.changed) {
      lines.push(
        `${signedKb(r.deltaGzipBytes).padStart(9)} ${kb(r.afterGzipBytes).padStart(9)}  ${r.route}`
      )
    }
  }
  for (const r of c.added) {
    lines.push(`added:   ${r.route} (${kb(r.gzipBytes)} KB gzip)`)
  }
  for (const r of c.removed) {
    lines.push(`removed: ${r.route} (was ${kb(r.gzipBytes)} KB gzip)`)
  }
  return lines.join('\n')
}

export function checkRouteBudgets(
  routes: RouteSize[],
  budgets: Record<string, RouteBudget> = PUBLIC_ROUTE_JS_BUDGETS
): RouteBudgetViolation[] {
  const byRoute = new Map(routes.map((r) => [r.route, r]))
  const violations: RouteBudgetViolation[] = []
  for (const [route, budget] of Object.entries(budgets)) {
    const actual = byRoute.get(route)
    if (!actual) {
      violations.push({
        route,
        reason: 'missing',
        message: `${route}: missing from build`
      })
      continue
    }
    if (actual.gzipBytes > budget.gzipBytes) {
      violations.push({
        route,
        reason: 'gzip',
        actualBytes: actual.gzipBytes,
        budgetBytes: budget.gzipBytes,
        message: `${route}: gzip ${kb(actual.gzipBytes)} KB exceeds budget ${kb(budget.gzipBytes)} KB (${signedKb(actual.gzipBytes - budget.gzipBytes)})`
      })
    }
    if (actual.rawBytes > budget.rawBytes) {
      violations.push({
        route,
        reason: 'raw',
        actualBytes: actual.rawBytes,
        budgetBytes: budget.rawBytes,
        message: `${route}: raw ${kb(actual.rawBytes)} KB exceeds budget ${kb(budget.rawBytes)} KB (${signedKb(actual.rawBytes - budget.rawBytes)})`
      })
    }
  }
  return violations
}

function readJson(file: string, hint: string): unknown {
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    throw new Error(`Cannot read ${file}. ${hint}`)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${file} is not valid JSON. ${hint}`)
  }
}

export function loadStats(root: string): RouteBundleStat[] {
  const file = path.join(root, STATS_PATH)
  const data = readJson(file, 'Run `yarn build` first.')
  if (!Array.isArray(data)) {
    throw new Error(`${file} is not a route list. Run \`yarn build\` again.`)
  }
  return data as RouteBundleStat[]
}

export function loadEarlierRoutes(file: string): RouteSize[] {
  const data = readJson(file, 'Write one with `--json <file>` first.') as {
    routes?: RouteSize[]
  }
  if (!Array.isArray(data?.routes)) {
    throw new Error(`${file} has no "routes" list; was it written by --json?`)
  }
  return data.routes
}

export function makeChunkSizer(root: string) {
  const cache = new Map<string, ChunkSize>()
  return (chunkPath: string): ChunkSize => {
    let size = cache.get(chunkPath)
    if (!size) {
      const bytes = fs.readFileSync(path.join(root, chunkPath))
      size = {
        rawBytes: bytes.length,
        gzipBytes: zlib.gzipSync(bytes, { level: 9 }).length
      }
      cache.set(chunkPath, size)
    }
    return size
  }
}

const USAGE = `Usage: yarn bundle:report [--check] [--json <file>] [--compare <file>] [--limit <n>] [--root <dir>]

Prints first-load JavaScript per route (largest gzip first) from the last
\`yarn build\`. --check verifies PUBLIC_ROUTE_JS_BUDGETS and exits non-zero on
any violation. --json writes the per-route results; --compare reads such a
file from an earlier build and prints the gzip change per route. --root sets
the project directory that holds .next (default: the current directory).`

export function main(args: string[]): number {
  const options = parseArgs(args)
  if (options.help) {
    console.log(USAGE)
    return 0
  }
  // Read the earlier report first so a bad --compare fails before any output
  // and before --json is written.
  const earlier = options.compare
    ? loadEarlierRoutes(options.compare)
    : undefined
  const summary = summarize(
    loadStats(options.root),
    makeChunkSizer(options.root)
  )
  console.log(formatSummary(summary, options.limit))
  if (earlier) {
    const comparison = compareRoutes(earlier, summary.routes)
    console.log(`\n${formatComparison(comparison)}`)
  }
  if (options.json) {
    fs.writeFileSync(options.json, `${JSON.stringify(summary, null, 2)}\n`)
    console.log(`\nWrote ${options.json}`)
  }
  if (options.check) {
    const violations = checkRouteBudgets(summary.routes)
    if (violations.length > 0) {
      console.error(
        `\nRoute JS budget violations (${violations.length}):\n${violations.map((v) => `  ${v.message}`).join('\n')}`
      )
      return 1
    }
    console.log(
      `\nAll ${Object.keys(PUBLIC_ROUTE_JS_BUDGETS).length} budgeted routes within JS limits.`
    )
  }
  return 0
}

if (
  process.argv[1]?.endsWith('bundleReport.ts') ||
  process.argv[1]?.endsWith('bundleReport.js')
) {
  try {
    process.exit(main(process.argv.slice(2)))
  } catch (err) {
    console.error(`bundle:report: ${err instanceof Error ? err.message : err}`)
    process.exit(1)
  }
}
