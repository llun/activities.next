import { getConfig } from '@/lib/config'
import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { DatabaseSeed } from '@/lib/stub/scenarios/database'

import { DEFAULT_QUOTA_PER_ACCOUNT } from './constants'
import { checkQuotaAvailable, getQuotaLimit } from './quota'

jest.mock('../../config')

const mockGetConfig = getConfig as jest.MockedFunction<typeof getConfig>

describe('Quota Service', () => {
  const { actors } = DatabaseSeed
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  describe('getQuotaLimit', () => {
    it('returns default quota when not configured', () => {
      mockGetConfig.mockReturnValue({
        mediaStorage: {}
      } as any)
      expect(getQuotaLimit()).toBe(DEFAULT_QUOTA_PER_ACCOUNT)
    })

    it('returns configured quota when set', () => {
      const customQuota = 500_000_000 // 500MB
      mockGetConfig.mockReturnValue({
        mediaStorage: { quotaPerAccount: customQuota }
      } as any)
      expect(getQuotaLimit()).toBe(customQuota)
    })
  })

  describe.each(table)('%s', (_, database) => {
    beforeAll(async () => {
      await seedDatabase(database)
    })

    afterAll(async () => {
      await database.destroy()
    })

    describe('checkQuotaAvailable', () => {
      it('returns available true when no media exists', async () => {
        mockGetConfig.mockReturnValue({
          mediaStorage: { quotaPerAccount: DEFAULT_QUOTA_PER_ACCOUNT }
        } as any)

        const actor = actors.primary
        const result = await checkQuotaAvailable(database, actor, 1000)

        expect(result.available).toBe(true)
        expect(result.used).toBe(0)
        expect(result.limit).toBe(DEFAULT_QUOTA_PER_ACCOUNT)
      })

      it('returns available false when quota would be exceeded', async () => {
        const smallQuota = 1000 // 1KB quota
        mockGetConfig.mockReturnValue({
          mediaStorage: { quotaPerAccount: smallQuota }
        } as any)

        // Create some media first
        await database.createMedia({
          actorId: actors.replyAuthor.id,
          original: {
            path: '/test/image.jpg',
            bytes: 500,
            mimeType: 'image/jpeg',
            metaData: { width: 100, height: 100 }
          }
        })

        const actor = actors.replyAuthor
        // Try to add 600 more bytes (would exceed 1000)
        const result = await checkQuotaAvailable(database, actor, 600)

        expect(result.available).toBe(false)
        expect(result.used).toBe(500)
        expect(result.limit).toBe(smallQuota)
      })

      it('returns available true when within quota', async () => {
        const mediumQuota = 10_000 // 10KB quota
        mockGetConfig.mockReturnValue({
          mediaStorage: { quotaPerAccount: mediumQuota }
        } as any)

        const actor = actors.pollAuthor
        // Try to add 1000 bytes (well within quota)
        const result = await checkQuotaAvailable(database, actor, 1000)

        expect(result.available).toBe(true)
        expect(result.used).toBeGreaterThanOrEqual(0)
        expect(result.limit).toBe(mediumQuota)
      })

      it('counts both original and thumbnail bytes', async () => {
        const mediumQuota = 10_000
        mockGetConfig.mockReturnValue({
          mediaStorage: { quotaPerAccount: mediumQuota }
        } as any)

        // Create media with thumbnail
        await database.createMedia({
          actorId: actors.extra.id,
          original: {
            path: '/test/image2.jpg',
            bytes: 1000,
            mimeType: 'image/jpeg',
            metaData: { width: 1000, height: 1000 }
          },
          thumbnail: {
            path: '/test/image2-thumb.jpg',
            bytes: 200,
            mimeType: 'image/jpeg',
            metaData: { width: 200, height: 200 }
          }
        })

        const actor = actors.extra
        const result = await checkQuotaAvailable(database, actor, 0)

        expect(result.used).toBe(1200) // 1000 + 200
      })
    })
  })
})
