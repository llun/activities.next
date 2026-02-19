import { getConfig } from '@/lib/config'
import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { DatabaseSeed } from '@/lib/stub/scenarios/database'

import { DEFAULT_QUOTA_PER_ACCOUNT } from './constants'
import { checkQuotaAvailable, getQuotaLimit } from './quota'

jest.mock('@/lib/config')

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
      } as unknown as ReturnType<typeof getConfig>)
      expect(getQuotaLimit()).toBe(DEFAULT_QUOTA_PER_ACCOUNT)
    })

    it('returns configured quota when set', () => {
      const customQuota = 500_000_000 // 500MB
      mockGetConfig.mockReturnValue({
        mediaStorage: { quotaPerAccount: customQuota }
      } as unknown as ReturnType<typeof getConfig>)
      expect(getQuotaLimit()).toBe(customQuota)
    })

    it('prefers fitness quota when both are configured', () => {
      mockGetConfig.mockReturnValue({
        fitnessStorage: { quotaPerAccount: 1234 },
        mediaStorage: { quotaPerAccount: 5678 }
      } as unknown as ReturnType<typeof getConfig>)
      expect(getQuotaLimit()).toBe(1234)
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
        } as unknown as ReturnType<typeof getConfig>)

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
        } as unknown as ReturnType<typeof getConfig>)

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
        } as unknown as ReturnType<typeof getConfig>)

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
        } as unknown as ReturnType<typeof getConfig>)

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

      it('includes fitness storage usage in shared quota checks', async () => {
        const mediumQuota = 10_000
        mockGetConfig.mockReturnValue({
          mediaStorage: { quotaPerAccount: mediumQuota }
        } as unknown as ReturnType<typeof getConfig>)

        const actor = actors.primary
        const actorData = await database.getActorFromId({ id: actor.id })
        expect(actorData?.account?.id).toBeDefined()

        const accountId = actorData!.account!.id
        const [beforeMedia, beforeFitness] = await Promise.all([
          database.getStorageUsageForAccount({ accountId }),
          database.getFitnessStorageUsageForAccount({ accountId })
        ])

        await database.createMedia({
          actorId: actor.id,
          original: {
            path: '/test/shared-quota-image.jpg',
            bytes: 700,
            mimeType: 'image/jpeg',
            metaData: { width: 400, height: 300 }
          }
        })
        await database.createFitnessFile({
          actorId: actor.id,
          path: 'fitness/shared-quota.fit',
          fileName: 'shared-quota.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 300
        })

        const result = await checkQuotaAvailable(database, actor, 0)

        expect(result.used).toBe(beforeMedia + beforeFitness + 1000)
      })
    })
  })
})
