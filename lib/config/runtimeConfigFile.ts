import { isRecord } from './utils'

let cachedRuntimeConfigFile: Record<string, unknown> | null | undefined

export const readRuntimeConfigFile = (): Record<string, unknown> | null => {
  if (cachedRuntimeConfigFile !== undefined) return cachedRuntimeConfigFile

  try {
    // Proxy runs in the Node.js runtime in Next 16; dynamic builtin lookup keeps
    // fs/path out of the static proxy import graph while preserving runtime IO.
    const fs = process.getBuiltinModule('fs')
    const path = process.getBuiltinModule('path')
    const parsed = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'config.json'), 'utf-8')
    )

    cachedRuntimeConfigFile = isRecord(parsed) ? parsed : null
    return cachedRuntimeConfigFile
  } catch {
    cachedRuntimeConfigFile = null
    return null
  }
}

export const resetRuntimeConfigFileCacheForTests = () => {
  if (process.env.JEST_WORKER_ID === undefined) {
    throw new Error('resetRuntimeConfigFileCacheForTests is test-only')
  }

  cachedRuntimeConfigFile = undefined
}
