import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'

const input = 'test-audit/raw/coverage-lines.jsonl.gz'
const csvPath = 'test-audit/raw/coverage-overlap.csv'
const mdPath = 'test-audit/03-coverage-overlap.md'
if (!existsSync(input)) throw new Error(`Missing coverage input: ${input}`)

const raw = gunzipSync(readFileSync(input)).toString('utf8')
const parsed = raw.split('\n').filter(Boolean).map((line) => JSON.parse(line))
const rows = parsed.filter((row) => row.ok).map((row) => ({
  ...row,
  covered: new Set(row.covered || [])
}))
const failed = parsed.filter((row) => !row.ok).map((row) => row.testFile)

const sourceFor = (line) => line.slice(0, line.lastIndexOf(':'))
const sourceDir = (file) => path.posix.dirname(file)
const isSource = (file) => /^(app|lib)\//.test(file) && !/\.test\.[tj]sx?$/.test(file)
const moduleCandidates = (testFile) => {
  const base = path.posix.basename(testFile).replace(/\.test\.[tj]sx?$/, '')
  const dir = sourceDir(testFile)
  return [`${dir}/${base}.ts`, `${dir}/${base}.tsx`, `${dir}/${base}/index.ts`, `${dir}/${base}/index.tsx`]
}
const moduleUnderTest = (row) => {
  const files = new Set([...row.covered].map(sourceFor))
  return moduleCandidates(row.testFile).find((candidate) => files.has(candidate))
}
const isTestingUtility = (file) =>
  /^lib\/database\/testing\//.test(file) ||
  /^migrations\//.test(file) ||
  /^lib\/config\//.test(file) ||
  /(?:\.test-helper(?:\.[^/]*)?|(?:^|\/)testing(?:\/|\.)|(?:^|\/)(?:testUtils?|testingUtils?)\.[^/]*)/.test(file)

// Baseline frequency is measured across successful test files, once per file per source line.
const frequency = new Map()
for (const row of rows) {
  for (const line of row.covered) {
    if (!isSource(sourceFor(line))) continue
    frequency.set(line, (frequency.get(line) || 0) + 1)
  }
}
const baselineLimit = rows.length * 0.05
const baselineRemoved = new Set([...frequency].filter(([, count]) => count > baselineLimit).map(([line]) => line))
const removedBySource = new Map()
for (const line of baselineRemoved) {
  const file = sourceFor(line)
  removedBySource.set(file, (removedBySource.get(file) || 0) + 1)
}
const topRemovedSources = [...removedBySource].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 20)

for (const row of rows) {
  row.moduleUnderTest = moduleUnderTest(row)
  row.distinctive = new Set([...row.covered].filter((line) => {
    const file = sourceFor(line)
    return isSource(file) && !baselineRemoved.has(line) && (!isTestingUtility(file) || file === row.moduleUnderTest)
  }))
}

const classify = (a, b) =>
  /^lib\/(services|database)\//.test(a.testFile) && /^app\/api\/.*route\.test\.[tj]sx?$/.test(b.testFile)
    ? 'route-contains-unit'
    : sourceDir(a.testFile) === sourceDir(b.testFile)
      ? 'same-directory'
      : 'other'
const pairMap = new Map()
const addPair = (category, a, b, shared, aLines, bLines, moduleFile = '') => {
  const containmentPct = (shared / aLines) * 100
  const key = `${category}\0${a.testFile}\0${b.testFile}`
  const existing = pairMap.get(key)
  const pair = { category, a: a.testFile, b: b.testFile, containmentPct, aDistinctLines: aLines, bDistinctLines: bLines, moduleUnderTest: moduleFile }
  if (!existing || (moduleFile && !existing.moduleUnderTest) || aLines > existing.aDistinctLines) pairMap.set(key, pair)
}

for (const a of rows) {
  if (a.distinctive.size < 10) continue
  for (const b of rows) {
    if (a === b || b.distinctive.size < a.distinctive.size * 0.9) continue
    let shared = 0
    for (const line of a.distinctive) if (b.distinctive.has(line)) shared++
    if (shared / a.distinctive.size < 0.9) continue
    addPair(classify(a, b), a, b, shared, a.distinctive.size, b.distinctive.size)
  }
}

// Module signal uses all covered lines in A's inferred module, even when baseline filtering removed them.
const moduleCoverage = new Map()
for (const row of rows) {
  if (!row.moduleUnderTest) continue
  const lines = new Set([...row.covered].filter((line) => sourceFor(line) === row.moduleUnderTest))
  if (!lines.size) continue
  moduleCoverage.set(row.testFile, { row, lines })
  for (const b of rows) {
    if (b === row) continue
    let shared = 0
    for (const line of lines) if (b.covered.has(line)) shared++
    if (shared / lines.size < 0.9) continue
    addPair(classify(row, b), row, b, shared, lines.size,
      [...b.covered].filter((line) => sourceFor(line) === row.moduleUnderTest).length,
      row.moduleUnderTest)
  }
}

const pairs = [...pairMap.values()].sort((a, b) =>
  b.containmentPct - a.containmentPct || b.aDistinctLines - a.aDistinctLines || a.a.localeCompare(b.a) || a.b.localeCompare(b.b))
const esc = (value) => {
  const string = String(value)
  return /[",\n]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string
}
const csvLines = ['category,A,B,containmentPct,aDistinctLines,bDistinctLines,moduleUnderTest']
for (const pair of pairs) csvLines.push([
  pair.category, pair.a, pair.b, pair.containmentPct.toFixed(2), pair.aDistinctLines,
  pair.bDistinctLines, pair.moduleUnderTest
].map(esc).join(','))
writeFileSync(csvPath, `${csvLines.join('\n')}\n`)

const dirsExpected = ['app/api', 'lib/services', 'lib/database', 'lib/jobs', 'lib/activities', 'lib/actions', 'lib/utils', 'lib/components', 'app/(timeline)']
const testFiles = rows.map((row) => row.testFile)
const dirsRan = dirsExpected.filter((dir) => testFiles.some((file) => file.startsWith(`${dir}/`)))
const dirsNotRun = dirsExpected.filter((dir) => !dirsRan.includes(dir))
const countCategory = (category) => pairs.filter((pair) => pair.category === category).length
const routePairs = pairs.filter((pair) => pair.category === 'route-contains-unit').slice(0, 60)
const sameDirPairs = pairs.filter((pair) => pair.category === 'same-directory').slice(0, 40)

const moduleTesters = new Map()
for (const moduleFile of new Set([...moduleCoverage.values()].map(({ row }) => row.moduleUnderTest))) {
  const testers = rows.filter((row) => [...row.covered].some((line) => sourceFor(line) === moduleFile))
  if (testers.length) moduleTesters.set(moduleFile, testers.map((row) => row.testFile))
}
const clusters = [...moduleTesters]
  .filter(([, files]) => files.length >= 3)
  .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
const clusterLines = []
for (let index = 0; index < clusters.length; index += 4) {
  clusterLines.push(`- ${clusters.slice(index, index + 4).map(([file, tests]) => `\`${file}\` (${tests.length}): ${tests.map((test) => `\`${test}\``).join(', ')}`).join(' · ')}`)
}

const tableRows = (list) => list.length
  ? list.map((pair) => `| ${pair.category} | \`${pair.a}\` | \`${pair.b}\` | ${pair.containmentPct.toFixed(2)}% | ${pair.aDistinctLines} | ${pair.bDistinctLines} | ${pair.moduleUnderTest ? `\`${pair.moduleUnderTest}\`` : '—'} |`)
  : ['| — | No qualifying pairs | — | — | — | — | — |']
const md = [
  '# Per-test coverage overlap', '',
  '## Method', '',
  `The script reads per-test V8 coverage from the gzip-compressed JSONL file. The baseline threshold is more than 5% of successful test files (${baselineLimit.toFixed(2)} files; any source line covered by at least ${Math.floor(baselineLimit) + 1} files is removed). It reports ${baselineRemoved.size.toLocaleString()} baseline lines across ${removedBySource.size.toLocaleString()} source files. Lines in \`lib/database/testing/**\`, \`migrations/**\`, \`lib/config/**\`, and named test helpers/testing utilities are also excluded unless that path is the current test's inferred module under test. On the remaining distinctive lines, A-in-B containment requires at least 90% and at least 10 distinctive lines in A. Module-focused containment independently compares A's covered lines in its inferred same-basename module (or \`index.ts[x]\`) against every other test; it requires at least 90%. These are coverage overlaps, not proof of equivalent assertions.`, '',
  '### Most frequently removed source files', '',
  '| Source file | Baseline lines removed |', '|---|---:|',
  ...topRemovedSources.map(([file, count]) => `| \`${file}\` | ${count} |`), '',
  '## Run coverage', '',
  `- Directories represented: ${dirsRan.join(', ') || 'none'}`,
  `- Directories not run: ${dirsNotRun.join(', ') || 'none'}`,
  `- Successful test files: ${rows.length}`,
  `- Failed test files: ${failed.length ? failed.map((file) => `\`${file}\``).join(', ') : 'none'}`,
  `- Route-contains-unit pairs: ${countCategory('route-contains-unit')}`,
  `- Same-directory pairs: ${countCategory('same-directory')}`,
  `- Other pairs: ${countCategory('other')}`,
  `- Baseline threshold removed ${baselineRemoved.size.toLocaleString()} lines across ${removedBySource.size.toLocaleString()} source files.`, '',
  '## Route contains unit: top 60', '',
  '| Category | A (contained unit test) | B (covering route test) | Containment | A lines | B lines | Module under test |', '|---|---|---|---:|---:|---:|---|',
  ...tableRows(routePairs), '',
  '## Same-directory: top 40', '',
  '| Category | A (contained) | B (covering) | Containment | A lines | B lines | Module under test |', '|---|---|---|---:|---:|---:|---|',
  ...tableRows(sameDirPairs), '',
  '## Module coverage clusters', '',
  ...(clusterLines.length ? clusterLines : ['No modules were covered by three or more tests.']), ''
].join('\n')
writeFileSync(mdPath, md)
console.log(JSON.stringify({ successful: rows.length, failed, baselineLimitFiles: baselineLimit, baselineRemovedLines: baselineRemoved.size, baselineRemovedSourceFiles: removedBySource.size, pairs: pairs.length, categories: { routeContainsUnit: countCategory('route-contains-unit'), sameDirectory: countCategory('same-directory'), other: countCategory('other') }, topRoutePairs: routePairs.slice(0, 5) }, null, 2))
