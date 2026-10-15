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

export interface ReportOptions {
  json?: string
  compare?: string
  root: string
  limit?: number
  help: boolean
}

export const STATS_PATH = '.next/diagnostics/route-bundle-stats.json'

export function parseArgs(args: string[]): ReportOptions {
  const options: ReportOptions = { root: process.cwd(), help: false }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const value = () => {
      const next = args[++i]
      if (next === undefined) throw new Error(`${arg} needs a value`)
      return next
    }
    if (arg === '--help' || arg === '-h') options.help = true
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
const signedKb = (bytes: number) => `${bytes > 0 ? '+' : ''}${kb(bytes)}`

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
    `Compared with the earlier report: total gzip ${signedKb(c.totalDeltaGzipBytes)} KB across ${c.changed.length} changed routes (${c.unchanged} unchanged)`
  ]
  if (c.changed.length) {
    lines.push('', `${'delta KB'.padStart(9)} ${'now KB'.padStart(9)}  route`)
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

const USAGE = `Usage: yarn bundle:report [--json <file>] [--compare <file>] [--limit <n>]

Prints first-load JavaScript per route (largest gzip first) from the last
\`yarn build\`. --json writes the per-route results; --compare reads such a
file from an earlier build and prints the gzip change per route.`

export function main(args: string[]): number {
  const options = parseArgs(args)
  if (options.help) {
    console.log(USAGE)
    return 0
  }
  const summary = summarize(
    loadStats(options.root),
    makeChunkSizer(options.root)
  )
  console.log(formatSummary(summary, options.limit))
  if (options.compare) {
    const comparison = compareRoutes(
      loadEarlierRoutes(options.compare),
      summary.routes
    )
    console.log(`\n${formatComparison(comparison)}`)
  }
  if (options.json) {
    fs.writeFileSync(options.json, `${JSON.stringify(summary, null, 2)}\n`)
    console.log(`\nWrote ${options.json}`)
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
