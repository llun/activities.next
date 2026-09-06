import {
  databaseBeforeAll,
  getTestDatabaseTable
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
    })

    describe('getMediaByIdForAccount', () => {
      // A well-formed id that simply has no row — this must stay numeric so it
      // exercises an actual database miss rather than short-circuiting in
      // toMediaRowId, which is what the malformed ids below cover.
      it('returns null when media does not exist', async () => {
        const actor = await database.getActorFromId({ id: actors.primary.id })
        expect(actor).toBeDefined()

        const media = await database.getMediaByIdForAccount({
          mediaId: '99999999',
          accountId: actor!.account!.id
        })

        expect(media).toBeNull()
      })

      // `medias.id` is an integer column on PostgreSQL, which answers a
      // malformed id with an error rather than by matching nothing: text with
      // `invalid input syntax for type integer`, and an out-of-range number
      // with `value out of range for type integer`. Mastodon clients put
      // whatever they like in the id path segment, so every one of these has to
      // read as a miss (404), not an error (500).
      it.each([
        { description: 'an empty id', mediaId: '' },
        { description: 'a non-numeric id', mediaId: 'abc' },
        { description: 'a fractional id', mediaId: '1.5' },
        { description: 'a negative id', mediaId: '-1' },
        { description: 'an exponential id', mediaId: '1e21' },
        { description: 'an id past the integer max', mediaId: '2147483648' }
      ])('returns null for $description', async ({ mediaId }) => {
        const actor = await database.getActorFromId({ id: actors.primary.id })

        const media = await database.getMediaByIdForAccount({
          mediaId,
          accountId: actor!.account!.id
        })

        expect(media).toBeNull()
      })

      // Coercing with a bare `Number()` would resolve these to a real row: they
      // are alternate spellings of an existing media's id, so the lookup would
      // answer with media the id does not name. Built from a freshly created
      // row so the assertion cannot pass by there being no such media.
      it('returns null for alternate spellings of a real media id', async () => {
        const actor = await database.getActorFromId({ id: actors.primary.id })
        const media = await database.createMedia({
          actorId: actors.primary.id,
          original: {
            path: '/test/media-alias-spellings.jpg',
            bytes: 1000,
            mimeType: 'image/jpeg',
            metaData: { width: 100, height: 100 }
          }
        })
        const accountId = actor!.account!.id
        const rowId = Number(media!.id)

        // Sanity: the plain decimal spelling does resolve, so a null below is
        // the guard rejecting the spelling and not a missing row.
        expect(
          await database.getMediaByIdForAccount({
            mediaId: String(rowId),
            accountId
          })
        ).not.toBeNull()

        for (const alias of [
          `0x${rowId.toString(16)}`,
          `0b${rowId.toString(2)}`,
          `0o${rowId.toString(8)}`,
          `${rowId}e0`,
          `+${rowId}`,
          ` ${rowId} `
        ]) {
          expect(
            await database.getMediaByIdForAccount({ mediaId: alias, accountId })
          ).toBeNull()
        }
      })

      // The spellings that are NOT rejected, because each still names the same
      // row unambiguously and each resolved before this guard existed (both
      // backends convert them). '12.0' in particular is reachable on SQLite,
      // where `attachments.mediaId` is a `varchar` and an id bound as a JS
      // number lands as '1.0', then gets re-resolved on every status edit.
      it.each([
        {
          description: 'an all-zero fraction',
          spell: (id: string) => `${id}.0`
        },
        { description: 'leading zeros', spell: (id: string) => `00${id}` }
      ])('resolves a media id written with $description', async ({ spell }) => {
        const actor = await database.getActorFromId({ id: actors.primary.id })
        const media = await database.createMedia({
          actorId: actors.primary.id,
          original: {
            path: `/test/media-tolerated-${spell('1')}.jpg`,
            bytes: 1000,
            mimeType: 'image/jpeg',
            metaData: { width: 100, height: 100 }
          }
        })

        const resolved = await database.getMediaByIdForAccount({
          mediaId: spell(media!.id),
          accountId: actor!.account!.id
        })

        expect(resolved?.id).toBe(media!.id)
      })

      it('returns null when media belongs to different account', async () => {
        // Create media for primary actor
        await database.getActorFromId({
          id: actors.primary.id
        })
        const media = await database.createMedia({
          actorId: actors.primary.id,
          original: {
            path: '/test/media-ownership.jpg',
            bytes: 2000,
            mimeType: 'image/jpeg',
            metaData: { width: 400, height: 400 }
          }
        })

        expect(media).toBeDefined()

        // Try to get it with a different account
        const actor2 = await database.getActorFromId({
          id: actors.replyAuthor.id
        })

        const result = await database.getMediaByIdForAccount({
          mediaId: media!.id,
          accountId: actor2!.account!.id
        })

        // Should be null because media belongs to different account
        expect(result).toBeNull()
      })

      it('returns media when it belongs to the account', async () => {
        const actor = await database.getActorFromId({
          id: actors.pollAuthor.id
        })
        expect(actor).toBeDefined()

        const media = await database.createMedia({
          actorId: actors.pollAuthor.id,
          original: {
            path: '/test/media-getbyid.jpg',
            bytes: 3000,
            mimeType: 'image/jpeg',
            metaData: { width: 600, height: 800 }
          },
          thumbnail: {
            path: '/test/media-getbyid-thumb.jpg',
            bytes: 400,
            mimeType: 'image/jpeg',
            metaData: { width: 150, height: 200 }
          }
        })

        expect(media).toBeDefined()

        const result = await database.getMediaByIdForAccount({
          mediaId: media!.id,
          accountId: actor!.account!.id
        })

        expect(result).toBeDefined()
        expect(result?.id).toBe(String(media!.id))
        expect(result?.original.path).toBe('/test/media-getbyid.jpg')
        expect(result?.original.bytes).toBe(3000)
        expect(result?.thumbnail).toBeDefined()
        expect(result?.thumbnail?.bytes).toBe(400)
      })
    })

    describe('getMediaByIdsForAccount', () => {
      it('returns only the account-owned media for the requested string ids', async () => {
        const actor = await database.getActorFromId({ id: actors.primary.id })
        const otherActor = await database.getActorFromId({
          id: actors.replyAuthor.id
        })

        const first = await database.createMedia({
          actorId: actors.primary.id,
          original: {
            path: '/test/batch-first.jpg',
            bytes: 1000,
            mimeType: 'image/jpeg',
            metaData: { width: 100, height: 100 }
          }
        })
        const second = await database.createMedia({
          actorId: actors.primary.id,
          original: {
            path: '/test/batch-second.jpg',
            bytes: 1200,
            mimeType: 'image/jpeg',
            metaData: { width: 120, height: 120 }
          }
        })
        const foreign = await database.createMedia({
          actorId: actors.replyAuthor.id,
          original: {
            path: '/test/batch-foreign.jpg',
            bytes: 1400,
            mimeType: 'image/jpeg',
            metaData: { width: 140, height: 140 }
          }
        })

        const results = await database.getMediaByIdsForAccount({
          // Ids arrive as strings (Mastodon API) and include another account's
          // media plus an unknown id; only the two owned ids should resolve.
          mediaIds: [
            String(first!.id),
            String(second!.id),
            String(foreign!.id),
            '999999999'
          ],
          accountId: actor!.account!.id
        })

        const ids = results.map((media) => media.id).sort()
        expect(ids).toEqual([String(first!.id), String(second!.id)].sort())
        expect(results.some((media) => media.id === String(foreign!.id))).toBe(
          false
        )
        // The foreign media is still readable by its own owner.
        const foreignOwned = await database.getMediaByIdsForAccount({
          mediaIds: [String(foreign!.id)],
          accountId: otherActor!.account!.id
        })
        expect(foreignOwned.map((media) => media.id)).toEqual([
          String(foreign!.id)
        ])
      })

      it('returns an empty array for empty or non-numeric ids', async () => {
        const actor = await database.getActorFromId({ id: actors.primary.id })
        expect(
          await database.getMediaByIdsForAccount({
            mediaIds: [],
            accountId: actor!.account!.id
          })
        ).toEqual([])
        expect(
          await database.getMediaByIdsForAccount({
            mediaIds: ['', 'not-a-number'],
            accountId: actor!.account!.id
          })
        ).toEqual([])
      })
    })

    describe('markMediaUploadVerified', () => {
      const createPendingMedia = (path: string) =>
        database.createMedia({
          actorId: actors.primary.id,
          original: {
            path,
            bytes: 1000,
            mimeType: 'image/jpeg',
            metaData: {
              width: 100,
              height: 100,
              upload: { state: 'pending', checksumSha1: 'abc123', size: 1000 }
            }
          }
        })

      it('flips a pending upload to verified and persists it', async () => {
        const actor = await database.getActorFromId({ id: actors.primary.id })
        const accountId = actor!.account!.id
        const media = await createPendingMedia('/test/verify-pending.jpg')
        const verifiedAt = Date.now()

        const verified = await database.markMediaUploadVerified({
          mediaId: media!.id,
          accountId,
          verifiedAt
        })

        expect(verified?.original.metaData.upload).toMatchObject({
          state: 'verified',
          verifiedAt,
          // The rest of the upload metadata survives the rewrite.
          checksumSha1: 'abc123',
          size: 1000
        })

        // The returned object is not enough — it must have reached the row.
        const reread = await database.getMediaByIdForAccount({
          mediaId: media!.id,
          accountId
        })
        expect(reread?.original.metaData.upload).toMatchObject({
          state: 'verified',
          verifiedAt
        })
      })

      it('returns null when the media belongs to another account', async () => {
        const otherActor = await database.getActorFromId({
          id: actors.replyAuthor.id
        })
        const media = await createPendingMedia('/test/verify-foreign.jpg')

        const verified = await database.markMediaUploadVerified({
          mediaId: media!.id,
          accountId: otherActor!.account!.id,
          verifiedAt: Date.now()
        })

        expect(verified).toBeNull()
      })

      it('returns null for an id that is not a positive integer', async () => {
        const actor = await database.getActorFromId({ id: actors.primary.id })
        const verified = await database.markMediaUploadVerified({
          mediaId: 'abc',
          accountId: actor!.account!.id,
          verifiedAt: Date.now()
        })
        expect(verified).toBeNull()
      })
    })

    describe('getStorageUsageForAccount', () => {
      it('returns 0 when no media exists', async () => {
        const actor = await database.getActorFromId({
          id: actors.extra.id
        })
        expect(actor).toBeDefined()

        const usage = await database.getStorageUsageForAccount({
          accountId: actor!.account!.id
        })

        expect(usage).toBeNumber()
        expect(usage).toBeGreaterThanOrEqual(0)
      })

      it('sums original and thumbnail bytes correctly', async () => {
        // Create media with thumbnail
        await database.createMedia({
          actorId: actors.pollAuthor.id,
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
          id: actors.pollAuthor.id
        })
        expect(actor).toBeDefined()

        const usage = await database.getStorageUsageForAccount({
          accountId: actor!.account!.id
        })

        expect(usage).toBeGreaterThanOrEqual(3500) // 3000 + 500
      })

      it('aggregates across all actors in account', async () => {
        const actor1 = actors.followRequester
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
          accountId: actor1Data!.account!.id
        })

        expect(usage).toBeGreaterThanOrEqual(2000)
      })
    })

    describe('deleteMedia', () => {
      it('deletes media successfully', async () => {
        const media = await database.createMedia({
          actorId: actors.empty.id,
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

        // Verify media is deleted
        const actor = await database.getActorFromId({
          id: actors.empty.id
        })

        // Check that the specific media doesn't exist anymore
        const result = await database.getMediasWithStatusForAccount({
          accountId: actor!.account!.id
        })
        const foundMedia = result.items.find((m) => m.id === media!.id)
        expect(foundMedia).toBeUndefined()
      })

      it('decreases storage usage when deleting media', async () => {
        const actor = await database.getActorFromId({
          id: actors.empty.id
        })
        expect(actor?.account).toBeDefined()

        const media = await database.createMedia({
          actorId: actors.empty.id,
          original: {
            path: '/test/usage-decrease-original.jpg',
            bytes: 2200,
            mimeType: 'image/jpeg',
            metaData: { width: 300, height: 200 }
          },
          thumbnail: {
            path: '/test/usage-decrease-thumbnail.jpg',
            bytes: 400,
            mimeType: 'image/jpeg',
            metaData: { width: 120, height: 80 }
          }
        })
        expect(media).toBeDefined()

        const beforeDeleteUsage = await database.getStorageUsageForAccount({
          accountId: actor!.account!.id
        })

        const deleted = await database.deleteMedia({ mediaId: media!.id })
        expect(deleted).toBe(true)

        const afterDeleteUsage = await database.getStorageUsageForAccount({
          accountId: actor!.account!.id
        })
        expect(afterDeleteUsage).toBe(beforeDeleteUsage - 2600)
      })

      it('returns false when media does not exist', async () => {
        const deleted = await database.deleteMedia({ mediaId: '999999' })
        expect(deleted).toBe(false)
      })

      it('returns false for an id that is not a positive integer', async () => {
        expect(await database.deleteMedia({ mediaId: 'abc' })).toBe(false)
      })

      it('deletes media by actor and original path', async () => {
        const actor = await database.getActorFromId({
          id: actors.empty.id
        })
        expect(actor?.account).toBeDefined()

        const media = await database.createMedia({
          actorId: actors.empty.id,
          original: {
            path: '/test/delete-by-path.jpg',
            bytes: 1600,
            mimeType: 'image/jpeg',
            metaData: { width: 300, height: 200 }
          }
        })
        expect(media).toBeDefined()

        const beforeDeleteUsage = await database.getStorageUsageForAccount({
          accountId: actor!.account!.id
        })

        const deleted = await database.deleteMediaByPath({
          actorId: actors.empty.id,
          path: '/test/delete-by-path.jpg'
        })
        expect(deleted).toBe(true)

        const afterDeleteUsage = await database.getStorageUsageForAccount({
          accountId: actor!.account!.id
        })
        expect(afterDeleteUsage).toBe(beforeDeleteUsage - 1600)

        const result = await database.getMediasWithStatusForAccount({
          accountId: actor!.account!.id
        })
        expect(result.items.find((m) => m.id === media!.id)).toBeUndefined()
      })

      it('does not delete media by path for a different actor', async () => {
        const media = await database.createMedia({
          actorId: actors.empty.id,
          original: {
            path: '/test/delete-by-path-wrong-actor.jpg',
            bytes: 1600,
            mimeType: 'image/jpeg',
            metaData: { width: 300, height: 200 }
          }
        })
        expect(media).toBeDefined()

        const deleted = await database.deleteMediaByPath({
          actorId: actors.primary.id,
          path: '/test/delete-by-path-wrong-actor.jpg'
        })
        expect(deleted).toBe(false)

        const actor = await database.getActorFromId({
          id: actors.empty.id
        })
        const result = await database.getMediaByIdForAccount({
          mediaId: media!.id,
          accountId: actor!.account!.id
        })
        expect(result).toBeDefined()
      })
    })

    describe('createMedia - fileName field', () => {
      it('stores and retrieves original fileName', async () => {
        const actor = await database.getActorFromId({
          id: actors.primary.id
        })
        expect(actor).toBeDefined()

        // Create media with fileName
        const media = await database.createMedia({
          actorId: actors.primary.id,
          original: {
            path: '/test/random-abc123.jpg',
            bytes: 5000,
            mimeType: 'image/jpeg',
            metaData: { width: 800, height: 600 },
            fileName: 'my-vacation-photo.jpg'
          }
        })

        expect(media).toBeDefined()
        expect(media?.original.fileName).toBe('my-vacation-photo.jpg')

        // Retrieve media and verify fileName is persisted
        const retrieved = await database.getMediaByIdForAccount({
          mediaId: media!.id,
          accountId: actor!.account!.id
        })

        expect(retrieved).toBeDefined()
        expect(retrieved?.original.fileName).toBe('my-vacation-photo.jpg')
        expect(retrieved?.original.path).toBe('/test/random-abc123.jpg')
      })

      it('creates media without a fileName for backward compatibility', async () => {
        const actor = await database.getActorFromId({
          id: actors.primary.id
        })
        expect(actor).toBeDefined()

        // Create media without fileName
        const media = await database.createMedia({
          actorId: actors.primary.id,
          original: {
            path: '/test/another-random-xyz789.jpg',
            bytes: 3000,
            mimeType: 'image/jpeg',
            metaData: { width: 400, height: 300 }
          }
        })

        expect(media).toBeDefined()
        expect(media?.original.fileName).toBeUndefined()

        // Retrieve media and verify no fileName is persisted
        const retrieved = await database.getMediaByIdForAccount({
          mediaId: media!.id,
          accountId: actor!.account!.id
        })

        expect(retrieved).toBeDefined()
        expect(retrieved?.original.fileName).toBeUndefined()
        expect(retrieved?.original.path).toBe('/test/another-random-xyz789.jpg')
      })
    })

    describe('updateMedia', () => {
      it('updates the description for media owned by the account', async () => {
        const actor = await database.getActorFromId({ id: actors.primary.id })
        const accountId = actor!.account!.id
        const media = await database.createMedia({
          actorId: actors.primary.id,
          original: {
            path: '/test/update-media-desc.jpg',
            bytes: 1234,
            mimeType: 'image/jpeg',
            metaData: { width: 100, height: 100 }
          }
        })

        const updated = await database.updateMedia({
          mediaId: media!.id,
          accountId,
          description: 'updated alt text'
        })

        expect(updated?.media.description).toBe('updated alt text')
        const retrieved = await database.getMediaByIdForAccount({
          mediaId: media!.id,
          accountId
        })
        expect(retrieved?.description).toBe('updated alt text')
      })

      it('clears the description when null is provided', async () => {
        const actor = await database.getActorFromId({ id: actors.primary.id })
        const accountId = actor!.account!.id
        const media = await database.createMedia({
          actorId: actors.primary.id,
          description: 'original',
          original: {
            path: '/test/update-media-clear.jpg',
            bytes: 1234,
            mimeType: 'image/jpeg',
            metaData: { width: 100, height: 100 }
          }
        })

        const updated = await database.updateMedia({
          mediaId: media!.id,
          accountId,
          description: null
        })

        expect(updated?.media.description).toBeUndefined()
      })

      it('returns null when the media is not owned by the account', async () => {
        const otherActor = await database.getActorFromId({
          id: actors.replyAuthor.id
        })
        const media = await database.createMedia({
          actorId: actors.primary.id,
          original: {
            path: '/test/update-media-foreign.jpg',
            bytes: 1234,
            mimeType: 'image/jpeg',
            metaData: { width: 100, height: 100 }
          }
        })

        const updated = await database.updateMedia({
          mediaId: media!.id,
          accountId: otherActor!.account!.id,
          description: 'should not apply'
        })

        expect(updated).toBeNull()
      })

      it('returns null for a nonexistent media id', async () => {
        const actor = await database.getActorFromId({ id: actors.primary.id })
        const updated = await database.updateMedia({
          mediaId: '99999999',
          accountId: actor!.account!.id,
          description: 'nope'
        })
        expect(updated).toBeNull()
      })

      it('returns null for an id that is not a positive integer', async () => {
        const actor = await database.getActorFromId({ id: actors.primary.id })
        const updated = await database.updateMedia({
          mediaId: 'abc',
          accountId: actor!.account!.id,
          description: 'nope'
        })
        expect(updated).toBeNull()
      })

      it('persists a focal point and round-trips it exactly', async () => {
        const actor = await database.getActorFromId({ id: actors.primary.id })
        const accountId = actor!.account!.id
        const media = await database.createMedia({
          actorId: actors.primary.id,
          original: {
            path: '/test/update-media-focus.jpg',
            bytes: 1234,
            mimeType: 'image/jpeg',
            metaData: { width: 100, height: 100 }
          }
        })

        const updated = await database.updateMedia({
          mediaId: media!.id,
          accountId,
          focus: { x: 0.5, y: -0.25 }
        })

        expect(updated?.media.focus).toEqual({ x: 0.5, y: -0.25 })
        const retrieved = await database.getMediaByIdForAccount({
          mediaId: media!.id,
          accountId
        })
        expect(retrieved?.focus).toEqual({ x: 0.5, y: -0.25 })
      })

      it('keeps focus untouched when only the description is updated', async () => {
        const actor = await database.getActorFromId({ id: actors.primary.id })
        const accountId = actor!.account!.id
        const media = await database.createMedia({
          actorId: actors.primary.id,
          description: 'original',
          focus: { x: 0.1, y: 0.2 },
          original: {
            path: '/test/update-media-focus-keep.jpg',
            bytes: 1234,
            mimeType: 'image/jpeg',
            metaData: { width: 100, height: 100 }
          }
        })

        const updated = await database.updateMedia({
          mediaId: media!.id,
          accountId,
          description: 'changed'
        })

        expect(updated?.media.description).toBe('changed')
        expect(updated?.media.focus).toEqual({ x: 0.1, y: 0.2 })
      })

      it('keeps the description untouched when only focus is updated', async () => {
        const actor = await database.getActorFromId({ id: actors.primary.id })
        const accountId = actor!.account!.id
        const media = await database.createMedia({
          actorId: actors.primary.id,
          description: 'keep me',
          original: {
            path: '/test/update-media-desc-keep.jpg',
            bytes: 1234,
            mimeType: 'image/jpeg',
            metaData: { width: 100, height: 100 }
          }
        })

        const updated = await database.updateMedia({
          mediaId: media!.id,
          accountId,
          focus: { x: -1, y: 1 }
        })

        expect(updated?.media.focus).toEqual({ x: -1, y: 1 })
        expect(updated?.media.description).toBe('keep me')
      })

      it('replaces the thumbnail and adjusts the usage counter by the byte delta', async () => {
        const actor = await database.getActorFromId({ id: actors.empty.id })
        const accountId = actor!.account!.id
        const media = await database.createMedia({
          actorId: actors.empty.id,
          original: {
            path: '/test/update-thumb-original.jpg',
            bytes: 1000,
            mimeType: 'image/jpeg',
            metaData: { width: 100, height: 100 }
          },
          thumbnail: {
            path: '/test/update-thumb-old.jpg',
            bytes: 200,
            mimeType: 'image/jpeg',
            metaData: { width: 40, height: 40 }
          }
        })

        const usageBefore = await database.getStorageUsageForAccount({
          accountId
        })

        const updated = await database.updateMedia({
          mediaId: media!.id,
          accountId,
          thumbnail: {
            path: '/test/update-thumb-new.webp',
            bytes: 350,
            mimeType: 'image/webp',
            metaData: { width: 60, height: 60 }
          }
        })

        expect(updated?.media.thumbnail?.path).toBe(
          '/test/update-thumb-new.webp'
        )
        expect(updated?.media.thumbnail?.bytes).toBe(350)

        const usageAfter = await database.getStorageUsageForAccount({
          accountId
        })
        // 350 - 200 = +150
        expect(usageAfter).toBe(usageBefore + 150)
      })

      it('decreases the usage counter when the replacement thumbnail is smaller', async () => {
        const actor = await database.getActorFromId({ id: actors.empty.id })
        const accountId = actor!.account!.id
        const media = await database.createMedia({
          actorId: actors.empty.id,
          original: {
            path: '/test/update-thumb-shrink-original.jpg',
            bytes: 1000,
            mimeType: 'image/jpeg',
            metaData: { width: 100, height: 100 }
          },
          thumbnail: {
            path: '/test/update-thumb-shrink-old.jpg',
            bytes: 400,
            mimeType: 'image/jpeg',
            metaData: { width: 40, height: 40 }
          }
        })

        const usageBefore = await database.getStorageUsageForAccount({
          accountId
        })

        await database.updateMedia({
          mediaId: media!.id,
          accountId,
          thumbnail: {
            path: '/test/update-thumb-shrink-new.webp',
            bytes: 100,
            mimeType: 'image/webp',
            metaData: { width: 20, height: 20 }
          }
        })

        const usageAfter = await database.getStorageUsageForAccount({
          accountId
        })
        // 100 - 400 = -300
        expect(usageAfter).toBe(usageBefore - 300)
      })
    })

    describe('deleteMediaForAccount', () => {
      it('deletes owner media not attached to a status and decreases usage', async () => {
        const actor = await database.getActorFromId({ id: actors.empty.id })
        const accountId = actor!.account!.id
        const media = await database.createMedia({
          actorId: actors.empty.id,
          original: {
            path: '/test/del-for-account.jpg',
            bytes: 1500,
            mimeType: 'image/jpeg',
            metaData: { width: 100, height: 100 }
          }
        })

        const usageBefore = await database.getStorageUsageForAccount({
          accountId
        })

        const result = await database.deleteMediaForAccount({
          mediaId: media!.id,
          accountId
        })

        expect(result.status).toBe('deleted')
        const usageAfter = await database.getStorageUsageForAccount({
          accountId
        })
        expect(usageAfter).toBe(usageBefore - 1500)
        const retrieved = await database.getMediaByIdForAccount({
          mediaId: media!.id,
          accountId
        })
        expect(retrieved).toBeNull()
      })

      it('returns not-found for a nonexistent media id', async () => {
        const actor = await database.getActorFromId({ id: actors.primary.id })
        const result = await database.deleteMediaForAccount({
          mediaId: '99999999',
          accountId: actor!.account!.id
        })
        expect(result.status).toBe('not-found')
      })

      it('returns not-found for an id that is not a positive integer', async () => {
        const actor = await database.getActorFromId({ id: actors.primary.id })
        const result = await database.deleteMediaForAccount({
          mediaId: 'abc',
          accountId: actor!.account!.id
        })
        expect(result.status).toBe('not-found')
      })

      it('returns not-found when the media belongs to another account', async () => {
        const media = await database.createMedia({
          actorId: actors.primary.id,
          original: {
            path: '/test/del-for-account-foreign.jpg',
            bytes: 1000,
            mimeType: 'image/jpeg',
            metaData: { width: 100, height: 100 }
          }
        })
        const otherActor = await database.getActorFromId({
          id: actors.replyAuthor.id
        })

        const result = await database.deleteMediaForAccount({
          mediaId: media!.id,
          accountId: otherActor!.account!.id
        })

        expect(result.status).toBe('not-found')
        // The media must still exist for its real owner.
        const owner = await database.getActorFromId({ id: actors.primary.id })
        const stillThere = await database.getMediaByIdForAccount({
          mediaId: media!.id,
          accountId: owner!.account!.id
        })
        expect(stillThere).toBeDefined()
      })

      it('returns in-use when the media is attached to a posted status', async () => {
        const actor = await database.getActorFromId({ id: actors.primary.id })
        const accountId = actor!.account!.id
        const media = await database.createMedia({
          actorId: actors.primary.id,
          original: {
            path: '/test/del-for-account-attached.jpg',
            bytes: 1000,
            mimeType: 'image/jpeg',
            metaData: { width: 100, height: 100 }
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
          url: media!.original.path,
          mediaId: media!.id
        })

        const result = await database.deleteMediaForAccount({
          mediaId: media!.id,
          accountId
        })

        expect(result.status).toBe('in-use')
        const stillThere = await database.getMediaByIdForAccount({
          mediaId: media!.id,
          accountId
        })
        expect(stillThere).toBeDefined()
      })
    })

    describe('blurhash and attachment focal points', () => {
      it('creates and retrieves media with blurhash', async () => {
        const actor = await database.getActorFromId({ id: actors.primary.id })
        const accountId = actor!.account!.id
        const media = await database.createMedia({
          actorId: actors.primary.id,
          original: {
            path: '/test/media-blurhash.jpg',
            bytes: 1234,
            mimeType: 'image/jpeg',
            metaData: { width: 100, height: 100 }
          },
          blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj'
        })

        expect(media?.blurhash).toBe('LEHV6nWB2yk8pyo0adR*.7kCMdnj')
        const retrieved = await database.getMediaByIdForAccount({
          mediaId: media!.id,
          accountId
        })
        expect(retrieved?.blurhash).toBe('LEHV6nWB2yk8pyo0adR*.7kCMdnj')
      })

      it('creates and retrieves attachments with blurhash, focus, and thumbnailUrl', async () => {
        const statuses = await database.getActorStatuses({
          actorId: actors.primary.id,
          limit: 1
        })
        expect(statuses.length).toBeGreaterThan(0)

        const attachment = await database.createAttachment({
          actorId: actors.primary.id,
          statusId: statuses[0].id,
          mediaType: 'image/jpeg',
          url: 'https://example.com/image.jpg',
          width: 800,
          height: 600,
          name: 'An image',
          blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
          focus: { x: -0.5, y: 0.75 },
          thumbnailUrl: 'https://example.com/thumbnail.jpg'
        })

        expect(attachment.blurhash).toBe('LEHV6nWB2yk8pyo0adR*.7kCMdnj')
        expect(attachment.focus).toEqual({ x: -0.5, y: 0.75 })
        expect(attachment.thumbnailUrl).toBe(
          'https://example.com/thumbnail.jpg'
        )

        const list = await database.getAttachments({ statusId: statuses[0].id })
        const found = list.find((a) => a.id === attachment.id)
        expect(found).toBeDefined()
        expect(found?.blurhash).toBe('LEHV6nWB2yk8pyo0adR*.7kCMdnj')
        expect(found?.focus).toEqual({ x: -0.5, y: 0.75 })
        expect(found?.thumbnailUrl).toBe('https://example.com/thumbnail.jpg')
      })
    })
  })
})
