import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { invalidateServerSettingsCache } from '@/lib/services/serverSettings'

import { MAX_FILE_SIZE } from './constants'
import {
  exceedsMaxMediaUploadSize,
  getMaxMediaUploadSize
} from './uploadSizeLimit'

describe('media upload size limit', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
  })

  afterAll(async () => {
    await database.destroy()
  })

  const setStoredMaxFileSize = async (value: number) => {
    await database.setServerSettings([{ key: 'media.maxFileSize', value }])
    invalidateServerSettingsCache(database)
  }

  beforeEach(async () => {
    await database.deleteServerSetting({ key: 'media.maxFileSize' })
    invalidateServerSettingsCache(database)
  })

  describe('getMaxMediaUploadSize', () => {
    it('falls back to the built-in default when nothing is stored', async () => {
      await expect(getMaxMediaUploadSize(database)).resolves.toBe(MAX_FILE_SIZE)
    })

    it('serves an admin-stored cap below the built-in default', async () => {
      await setStoredMaxFileSize(1_000)
      await expect(getMaxMediaUploadSize(database)).resolves.toBe(1_000)
    })

    it('serves an admin-stored cap above the built-in default', async () => {
      await setStoredMaxFileSize(MAX_FILE_SIZE * 2)
      await expect(getMaxMediaUploadSize(database)).resolves.toBe(
        MAX_FILE_SIZE * 2
      )
    })
  })

  describe('exceedsMaxMediaUploadSize', () => {
    it('returns false without any sizes to check', async () => {
      await expect(
        exceedsMaxMediaUploadSize([undefined, null], database)
      ).resolves.toBe(false)
    })

    it.each([
      {
        description: 'a size under the stored cap',
        sizes: [999],
        expected: false
      },
      {
        description: 'a size exactly at the stored cap',
        sizes: [1_000],
        expected: false
      },
      {
        description: 'a size over the stored cap',
        sizes: [1_001],
        expected: true
      },
      {
        description: 'any one of several sizes over the stored cap',
        sizes: [10, undefined, 1_001],
        expected: true
      },
      {
        description: 'no size over the stored cap',
        sizes: [10, undefined, 20],
        expected: false
      }
    ])('returns $expected for $description', async ({ sizes, expected }) => {
      await setStoredMaxFileSize(1_000)
      await expect(exceedsMaxMediaUploadSize(sizes, database)).resolves.toBe(
        expected
      )
    })

    it('accepts a file the admin raised the cap for', async () => {
      await setStoredMaxFileSize(MAX_FILE_SIZE * 2)
      await expect(
        exceedsMaxMediaUploadSize([MAX_FILE_SIZE + 1], database)
      ).resolves.toBe(false)
    })
  })
})
