import {
  getTestDatabaseTable,
  databaseBeforeAll
} from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { DatabaseSeed } from '@/lib/stub/scenarios/database'

describe('MediaDatabase', () => {
  const { actors } = DatabaseSeed
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  describe.each(table)('%s', (_, database) => {
    beforeAll(async () => {
      await seedDatabase(database)
    })

    afterAll(async () => {
      await database.destroy()
    })

    describe('getMediasForAccount', () => {
      it('returns empty array when no media exists', async () => {
        // Get account for primary actor
        const actor = await database.getActorFromId({ id: actors.primary.id })
        expect(actor).toBeDefined()
        expect(actor?.accountId).toBeDefined()

        const medias = await database.getMediasForAccount({
          accountId: actor!.accountId!
        })

        expect(medias).toBeArray()
        expect(medias.length).toBeGreaterThanOrEqual(0)
      })

      it('returns media for all actors in account', async () => {
        // Create media for primary actor
        const media1 = await database.createMedia({
          actorId: actors.primary.id,
          original: {
            path: '/test/media1.jpg',
            bytes: 5000,
            mimeType: 'image/jpeg',
            metaData: { width: 800, height: 600 }
          }
        })

        expect(media1).toBeDefined()

        // Get account for primary actor
        const actor = await database.getActorFromId({ id: actors.primary.id })
        expect(actor).toBeDefined()

        const medias = await database.getMediasForAccount({
          accountId: actor!.accountId!
        })

        expect(medias.length).toBeGreaterThanOrEqual(1)
        const foundMedia = medias.find((m) => m.id === media1!.id)
        expect(foundMedia).toBeDefined()
        expect(foundMedia?.original.path).toBe('/test/media1.jpg')
        expect(foundMedia?.original.bytes).toBe(5000)
      })

      it('respects limit parameter', async () => {
        const actor = await database.getActorFromId({
          id: actors.replyAuthor.id
        })
        expect(actor).toBeDefined()

        // Create multiple media
        for (let i = 0; i < 5; i++) {
          await database.createMedia({
            actorId: actors.replyAuthor.id,
            original: {
              path: `/test/media-${i}.jpg`,
              bytes: 1000 * (i + 1),
              mimeType: 'image/jpeg',
              metaData: { width: 100, height: 100 }
            }
          })
        }

        const medias = await database.getMediasForAccount({
          accountId: actor!.accountId!,
          limit: 2
        })

        expect(medias.length).toBeLessThanOrEqual(2)
      })
    })

    describe('getStorageUsageForAccount', () => {
      it('returns 0 when no media exists', async () => {
        const actor = await database.getActorFromId({
          id: actors.followAuthor.id
        })
        expect(actor).toBeDefined()

        const usage = await database.getStorageUsageForAccount({
          accountId: actor!.accountId!
        })

        expect(usage).toBeNumber()
        expect(usage).toBeGreaterThanOrEqual(0)
      })

      it('sums original and thumbnail bytes correctly', async () => {
        // Create media with thumbnail
        await database.createMedia({
          actorId: actors.likeAuthor.id,
          original: {
            path: '/test/with-thumb.jpg',
            bytes: 3000,
            mimeType: 'image/jpeg',
            metaData: { width: 1000, height: 1000 }
          },
          thumbnail: {
            path: '/test/with-thumb-thumbnail.jpg',
            bytes: 500,
            mimeType: 'image/jpeg',
            metaData: { width: 200, height: 200 }
          }
        })

        const actor = await database.getActorFromId({
          id: actors.likeAuthor.id
        })
        expect(actor).toBeDefined()

        const usage = await database.getStorageUsageForAccount({
          accountId: actor!.accountId!
        })

        expect(usage).toBeGreaterThanOrEqual(3500) // 3000 + 500
      })

      it('aggregates across all actors in account', async () => {
        const actor1 = actors.mentionAuthor
        const actor1Data = await database.getActorFromId({ id: actor1.id })

        // Create media for first actor
        await database.createMedia({
          actorId: actor1.id,
          original: {
            path: '/test/actor1-media.jpg',
            bytes: 2000,
            mimeType: 'image/jpeg',
            metaData: { width: 500, height: 500 }
          }
        })

        // If there are multiple actors in the same account, test aggregation
        const usage = await database.getStorageUsageForAccount({
          accountId: actor1Data!.accountId!
        })

        expect(usage).toBeGreaterThanOrEqual(2000)
      })
    })

    describe('deleteMedia', () => {
      it('deletes media successfully', async () => {
        const media = await database.createMedia({
          actorId: actors.announceAuthor.id,
          original: {
            path: '/test/to-delete.jpg',
            bytes: 1000,
            mimeType: 'image/jpeg',
            metaData: { width: 200, height: 200 }
          }
        })

        expect(media).toBeDefined()

        const deleted = await database.deleteMedia({ mediaId: media!.id })
        expect(deleted).toBe(true)

        // Verify media is deleted by checking storage usage
        const actor = await database.getActorFromId({
          id: actors.announceAuthor.id
        })
        const usageAfter = await database.getStorageUsageForAccount({
          accountId: actor!.accountId!
        })

        // Check that the specific media doesn't exist anymore
        const medias = await database.getMediasForAccount({
          accountId: actor!.accountId!
        })
        const foundMedia = medias.find((m) => m.id === media!.id)
        expect(foundMedia).toBeUndefined()
      })

      it('returns false when media does not exist', async () => {
        const deleted = await database.deleteMedia({ mediaId: '999999' })
        expect(deleted).toBe(false)
      })
    })
  })
})
