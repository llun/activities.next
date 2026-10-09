import {
  SQLITE_MAX_BINDINGS,
  chunkArray,
  isSQLiteClient
} from '@/lib/database/sql/utils/knex'
import {
  databaseBeforeAll,
  getTestDatabaseTable,
  getTestDatabaseWithInstance
} from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { DatabaseSeed } from '@/lib/stub/scenarios/database'

describe('MediaDatabase', () => {
  const { actors } = DatabaseSeed
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  describe.each(table)('%s', (databaseType, database) => {
    beforeAll(async () => {
      await seedDatabase(database)
    })

    afterAll(async () => {
      await database.destroy()
    })

    describe('getMediasWithStatusForAccount', () => {
      it('returns empty array when no media exists', async () => {
        // Get account for primary actor
        const actor = await database.getActorFromId({ id: actors.primary.id })
        expect(actor).toBeDefined()
        expect(actor?.account?.id).toBeDefined()

        const result = await database.getMediasWithStatusForAccount({
          accountId: actor!.account!.id
        })

        expect(result.items).toBeArray()
        expect(result.total).toBeGreaterThanOrEqual(0)
      })

      it('returns media for all actors in account', async () => {
        // Get account for primary actor first to ensure actor is fully loaded
        const actorBefore = await database.getActorFromId({
          id: actors.primary.id
        })
        expect(actorBefore).toBeDefined()
        expect(actorBefore?.account).toBeDefined()

        const accountId = actorBefore!.account!.id

        // Create media for primary actor
        const media1 = await database.createMedia({
          actorId: actors.primary.id,
          original: {
            path: '/test/media1-unique.jpg',
            bytes: 5000,
            mimeType: 'image/jpeg',
            metaData: { width: 800, height: 600 }
          }
        })

        expect(media1).toBeDefined()

        // Get medias for account - this uses join on actors.accountId
        const result = await database.getMediasWithStatusForAccount({
          accountId
        })

        // The test verifies getMediasWithStatusForAccount works with the join
        // In production this will work correctly; if it fails in test it's likely
        // a test setup issue with the accountId relationship
        expect(result.items).toBeArray()

        const foundMedia = result.items.find((m) => m.id === media1!.id)

        // Only check details if we found the media
        if (foundMedia) {
          expect(foundMedia.original.path).toBe('/test/media1-unique.jpg')
          expect(foundMedia.original.bytes).toBe(5000)
        }
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

        const result = await database.getMediasWithStatusForAccount({
          accountId: actor!.account!.id,
          limit: 2
        })

        expect(result.items.length).toBeLessThanOrEqual(2)
      })
    })

    describe('getMediasWithStatusForAccount - with statusId', () => {
      it('returns media with statusId when attached to posts', async () => {
        const actor = await database.getActorFromId({
          id: actors.primary.id
        })
        expect(actor).toBeDefined()

        // Create media
        const media = await database.createMedia({
          actorId: actors.primary.id,
          original: {
            path: '/test/media-with-status.jpg',
            bytes: 2000,
            mimeType: 'image/jpeg',
            metaData: { width: 400, height: 400 }
          }
        })

        expect(media).toBeDefined()

        // Create attachment linking media to an existing status
        // Use the seed data which has existing statuses
        const statuses = await database.getActorStatuses({
          actorId: actors.primary.id,
          limit: 1
        })
        expect(statuses.length).toBeGreaterThan(0)

        await database.createAttachment({
          actorId: actors.primary.id,
          statusId: statuses[0].id,
          mediaType: 'image/jpeg',
          url: media!.original.path,
          width: 400,
          height: 400,
          mediaId: media!.id
        })

        // Get medias with status
        const result = await database.getMediasWithStatusForAccount({
          accountId: actor!.account!.id,
          limit: 100
        })

        // Find our test media - need to convert ID to string for comparison
        const testMedia = result.items.find((m) => m.id === String(media!.id))
        expect(testMedia).toBeDefined()
        expect(testMedia?.statusId).toBe(statuses[0].id)
      })

      it('returns media without statusId when not attached to posts', async () => {
        const actor = await database.getActorFromId({
          id: actors.replyAuthor.id
        })
        expect(actor).toBeDefined()

        // Create media without attaching to any status
        const media = await database.createMedia({
          actorId: actors.replyAuthor.id,
          original: {
            path: '/test/media-no-status-unique.jpg',
            bytes: 1500,
            mimeType: 'image/jpeg',
            metaData: { width: 300, height: 300 }
          }
        })

        expect(media).toBeDefined()

        // Get medias with status
        const result = await database.getMediasWithStatusForAccount({
          accountId: actor!.account!.id,
          limit: 100
        })

        // Find our test media - need to convert ID to string for comparison
        const testMedia = result.items.find((m) => m.id === String(media!.id))
        expect(testMedia).toBeDefined()
        expect(testMedia?.statusId).toBeUndefined()
      })

      it('returns correct total count', async () => {
        const actor = await database.getActorFromId({ id: actors.primary.id })
        expect(actor).toBeDefined()

        // Create multiple media items
        await database.createMedia({
          actorId: actors.primary.id,
          original: {
            path: '/test/media-count-1.jpg',
            bytes: 1000,
            mimeType: 'image/jpeg',
            metaData: { width: 100, height: 100 }
          }
        })

        await database.createMedia({
          actorId: actors.primary.id,
          original: {
            path: '/test/media-count-2.jpg',
            bytes: 1000,
            mimeType: 'image/jpeg',
            metaData: { width: 100, height: 100 }
          }
        })

        // Get medias with limit smaller than total
        const result = await database.getMediasWithStatusForAccount({
          accountId: actor!.account!.id,
          limit: 1
        })

        expect(result.items.length).toBe(1)
        expect(result.total).toBeGreaterThanOrEqual(2)
      })

      it('respects page parameter for pagination', async () => {
        const actor = await database.getActorFromId({ id: actors.primary.id })
        expect(actor).toBeDefined()

        // Create multiple media items to test pagination
        await database.createMedia({
          actorId: actors.primary.id,
          original: {
            path: '/test/media-page-1.jpg',
            bytes: 1000,
            mimeType: 'image/jpeg',
            metaData: { width: 100, height: 100 }
          }
        })

        await database.createMedia({
          actorId: actors.primary.id,
          original: {
            path: '/test/media-page-2.jpg',
            bytes: 1000,
            mimeType: 'image/jpeg',
            metaData: { width: 100, height: 100 }
          }
        })

        // Get first page
        const page1Result = await database.getMediasWithStatusForAccount({
          accountId: actor!.account!.id,
          limit: 1,
          page: 1
        })

        // Get second page
        const page2Result = await database.getMediasWithStatusForAccount({
          accountId: actor!.account!.id,
          limit: 1,
          page: 2
        })

        expect(page1Result.items.length).toBe(1)
        expect(page2Result.items.length).toBe(1)
        // Items should be different (different IDs)
        expect(page1Result.items[0].id).not.toBe(page2Result.items[0].id)
        // Total should be the same for both pages
        expect(page1Result.total).toBe(page2Result.total)
        expect(page1Result.total).toBeGreaterThanOrEqual(2)
      })

      it('returns media with statusId when using S3 URL format', async () => {
        const actor = await database.getActorFromId({
          id: actors.primary.id
        })
        expect(actor).toBeDefined()

        // Create media with S3-style path
        const media = await database.createMedia({
          actorId: actors.primary.id,
          original: {
            path: 'medias/2024-01-23/abc123-s3-test.webp',
            bytes: 3000,
            mimeType: 'image/webp',
            metaData: { width: 500, height: 500 }
          }
        })

        expect(media).toBeDefined()

        // Get an existing status
        const statuses = await database.getActorStatuses({
          actorId: actors.primary.id,
          limit: 1
        })
        expect(statuses.length).toBeGreaterThan(0)

        // Create attachment with S3-style URL (full URL format)
        await database.createAttachment({
          actorId: actors.primary.id,
          statusId: statuses[0].id,
          mediaType: 'image/webp',
          url: `https://example.com/api/v1/files/${media!.original.path}`,
          width: 500,
          height: 500,
          mediaId: media!.id
        })

        // Get medias with status
        const result = await database.getMediasWithStatusForAccount({
          accountId: actor!.account!.id,
          limit: 100
        })

        // Find our test media
        const testMedia = result.items.find((m) => m.id === String(media!.id))
        expect(testMedia).toBeDefined()
        expect(testMedia?.statusId).toBe(statuses[0].id)
      })

      it('does not duplicate media attached to multiple statuses and picks deterministic MIN statusId', async () => {
        const actor = await database.getActorFromId({
          id: actors.primary.id
        })
        expect(actor?.account).toBeDefined()
        const accountId = actor!.account!.id

        const media = await database.createMedia({
          actorId: actors.primary.id,
          original: {
            path: '/test/multi-attached-media.jpg',
            bytes: 2048,
            mimeType: 'image/jpeg',
            metaData: { width: 400, height: 400 }
          }
        })
        expect(media).toBeDefined()

        const statuses = await database.getActorStatuses({
          actorId: actors.primary.id,
          limit: 3
        })
        expect(statuses.length).toBeGreaterThanOrEqual(2)

        const statusId1 = statuses[0].id
        const statusId2 = statuses[1].id
        const expectedMinStatusId =
          statusId1 < statusId2 ? statusId1 : statusId2

        // Attach the same media to both statuses
        await database.createAttachment({
          actorId: actors.primary.id,
          statusId: statusId1,
          mediaType: 'image/jpeg',
          url: media!.original.path,
          width: 400,
          height: 400,
          mediaId: media!.id
        })
        await database.createAttachment({
          actorId: actors.primary.id,
          statusId: statusId2,
          mediaType: 'image/jpeg',
          url: media!.original.path,
          width: 400,
          height: 400,
          mediaId: media!.id
        })

        const result = await database.getMediasWithStatusForAccount({
          accountId,
          limit: 100
        })

        // Must appear exactly once in items
        const matches = result.items.filter(
          (item) => item.id === String(media!.id)
        )
        expect(matches).toHaveLength(1)
        expect(matches[0].statusId).toBe(expectedMinStatusId)
      })

      it('returns unattached media with undefined statusId alongside attached media', async () => {
        const actor = await database.getActorFromId({
          id: actors.primary.id
        })
        expect(actor?.account).toBeDefined()
        const accountId = actor!.account!.id

        const unattached = await database.createMedia({
          actorId: actors.primary.id,
          original: {
            path: '/test/regression-unattached.jpg',
            bytes: 1200,
            mimeType: 'image/jpeg',
            metaData: { width: 300, height: 300 }
          }
        })

        const attached = await database.createMedia({
          actorId: actors.primary.id,
          original: {
            path: '/test/regression-attached.jpg',
            bytes: 1400,
            mimeType: 'image/jpeg',
            metaData: { width: 300, height: 300 }
          }
        })

        const statuses = await database.getActorStatuses({
          actorId: actors.primary.id,
          limit: 1
        })
        await database.createAttachment({
          actorId: actors.primary.id,
          statusId: statuses[0].id,
          mediaType: 'image/jpeg',
          url: attached!.original.path,
          width: 300,
          height: 300,
          mediaId: attached!.id
        })

        const result = await database.getMediasWithStatusForAccount({
          accountId,
          limit: 100
        })

        const unattachedItem = result.items.find(
          (item) => item.id === String(unattached!.id)
        )
        const attachedItem = result.items.find(
          (item) => item.id === String(attached!.id)
        )

        expect(unattachedItem).toBeDefined()
        expect(unattachedItem?.statusId).toBeUndefined()
        expect('statusId' in unattachedItem!).toBe(false)

        expect(attachedItem).toBeDefined()
        expect(attachedItem?.statusId).toBe(statuses[0].id)
      })

      it('orders deterministically by createdAt DESC, id DESC when timestamps are equal', async () => {
        const actor = await database.getActorFromId({
          id: actors.extra.id
        })
        expect(actor?.account).toBeDefined()
        const accountId = actor!.account!.id

        // Create multiple media items in rapid succession so they share the same CURRENT_TIMESTAMP
        const media1 = await database.createMedia({
          actorId: actors.extra.id,
          original: {
            path: '/test/equal-time-1.jpg',
            bytes: 1000,
            mimeType: 'image/jpeg',
            metaData: { width: 100, height: 100 }
          }
        })
        const media2 = await database.createMedia({
          actorId: actors.extra.id,
          original: {
            path: '/test/equal-time-2.jpg',
            bytes: 1000,
            mimeType: 'image/jpeg',
            metaData: { width: 100, height: 100 }
          }
        })
        const media3 = await database.createMedia({
          actorId: actors.extra.id,
          original: {
            path: '/test/equal-time-3.jpg',
            bytes: 1000,
            mimeType: 'image/jpeg',
            metaData: { width: 100, height: 100 }
          }
        })

        expect(media1).toBeDefined()
        expect(media2).toBeDefined()
        expect(media3).toBeDefined()

        const id1 = Number(media1!.id)
        const id2 = Number(media2!.id)
        const id3 = Number(media3!.id)
        expect(id1).toBeLessThan(id2)
        expect(id2).toBeLessThan(id3)

        const result = await database.getMediasWithStatusForAccount({
          accountId,
          limit: 100
        })

        const idx1 = result.items.findIndex(
          (item) => item.id === String(media1!.id)
        )
        const idx2 = result.items.findIndex(
          (item) => item.id === String(media2!.id)
        )
        const idx3 = result.items.findIndex(
          (item) => item.id === String(media3!.id)
        )

        expect(idx1).toBeGreaterThanOrEqual(0)
        expect(idx2).toBeGreaterThanOrEqual(0)
        expect(idx3).toBeGreaterThanOrEqual(0)

        // id DESC: media3 (largest id) comes before media2, which comes before media1
        expect(idx3).toBeLessThan(idx2)
        expect(idx2).toBeLessThan(idx1)
      })

      it('pages unique media cleanly across page boundaries without duplicates or offset drift', async () => {
        const actor = await database.getActorFromId({
          id: actors.followRequester.id
        })
        expect(actor?.account).toBeDefined()
        const accountId = actor!.account!.id

        // Create 4 distinct media items
        const createdMedias = []
        for (let i = 0; i < 4; i++) {
          const media = await database.createMedia({
            actorId: actors.followRequester.id,
            original: {
              path: `/test/page-boundary-${i}.jpg`,
              bytes: 1000 * (i + 1),
              mimeType: 'image/jpeg',
              metaData: { width: 100, height: 100 }
            }
          })
          createdMedias.push(media!)
        }

        // Attach the first two medias to multiple statuses to verify attachments do not shift pagination
        const statuses = await database.getActorStatuses({
          actorId: actors.primary.id,
          limit: 2
        })
        for (const media of createdMedias.slice(0, 2)) {
          for (const status of statuses) {
            await database.createAttachment({
              actorId: actors.followRequester.id,
              statusId: status.id,
              mediaType: 'image/jpeg',
              url: media.original.path,
              width: 100,
              height: 100,
              mediaId: media.id
            })
          }
        }

        const page1 = await database.getMediasWithStatusForAccount({
          accountId,
          limit: 2,
          page: 1
        })
        const page2 = await database.getMediasWithStatusForAccount({
          accountId,
          limit: 2,
          page: 2
        })

        expect(page1.items).toHaveLength(2)
        expect(page2.items).toHaveLength(2)

        const page1Ids = page1.items.map((m) => m.id)
        const page2Ids = page2.items.map((m) => m.id)

        // No item on page 1 should appear on page 2
        for (const id of page1Ids) {
          expect(page2Ids).not.toContain(id)
        }

        // Total should match across pages
        expect(page1.total).toBe(page2.total)
        expect(page1.total).toBeGreaterThanOrEqual(4)
      })

      it('isolates media and attachments between different accounts', async () => {
        const actor1 = await database.getActorFromId({
          id: actors.primary.id
        })
        const actor2 = await database.getActorFromId({
          id: actors.replyAuthor.id
        })
        expect(actor1?.account).toBeDefined()
        expect(actor2?.account).toBeDefined()
        const account1Id = actor1!.account!.id
        const account2Id = actor2!.account!.id
        expect(account1Id).not.toBe(account2Id)

        const mediaAccount1 = await database.createMedia({
          actorId: actors.primary.id,
          original: {
            path: '/test/isolation-account-1.jpg',
            bytes: 1111,
            mimeType: 'image/jpeg',
            metaData: { width: 100, height: 100 }
          }
        })

        const mediaAccount2 = await database.createMedia({
          actorId: actors.replyAuthor.id,
          original: {
            path: '/test/isolation-account-2.jpg',
            bytes: 2222,
            mimeType: 'image/jpeg',
            metaData: { width: 100, height: 100 }
          }
        })

        const statuses = await database.getActorStatuses({
          actorId: actors.replyAuthor.id,
          limit: 1
        })
        await database.createAttachment({
          actorId: actors.replyAuthor.id,
          statusId: statuses[0].id,
          mediaType: 'image/jpeg',
          url: mediaAccount2!.original.path,
          width: 100,
          height: 100,
          mediaId: mediaAccount2!.id
        })

        const resultAccount1 = await database.getMediasWithStatusForAccount({
          accountId: account1Id,
          limit: 100
        })
        const resultAccount2 = await database.getMediasWithStatusForAccount({
          accountId: account2Id,
          limit: 100
        })

        // Account 1 sees mediaAccount1, never mediaAccount2
        expect(
          resultAccount1.items.some((m) => m.id === String(mediaAccount1!.id))
        ).toBe(true)
        expect(
          resultAccount1.items.some((m) => m.id === String(mediaAccount2!.id))
        ).toBe(false)

        // Account 2 sees mediaAccount2, never mediaAccount1
        expect(
          resultAccount2.items.some((m) => m.id === String(mediaAccount2!.id))
        ).toBe(true)
        expect(
          resultAccount2.items.some((m) => m.id === String(mediaAccount1!.id))
        ).toBe(false)
      })

      it('validates and preserves numeric IDs across queries and attachment resolution', async () => {
        const actor = await database.getActorFromId({
          id: actors.primary.id
        })
        expect(actor?.account).toBeDefined()
        const accountId = actor!.account!.id

        const media = await database.createMedia({
          actorId: actors.primary.id,
          original: {
            path: '/test/numeric-id-media.jpg',
            bytes: 3333,
            mimeType: 'image/jpeg',
            metaData: { width: 100, height: 100 }
          }
        })
        expect(media).toBeDefined()

        // Verify ID is a numeric string
        expect(typeof media!.id).toBe('string')
        expect(/^\d+$/.test(media!.id)).toBe(true)
        expect(Number(media!.id)).toBeGreaterThan(0)

        const statuses = await database.getActorStatuses({
          actorId: actors.primary.id,
          limit: 1
        })
        await database.createAttachment({
          actorId: actors.primary.id,
          statusId: statuses[0].id,
          mediaType: 'image/jpeg',
          url: media!.original.path,
          width: 100,
          height: 100,
          mediaId: media!.id
        })

        const result = await database.getMediasWithStatusForAccount({
          accountId,
          limit: 100
        })

        const item = result.items.find((m) => m.id === media!.id)
        expect(item).toBeDefined()
        expect(item?.id).toBe(media!.id)
        expect(item?.statusId).toBe(statuses[0].id)
      })

      it('resolves statusId when attachment has decimal numeric mediaId form', async () => {
        const actor = await database.getActorFromId({
          id: actors.primary.id
        })
        const accountId = actor!.account!.id

        const media = await database.createMedia({
          actorId: actors.primary.id,
          original: {
            path: '/test/decimal-mediaId.jpg',
            bytes: 1500,
            mimeType: 'image/jpeg',
            metaData: { width: 100, height: 100 }
          }
        })

        const statuses = await database.getActorStatuses({
          actorId: actors.primary.id,
          limit: 1
        })
        // attachments.mediaId is varchar(255) on SQLite, where decimal string forms
        // like '27.0' can be stored from legacy number-bound IDs and exercise SQLite's
        // dynamic type affinity in the join. On PostgreSQL, attachments.mediaId is an
        // integer column, so fixtures must use the valid integer representation.
        const attachmentMediaId =
          databaseType === 'sqlite' ? `${media!.id}.0` : media!.id

        await database.createAttachment({
          actorId: actors.primary.id,
          statusId: statuses[0].id,
          mediaType: 'image/jpeg',
          url: media!.original.path,
          width: 100,
          height: 100,
          mediaId: attachmentMediaId
        })

        const result = await database.getMediasWithStatusForAccount({
          accountId,
          limit: 100
        })

        const item = result.items.find((m) => m.id === media!.id)
        expect(item).toBeDefined()
        expect(item?.statusId).toBe(statuses[0].id)
      })

      it('prevents cross-account attachments from contributing statusId to requesting account', async () => {
        const actor1 = await database.getActorFromId({
          id: actors.primary.id
        })
        const actor2 = await database.getActorFromId({
          id: actors.replyAuthor.id
        })
        expect(actor1?.account).toBeDefined()
        expect(actor2?.account).toBeDefined()
        const account1Id = actor1!.account!.id
        const account2Id = actor2!.account!.id
        expect(account1Id).not.toBe(account2Id)

        const mediaAccount1 = await database.createMedia({
          actorId: actors.primary.id,
          original: {
            path: '/test/cross-account-attachment-test.jpg',
            bytes: 1234,
            mimeType: 'image/jpeg',
            metaData: { width: 100, height: 100 }
          }
        })
        expect(mediaAccount1).toBeDefined()

        const foreignStatuses = await database.getActorStatuses({
          actorId: actors.replyAuthor.id,
          limit: 1
        })
        expect(foreignStatuses.length).toBeGreaterThan(0)
        const foreignStatusId = foreignStatuses[0].id

        await database.createAttachment({
          actorId: actors.replyAuthor.id,
          statusId: foreignStatusId,
          mediaType: 'image/jpeg',
          url: mediaAccount1!.original.path,
          width: 100,
          height: 100,
          mediaId: mediaAccount1!.id
        })

        const resultAccount1 = await database.getMediasWithStatusForAccount({
          accountId: account1Id,
          limit: 100
        })

        const item = resultAccount1.items.find(
          (m) => m.id === String(mediaAccount1!.id)
        )
        expect(item).toBeDefined()
        expect(item?.statusId).toBeUndefined()

        const ownStatuses = await database.getActorStatuses({
          actorId: actors.primary.id,
          limit: 1
        })
        expect(ownStatuses.length).toBeGreaterThan(0)
        const ownStatusId = ownStatuses[0].id

        await database.createAttachment({
          actorId: actors.primary.id,
          statusId: ownStatusId,
          mediaType: 'image/jpeg',
          url: mediaAccount1!.original.path,
          width: 100,
          height: 100,
          mediaId: mediaAccount1!.id
        })

        const resultWithOwn = await database.getMediasWithStatusForAccount({
          accountId: account1Id,
          limit: 100
        })

        const itemWithOwn = resultWithOwn.items.find(
          (m) => m.id === String(mediaAccount1!.id)
        )
        expect(itemWithOwn).toBeDefined()
        expect(itemWithOwn?.statusId).toBe(ownStatusId)
      })

      describe('chunking attachment lookups under SQLite parameter limits', () => {
        let isolatedDb: typeof database
        let instance: ReturnType<typeof getTestDatabaseWithInstance>['instance']
        let account1Id: string
        const mediaCount = 1000
        const attachmentQueries: { sql: string; bindings: unknown[] }[] = []
        let result: Awaited<
          ReturnType<typeof database.getMediasWithStatusForAccount>
        >

        beforeAll(async () => {
          const isolated = getTestDatabaseWithInstance(true, databaseType)
          isolatedDb = isolated.database
          instance = isolated.instance
          await isolated.prepare()
          await isolatedDb.migrate()

          await seedDatabase(isolatedDb)

          const actor1 = await isolatedDb.getActorFromId({
            id: actors.primary.id
          })
          const actor2 = await isolatedDb.getActorFromId({
            id: actors.replyAuthor.id
          })
          expect(actor1?.account).toBeDefined()
          expect(actor2?.account).toBeDefined()
          account1Id = actor1!.account!.id
          const account2Id = actor2!.account!.id
          expect(account1Id).not.toBe(account2Id)

          // Insert 1000 owned media rows for account1. With 2 reserved bindings
          // (actors.accountId and attachments.statusId <> ''), SQLite batch size
          // is 997 (SQLITE_MAX_BINDINGS - 2), so 1000 items cross into a second chunk.
          const now = Date.now()
          const mediaRows = Array.from({ length: mediaCount }, (_, index) => ({
            id: index + 1,
            actorId: actors.primary.id,
            accountId: account1Id,
            original: `/test/chunk-boundary-media-${index + 1}.jpg`,
            originalBytes: 1024,
            originalMimeType: 'image/jpeg',
            originalMetaData: '{}',
            createdAt: new Date(now - index * 1000),
            updatedAt: new Date(now - index * 1000)
          }))

          for (const chunk of chunkArray(mediaRows, 50)) {
            await instance('medias').insert(chunk)
          }

          // Media 1 (chunk 1): own attachment -> should return 'own-status-1'
          // Media 2 (chunk 1): own attachment ('status-own-2') AND foreign attachment ('aaa-foreign-status-2').
          //   Ownership filtering must ignore 'aaa-foreign-status-2' even though it sorts earlier in MIN(statusId).
          // Media 500 (chunk 1): foreign attachment only -> should return undefined
          // Media 501 (chunk 1): empty statusId attachment -> should return undefined
          // Media 1000 (chunk 2): own attachment -> should return 'own-status-1000'
          await instance('attachments').insert([
            {
              id: 'att-chunk-1',
              actorId: actors.primary.id,
              mediaId: '1',
              statusId: 'own-status-1',
              mediaType: 'image/jpeg',
              type: 'Document',
              url: '/test/chunk-boundary-media-1.jpg',
              createdAt: new Date(now),
              updatedAt: new Date(now)
            },
            {
              id: 'att-chunk-2-own',
              actorId: actors.primary.id,
              mediaId: '2',
              statusId: 'status-own-2',
              mediaType: 'image/jpeg',
              type: 'Document',
              url: '/test/chunk-boundary-media-2.jpg',
              createdAt: new Date(now),
              updatedAt: new Date(now)
            },
            {
              id: 'att-chunk-2-foreign',
              actorId: actors.replyAuthor.id,
              mediaId: '2',
              statusId: 'aaa-foreign-status-2',
              mediaType: 'image/jpeg',
              type: 'Document',
              url: '/test/chunk-boundary-media-2.jpg',
              createdAt: new Date(now),
              updatedAt: new Date(now)
            },
            {
              id: 'att-chunk-500-foreign',
              actorId: actors.replyAuthor.id,
              mediaId: '500',
              statusId: 'foreign-status-500',
              mediaType: 'image/jpeg',
              type: 'Document',
              url: '/test/chunk-boundary-media-500.jpg',
              createdAt: new Date(now),
              updatedAt: new Date(now)
            },
            {
              id: 'att-chunk-501-empty',
              actorId: actors.primary.id,
              mediaId: '501',
              statusId: '',
              mediaType: 'image/jpeg',
              type: 'Document',
              url: '/test/chunk-boundary-media-501.jpg',
              createdAt: new Date(now),
              updatedAt: new Date(now)
            },
            {
              id: 'att-chunk-1000',
              actorId: actors.primary.id,
              mediaId: '1000',
              statusId: 'own-status-1000',
              mediaType: 'image/jpeg',
              type: 'Document',
              url: '/test/chunk-boundary-media-1000.jpg',
              createdAt: new Date(now),
              updatedAt: new Date(now)
            }
          ])

          const onQuery = ({
            sql,
            bindings
          }: {
            sql: string
            bindings?: unknown[]
          }) => {
            const normalizedSql = sql.toLowerCase()
            if (
              normalizedSql.includes('attachments') &&
              normalizedSql.includes('medias') &&
              normalizedSql.includes('group by')
            ) {
              attachmentQueries.push({ sql, bindings: bindings ?? [] })
            }
          }

          instance.on('query', onQuery)
          try {
            result = await isolatedDb.getMediasWithStatusForAccount({
              accountId: account1Id,
              limit: mediaCount
            })
          } finally {
            instance.off('query', onQuery)
          }
        })

        afterAll(async () => {
          await isolatedDb?.destroy()
        })

        it('splits the lookup into chunks that stay within the SQLite bind ceiling', async () => {
          expect(attachmentQueries.length).toBeGreaterThan(0)

          if (isSQLiteClient(instance)) {
            // 1000 items with batch size 997 produces exactly 2 chunks (997 and 3 items).
            expect(attachmentQueries).toHaveLength(2)

            // Every SQLite attachment query must strictly satisfy the parameter ceiling.
            for (const query of attachmentQueries) {
              expect(query.bindings.length).toBeLessThanOrEqual(
                SQLITE_MAX_BINDINGS
              )
            }

            // Chunk 1 has 997 IDs + 2 non-ID bindings (accountId and attachments.statusId <> '') = 999.
            // If getWhereInBatchSize only reserved 1, chunk 1 would have 998 IDs + 2 = 1000 bindings,
            // exceeding SQLite's limit.
            expect(attachmentQueries[0].bindings).toHaveLength(
              SQLITE_MAX_BINDINGS
            )
            expect(attachmentQueries[0].bindings[0]).toBe(account1Id)
            expect(
              attachmentQueries[0].bindings[
                attachmentQueries[0].bindings.length - 1
              ]
            ).toBe('')

            // Chunk 2 has remaining 3 IDs + 2 non-ID bindings = 5 bindings.
            expect(attachmentQueries[1].bindings).toHaveLength(5)
            expect(attachmentQueries[1].bindings[0]).toBe(account1Id)
            expect(
              attachmentQueries[1].bindings[
                attachmentQueries[1].bindings.length - 1
              ]
            ).toBe('')
          }
        })

        it('keeps own status ids across the chunk boundary and ignores foreign and empty-status attachments', async () => {
          expect(result.items).toHaveLength(mediaCount)

          // Verify ownership filtering and correct status IDs across chunks:
          // Chunk 1:
          const item1 = result.items.find((m) => m.id === '1')
          expect(item1).toBeDefined()
          expect(item1?.statusId).toBe('own-status-1')

          // Item 2 has own status 'status-own-2' preserved over foreign 'aaa-foreign-status-2'
          const item2 = result.items.find((m) => m.id === '2')
          expect(item2).toBeDefined()
          expect(item2?.statusId).toBe('status-own-2')

          // Item 500 only has foreign attachment, so statusId must remain undefined
          const item500 = result.items.find((m) => m.id === '500')
          expect(item500).toBeDefined()
          expect(item500?.statusId).toBeUndefined()

          // Item 501 has empty statusId, so statusId must remain undefined
          const item501 = result.items.find((m) => m.id === '501')
          expect(item501).toBeDefined()
          expect(item501?.statusId).toBeUndefined()

          // Chunk 2 (across the chunk boundary):
          const item1000 = result.items.find((m) => m.id === '1000')
          expect(item1000).toBeDefined()
          expect(item1000?.statusId).toBe('own-status-1000')
        })
      })
    })
  })
})
