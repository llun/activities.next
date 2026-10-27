import { logger } from '@/lib/utils/logger'

// The largest archive upload the importer accepts, in bytes.
export const DEFAULT_ACCOUNT_IMPORT_MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024

export type AccountImportConfig = {
  maxFileSize: number
}

const getMaxFileSize = (): number => {
  const raw = process.env.ACTIVITIES_ACCOUNT_IMPORT_MAX_FILE_SIZE
  if (!raw) return DEFAULT_ACCOUNT_IMPORT_MAX_FILE_SIZE
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    logger.warn(
      `Invalid ACTIVITIES_ACCOUNT_IMPORT_MAX_FILE_SIZE value "${raw}"; using the default`
    )
    return DEFAULT_ACCOUNT_IMPORT_MAX_FILE_SIZE
  }
  return parsed
}

export const getAccountImportConfig = (): AccountImportConfig => ({
  maxFileSize: getMaxFileSize()
})
