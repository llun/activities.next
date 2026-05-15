import fs from 'fs'
import path from 'path'

const SOURCE_ROOTS = ['app', 'lib']
const ROOT_SOURCE_FILES = ['next.config.ts', 'proxy.ts', 'instrumentation.ts']

const RUNTIME_CONFIG_PATTERN =
  /process\.env(?:\.(?:ACTIVITIES|OTEL_EXPORTER)_|\[['"](?:ACTIVITIES|OTEL_EXPORTER)_\w+['"]\])|['"](?:ACTIVITIES|OTEL_EXPORTER)_\w+['"]/

const isSourceFile = (filePath: string) =>
  /\.(ts|tsx)$/.test(filePath) && !/\.test\.(ts|tsx)$/.test(filePath)

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
        RUNTIME_CONFIG_PATTERN.test(fs.readFileSync(filePath, 'utf-8'))
      )
      .map((filePath) => path.relative(rootDirectory, filePath))

    expect(violations).toEqual([])
  })
})
