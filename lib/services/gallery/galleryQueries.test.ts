import type {
  GalleryIndexRow,
  GalleryMapRow
} from '@/lib/database/sql/galleryMedia'
import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import {
  GalleryAudience,
  OWNER_GALLERY_AUDIENCE,
  PUBLIC_GALLERY_AUDIENCE
} from '@/lib/services/gallery/galleryAudience'
import {
  GALLERY_INDEX_CAP,
  MAX_INDEX_WINDOWS,
  getGalleryLifeList,
  getGalleryMapPoints,
  getGalleryMediaPage,
  getGallerySubjects
} from '@/lib/services/gallery/galleryQueries'
import { seedDatabase } from '@/lib/stub/database'
import { DatabaseSeed } from '@/lib/stub/scenarios/database'
import {
  DEFAULT_GALLERY_SETTINGS,
  MediaDetailsRecord
} from '@/lib/types/database/gallery'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

describe('gallery queries', () => {
  const { actors } = DatabaseSeed
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  describe.each(table)('%s', (_, database) => {
    const owner = { id: actors.empty.id }
    const followersUrl = `${owner.id}/followers`
    const follower: GalleryAudience = {
      kind: 'viewer',
      publicOnly: false,
      visibleToActorId: actors.extra.id,
      includeFollowersOnly: true,
      followersAudience: followersUrl
    }
    const ids: Record<string, string> = {}

    const createPostedMedia = async (
      name: string,
      statusId: string,
      details: Partial<MediaDetailsRecord>
    ) => {
      const media = await database.createMedia({
        actorId: owner.id,
        original: {
          path: `/test/queries-${name}.jpg`,
          bytes: 1000,
          mimeType: 'image/jpeg',
          metaData: { width: 100, height: 100 }
        },
        details: { inGallery: true, ...details }
      })
      ids[name] = media!.id
      await database.createAttachment({
        actorId: owner.id,
        statusId,
        mediaType: 'image/jpeg',
        url: `https://media.test/${name}.jpg`,
        width: 100,
        height: 100,
        mediaId: media!.id
      })
    }

    beforeAll(async () => {
      await seedDatabase(database)

      const publicStatus = `${owner.id}/statuses/queries-public`
      const followersStatus = `${owner.id}/statuses/queries-followers`
      await database.createNote({
        id: publicStatus,
        url: publicStatus,
        actorId: owner.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        text: 'public'
      })
      await database.createNote({
        id: followersStatus,
        url: followersStatus,
        actorId: owner.id,
        to: [followersUrl],
        cc: [],
        text: 'followers'
      })

      // Oldest first, so ids ascend in this order.
      await createPostedMedia('kingfisher-1', publicStatus, {
        subjectName: 'Kingfisher',
        subjectScientificName: 'Alcedo atthis',
        subjectCategory: 'bird',
        takenAt: Date.UTC(2024, 2, 1),
        placeName: 'River',
        placeLatitude: 51.5543,
        placeLongitude: -0.0231,
        placePrecision: 'area'
      })
      await createPostedMedia('fox', publicStatus, {
        subjectName: 'Red Fox',
        subjectCategory: 'mammal',
        takenAt: Date.UTC(2023, 5, 1),
        placeLatitude: 40.7,
        placeLongitude: -74,
        placePrecision: 'exact'
      })
      await createPostedMedia('lakes', publicStatus, {
        subjectName: 'Lakes',
        subjectCategory: 'landscape',
        takenAt: Date.UTC(2022, 0, 1)
      })
      await createPostedMedia('unidentified', publicStatus, {})
      await createPostedMedia('mystery', publicStatus, {
        subjectName: 'Mystery'
      })
      await createPostedMedia('heron', followersStatus, {
        subjectName: 'Grey Heron',
        subjectScientificName: 'Ardea cinerea',
        subjectCategory: 'bird',
        takenAt: Date.UTC(2024, 4, 1),
        placeLatitude: 20,
        placeLongitude: 20,
        placePrecision: 'exact'
      })
      // Spelled differently, the same species by its scientific name.
      await createPostedMedia('kingfisher-2', publicStatus, {
        subjectName: 'Common Kingfisher',
        subjectScientificName: '  alcedo   ATTHIS ',
        subjectCategory: 'bird',
        takenAt: Date.UTC(2024, 0, 1)
      })
      // Posted, but with Show in my gallery switched off: only the owner's
      // All media list can reach it.
      await createPostedMedia('hidden-bird', publicStatus, {
        inGallery: false,
        subjectName: 'Hidden Bird',
        subjectCategory: 'bird'
      })

      // What the subject job would write: every species above is Least
      // Concern, so the threatened-species rule (on by default) lets their
      // places through and the place tests below see only the other rules.
      for (const name of ['kingfisher-1', 'kingfisher-2', 'fox', 'heron']) {
        const media = await database.getMediaByIdForAccount({
          mediaId: ids[name],
          accountId: (await database.getActorFromId({ id: owner.id }))!.account!
            .id
        })
        await database.setMediaSubjectLookup({
          mediaId: ids[name],
          expect: {
            subjectName: media!.details!.subjectName,
            subjectScientificName: media!.details!.subjectScientificName,
            subjectTaxonKey: media!.details!.subjectTaxonKey
          },
          patch: { subjectLookupStatus: 'resolved', subjectIucnCategory: 'LC' }
        })
      }

      await database.updateGallerySettings({
        actorId: owner.id,
        showGear: false,
        // Around the fox's exact point.
        hiddenLocations: [
          { latitude: 40.7, longitude: -74, hideRadiusMeters: 100 }
        ]
      })
    })

    afterAll(async () => {
      await database.destroy()
    })

    describe('getGallerySubjects', () => {
      it('groups by subject key and category for the owner', async () => {
        const result = await getGallerySubjects({
          database,
          owner,
          audience: OWNER_GALLERY_AUDIENCE
        })

        expect(
          result.groups.map((group) => ({
            category: group.category,
            subjects: group.subjects.map((subject) => [
              subject.key,
              subject.count
            ])
          }))
        ).toEqual([
          {
            category: 'bird',
            subjects: [
              ['sci:alcedo atthis', 2],
              ['sci:ardea cinerea', 1]
            ]
          },
          { category: 'mammal', subjects: [['name:red fox', 1]] },
          { category: 'landscape', subjects: [['name:lakes', 1]] },
          { category: 'unidentified', subjects: [['name:mystery', 1]] }
        ])
        expect(result.unidentifiedCount).toBe(1)
        expect(result.truncated).toBeFalse()
      })

      it('names a subject after its newest photo and spans its seen dates', async () => {
        const result = await getGallerySubjects({
          database,
          owner,
          audience: OWNER_GALLERY_AUDIENCE
        })
        const kingfisher = result.groups[0].subjects[0]

        expect(kingfisher).toMatchObject({
          name: 'Common Kingfisher',
          scientificName: '  alcedo   ATTHIS ',
          category: 'bird',
          firstSeenAt: '2024-01-01T00:00:00.000Z',
          lastSeenAt: '2024-03-01T00:00:00.000Z'
        })
        expect(kingfisher.cover.mediaId).toBe(ids['kingfisher-2'])
      })

      it('builds subjects for a logged-out viewer from public posts only', async () => {
        const result = await getGallerySubjects({
          database,
          owner,
          audience: PUBLIC_GALLERY_AUDIENCE
        })
        const keys = result.groups.flatMap((group) =>
          group.subjects.map((subject) => subject.key)
        )

        expect(keys).not.toContain('sci:ardea cinerea')
        expect(keys).toContain('sci:alcedo atthis')
        // Gear and exact places are not the public's.
        const cover = result.groups[0].subjects[0].cover
        expect(cover.camera).toBeNull()
        expect(cover.exposure).toBeNull()
      })
    })

    describe('getGalleryLifeList', () => {
      it('lists species oldest first and leaves landscapes out', async () => {
        const result = await getGalleryLifeList({
          database,
          owner,
          audience: OWNER_GALLERY_AUDIENCE
        })

        expect(result.entries.map((entry) => entry.key)).toEqual([
          'name:red fox',
          'sci:alcedo atthis',
          'sci:ardea cinerea',
          // No capture date: seen at upload, which is now.
          'name:mystery'
        ])
        expect(result.total).toBe(4)
        expect(result.byCategory).toEqual({ bird: 2, mammal: 1 })
        expect(result.entries[1].coverMediaId).toBe(ids['kingfisher-2'])
        expect(result.entries[1]).not.toHaveProperty('cover')
        expect(result.truncated).toBeFalse()
      })

      it('scopes the life list to what the viewer may read', async () => {
        const [publicList, followerList] = await Promise.all([
          getGalleryLifeList({
            database,
            owner,
            audience: PUBLIC_GALLERY_AUDIENCE
          }),
          getGalleryLifeList({ database, owner, audience: follower })
        ])

        expect(publicList.total).toBe(3)
        expect(publicList.byCategory).toEqual({ bird: 1, mammal: 1 })
        expect(followerList.total).toBe(4)
      })
    })

    describe('getGalleryMediaPage', () => {
      it('pages a subject filter by nextMaxId', async () => {
        const first = await getGalleryMediaPage({
          database,
          owner,
          audience: OWNER_GALLERY_AUDIENCE,
          limit: 1,
          subjectKey: 'sci:alcedo atthis'
        })
        const second = await getGalleryMediaPage({
          database,
          owner,
          audience: OWNER_GALLERY_AUDIENCE,
          limit: 1,
          subjectKey: 'sci:alcedo atthis',
          maxId: first.nextMaxId!
        })

        expect(first.items.map((item) => item.mediaId)).toEqual([
          ids['kingfisher-2']
        ])
        expect(first.nextMaxId).toBe(ids['kingfisher-2'])
        expect(second.items.map((item) => item.mediaId)).toEqual([
          ids['kingfisher-1']
        ])
        expect(second.nextMaxId).toBeNull()
      })

      it('filters by category within the viewer scope', async () => {
        const result = await getGalleryMediaPage({
          database,
          owner,
          audience: PUBLIC_GALLERY_AUDIENCE,
          limit: 30,
          category: 'bird'
        })

        expect(result.items.map((item) => item.mediaId)).toEqual([
          ids['kingfisher-2'],
          ids['kingfisher-1']
        ])
      })

      it('pages the recent grid newest first', async () => {
        const first = await getGalleryMediaPage({
          database,
          owner,
          audience: PUBLIC_GALLERY_AUDIENCE,
          limit: 4
        })
        const second = await getGalleryMediaPage({
          database,
          owner,
          audience: PUBLIC_GALLERY_AUDIENCE,
          limit: 4,
          maxId: first.nextMaxId!
        })

        expect(first.items).toHaveLength(4)
        expect(first.nextMaxId).toBe(first.items[3].mediaId)
        expect(first.items.map((item) => item.mediaId)).toEqual([
          ids['kingfisher-2'],
          ids.mystery,
          ids.unidentified,
          ids.lakes
        ])
        expect(second.items.map((item) => item.mediaId)).toEqual([
          ids.fox,
          ids['kingfisher-1']
        ])
        expect(second.nextMaxId).toBeNull()
      })

      it('withholds a place inside a hidden location from the public only', async () => {
        const [publicPage, ownerPage] = await Promise.all([
          getGalleryMediaPage({
            database,
            owner,
            audience: PUBLIC_GALLERY_AUDIENCE,
            limit: 30
          }),
          getGalleryMediaPage({
            database,
            owner,
            audience: OWNER_GALLERY_AUDIENCE,
            limit: 30
          })
        ])

        expect(
          publicPage.items.find((item) => item.mediaId === ids.fox)?.place
        ).toBeNull()
        expect(
          ownerPage.items.find((item) => item.mediaId === ids.fox)?.place
        ).toEqual({
          name: null,
          precision: 'exact',
          latitude: 40.7,
          longitude: -74,
          countryCode: null
        })
      })

      describe('show', () => {
        const idsOf = (page: { items: { mediaId: string }[] }) =>
          page.items.map((item) => item.mediaId)

        it.each([
          { show: 'all' as const, first: 'hidden-bird', count: 8 },
          { show: 'in_gallery' as const, first: 'kingfisher-2', count: 7 },
          { show: 'hidden' as const, first: 'hidden-bird', count: 1 }
        ])('gives the owner the $show list', async ({ show, first, count }) => {
          const page = await getGalleryMediaPage({
            database,
            owner,
            audience: OWNER_GALLERY_AUDIENCE,
            limit: 30,
            show
          })

          expect(page.items).toHaveLength(count)
          expect(page.items[0].mediaId).toBe(ids[first])
        })

        it('defaults to the gallery', async () => {
          const page = await getGalleryMediaPage({
            database,
            owner,
            audience: OWNER_GALLERY_AUDIENCE,
            limit: 30
          })

          expect(idsOf(page)).not.toContain(ids['hidden-bird'])
        })

        it('tells the owner which tiles are in the gallery, and nobody else', async () => {
          const ownerPage = await getGalleryMediaPage({
            database,
            owner,
            audience: OWNER_GALLERY_AUDIENCE,
            limit: 30,
            show: 'all'
          })
          const publicPage = await getGalleryMediaPage({
            database,
            owner,
            audience: PUBLIC_GALLERY_AUDIENCE,
            limit: 30
          })

          const hidden = ownerPage.items.find(
            (item) => item.mediaId === ids['hidden-bird']
          )
          expect(hidden?.inGallery).toBe(false)
          expect(
            ownerPage.items.find((item) => item.mediaId === ids.fox)?.inGallery
          ).toBe(true)
          for (const item of publicPage.items) {
            expect(item).not.toHaveProperty('inGallery')
          }
        })

        it('applies to a category filter, which reads the index', async () => {
          const all = await getGalleryMediaPage({
            database,
            owner,
            audience: OWNER_GALLERY_AUDIENCE,
            limit: 30,
            category: 'bird',
            show: 'all'
          })
          const hidden = await getGalleryMediaPage({
            database,
            owner,
            audience: OWNER_GALLERY_AUDIENCE,
            limit: 30,
            category: 'bird',
            show: 'hidden'
          })
          const inGallery = await getGalleryMediaPage({
            database,
            owner,
            audience: OWNER_GALLERY_AUDIENCE,
            limit: 30,
            category: 'bird'
          })

          expect(idsOf(all)).toEqual([
            ids['hidden-bird'],
            ids['kingfisher-2'],
            ids.heron,
            ids['kingfisher-1']
          ])
          expect(idsOf(hidden)).toEqual([ids['hidden-bird']])
          expect(idsOf(inGallery)).toEqual([
            ids['kingfisher-2'],
            ids.heron,
            ids['kingfisher-1']
          ])
        })

        it.each([
          { description: 'logged out', audience: PUBLIC_GALLERY_AUDIENCE },
          { description: 'a follower', audience: follower }
        ])('is ignored for $description', async ({ audience }) => {
          const baseline = await getGalleryMediaPage({
            database,
            owner,
            audience,
            limit: 30
          })
          for (const show of ['all', 'hidden', 'in_gallery'] as const) {
            const page = await getGalleryMediaPage({
              database,
              owner,
              audience,
              limit: 30,
              show
            })
            expect(page).toEqual(baseline)
            expect(idsOf(page)).not.toContain(ids['hidden-bird'])
          }
        })
      })

      it('answers a non-owner gear filter with an empty page', async () => {
        expect(
          await getGalleryMediaPage({
            database,
            owner,
            audience: follower,
            limit: 30,
            gearId: 'anything'
          })
        ).toEqual({ items: [], nextMaxId: null })
      })

      it('answers an invalid maxId on a filtered page with an empty page', async () => {
        expect(
          await getGalleryMediaPage({
            database,
            owner,
            audience: OWNER_GALLERY_AUDIENCE,
            limit: 30,
            category: 'bird',
            maxId: 'abc'
          })
        ).toEqual({ items: [], nextMaxId: null })
      })
    })

    describe('getGalleryMapPoints', () => {
      it('serves the public preview exactly as a logged-out viewer sees it', async () => {
        // The route runs the owner's `preview=public` with the public
        // audience; it must equal a logged-out call, not owner rows
        // re-projected.
        const loggedOut = await getGalleryMapPoints({
          database,
          owner,
          audience: PUBLIC_GALLERY_AUDIENCE
        })
        const preview = await getGalleryMapPoints({
          database,
          owner,
          audience: { ...PUBLIC_GALLERY_AUDIENCE }
        })

        expect(preview).toEqual(loggedOut)
        // The fox is in a hidden location and the heron is followers-only.
        expect(loggedOut.points).toEqual([
          expect.objectContaining({
            mediaId: ids['kingfisher-1'],
            latitude: 51.55,
            longitude: 0,
            precision: 'area'
          })
        ])
        expect(loggedOut.points[0]).not.toHaveProperty('publicState')
        expect(loggedOut.truncated).toBeFalse()
      })

      it('gives the owner every stored point marked with its public state', async () => {
        const result = await getGalleryMapPoints({
          database,
          owner,
          audience: OWNER_GALLERY_AUDIENCE
        })

        expect(
          result.points.map((point) => [
            point.mediaId,
            point.latitude,
            point.longitude,
            point.publicState
          ])
        ).toEqual([
          // Followers-only: never on the public map.
          [ids.heron, 20, 20, 'not-public-post'],
          [ids.fox, 40.7, -74, 'in-hidden-location'],
          [ids['kingfisher-1'], 51.5543, -0.0231, 'shown-area']
        ])
      })
    })

    describe('threatened species and countries', () => {
      const other = { id: actors.followRequester.id }
      const otherIds: Record<string, string> = {}

      const createOtherMedia = async (
        name: string,
        details: Parameters<typeof database.createMedia>[0]['details'],
        lookups: {
          subject?: 'LC' | 'VU' | 'pending'
          countryCode?: string
        }
      ) => {
        const statusId = `${other.id}/statuses/threat-${name}`
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: other.id,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: name
        })
        const media = await database.createMedia({
          actorId: other.id,
          original: {
            path: `/test/threat-${name}.jpg`,
            bytes: 1000,
            mimeType: 'image/jpeg',
            metaData: { width: 100, height: 100 }
          },
          details: { inGallery: true, ...details }
        })
        otherIds[name] = media!.id
        await database.createAttachment({
          actorId: other.id,
          statusId,
          mediaType: 'image/jpeg',
          url: `https://media.test/threat-${name}.jpg`,
          width: 100,
          height: 100,
          mediaId: media!.id
        })
        if (lookups.subject && lookups.subject !== 'pending') {
          expect(
            await database.setMediaSubjectLookup({
              mediaId: media!.id,
              expect: {
                subjectName: details?.subjectName ?? null,
                subjectScientificName: details?.subjectScientificName ?? null,
                subjectTaxonKey: null
              },
              patch: {
                subjectLookupStatus: 'resolved',
                subjectIucnCategory: lookups.subject
              }
            })
          ).toBeTrue()
        }
        if (lookups.countryCode) {
          expect(
            await database.setMediaPlaceLookup({
              mediaId: media!.id,
              expect: {
                placeLatitude: details?.placeLatitude ?? null,
                placeLongitude: details?.placeLongitude ?? null
              },
              patch: {
                placeLookupStatus: 'resolved',
                placeCountryCode: lookups.countryCode
              }
            })
          ).toBeTrue()
        }
      }

      beforeAll(async () => {
        // Oldest first.
        await createOtherMedia(
          'hornbill',
          {
            subjectName: 'Great Hornbill',
            subjectScientificName: 'Buceros bicornis',
            subjectCategory: 'bird',
            takenAt: Date.UTC(2022, 0, 1),
            placeName: 'Khao Yai',
            placeLatitude: 14.4389,
            placeLongitude: 101.3722,
            placePrecision: 'exact'
          },
          { subject: 'VU', countryCode: 'TH' }
        )
        await createOtherMedia(
          'tiger',
          {
            subjectName: 'Bengal Tiger',
            subjectScientificName: 'Panthera tigris',
            subjectCategory: 'mammal',
            takenAt: Date.UTC(2022, 6, 1),
            placeName: 'Ranthambore',
            placeLatitude: 26.0173,
            placeLongitude: 76.5026,
            placePrecision: 'area'
          },
          // The lookup has not run: unchecked, so withheld.
          { subject: 'pending', countryCode: 'IN' }
        )
        await createOtherMedia(
          'robin-fr',
          {
            subjectName: 'European Robin',
            subjectScientificName: 'Erithacus rubecula',
            subjectCategory: 'bird',
            takenAt: Date.UTC(2023, 0, 1),
            placeName: 'Paris, France',
            placeLatitude: 48.8566,
            placeLongitude: 2.3522,
            placePrecision: 'country'
          },
          { subject: 'LC', countryCode: 'FR' }
        )
        await createOtherMedia(
          'robin-gb',
          {
            subjectName: 'European Robin',
            subjectScientificName: 'Erithacus rubecula',
            subjectCategory: 'bird',
            takenAt: Date.UTC(2024, 0, 1),
            placeName: 'Lea Valley',
            placeLatitude: 51.5543,
            placeLongitude: -0.0231,
            placePrecision: 'area'
          },
          { subject: 'LC', countryCode: 'GB' }
        )
        await createOtherMedia(
          'lake',
          {
            subjectName: 'Lake Geneva',
            subjectCategory: 'landscape',
            takenAt: Date.UTC(2024, 6, 1),
            placeName: 'Geneva',
            placeLatitude: 46.2044,
            placeLongitude: 6.1432,
            placePrecision: 'exact'
          },
          { countryCode: 'CH' }
        )
        await createOtherMedia(
          'hidden-robin',
          {
            subjectName: 'European Robin',
            subjectScientificName: 'Erithacus rubecula',
            subjectCategory: 'bird',
            takenAt: Date.UTC(2024, 8, 1),
            placeName: 'Berlin',
            placeLatitude: 52.52,
            placeLongitude: 13.405,
            placePrecision: 'hidden'
          },
          { subject: 'LC', countryCode: 'DE' }
        )
        // A name with no precision: the geocoded code is the owner's alone.
        await createOtherMedia(
          'home-robin',
          {
            subjectName: 'European Robin',
            subjectScientificName: 'Erithacus rubecula',
            subjectCategory: 'bird',
            takenAt: Date.UTC(2024, 9, 1),
            placeName: 'Home',
            placeLatitude: 40.4168,
            placeLongitude: -3.7038,
            placePrecision: null
          },
          { subject: 'LC', countryCode: 'ES' }
        )
      })

      it('counts only the countries of places the public is shown', async () => {
        const [publicSubjects, ownerSubjects] = await Promise.all([
          getGallerySubjects({
            database,
            owner: other,
            audience: PUBLIC_GALLERY_AUDIENCE
          }),
          getGallerySubjects({
            database,
            owner: other,
            audience: OWNER_GALLERY_AUDIENCE
          })
        ])

        // TH (threatened), IN (unchecked), DE (hidden precision) and ES (no
        // precision, so no code) are withheld, and each was the only photo in
        // its country.
        expect(publicSubjects.countryCount).toBe(3)
        expect(ownerSubjects.countryCount).toBe(7)

        const entries = (result: typeof publicSubjects) =>
          Object.fromEntries(
            result.groups
              .flatMap((group) => group.subjects)
              .map((subject) => [subject.key, subject.countryCodes])
          )
        expect(entries(publicSubjects)).toEqual({
          'sci:buceros bicornis': [],
          'sci:panthera tigris': [],
          'sci:erithacus rubecula': ['FR', 'GB'],
          'name:lake geneva': ['CH']
        })
        expect(entries(ownerSubjects)['sci:erithacus rubecula']).toEqual([
          'DE',
          'ES',
          'FR',
          'GB'
        ])
        expect(entries(ownerSubjects)['sci:buceros bicornis']).toEqual(['TH'])
      })

      it('never sends the IUCN verdict or the hidden places in subjects', async () => {
        const json = JSON.stringify(
          await getGallerySubjects({
            database,
            owner: other,
            audience: PUBLIC_GALLERY_AUDIENCE
          })
        )

        for (const leak of [
          'Khao Yai',
          'Ranthambore',
          'Berlin',
          '14.4389',
          '26.0173',
          '"TH"',
          '"IN"',
          '"DE"',
          '"VU"',
          'resolved',
          'pending'
        ]) {
          expect(json).not.toContain(leak)
        }
      })

      it('names the first place of a life-list entry from the projection', async () => {
        const [publicList, ownerList] = await Promise.all([
          getGalleryLifeList({
            database,
            owner: other,
            audience: PUBLIC_GALLERY_AUDIENCE
          }),
          getGalleryLifeList({
            database,
            owner: other,
            audience: OWNER_GALLERY_AUDIENCE
          })
        ])
        const where = (list: typeof publicList) =>
          Object.fromEntries(
            list.entries.map((entry) => [entry.key, entry.firstPlaceName])
          )

        // The earliest robin is the French one at country precision, named
        // by its country code rather than the stored locality.
        expect(where(publicList)).toEqual({
          'sci:buceros bicornis': null,
          'sci:panthera tigris': null,
          'sci:erithacus rubecula': 'France'
        })
        expect(where(ownerList)).toEqual({
          'sci:buceros bicornis': 'Khao Yai',
          'sci:panthera tigris': 'Ranthambore',
          'sci:erithacus rubecula': 'Paris, France'
        })
      })

      it('keeps threatened and unchecked species off the public map', async () => {
        const [loggedOut, preview, ownerMap] = await Promise.all([
          getGalleryMapPoints({
            database,
            owner: other,
            audience: PUBLIC_GALLERY_AUDIENCE
          }),
          getGalleryMapPoints({
            database,
            owner: other,
            audience: { ...PUBLIC_GALLERY_AUDIENCE }
          }),
          getGalleryMapPoints({
            database,
            owner: other,
            audience: OWNER_GALLERY_AUDIENCE
          })
        ])

        expect(preview).toEqual(loggedOut)
        expect(loggedOut.points.map((point) => point.mediaId)).toEqual([
          otherIds.lake,
          otherIds['robin-gb']
        ])
        expect(loggedOut.points.map((point) => point.countryCode)).toEqual([
          'CH',
          'GB'
        ])
        expect(loggedOut.countryCount).toBe(2)

        expect(
          Object.fromEntries(
            ownerMap.points.map((point) => [point.mediaId, point.publicState])
          )
        ).toEqual({
          [otherIds['hidden-robin']]: 'not-shown',
          [otherIds.lake]: 'shown-exact',
          [otherIds['robin-gb']]: 'shown-area',
          [otherIds['robin-fr']]: 'not-shown',
          [otherIds.tiger]: 'threatened-species',
          [otherIds.hornbill]: 'threatened-species',
          [otherIds['home-robin']]: 'not-shown'
        })
        expect(ownerMap.countryCount).toBe(7)
      })

      it('withholds a threatened item place in the grid, and the owner keeps it', async () => {
        const [publicPage, ownerPage] = await Promise.all([
          getGalleryMediaPage({
            database,
            owner: other,
            audience: PUBLIC_GALLERY_AUDIENCE,
            limit: 30
          }),
          getGalleryMediaPage({
            database,
            owner: other,
            audience: OWNER_GALLERY_AUDIENCE,
            limit: 30
          })
        ])
        const placeOf = (page: typeof publicPage, name: string) =>
          page.items.find((item) => item.mediaId === otherIds[name])?.place

        expect(placeOf(publicPage, 'hornbill')).toBeNull()
        expect(placeOf(publicPage, 'tiger')).toBeNull()
        expect(placeOf(publicPage, 'robin-fr')).toEqual({
          name: 'France',
          precision: 'country',
          countryCode: 'FR'
        })
        expect(placeOf(ownerPage, 'hornbill')).toEqual({
          name: 'Khao Yai',
          precision: 'exact',
          latitude: 14.4389,
          longitude: 101.3722,
          countryCode: 'TH'
        })
      })

      it('shows every place once the owner turns the rule off', async () => {
        await database.updateGallerySettings({
          actorId: other.id,
          hideThreatenedPlaces: false
        })
        try {
          const result = await getGallerySubjects({
            database,
            owner: other,
            audience: PUBLIC_GALLERY_AUDIENCE
          })
          // TH and IN come back; DE stays hidden by its precision.
          expect(result.countryCount).toBe(5)
        } finally {
          await database.updateGallerySettings({
            actorId: other.id,
            hideThreatenedPlaces: true
          })
        }
      })
    })
  })
})

describe('gallery queries at the index cap', () => {
  const indexRows = (count: number): GalleryIndexRow[] =>
    Array.from({ length: count }, (_, index) => ({
      id: String(count - index),
      subjectName: index % 2 === 0 ? 'Robin' : null,
      subjectScientificName: null,
      subjectCategory: index % 2 === 0 ? 'bird' : null,
      subjectTaxonKey: null,
      subjectTaxonPath: null,
      subjectIucnCategory: null,
      subjectLookupStatus: null,
      placeName: null,
      placePrecision: null,
      placeLatitude: null,
      placeLongitude: null,
      placeCountryCode: null,
      placeNameSource: null,
      takenAt: null,
      createdAt: 1_700_000_000_000
    }))

  const fakeDatabase = (rows: GalleryIndexRow[]) => ({
    getGallerySettings: vi.fn(async () => ({ ...DEFAULT_GALLERY_SETTINGS })),
    getGalleryGearNamesByIds: vi.fn(async () => ({})),
    getGalleryMedia: vi.fn(async () => []),
    getGalleryMediaByIds: vi.fn(async () => []),
    getGalleryMediaIndex: vi.fn(
      async ({ limit, maxId }: { limit: number; maxId?: string }) =>
        rows
          .filter(
            (row) => maxId === undefined || Number(row.id) < Number(maxId)
          )
          .slice(0, limit)
    ),
    getGalleryMapRows: vi.fn(async () => [])
  })

  it.each([
    { description: 'at the cap', count: GALLERY_INDEX_CAP, truncated: false },
    {
      description: 'past the cap',
      count: GALLERY_INDEX_CAP + 10,
      truncated: true
    }
  ])(
    'reports truncated $truncated $description',
    async ({ count, truncated }) => {
      const database = fakeDatabase(indexRows(count))

      const lifeList = await getGalleryLifeList({
        database,
        owner: { id: 'owner' },
        audience: OWNER_GALLERY_AUDIENCE
      })
      const subjects = await getGallerySubjects({
        database,
        owner: { id: 'owner' },
        audience: OWNER_GALLERY_AUDIENCE
      })

      expect(lifeList.truncated).toBe(truncated)
      expect(subjects.truncated).toBe(truncated)
      expect(subjects.unidentifiedCount).toBe(GALLERY_INDEX_CAP / 2)
      expect(lifeList.entries[0].count).toBe(GALLERY_INDEX_CAP / 2)
    }
  )

  const mapRows = (count: number): GalleryMapRow[] =>
    Array.from({ length: count }, (_, index) => ({
      id: String(count - index),
      latitude: 13.7,
      longitude: 100.5,
      placePrecision: 'exact',
      placeName: null,
      placeCountryCode: null,
      placeNameSource: null,
      subjectName: null,
      subjectScientificName: null,
      subjectCategory: null,
      subjectTaxonKey: null,
      subjectIucnCategory: null,
      subjectLookupStatus: null,
      takenAt: null,
      thumbnailUrl: null,
      statusId: `status-${index}`,
      statusPublicId: null
    }))

  it.each([
    { description: 'at the cap', count: GALLERY_INDEX_CAP, truncated: false },
    {
      description: 'past the cap',
      count: GALLERY_INDEX_CAP + 10,
      truncated: true
    }
  ])(
    'caps the map points and reports truncated $truncated $description',
    async ({ count, truncated }) => {
      const database = {
        ...fakeDatabase([]),
        getGalleryMapRows: vi.fn(async ({ limit }: { limit: number }) =>
          mapRows(count).slice(0, limit)
        )
      }

      const result = await getGalleryMapPoints({
        database,
        owner: { id: 'owner' },
        audience: OWNER_GALLERY_AUDIENCE
      })

      expect(database.getGalleryMapRows).toHaveBeenCalledWith(
        expect.objectContaining({ limit: GALLERY_INDEX_CAP + 1 })
      )
      expect(result.points).toHaveLength(GALLERY_INDEX_CAP)
      expect(result.truncated).toBe(truncated)
    }
  )

  it('reaches a subject past the first index window by moving the cursor', async () => {
    const count = GALLERY_INDEX_CAP + 10
    const rows = indexRows(count).map((row) => ({
      ...row,
      subjectName: row.id === '1' ? 'Rare Bird' : null,
      subjectCategory: null
    }))
    const database = fakeDatabase(rows)

    await getGalleryMediaPage({
      database,
      owner: { id: 'owner' },
      audience: OWNER_GALLERY_AUDIENCE,
      limit: 30,
      subjectKey: 'name:rare bird'
    })

    expect(database.getGalleryMediaIndex).toHaveBeenCalledTimes(2)
    expect(database.getGalleryMediaIndex).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ maxId: String(count - GALLERY_INDEX_CAP + 1) })
    )
    expect(database.getGalleryMediaByIds).toHaveBeenCalledWith(
      expect.objectContaining({ mediaIds: ['1'] })
    )
  })

  it('reads one window when the page is already full', async () => {
    const database = fakeDatabase(indexRows(GALLERY_INDEX_CAP + 10))
    database.getGalleryMediaByIds.mockImplementation((async ({
      mediaIds
    }: {
      mediaIds: string[]
    }) =>
      mediaIds.map((id) => ({
        media: { id }
      }))) as never)

    const page = await getGalleryMediaPage({
      database,
      owner: { id: 'owner' },
      audience: OWNER_GALLERY_AUDIENCE,
      limit: 2,
      category: 'bird'
    })

    expect(database.getGalleryMediaIndex).toHaveBeenCalledTimes(1)
    expect(page.nextMaxId).not.toBeNull()
  })

  const byIds = (dropped: string[] = []) =>
    (async ({ mediaIds }: { mediaIds: string[] }) =>
      mediaIds
        .filter((id) => !dropped.includes(id))
        .map((id) => ({ media: { id } }))) as never

  it('requests the next matching ids when a by-ids read comes back short', async () => {
    const database = fakeDatabase(indexRows(10))
    // Even ids are birds (10, 8, 6, 4, 2); the read drops id 8.
    database.getGalleryMediaByIds.mockImplementation(byIds(['8']))

    const page = await getGalleryMediaPage({
      database,
      owner: { id: 'owner' },
      audience: OWNER_GALLERY_AUDIENCE,
      limit: 2,
      category: 'bird'
    })

    expect(page.items.map((item) => item.mediaId)).toEqual(['10', '6'])
    // 6 is the look-ahead row for a page of two, so 4 is for the next page.
    expect(page.nextMaxId).toBe('6')
    expect(database.getGalleryMediaByIds).toHaveBeenCalledTimes(2)
  })

  it('keeps reading the recent grid when a row is dropped after the SQL limit', async () => {
    const database = fakeDatabase([])
    const all = ['9', '8', '7', '6', '5', '4']
    database.getGalleryMedia.mockImplementation((async ({
      maxId,
      limit
    }: {
      maxId?: string
      limit: number
    }) =>
      all
        .filter((id) => maxId === undefined || Number(id) < Number(maxId))
        .slice(0, limit)
        // The read drops id 8 after the limit was applied.
        .filter((id) => id !== '8')
        .map((id) => ({ media: { id } }))) as never)

    const page = await getGalleryMediaPage({
      database,
      owner: { id: 'owner' },
      audience: OWNER_GALLERY_AUDIENCE,
      limit: 2
    })

    expect(page.items.map((item) => item.mediaId)).toEqual(['9', '7'])
    expect(page.nextMaxId).toBe('7')
  })

  it('stops after the window cap and hands back the last scanned id', async () => {
    const count = GALLERY_INDEX_CAP * (MAX_INDEX_WINDOWS + 2)
    const rows = indexRows(count).map((row) => ({
      ...row,
      subjectName: null,
      subjectCategory: null
    }))
    const database = fakeDatabase(rows)

    const page = await getGalleryMediaPage({
      database,
      owner: { id: 'owner' },
      audience: PUBLIC_GALLERY_AUDIENCE,
      limit: 30,
      subjectKey: 'name:zzz'
    })

    expect(database.getGalleryMediaIndex).toHaveBeenCalledTimes(
      MAX_INDEX_WINDOWS
    )
    expect(page.items).toEqual([])
    expect(page.nextMaxId).toBe(
      String(count - MAX_INDEX_WINDOWS * GALLERY_INDEX_CAP + 1)
    )

    const next = await getGalleryMediaPage({
      database,
      owner: { id: 'owner' },
      audience: PUBLIC_GALLERY_AUDIENCE,
      limit: 30,
      subjectKey: 'name:zzz',
      maxId: page.nextMaxId!
    })
    // Two windows remain, so the index ends before the cap and paging stops.
    expect(next.nextMaxId).toBeNull()
  })
})
