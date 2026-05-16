import fs from 'fs'
import path from 'path'

const SOURCE_ROOTS = ['app', 'lib']
const ROOT_SOURCE_FILES = [
  'next.config.ts',
  'proxy.ts',
  'instrumentation.ts',
  'knexfile.js'
]

const RUNTIME_CONFIG_PATTERN =
  /process\.env(?:\.(?:ACTIVITIES|OTEL_EXPORTER)_|\[['"](?:ACTIVITIES|OTEL_EXPORTER)_\w+['"]\])|=\s*['"](?:ACTIVITIES|OTEL_EXPORTER)_\w+['"]/

const IGNORED_SOURCE_PATH_SEGMENTS = [
  `${path.sep}__mocks__${path.sep}`,
  `${path.sep}fixtures${path.sep}`,
  `${path.sep}stub${path.sep}`
]

const isSourceFile = (filePath: string) =>
  /\.(ts|tsx|js|mjs)$/.test(filePath) &&
  !/\.(test|spec)\.(ts|tsx|js|mjs)$/.test(filePath) &&
  !IGNORED_SOURCE_PATH_SEGMENTS.some((segment) => filePath.includes(segment))

const hasRuntimeConfigAccessViolation = (source: string) =>
  RUNTIME_CONFIG_PATTERN.test(source)

const collectSourceFiles = (directory: string): string[] => {
  if (!fs.existsSync(directory)) return []

  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return collectSourceFiles(fullPath)
    return isSourceFile(fullPath) ? [fullPath] : []
  })
}

describe('runtime config access boundaries', () => {
  it('keeps ACTIVITIES and OTEL environment access inside config utilities', () => {
    const rootDirectory = process.cwd()
    const files = [
      ...SOURCE_ROOTS.flatMap((sourceRoot) =>
        collectSourceFiles(path.join(rootDirectory, sourceRoot))
      ),
      ...ROOT_SOURCE_FILES.map((fileName) => path.join(rootDirectory, fileName))
    ]
    const violations = files
      .filter(
        (filePath) =>
          !filePath.includes(`${path.sep}lib${path.sep}config${path.sep}`)
      )
      .filter((filePath) =>
        hasRuntimeConfigAccessViolation(fs.readFileSync(filePath, 'utf-8'))
      )
      .map((filePath) => path.relative(rootDirectory, filePath))

    expect(violations).toEqual([])
  })

  it('allows user-facing messages that mention runtime variable names', () => {
    expect(
      hasRuntimeConfigAccessViolation(
        "throw new Error('ACTIVITIES_HOST is required')"
      )
    ).toBe(false)
  })

  it('detects direct runtime environment reads', () => {
    expect(
      hasRuntimeConfigAccessViolation(
        'const host = process.env.ACTIVITIES_HOST'
      )
    ).toBe(true)
    expect(
      hasRuntimeConfigAccessViolation(
        "const headers = process.env['OTEL_EXPORTER_OTLP_HEADERS']"
      )
    ).toBe(true)
  })

  it('detects environment variable name constants', () => {
    expect(
      hasRuntimeConfigAccessViolation("const HOST_ENV = 'ACTIVITIES_HOST'")
    ).toBe(true)
  })

  it('ignores test scaffolding and fixtures', () => {
    expect(isSourceFile(path.join('lib', 'feature', 'sample.spec.ts'))).toBe(
      false
    )
    expect(
      isSourceFile(path.join('lib', 'feature', '__mocks__', 'config.ts'))
    ).toBe(false)
    expect(
      isSourceFile(path.join('lib', 'feature', 'fixtures', 'config.ts'))
    ).toBe(false)
    expect(isSourceFile(path.join('lib', 'stub', 'config.ts'))).toBe(false)
  })
})
