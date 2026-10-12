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

        expect(verified?.media.original.metaData.upload).toMatchObject({
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

      // The client declares width/height when it asks for the URL; the
      // probed dimensions of the uploaded bytes replace them.
      it('records probed dimensions over the declared ones', async () => {
        const actor = await database.getActorFromId({ id: actors.primary.id })
        const accountId = actor!.account!.id
        const media = await createPendingMedia('/test/verify-dimensions.jpg')

        await database.markMediaUploadVerified({
          mediaId: media!.id,
          accountId,
          verifiedAt: Date.now(),
          dimensions: { width: 640, height: 480 }
        })

        const reread = await database.getMediaByIdForAccount({
          mediaId: media!.id,
          accountId
        })
        expect(reread?.original.metaData).toMatchObject({
          width: 640,
          height: 480,
          upload: { state: 'verified', checksumSha1: 'abc123' }
        })
      })

      // Completion rewrites the object without its metadata, so the stored
      // size and the account's usage move together.
      it('records the rewritten size and moves the usage counter by the difference', async () => {
        const actor = await database.getActorFromId({ id: actors.primary.id })
        const accountId = actor!.account!.id
        const media = await createPendingMedia('/test/verify-rewritten.jpg')
        const before = await database.getStorageUsageForAccount({ accountId })

        const verified = await database.markMediaUploadVerified({
          mediaId: media!.id,
          accountId,
          verifiedAt: Date.now(),
          originalBytes: 700
        })

        expect(verified?.media.original.bytes).toBe(700)
        const reread = await database.getMediaByIdForAccount({
          mediaId: media!.id,
          accountId
        })
        expect(reread?.original.bytes).toBe(700)
        expect(await database.getStorageUsageForAccount({ accountId })).toBe(
          before - 300
        )
      })

      it('swaps in the stripped original path with the verification', async () => {
        const actor = await database.getActorFromId({ id: actors.primary.id })
        const accountId = actor!.account!.id
        const media = await createPendingMedia('/test/verify-swap.jpg')

        const verified = await database.markMediaUploadVerified({
          mediaId: media!.id,
          accountId,
          verifiedAt: Date.now(),
          originalBytes: 800,
          originalPath: '/test/verify-swap-stripped.jpg'
        })

        expect(verified).toMatchObject({
          transitioned: true,
          media: { original: { path: '/test/verify-swap-stripped.jpg' } }
        })
        const reread = await database.getMediaByIdForAccount({
          mediaId: media!.id,
          accountId
        })
        expect(reread?.original).toMatchObject({
          path: '/test/verify-swap-stripped.jpg',
          bytes: 800
        })
      })

      // A retried or concurrent completion must not move the usage counter a
      // second time, nor overwrite the first call's path and size.
      it('transitions once and adjusts usage once under repeated and concurrent calls', async () => {
        const actor = await database.getActorFromId({ id: actors.primary.id })
        const accountId = actor!.account!.id
        const media = await createPendingMedia('/test/verify-once.jpg')
        const before = await database.getStorageUsageForAccount({ accountId })

        const results = await Promise.all(
          [600, 650].map((bytes) =>
            database.markMediaUploadVerified({
              mediaId: media!.id,
              accountId,
              verifiedAt: Date.now(),
              originalBytes: bytes,
              originalPath: `/test/verify-once-${bytes}.jpg`
            })
          )
        )
        const repeated = await database.markMediaUploadVerified({
          mediaId: media!.id,
          accountId,
          verifiedAt: Date.now(),
          originalBytes: 100,
          originalPath: '/test/verify-once-late.jpg'
        })

        const winners = results.filter((result) => result?.transitioned)
        expect(winners).toHaveLength(1)
        expect(repeated?.transitioned).toBe(false)
        const winningBytes = winners[0]!.media.original.bytes
        const reread = await database.getMediaByIdForAccount({
          mediaId: media!.id,
          accountId
        })
        expect(reread?.original).toMatchObject({
          bytes: winningBytes,
          path: `/test/verify-once-${winningBytes}.jpg`
        })
        expect(repeated?.media.original.bytes).toBe(winningBytes)
        expect(await database.getStorageUsageForAccount({ accountId })).toBe(
          before - (1000 - winningBytes)
        )
      })

      // The details are built from bytes whose original is deleted right after
      // the swap, so they must commit with it — and only with it.
      it('writes the details with the verification and not on a repeat', async () => {
        const actor = await database.getActorFromId({ id: actors.primary.id })
        const accountId = actor!.account!.id
        const media = await createPendingMedia('/test/verify-details.jpg')
        const takenAt = Date.UTC(2024, 4, 6, 7, 8, 9)

        const verified = await database.markMediaUploadVerified({
          mediaId: media!.id,
          accountId,
          verifiedAt: Date.now(),
          originalBytes: 600,
          originalPath: '/test/verify-details-stripped.jpg',
          details: {
            inGallery: true,
            takenAt,
            placeName: 'Somewhere',
            placeLatitude: 51.5,
            placeLongitude: -0.125
          }
        })

        expect(verified?.transitioned).toBe(true)
        expect(verified?.media.details).toMatchObject({
          inGallery: true,
          takenAt,
          placeName: 'Somewhere'
        })
        const reread = await database.getMediaByIdForAccount({
          mediaId: media!.id,
          accountId
        })
        expect(reread?.original.path).toBe('/test/verify-details-stripped.jpg')
        expect(reread?.details).toMatchObject({
          inGallery: true,
          takenAt,
          placeName: 'Somewhere',
          placeLatitude: 51.5,
          placeLongitude: -0.125
        })

        const repeated = await database.markMediaUploadVerified({
          mediaId: media!.id,
          accountId,
          verifiedAt: Date.now(),
          details: { inGallery: false, placeName: 'Elsewhere' }
        })
        expect(repeated?.transitioned).toBe(false)
        const after = await database.getMediaByIdForAccount({
          mediaId: media!.id,
          accountId
        })
        expect(after?.details).toMatchObject({
          inGallery: true,
          placeName: 'Somewhere'
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
  })
})
