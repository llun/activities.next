import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = path.join(root, 'test-audit/raw/coverage-lines.jsonl')
const coverageRoot = path.join(root, 'test-audit/.cov')
const args = process.argv.slice(2)
const dirs = args.filter((arg, index) => !arg.startsWith('--') && args[index - 1] !== '--concurrency' && args[index - 1] !== '--limit')
const value = (name, fallback) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : fallback
}
const concurrency = Math.max(1, Number(value('--concurrency', Math.max(1, Math.floor(os.cpus().length / 2)))))
const limit = Number(value('--limit', 0))
const requested = dirs.length ? dirs : ['app/api', 'lib/services', 'lib/database', 'lib/jobs', 'lib/activities', 'lib/actions', 'lib/utils']

mkdirSync(path.dirname(output), { recursive: true })
mkdirSync(coverageRoot, { recursive: true })
const completed = new Set(
  (existsSync(output) ? readFileSync(output, 'utf8') : '')
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line).testFile]
      } catch {
        return []
      }
    })
)

function walk(dir) {
  return readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = path.posix.join(dir, entry.name)
    if (entry.isDirectory()) return walk(rel)
    return /\.test\.tsx?$/.test(entry.name) ? [rel] : []
  })
}

const files = [...new Set(requested.flatMap((dir) => walk(dir).sort()))].filter((file) => !completed.has(file)).slice(0, limit || undefined)
let cursor = 0
let passed = 0
let failed = 0

function runOne(testFile) {
  return new Promise((resolve) => {
    const slug = `${path.basename(testFile).replace(/[^a-zA-Z0-9_-]/g, '-')}-${createHash('sha1').update(testFile).digest('hex').slice(0, 10)}`
    const reportDir = path.join(coverageRoot, slug)
    rmSync(reportDir, { recursive: true, force: true })
    const started = Date.now()
    const command = process.platform === 'win32' ? 'yarn.cmd' : 'yarn'
    const child = spawn(command, [
      'vitest', 'run', testFile,
      '--coverage.enabled',
      '--coverage.provider=v8',
      '--coverage.reporter=json',
      `--coverage.reportsDirectory=${reportDir}`,
      '--coverage.include=app/**/*.{ts,tsx}',
      '--coverage.include=lib/**/*.{ts,tsx}',
      '--coverage.exclude=**/*.test.{ts,tsx}',
      '--coverage.exclude=**/__mocks__/**',
      '--coverage.exclude=**/mocks/**',
      '--coverage.exclude=**/stubs/**',
      '--coverage.exclude=**/*.stub.{ts,tsx}',
      '--coverage.exclude=**/*.mock.{ts,tsx}',
      '--coverage.reportOnFailure'
    ], { cwd: root, stdio: 'ignore' })
    child.on('error', () => finish(null, 1))
    child.on('close', (code) => finish(code, code ?? 1))

    function finish(code, status) {
      const duration = Date.now() - started
      let covered = []
      const report = path.join(reportDir, 'coverage-final.json')
      if (existsSync(report)) {
        try {
          const data = JSON.parse(readFileSync(report, 'utf8'))
          for (const [file, record] of Object.entries(data)) {
            const relative = path.relative(root, file).split(path.sep).join('/')
            for (const [key, count] of Object.entries(record.s || {})) {
              if (count > 0) {
                const line = record.statementMap?.[key]?.start?.line
                if (line) covered.push(`${relative}:${line}`)
              }
            }
          }
          covered = [...new Set(covered)].sort()
        } catch {}
      }
      appendFileSync(output, `${JSON.stringify({ testFile, ok: status === 0, ms: duration, covered })}\n`)
      rmSync(reportDir, { recursive: true, force: true })
      if (status === 0) passed++
      else failed++
      resolve({ code, count: covered.length })
    }
  })
}

async function worker() {
  while (cursor < files.length) {
    const file = files[cursor++]
    const result = await runOne(file)
    console.log(`${result.code === 0 ? 'OK' : 'FAIL'} ${file}: ${result.count} covered lines`)
  }
}

console.log(`Running ${files.length} files from ${requested.join(', ')} with concurrency ${concurrency}; ${completed.size} already recorded`)
await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker))
console.log(`Finished: ${passed} passed, ${failed} failed; results in test-audit/raw/coverage-lines.jsonl`)
