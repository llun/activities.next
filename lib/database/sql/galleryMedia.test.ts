import type { GalleryMediaDatabase } from '@/lib/database/sql/galleryMedia'
import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import {
  GalleryAudience,
  OWNER_GALLERY_AUDIENCE,
  PUBLIC_GALLERY_AUDIENCE
} from '@/lib/services/gallery/galleryAudience'
import { seedDatabase } from '@/lib/stub/database'
import { DatabaseSeed } from '@/lib/stub/scenarios/database'
import { MediaDetailsRecord } from '@/lib/types/database/gallery'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

// Every query here chunks its `whereIn` lists by `getWhereInBatchSize`. Capping
// it at 2 makes even this small fixture span several chunks, so the batched
// attachment pick and the id reads are exercised across chunk boundaries. Any
// batch size of at least 1 is correct, so the rest of the database (seeding
// included) is unaffected.
vi.mock('@/lib/database/sql/utils/knex', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/lib/database/sql/utils/knex')>()
  return {
    ...original,
    getWhereInBatchSize: (
      ...args: Parameters<typeof original.getWhereInBatchSize>
    ) => Math.min(original.getWhereInBatchSize(...args), 2)
  }
})

describe('GalleryMediaDatabase', () => {
  const { actors } = DatabaseSeed
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  describe.each(table)('%s', (_, database) => {
    const ownerId: string = actors.empty.id
    const followersUrl = `${ownerId}/followers`
    const strangerId = actors.extra.id
    const mentionedId = actors.pollAuthor.id
    const otherActorId = actors.replyAuthor.id

    const audiences: Record<string, GalleryAudience> = {
      owner: OWNER_GALLERY_AUDIENCE,
      'logged out': PUBLIC_GALLERY_AUDIENCE,
      stranger: {
        kind: 'viewer',
        publicOnly: false,
        visibleToActorId: strangerId,
        includeFollowersOnly: false,
        followersAudience: followersUrl
      },
      follower: {
        kind: 'viewer',
        publicOnly: false,
        visibleToActorId: strangerId,
        includeFollowersOnly: true,
        followersAudience: followersUrl
      },
      'mentioned actor': {
        kind: 'viewer',
        publicOnly: false,
        visibleToActorId: mentionedId,
        includeFollowersOnly: false,
        followersAudience: followersUrl
      },
      // All flags falsy reads as "no filter" to the status builder; the
      // gallery must coerce it to the logged-out view instead.
      'viewer with no flags': {
        kind: 'viewer',
        publicOnly: false,
        visibleToActorId: null,
        includeFollowersOnly: false,
        followersAudience: null
      }
    }

    const status = (name: string, actorId = ownerId) =>
      `${actorId}/statuses/gallery-${name}`

    const ids: Record<string, string> = {}
    let gearA = ''
    let gearB = ''

    const createMedia = async (
      name: string,
      details: Partial<MediaDetailsRecord> = {},
      actorId = ownerId
    ) => {
      const media = await database.createMedia({
        actorId,
        original: {
          path: `/test/gallery-${name}.jpg`,
          bytes: 1000,
          mimeType: 'image/jpeg',
          metaData: { width: 100, height: 100 }
        },
        details: { inGallery: true, ...details }
      })
      ids[name] = media!.id
      return media!.id
    }

    const note = async (
      name: string,
      to: string[],
      cc: string[] = [],
      actorId = ownerId
    ) => {
      await database.createNote({
        id: status(name, actorId),
        url: status(name, actorId),
        actorId,
        to,
        cc,
        text: name
      })
      return status(name, actorId)
    }

    const attach = async (
      statusId: string,
      mediaId: string,
      {
        actorId = ownerId,
        createdAt
      }: { actorId?: string; createdAt?: number } = {}
    ) =>
      database.createAttachment({
        actorId,
        statusId,
        mediaType: 'image/jpeg',
        url: `https://media.test/${encodeURIComponent(statusId)}/${mediaId}.jpg`,
        width: 100,
        height: 100,
        mediaId,
        ...(createdAt ? { createdAt } : {})
      })

    beforeAll(async () => {
      await seedDatabase(database)

      gearA = (
        await database.createGalleryGear({
          actorId: ownerId,
          kind: 'camera',
          name: 'Camera A'
        })
      ).id
      gearB = (
        await database.createGalleryGear({
          actorId: ownerId,
          kind: 'lens',
          name: 'Lens B'
        })
      ).id

      const publicStatus = await note('public', [ACTIVITY_STREAM_PUBLIC])
      const unlistedStatus = await note(
        'unlisted',
        [followersUrl],
        [ACTIVITY_STREAM_PUBLIC]
      )
      const followersStatus = await note('followers', [followersUrl])
      const directStatus = await note('direct', [mentionedId])
      const followersStatus2 = await note('followers-2', [followersUrl])
      const publicStatus2 = await note('public-2', [ACTIVITY_STREAM_PUBLIC])
      const deletedStatus = await note('deleted', [ACTIVITY_STREAM_PUBLIC])

      // Created in id order, oldest first.
      await createMedia('public', {
        subjectName: 'Common Kingfisher',
        subjectScientificName: 'Alcedo atthis',
        subjectCategory: 'bird',
        takenAt: Date.UTC(2024, 0, 1),
        cameraGearId: gearA,
        placeName: 'River',
        placeLatitude: 51.5543,
        placeLongitude: -0.0231,
        placePrecision: 'exact'
      })
      await createMedia('unlisted', {
        subjectName: 'Red Fox',
        placeLatitude: 10,
        placeLongitude: 10,
        placePrecision: 'hidden'
      })
      await createMedia('followers', {
        subjectName: 'Grey Heron',
        lensGearId: gearA,
        placeLatitude: 20,
        placeLongitude: 20,
        placePrecision: 'area'
      })
      await createMedia('direct', {
        subjectName: 'Badger',
        placeLatitude: 30,
        placeLongitude: 30,
        placePrecision: 'country'
      })
      await createMedia('not-in-gallery', {
        inGallery: false,
        cameraGearId: gearA,
        takenAt: Date.UTC(2020, 5, 1)
      })
      // In the gallery but never posted (upload-on-pick leaves these).
      await createMedia('unposted', { cameraGearId: gearA })
      await createMedia('both', {
        subjectName: 'Common Kingfisher',
        subjectScientificName: 'Alcedo atthis',
        cameraGearId: gearB
      })
      await createMedia('foreign', { subjectName: 'Stolen' })
      await createMedia('persona', { subjectName: 'Persona' })
      await createMedia('deleted', { subjectName: 'Gone' })
      // What the lookups write for the kingfisher: the subject and threat
      // columns, and the country, that the rows below must carry.
      await database.setMediaSubjectLookup({
        mediaId: ids.public,
        expect: {
          subjectName: 'Common Kingfisher',
          subjectScientificName: 'Alcedo atthis',
          subjectTaxonKey: null
        },
        patch: {
          subjectLookupStatus: 'resolved',
          subjectIucnCategory: 'LC',
          subjectTaxonKey: '2475532',
          subjectTaxonPath: ['Animalia', 'Chordata', 'Aves']
        }
      })
      await database.setMediaPlaceLookup({
        mediaId: ids.public,
        expect: { placeLatitude: 51.5543, placeLongitude: -0.0231 },
        patch: { placeLookupStatus: 'resolved', placeCountryCode: 'GB' }
      })

      await attach(publicStatus, ids.public)
      await attach(unlistedStatus, ids.unlisted)
      await attach(followersStatus, ids.followers)
      await attach(directStatus, ids.direct)
      await attach(publicStatus2, ids['not-in-gallery'])
      // `both` hangs off a public post AND a newer followers-only one: a
      // stranger must be shown it through the public post, never the other.
      await attach(publicStatus2, ids.both, { createdAt: Date.UTC(2024, 0, 1) })
      await attach(followersStatus2, ids.both, {
        createdAt: Date.UTC(2024, 6, 1)
      })

      // Another actor's PUBLIC post pointing at the owner's media id. Anyone
      // can write `attachments.mediaId`; it must unlock nothing.
      const foreignStatus = await note(
        'foreign',
        [ACTIVITY_STREAM_PUBLIC],
        [],
        otherActorId
      )
      await attach(foreignStatus, ids.foreign, { actorId: otherActorId })

      // A second persona on the owner's account. The gallery is the owner
      // actor's: another persona's post is that persona's.
      const owner = await database.getActorFromId({ id: ownerId })
      const personaId = await database.createActorForAccount({
        accountId: owner!.account!.id,
        username: 'gallery-persona',
        domain: owner!.domain,
        privateKey: 'private',
        publicKey: 'public'
      })
      const personaStatus = await note(
        'persona',
        [ACTIVITY_STREAM_PUBLIC],
        [],
        personaId
      )
      await attach(personaStatus, ids.persona, { actorId: personaId })

      await attach(deletedStatus, ids.deleted)
      await database.deleteStatus({ statusId: deletedStatus })
    })

    afterAll(async () => {
      await database.destroy()
    })

    const namesOf = (mediaIds: string[]) => {
      const byId = Object.fromEntries(
        Object.entries(ids).map(([name, id]) => [id, name])
      )
      return mediaIds.map((id) => byId[id] ?? `unknown:${id}`)
    }

    // Newest first.
    const visibleTo: Record<string, string[]> = {
      owner: ['both', 'direct', 'followers', 'unlisted', 'public'],
      'logged out': ['both', 'unlisted', 'public'],
      stranger: ['both', 'unlisted', 'public'],
      follower: ['both', 'followers', 'unlisted', 'public'],
      'mentioned actor': ['both', 'direct', 'unlisted', 'public'],
      'viewer with no flags': ['both', 'unlisted', 'public']
    }
    const audienceNames = Object.keys(visibleTo)

    describe('getActorHasGalleryMedia', () => {
      it.each(audienceNames)('is true for the %s', async (name) => {
        expect(
          await database.getActorHasGalleryMedia({
            actorId: ownerId,
            audience: audiences[name]
          })
        ).toBeTrue()
      })

      it('is false for a stranger when the only gallery photo is on a followers-only post', async () => {
        const actorId = actors.followRequester.id
        const statusId = await note(
          'only-followers',
          [`${actorId}/followers`],
          [],
          actorId
        )
        const mediaId = await createMedia('only-followers', {}, actorId)
        await attach(statusId, mediaId, { actorId })

        const viewer = (includeFollowersOnly: boolean): GalleryAudience => ({
          kind: 'viewer',
          publicOnly: false,
          visibleToActorId: strangerId,
          includeFollowersOnly,
          followersAudience: `${actorId}/followers`
        })

        expect(
          await database.getActorHasGalleryMedia({
            actorId,
            audience: PUBLIC_GALLERY_AUDIENCE
          })
        ).toBeFalse()
        expect(
          await database.getActorHasGalleryMedia({
            actorId,
            audience: viewer(false)
          })
        ).toBeFalse()
        expect(
          await database.getActorHasGalleryMedia({
            actorId,
            audience: viewer(true)
          })
        ).toBeTrue()
      })

      it('is false for an actor whose only uploads are unposted or out of the gallery', async () => {
        const actorId = actors.pollAuthor.id
        await createMedia('poll-unposted', {}, actorId)

        expect(
          await database.getActorHasGalleryMedia({
            actorId,
            audience: OWNER_GALLERY_AUDIENCE
          })
        ).toBeFalse()
      })
    })

    describe('getGalleryMedia', () => {
      it.each(audienceNames)(
        'returns exactly the posts the %s may read',
        async (name) => {
          const rows = await database.getGalleryMedia({
            actorId: ownerId,
            audience: audiences[name],
            limit: 50
          })

          expect(namesOf(rows.map((row) => row.media.id))).toEqual(
            visibleTo[name]
          )
        }
      )

      it.each([
        ['logged out', 'public-2'],
        ['stranger', 'public-2'],
        ['follower', 'followers-2'],
        ['owner', 'followers-2']
      ])(
        'shows a media on several posts to the %s through the newest post they may read',
        async (name, expected) => {
          const rows = await database.getGalleryMedia({
            actorId: ownerId,
            audience: audiences[name],
            limit: 50
          })
          const both = rows.find((row) => row.media.id === ids.both)

          expect(both?.statusId).toBe(status(expected))
          expect(both?.attachment.statusId).toBe(status(expected))
          expect(both?.attachment.mediaId).toBe(ids.both)
        }
      )

      it('carries the status publicId for client ids', async () => {
        const [row] = await database.getGalleryMedia({
          actorId: ownerId,
          audience: OWNER_GALLERY_AUDIENCE,
          limit: 1
        })
        const stored = await database.getStatus({
          statusId: row.statusId,
          withReplies: false
        })

        expect(row.statusPublicId).toBe(stored?.publicId ?? null)
      })

      it('pages by maxId, newest first', async () => {
        const first = await database.getGalleryMedia({
          actorId: ownerId,
          audience: OWNER_GALLERY_AUDIENCE,
          limit: 2
        })
        const second = await database.getGalleryMedia({
          actorId: ownerId,
          audience: OWNER_GALLERY_AUDIENCE,
          limit: 2,
          maxId: first[first.length - 1].media.id
        })
        const third = await database.getGalleryMedia({
          actorId: ownerId,
          audience: OWNER_GALLERY_AUDIENCE,
          limit: 2,
          maxId: second[second.length - 1].media.id
        })

        expect(namesOf(first.map((row) => row.media.id))).toEqual([
          'both',
          'direct'
        ])
        expect(namesOf(second.map((row) => row.media.id))).toEqual([
          'followers',
          'unlisted'
        ])
        expect(namesOf(third.map((row) => row.media.id))).toEqual(['public'])
      })

      it.each(['abc', '0x10', '-1', '2147483648', ''])(
        'returns nothing for the invalid maxId %j',
        async (maxId) => {
          expect(
            await database.getGalleryMedia({
              actorId: ownerId,
              audience: OWNER_GALLERY_AUDIENCE,
              limit: 50,
              maxId
            })
          ).toEqual([])
        }
      )

      it('filters by camera or lens gear', async () => {
        const rows = await database.getGalleryMedia({
          actorId: ownerId,
          audience: OWNER_GALLERY_AUDIENCE,
          limit: 50,
          gearId: gearA
        })

        expect(namesOf(rows.map((row) => row.media.id))).toEqual([
          'followers',
          'public'
        ])
      })

      it('keeps the gear filter inside the audience scope', async () => {
        const rows = await database.getGalleryMedia({
          actorId: ownerId,
          audience: PUBLIC_GALLERY_AUDIENCE,
          limit: 50,
          gearId: gearA
        })

        expect(namesOf(rows.map((row) => row.media.id))).toEqual(['public'])
      })

      it('returns nothing for a zero limit', async () => {
        expect(
          await database.getGalleryMedia({
            actorId: ownerId,
            audience: OWNER_GALLERY_AUDIENCE,
            limit: 0
          })
        ).toEqual([])
      })
    })

    describe('getGalleryMediaByIds', () => {
      const everyName = [
        'public',
        'unlisted',
        'followers',
        'direct',
        'not-in-gallery',
        'unposted',
        'both',
        'foreign',
        'persona',
        'deleted'
      ]

      it.each(audienceNames)(
        're-applies the scope for the %s whatever ids are asked for',
        async (name) => {
          const rows = await database.getGalleryMediaByIds({
            actorId: ownerId,
            audience: audiences[name],
            mediaIds: [...everyName.map((media) => ids[media]), 'abc', '0']
          })

          expect(namesOf(rows.map((row) => row.media.id))).toEqual(
            visibleTo[name]
          )
          // Every row is shown through a post this audience may read.
          for (const row of rows) {
            expect(row.attachment.mediaId).toBe(row.media.id)
          }
        }
      )

      it('does not hand out another actor media through its own id list', async () => {
        expect(
          await database.getGalleryMediaByIds({
            actorId: otherActorId,
            audience: OWNER_GALLERY_AUDIENCE,
            mediaIds: everyName.map((media) => ids[media])
          })
        ).toEqual([])
      })

      it('picks the newest visible attachment for media read across chunks', async () => {
        const rows = await database.getGalleryMediaByIds({
          actorId: ownerId,
          audience: audiences.stranger,
          mediaIds: everyName.map((media) => ids[media])
        })
        const both = rows.find((row) => row.media.id === ids.both)

        expect(rows).toHaveLength(3)
        expect(both?.statusId).toBe(status('public-2'))
      })
    })

    describe('getGalleryMediaIndex', () => {
      it.each(audienceNames)(
        'lists only what the %s may read',
        async (name) => {
          const rows = await database.getGalleryMediaIndex({
            actorId: ownerId,
            audience: audiences[name],
            limit: 50
          })

          expect(namesOf(rows.map((row) => row.id))).toEqual(visibleTo[name])
        }
      )

      it('carries the subject fields and times', async () => {
        const rows = await database.getGalleryMediaIndex({
          actorId: ownerId,
          audience: OWNER_GALLERY_AUDIENCE,
          limit: 50
        })
        const row = rows.find((item) => item.id === ids.public)

        expect(row).toEqual({
          id: ids.public,
          subjectName: 'Common Kingfisher',
          subjectScientificName: 'Alcedo atthis',
          subjectCategory: 'bird',
          subjectTaxonKey: '2475532',
          subjectTaxonPath: ['Animalia', 'Chordata', 'Aves'],
          subjectIucnCategory: 'LC',
          subjectLookupStatus: 'resolved',
          placeName: 'River',
          placePrecision: 'exact',
          placeLatitude: 51.5543,
          placeLongitude: -0.0231,
          placeCountryCode: 'GB',
          // Typed with the details, so the owner's.
          placeNameSource: 'owner',
          takenAt: Date.UTC(2024, 0, 1),
          createdAt: expect.any(Number)
        })
        expect(row!.createdAt).toBeGreaterThan(0)
      })

      it('reads only media older than maxId and nothing for a bad id', async () => {
        const all = await database.getGalleryMediaIndex({
          actorId: ownerId,
          audience: OWNER_GALLERY_AUDIENCE,
          limit: 50
        })
        const older = await database.getGalleryMediaIndex({
          actorId: ownerId,
          audience: OWNER_GALLERY_AUDIENCE,
          limit: 50,
          maxId: all[1].id
        })
        const bad = await database.getGalleryMediaIndex({
          actorId: ownerId,
          audience: OWNER_GALLERY_AUDIENCE,
          limit: 50,
          maxId: 'nope'
        })

        expect(older.map((row) => row.id)).toEqual(
          all.slice(2).map((row) => row.id)
        )
        expect(bad).toEqual([])
      })

      it('honours the limit', async () => {
        const rows = await database.getGalleryMediaIndex({
          actorId: ownerId,
          audience: OWNER_GALLERY_AUDIENCE,
          limit: 2
        })

        expect(namesOf(rows.map((row) => row.id))).toEqual(['both', 'direct'])
      })
    })

    describe('getGalleryMapRows', () => {
      it.each([
        ['owner', ['direct', 'followers', 'unlisted', 'public']],
        ['logged out', ['public']],
        ['viewer with no flags', ['public']],
        ['stranger', ['public']],
        ['follower', ['followers', 'public']],
        // `direct` has only a country: never a public point.
        ['mentioned actor', ['public']]
      ])('reads the points the %s could be shown', async (name, expected) => {
        const rows = await database.getGalleryMapRows({
          actorId: ownerId,
          audience: audiences[name],
          limit: 50
        })

        expect(namesOf(rows.map((row) => row.id))).toEqual(expected)
      })

      it('returns the stored point with the post it is shown through', async () => {
        const rows = await database.getGalleryMapRows({
          actorId: ownerId,
          audience: PUBLIC_GALLERY_AUDIENCE,
          limit: 50
        })

        expect(rows).toHaveLength(1)
        expect(rows).toMatchObject([
          {
            id: ids.public,
            latitude: 51.5543,
            longitude: -0.0231,
            placePrecision: 'exact',
            placeName: 'River',
            placeCountryCode: 'GB',
            subjectName: 'Common Kingfisher',
            subjectScientificName: 'Alcedo atthis',
            subjectCategory: 'bird',
            subjectTaxonKey: '2475532',
            subjectIucnCategory: 'LC',
            subjectLookupStatus: 'resolved',
            takenAt: Date.UTC(2024, 0, 1),
            thumbnailUrl: expect.stringContaining(`/${ids.public}.jpg`),
            statusId: status('public')
          }
        ])
      })
    })

    describe('getGalleryGearUsageRows', () => {
      it('lists every posted media using the gear, in the gallery or not', async () => {
        const rows = await database.getGalleryGearUsageRows({
          actorId: ownerId,
          gearIds: [gearA, gearB]
        })
        const summary = rows
          .map((row) => ({
            gear: row.gearId === gearA ? 'A' : 'B',
            media: namesOf([row.mediaId])[0],
            inGallery: row.inGallery
          }))
          .sort((a, b) =>
            `${a.gear}${a.media}`.localeCompare(`${b.gear}${b.media}`)
          )

        expect(summary).toEqual([
          { gear: 'A', media: 'followers', inGallery: true },
          { gear: 'A', media: 'not-in-gallery', inGallery: false },
          { gear: 'A', media: 'public', inGallery: true },
          { gear: 'B', media: 'both', inGallery: true }
        ])
        const notInGallery = rows.find(
          (row) => row.mediaId === ids['not-in-gallery']
        )
        expect(notInGallery?.takenAt).toBe(Date.UTC(2020, 5, 1))
        expect(notInGallery?.createdAt).toBeGreaterThan(0)
        const publicRow = rows.find((row) => row.mediaId === ids.public)
        expect(publicRow).toMatchObject({
          originalMimeType: 'image/jpeg',
          placeCountryCode: 'GB'
        })
        expect(notInGallery?.placeCountryCode).toBeNull()
      })

      it('lists nothing for another actor or no gear', async () => {
        expect(
          await database.getGalleryGearUsageRows({
            actorId: otherActorId,
            gearIds: [gearA]
          })
        ).toEqual([])
        expect(
          await database.getGalleryGearUsageRows({
            actorId: ownerId,
            gearIds: []
          })
        ).toEqual([])
      })
    })

    describe('a photo edited for the gallery only', () => {
      // Another actor than the fixture owner, so the rows above keep their
      // counts.
      const editorId = actors.primary.id
      const fileUrl = (path: string) => `https://llun.test/api/v1/files/${path}`

      it('shows the live file in the gallery while the post keeps its own', async () => {
        const accountId = (await database.getActorFromId({ id: editorId }))!
          .account!.id
        const media = (await database.createMedia({
          actorId: editorId,
          original: {
            path: 'medias/gallery-edit-uploaded.jpg',
            bytes: 1000,
            mimeType: 'image/jpeg',
            metaData: { width: 400, height: 300 }
          },
          blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
          details: {
            inGallery: true,
            placeLatitude: 51.5,
            placeLongitude: -0.1,
            placePrecision: 'exact'
          }
        }))!
        const statusId = `${editorId}/statuses/gallery-edit`
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: editorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Edited photo'
        })
        await database.createAttachment({
          actorId: editorId,
          statusId,
          mediaType: 'image/jpeg',
          url: fileUrl(media.original.path),
          width: 400,
          height: 300,
          mediaId: media.id,
          blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj'
        })
        await database.applyMediaEdit({
          mediaId: media.id,
          accountId,
          baseVersion: 0,
          saveId: 'gallery-only',
          recipe: '{"v":1}',
          render: {
            path: 'medias/gallery-edit-render.webp',
            bytes: 100,
            mimeType: 'image/webp',
            width: 300,
            height: 300,
            blurhash: 'L00000fQfQfQfQfQfQfQfQfQfQfQ',
            focus: { x: 0.5, y: 0 }
          }
        })

        const [row] = await database.getGalleryMediaByIds({
          actorId: editorId,
          audience: PUBLIC_GALLERY_AUDIENCE,
          mediaIds: [media.id]
        })
        expect(row.statusId).toBe(statusId)
        expect(row.attachment).toMatchObject({
          url: fileUrl('medias/gallery-edit-render.webp'),
          width: 300,
          height: 300,
          blurhash: 'L00000fQfQfQfQfQfQfQfQfQfQfQ',
          focus: { x: 0.5, y: 0 }
        })

        const [point] = await database.getGalleryMapRows({
          actorId: editorId,
          audience: PUBLIC_GALLERY_AUDIENCE,
          limit: 10
        })
        expect(point.thumbnailUrl).toBe(
          fileUrl('medias/gallery-edit-render.webp')
        )

        // The post still shows the file it was published with.
        const [attachment] = await database.getAttachments({ statusId })
        expect(attachment.url).toBe(fileUrl('medias/gallery-edit-uploaded.jpg'))
      })
    })

    // Compile-time pin: the audience is required on every scoped method.
    it('requires an audience on every scoped method', () => {
      type ScopedParams = Parameters<
        GalleryMediaDatabase[
          | 'getActorHasGalleryMedia'
          | 'getGalleryMedia'
          | 'getGalleryMediaByIds'
          | 'getGalleryMediaIndex'
          | 'getGalleryMapRows']
      >[0]
      const audienceIsRequired: ScopedParams extends {
        audience: GalleryAudience
      }
        ? true
        : false = true
      expect(audienceIsRequired).toBeTrue()
    })
  })
})
