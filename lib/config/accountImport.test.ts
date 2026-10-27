import { getAccountImportConfig } from './accountImport'

describe('account import config', () => {
  const ORIGINAL = process.env.ACTIVITIES_ACCOUNT_IMPORT_MAX_FILE_SIZE

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env.ACTIVITIES_ACCOUNT_IMPORT_MAX_FILE_SIZE
    } else {
      process.env.ACTIVITIES_ACCOUNT_IMPORT_MAX_FILE_SIZE = ORIGINAL
    }
  })

  it('falls back to the 10 GiB default when nothing is set', () => {
    delete process.env.ACTIVITIES_ACCOUNT_IMPORT_MAX_FILE_SIZE
    expect(getAccountImportConfig().maxFileSize).toBe(10 * 1024 * 1024 * 1024)
  })

  it('reads a positive integer of bytes', () => {
    process.env.ACTIVITIES_ACCOUNT_IMPORT_MAX_FILE_SIZE = '123'
    expect(getAccountImportConfig().maxFileSize).toBe(123)
  })

  it('falls back to the default for an invalid value', () => {
    process.env.ACTIVITIES_ACCOUNT_IMPORT_MAX_FILE_SIZE = 'not-a-number'
    expect(getAccountImportConfig().maxFileSize).toBe(10 * 1024 * 1024 * 1024)
    process.env.ACTIVITIES_ACCOUNT_IMPORT_MAX_FILE_SIZE = '-5'
    expect(getAccountImportConfig().maxFileSize).toBe(10 * 1024 * 1024 * 1024)
    process.env.ACTIVITIES_ACCOUNT_IMPORT_MAX_FILE_SIZE = '0'
    expect(getAccountImportConfig().maxFileSize).toBe(10 * 1024 * 1024 * 1024)
  })
})
