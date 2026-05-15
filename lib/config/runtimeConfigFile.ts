const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export const readRuntimeConfigFile = (): Record<string, unknown> | null => {
  try {
    const fs = process.getBuiltinModule('fs')
    const path = process.getBuiltinModule('path')
    const parsed = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'config.json'), 'utf-8')
    )

    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}
