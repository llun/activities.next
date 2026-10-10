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

    // A photo edited twice: the uploaded file sits in the `original` slot
    // (with the presigned key it came through) and the first render is kept
    // as a superseded slot, beside the live second render.
    const createEditedMedia = async (name: string) => {
      const actor = await database.getActorFromId({ id: actors.empty.id })
      const accountId = actor!.account!.id
      const media = await database.createMedia({
        actorId: actors.empty.id,
        original: {
          path: `/test/${name}.webp`,
          bytes: 1000,
          mimeType: 'image/jpeg',
          metaData: {
            width: 100,
            height: 100,
            upload: {
              state: 'verified',
              clientPath: `/test/${name}-client.jpg`
            }
          }
        }
      })
      const render = (suffix: string, bytes: number) => ({
        path: `/test/${name}-${suffix}.webp`,
        bytes,
        mimeType: 'image/webp',
        width: 80,
        height: 80,
        blurhash: null,
        focus: null
      })
      for (const [index, [suffix, bytes]] of (
        [
          ['a', 300],
          ['b', 400]
        ] as const
      ).entries()) {
        await database.applyMediaEdit({
          mediaId: media!.id,
          accountId,
          baseVersion: index,
          saveId: suffix,
          recipe: '{"v":1}',
          render: render(suffix, bytes)
        })
      }
      return { media: media!, accountId }
    }

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

      it('removes the photo edit files and frees all their bytes', async () => {
        const { media, accountId } = await createEditedMedia('del-edited')
        const usageBefore = await database.getStorageUsageForAccount({
          accountId
        })

        expect(await database.deleteMedia({ mediaId: media.id })).toBe(true)

        // live render (400) + uploaded original (1000) + superseded (300)
        expect(await database.getStorageUsageForAccount({ accountId })).toBe(
          usageBefore - 1700
        )
        expect(
          await database.listMediaEditFiles({ mediaIds: [media.id] })
        ).toEqual([])
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

      it('returns null when actorId narrows ownership to a different actor of the account', async () => {
        const actor = await database.getActorFromId({ id: actors.primary.id })
        const accountId = actor!.account!.id
        const media = await database.createMedia({
          actorId: actors.primary.id,
          description: 'original',
          original: {
            path: '/test/update-media-other-actor.jpg',
            bytes: 1234,
            mimeType: 'image/jpeg',
            metaData: { width: 100, height: 100 }
          }
        })

        const updated = await database.updateMedia({
          mediaId: media!.id,
          accountId,
          actorId: `${actors.primary.id}-sibling`,
          description: 'should not apply'
        })
        expect(updated).toBeNull()
        const retrieved = await database.getMediaByIdForAccount({
          mediaId: media!.id,
          accountId
        })
        expect(retrieved?.description).toBe('original')

        const owned = await database.updateMedia({
          mediaId: media!.id,
          accountId,
          actorId: actors.primary.id,
          description: 'owner edit'
        })
        expect(owned?.media.description).toBe('owner edit')
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

      it('also returns the presign key recorded as upload.clientPath', async () => {
        const actor = await database.getActorFromId({ id: actors.empty.id })
        const accountId = actor!.account!.id
        const media = await database.createMedia({
          actorId: actors.empty.id,
          original: {
            path: '/test/del-client-path-client.jpg',
            bytes: 1000,
            mimeType: 'image/jpeg',
            metaData: {
              width: 100,
              height: 100,
              upload: { state: 'pending', checksumSha1: 'abc', size: 1000 }
            }
          }
        })
        await database.markMediaUploadVerified({
          mediaId: media!.id,
          accountId,
          verifiedAt: Date.now(),
          originalPath: '/test/del-client-path-stripped.jpg',
          originalBytes: 900,
          clientPath: '/test/del-client-path-client.jpg'
        })

        const result = await database.deleteMediaForAccount({
          mediaId: media!.id,
          accountId
        })

        expect(result).toEqual({
          status: 'deleted',
          files: [
            '/test/del-client-path-stripped.jpg',
            '/test/del-client-path-client.jpg'
          ]
        })
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

      it('returns the photo edit files and frees all their bytes', async () => {
        const { media, accountId } = await createEditedMedia('del-acct-edited')
        const usageBefore = await database.getStorageUsageForAccount({
          accountId
        })

        const result = await database.deleteMediaForAccount({
          mediaId: media.id,
          accountId
        })

        expect(result.status).toBe('deleted')
        if (result.status !== 'deleted') return
        expect([...result.files].sort()).toEqual(
          [
            '/test/del-acct-edited-b.webp',
            '/test/del-acct-edited.webp',
            '/test/del-acct-edited-client.jpg',
            '/test/del-acct-edited-a.webp'
          ].sort()
        )
        expect(await database.getStorageUsageForAccount({ accountId })).toBe(
          usageBefore - 1700
        )
        expect(
          await database.listMediaEditFiles({ mediaIds: [media.id] })
        ).toEqual([])
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

      it('persists, queries, and updates playbackType for animation attachments', async () => {
        const statuses = await database.getActorStatuses({
          actorId: actors.primary.id
        })
        expect(statuses.length).toBeGreaterThan(0)

        const attachment = await database.createAttachment({
          actorId: actors.primary.id,
          statusId: statuses[0].id,
          mediaType: 'video/mp4',
          url: 'https://example.com/animation.mp4',
          width: 480,
          height: 480,
          name: 'An animation',
          playbackType: 'gifv',
          thumbnailUrl: 'https://example.com/preview.png'
        })

        expect(attachment.playbackType).toBe('gifv')

        const list = await database.getAttachments({ statusId: statuses[0].id })
        const found = list.find((a) => a.id === attachment.id)
        expect(found).toBeDefined()
        expect(found?.playbackType).toBe('gifv')
        expect(found?.thumbnailUrl).toBe('https://example.com/preview.png')

        const listWithMedia = await database.getAttachmentsWithMedia({
          statusId: statuses[0].id
        })
        const foundWithMedia = listWithMedia.find((a) => a.id === attachment.id)
        expect(foundWithMedia?.playbackType).toBe('gifv')

        const updated = await database.updateAttachmentPlayback({
          id: attachment.id,
          statusId: statuses[0].id,
          playbackType: 'video',
          thumbnailUrl: 'https://example.com/new-preview.png'
        })
        expect(updated).toBe(true)

        // onlyIfUnset prevents overwriting when playbackType is already set
        const staleUpdate = await database.updateAttachmentPlayback({
          id: attachment.id,
          statusId: statuses[0].id,
          playbackType: 'gifv',
          onlyIfUnset: true
        })
        expect(staleUpdate).toBe(false)

        const listAfterUpdate = await database.getAttachments({
          statusId: statuses[0].id
        })
        const foundAfterUpdate = listAfterUpdate.find(
          (a) => a.id === attachment.id
        )
        expect(foundAfterUpdate?.playbackType).toBe('video')
        expect(foundAfterUpdate?.thumbnailUrl).toBe(
          'https://example.com/new-preview.png'
        )

        // Create an unclassified attachment and update it with onlyIfUnset: true
        const unsetAttachment = await database.createAttachment({
          actorId: actors.primary.id,
          statusId: statuses[0].id,
          mediaType: 'video/mp4',
          url: 'https://example.com/unset.mp4',
          name: 'Unset animation'
        })
        expect(unsetAttachment.playbackType).toBeUndefined()

        const freshUpdate = await database.updateAttachmentPlayback({
          id: unsetAttachment.id,
          statusId: statuses[0].id,
          playbackType: 'gifv',
          thumbnailUrl: 'https://example.com/unset-thumb.png',
          onlyIfUnset: true
        })
        expect(freshUpdate).toBe(true)

        const listAfterFreshUpdate = await database.getAttachments({
          statusId: statuses[0].id
        })
        const foundFresh = listAfterFreshUpdate.find(
          (a) => a.id === unsetAttachment.id
        )
        expect(foundFresh?.playbackType).toBe('gifv')
        expect(foundFresh?.thumbnailUrl).toBe(
          'https://example.com/unset-thumb.png'
        )
      })

      it('never updates playback for an attachment of another status', async () => {
        // Remote attachment ids are attacker-chosen strings, so the id alone
        // must not be able to reach a row belonging to a different status.
        const statuses = await database.getActorStatuses({
          actorId: actors.primary.id
        })
        const victim = await database.createAttachment({
          actorId: actors.primary.id,
          statusId: statuses[0].id,
          mediaType: 'image/png',
          url: 'https://example.com/victim.png',
          name: 'Victim image'
        })

        const updated = await database.updateAttachmentPlayback({
          id: victim.id,
          statusId: 'https://attacker.example/notes/1',
          playbackType: 'gifv',
          thumbnailUrl: 'https://attacker.example/track.png',
          onlyIfUnset: true
        })
        expect(updated).toBe(false)

        const [stored] = (
          await database.getAttachments({ statusId: statuses[0].id })
        ).filter((a) => a.id === victim.id)
        expect(stored.playbackType).toBeUndefined()
        expect(stored.thumbnailUrl).toBeUndefined()
      })
    })
  })
})
