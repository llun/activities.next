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
          expect(both?.attachment?.statusId).toBe(status(expected))
          expect(both?.attachment?.mediaId).toBe(ids.both)
        }
      )

      it('carries the status publicId for client ids', async () => {
        const [row] = await database.getGalleryMedia({
          actorId: ownerId,
          audience: OWNER_GALLERY_AUDIENCE,
          limit: 1
        })
        const stored = await database.getStatus({
          statusId: row.statusId!,
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
            expect(row.attachment?.mediaId).toBe(row.media.id)
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

    // The owner's All media list widens the scope to posted media outside the
    // gallery. Nobody else may: for them `show` is read as `in_gallery`.
    describe('show', () => {
      const ownerShows: Record<string, string[]> = {
        all: [
          'both',
          'not-in-gallery',
          'direct',
          'followers',
          'unlisted',
          'public'
        ],
        in_gallery: visibleTo.owner,
        hidden: ['not-in-gallery']
      }
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

      describe.each(Object.entries(ownerShows))(
        'for the owner, %s',
        (show, expected) => {
          const showParam = show as 'all' | 'in_gallery' | 'hidden'

          it('lists the media', async () => {
            const rows = await database.getGalleryMedia({
              actorId: ownerId,
              audience: OWNER_GALLERY_AUDIENCE,
              limit: 50,
              show: showParam
            })
            expect(namesOf(rows.map((row) => row.media.id))).toEqual(expected)
          })

          it('reads the same media back by id', async () => {
            const rows = await database.getGalleryMediaByIds({
              actorId: ownerId,
              audience: OWNER_GALLERY_AUDIENCE,
              mediaIds: everyName.map((name) => ids[name]),
              show: showParam
            })
            expect(namesOf(rows.map((row) => row.media.id))).toEqual(expected)
          })

          it('indexes the same media', async () => {
            const rows = await database.getGalleryMediaIndex({
              actorId: ownerId,
              audience: OWNER_GALLERY_AUDIENCE,
              limit: 50,
              show: showParam
            })
            expect(namesOf(rows.map((row) => row.id))).toEqual(expected)
          })
        }
      )

      it('never lists unposted media, whatever the owner asks for', async () => {
        const rows = await database.getGalleryMedia({
          actorId: ownerId,
          audience: OWNER_GALLERY_AUDIENCE,
          limit: 50,
          show: 'all'
        })
        expect(namesOf(rows.map((row) => row.media.id))).not.toContain(
          'unposted'
        )
      })

      it('marks media in the gallery or not on the row', async () => {
        const rows = await database.getGalleryMedia({
          actorId: ownerId,
          audience: OWNER_GALLERY_AUDIENCE,
          limit: 50,
          show: 'all'
        })
        const inGallery = Object.fromEntries(
          rows.map((row) => [row.media.id, row.media.details?.inGallery])
        )
        expect(inGallery[ids['not-in-gallery']]).toBe(false)
        expect(inGallery[ids.public]).toBe(true)
      })

      describe.each(
        audienceNames.filter((name) => name !== 'owner').map((name) => [name])
      )('for the %s', (name) => {
        it.each(['all', 'hidden', 'in_gallery'] as const)(
          'ignores show=%s and keeps the gallery',
          async (show) => {
            const audience = audiences[name]
            const media = await database.getGalleryMedia({
              actorId: ownerId,
              audience,
              limit: 50,
              show
            })
            const byIds = await database.getGalleryMediaByIds({
              actorId: ownerId,
              audience,
              mediaIds: everyName.map((media) => ids[media]),
              show
            })
            const index = await database.getGalleryMediaIndex({
              actorId: ownerId,
              audience,
              limit: 50,
              show
            })

            expect(namesOf(media.map((row) => row.media.id))).toEqual(
              visibleTo[name]
            )
            expect(namesOf(byIds.map((row) => row.media.id))).toEqual(
              visibleTo[name]
            )
            expect(namesOf(index.map((row) => row.id))).toEqual(visibleTo[name])
          }
        )
      })
    })

    // Media the owner keeps in Gallery without a post (`galleryAddedAt`). Only
    // the owner reads it, and only when it has no post to be shown through.
    describe('Gallery additions', () => {
      const adder = actors.primary.id
      const adderFollowers = `${adder}/followers`
      let adderCamera = ''
      const adderAudiences: Record<string, GalleryAudience> = {
        'logged out': PUBLIC_GALLERY_AUDIENCE,
        follower: {
          kind: 'viewer',
          publicOnly: false,
          visibleToActorId: strangerId,
          includeFollowersOnly: true,
          followersAudience: adderFollowers
        }
      }
      const names = (mediaIds: string[]) => namesOf(mediaIds)

      beforeAll(async () => {
        adderCamera = (
          await database.createGalleryGear({
            actorId: adder,
            kind: 'camera',
            name: 'Adder Camera'
          })
        ).id
        const publicStatus = await note(
          'add-public',
          [ACTIVITY_STREAM_PUBLIC],
          [],
          adder
        )
        // Created oldest first.
        await createMedia('add-posted', {}, adder)
        await createMedia('add-posted-hidden', { inGallery: false }, adder)
        await createMedia('add-plain-upload', {}, adder)
        await createMedia(
          'add-added',
          {
            subjectName: 'Added Fox',
            cameraGearId: adderCamera,
            placeLatitude: 5,
            placeLongitude: 6,
            placePrecision: 'exact'
          },
          adder
        )
        await createMedia('add-added-hidden', {}, adder)
        await createMedia('add-added-posted', {}, adder)
        await createMedia('add-foreign', {}, otherActorId)
        await attach(publicStatus, ids['add-posted'], { actorId: adder })
        await attach(publicStatus, ids['add-posted-hidden'], { actorId: adder })
        const added = await database.addMediaToGallery({
          actorId: adder,
          mediaIds: [
            ids['add-added'],
            ids['add-added-hidden'],
            ids['add-added-posted'],
            // Not the adder's, and an id that is no media at all.
            ids['add-foreign'],
            'abc'
          ]
        })
        expect(names(added)).toEqual([
          'add-added-posted',
          'add-added-hidden',
          'add-added'
        ])
        // Posted afterwards: from then on it is shown through its post.
        await attach(publicStatus, ids['add-added-posted'], { actorId: adder })
        const adderAccount = (await database.getActorFromId({ id: adder }))!
          .account!.id
        await database.updateMedia({
          mediaId: ids['add-added-hidden'],
          accountId: adderAccount,
          details: { inGallery: false }
        })
      })

      const ownerShows = {
        all: [
          'add-added-posted',
          'add-added-hidden',
          'add-added',
          'add-posted-hidden',
          'add-posted'
        ],
        in_gallery: ['add-added-posted', 'add-added', 'add-posted'],
        hidden: ['add-added-hidden', 'add-posted-hidden'],
        not_posted: ['add-added-hidden', 'add-added']
      } as const
      const everyName = [
        'add-posted',
        'add-posted-hidden',
        'add-plain-upload',
        'add-added',
        'add-added-hidden',
        'add-added-posted',
        'add-foreign'
      ]

      describe.each(Object.entries(ownerShows))(
        'for the owner, show=%s',
        (show, expected) => {
          const showParam = show as keyof typeof ownerShows

          it('lists the media', async () => {
            const rows = await database.getGalleryMedia({
              actorId: adder,
              audience: OWNER_GALLERY_AUDIENCE,
              limit: 50,
              show: showParam
            })
            expect(names(rows.map((row) => row.media.id))).toEqual(expected)
          })

          it('reads the same media back by id', async () => {
            const rows = await database.getGalleryMediaByIds({
              actorId: adder,
              audience: OWNER_GALLERY_AUDIENCE,
              mediaIds: everyName.map((name) => ids[name]),
              show: showParam
            })
            expect(names(rows.map((row) => row.media.id))).toEqual(expected)
          })

          it('indexes the same media', async () => {
            const rows = await database.getGalleryMediaIndex({
              actorId: adder,
              audience: OWNER_GALLERY_AUDIENCE,
              limit: 50,
              show: showParam
            })
            expect(names(rows.map((row) => row.id))).toEqual(expected)
          })
        }
      )

      it('shows an addition without a post and a posted one through its post', async () => {
        const rows = await database.getGalleryMedia({
          actorId: adder,
          audience: OWNER_GALLERY_AUDIENCE,
          limit: 50,
          show: 'all'
        })
        const byName = Object.fromEntries(
          rows.map((row) => [names([row.media.id])[0], row])
        )
        expect(byName['add-added']).toMatchObject({
          attachment: null,
          statusId: null,
          statusPublicId: null
        })
        expect(byName['add-added'].media.details?.inGallery).toBe(true)
        expect(byName['add-added-hidden'].attachment).toBeNull()
        expect(byName['add-added-posted'].statusId).toBe(
          status('add-public', adder)
        )
        expect(byName['add-added-posted'].attachment?.mediaId).toBe(
          ids['add-added-posted']
        )
      })

      it('counts an addition as gallery media for the owner only', async () => {
        const actorId = actors.extra.id
        const mediaId = await createMedia('add-only', {}, actorId)
        const before = await database.getActorHasGalleryMedia({
          actorId,
          audience: OWNER_GALLERY_AUDIENCE
        })
        await database.addMediaToGallery({ actorId, mediaIds: [mediaId] })

        expect(before).toBeFalse()
        expect(
          await database.getActorHasGalleryMedia({
            actorId,
            audience: OWNER_GALLERY_AUDIENCE
          })
        ).toBeTrue()
        expect(
          await database.getActorHasGalleryMedia({
            actorId,
            audience: PUBLIC_GALLERY_AUDIENCE
          })
        ).toBeFalse()
      })

      it.each(['logged out', 'follower'])(
        'shows the %s only the posted media, whatever show asks for',
        async (name) => {
          const expectedPosted = ['add-added-posted', 'add-posted']
          for (const show of [
            undefined,
            'all',
            'hidden',
            'not_posted',
            'in_gallery'
          ] as const) {
            const audience = adderAudiences[name]
            const rows = await database.getGalleryMedia({
              actorId: adder,
              audience,
              limit: 50,
              show
            })
            const byIds = await database.getGalleryMediaByIds({
              actorId: adder,
              audience,
              mediaIds: everyName.map((media) => ids[media]),
              show
            })
            const index = await database.getGalleryMediaIndex({
              actorId: adder,
              audience,
              limit: 50,
              show
            })
            expect(names(rows.map((row) => row.media.id))).toEqual(
              expectedPosted
            )
            expect(names(byIds.map((row) => row.media.id))).toEqual(
              expectedPosted
            )
            expect(names(index.map((row) => row.id))).toEqual(expectedPosted)
            for (const row of rows) expect(row.attachment).not.toBeNull()
          }
        }
      )

      it('puts an addition with a place on the owner map and not on the public one', async () => {
        const owner = await database.getGalleryMapRows({
          actorId: adder,
          audience: OWNER_GALLERY_AUDIENCE,
          limit: 50
        })
        const publicRows = await database.getGalleryMapRows({
          actorId: adder,
          audience: PUBLIC_GALLERY_AUDIENCE,
          limit: 50
        })

        expect(names(owner.map((row) => row.id))).toEqual(['add-added'])
        expect(owner[0]).toMatchObject({
          statusId: null,
          statusPublicId: null,
          thumbnailUrl: null,
          file: { path: '/test/gallery-add-added.jpg', mimeType: 'image/jpeg' }
        })
        expect(publicRows).toEqual([])
      })

      it('counts an addition in the gear usage of its gear', async () => {
        const rows = await database.getGalleryGearUsageRows({
          actorId: adder,
          gearIds: [adderCamera]
        })
        expect(names(rows.map((row) => row.mediaId))).toEqual(['add-added'])
      })

      it('never reads another actor media through the adder', async () => {
        expect(
          await database.getGalleryMediaByIds({
            actorId: otherActorId,
            audience: OWNER_GALLERY_AUDIENCE,
            mediaIds: everyName.map((media) => ids[media]),
            show: 'all'
          })
        ).toEqual([])
      })

      describe('getUnattachedMedia', () => {
        it('returns the actor own media no status uses, newest first', async () => {
          const unattached = await createMedia('add-un-1', {}, adder)
          const alsoUnattached = await createMedia('add-un-2', {}, adder)
          const posted = await createMedia('add-un-posted', {}, adder)
          const statusId = await note(
            'add-un-posted',
            [ACTIVITY_STREAM_PUBLIC],
            [],
            adder
          )
          await attach(statusId, posted, { actorId: adder })

          const medias = await database.getUnattachedMedia({
            actorId: adder,
            mediaIds: [
              unattached,
              posted,
              alsoUnattached,
              ids['add-foreign'],
              'abc',
              unattached
            ]
          })

          expect(names(medias.map((media) => media.id))).toEqual([
            'add-un-2',
            'add-un-1'
          ])
        })

        it('reads nothing for no ids', async () => {
          expect(
            await database.getUnattachedMedia({ actorId: adder, mediaIds: [] })
          ).toEqual([])
        })
      })

      describe('addMediaToGallery', () => {
        it('adds only the actor own media that no status uses', async () => {
          const own = await createMedia('add-own', {}, adder)
          const posted = await createMedia('add-own-posted', {}, adder)
          const statusId = await note(
            'add-own-posted',
            [ACTIVITY_STREAM_PUBLIC],
            [],
            adder
          )
          await attach(statusId, posted, { actorId: adder })
          const foreign = ids['add-foreign']

          const added = await database.addMediaToGallery({
            actorId: adder,
            mediaIds: [own, posted, foreign, own, '0', '2147483648']
          })

          expect(names(added)).toEqual(['add-own'])
          // The attached media was left as it was, and the foreign media is
          // still invisible to the adder.
          const rows = await database.getGalleryMediaByIds({
            actorId: adder,
            audience: OWNER_GALLERY_AUDIENCE,
            mediaIds: [own, posted, foreign],
            show: 'not_posted'
          })
          expect(names(rows.map((row) => row.media.id))).toEqual(['add-own'])
        })

        it('turns the gallery switch on', async () => {
          const mediaId = await createMedia(
            'add-off',
            { inGallery: false },
            adder
          )
          await database.addMediaToGallery({
            actorId: adder,
            mediaIds: [mediaId]
          })

          const [row] = await database.getGalleryMediaByIds({
            actorId: adder,
            audience: OWNER_GALLERY_AUDIENCE,
            mediaIds: [mediaId]
          })
          expect(row.media.details?.inGallery).toBe(true)
        })

        it('is idempotent', async () => {
          const mediaId = await createMedia('add-twice', {}, adder)
          const first = await database.addMediaToGallery({
            actorId: adder,
            mediaIds: [mediaId]
          })
          const second = await database.addMediaToGallery({
            actorId: adder,
            mediaIds: [mediaId]
          })
          const rows = await database.getGalleryMedia({
            actorId: adder,
            audience: OWNER_GALLERY_AUDIENCE,
            limit: 50,
            show: 'not_posted'
          })

          expect(first).toEqual([mediaId])
          expect(second).toEqual([mediaId])
          expect(rows.filter((row) => row.media.id === mediaId)).toHaveLength(1)
        })

        it('reads nothing for no ids', async () => {
          expect(
            await database.addMediaToGallery({ actorId: adder, mediaIds: [] })
          ).toEqual([])
        })

        it('adds more media than one chunk holds', async () => {
          const many = []
          for (const name of [
            'add-c1',
            'add-c2',
            'add-c3',
            'add-c4',
            'add-c5'
          ]) {
            many.push(await createMedia(name, {}, adder))
          }
          const added = await database.addMediaToGallery({
            actorId: adder,
            mediaIds: many
          })
          expect(added).toEqual([...many].reverse())
        })
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
