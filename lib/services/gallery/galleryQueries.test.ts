import type { GalleryIndexRow } from '@/lib/database/sql/galleryMedia'
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
          longitude: -74
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
  })
})

describe('gallery queries at the index cap', () => {
  const indexRows = (count: number): GalleryIndexRow[] =>
    Array.from({ length: count }, (_, index) => ({
      id: String(count - index),
      subjectName: index % 2 === 0 ? 'Robin' : null,
      subjectScientificName: null,
      subjectCategory: index % 2 === 0 ? 'bird' : null,
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
