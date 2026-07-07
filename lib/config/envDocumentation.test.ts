import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const configDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(configDir, '..', '..')

// Variables read by lib/config that intentionally have no row in
// docs/environment-variables.md. Add an entry here ONLY with a reason.
const UNDOCUMENTED_ALLOWLIST = new Set([
  // Deprecated: lib/config/auth.ts only warns that these are ignored.
  'ACTIVITIES_AUTH_GITHUB_ID',
  'ACTIVITIES_AUTH_GITHUB_SECRET'
])

// knexfile.js is the migration-CLI helper; its generic connection fallbacks
// (ACTIVITIES_DATABASE_HOST/PORT/USER/PASSWORD and the dev-only
// ACTIVITIES_DEFAULT_DATABASE_SQLITE_FILENAME) are internal, so the file is
// skipped below.
const SKIPPED_FILES = new Set(['knexfile.js'])

describe('environment variable documentation', () => {
  it('documents every ACTIVITIES_*/OTEL_* variable read in lib/config', () => {
    const sources = readdirSync(configDir)
      .filter((name) => /\.(ts|js)$/.test(name))
      .filter((name) => !/\.test\.ts$/.test(name))
      .filter((name) => !SKIPPED_FILES.has(name))
      .map((name) => readFileSync(join(configDir, name), 'utf8'))
      .join('\n')
    const docs = readFileSync(
      join(repoRoot, 'docs', 'environment-variables.md'),
      'utf8'
    )

    const variables = [
      ...new Set(sources.match(/(?:ACTIVITIES|OTEL)_[A-Z0-9_]*[A-Z0-9]/g) ?? [])
    ].filter((name) => !UNDOCUMENTED_ALLOWLIST.has(name))

    expect(variables.length).toBeGreaterThan(50)

    const undocumented = variables.filter((name) => !docs.includes(name))
    expect(undocumented).toEqual([])
  })
})
