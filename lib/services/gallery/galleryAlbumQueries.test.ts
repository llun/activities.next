import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import {
  computeGalleryAlbumFacts,
  countHiddenThreatenedPlaces,
  getGalleryAlbumDetail,
  getGalleryAlbumList,
  getGalleryAlbumPage,
  parseAlbumCursor,
  toAlbumCursorString,
  toSpeciesChips
} from '@/lib/services/gallery/galleryAlbumQueries'
import {
  GalleryAudience,
  OWNER_GALLERY_AUDIENCE,
  PUBLIC_GALLERY_AUDIENCE
} from '@/lib/services/gallery/galleryAudience'
import { getPublicPlace } from '@/lib/services/gallery/publicMediaDetails'
import { seedDatabase } from '@/lib/stub/database'
import { DatabaseSeed } from '@/lib/stub/scenarios/database'
import {
  DEFAULT_GALLERY_SETTINGS,
  MediaDetailsRecord
} from '@/lib/types/database/gallery'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

describe('album cursors', () => {
  it('round-trips a cursor, including a negative sort key', () => {
    for (const cursor of [
      { key: 1704067200000, mediaId: 42 },
      { key: -86400000, mediaId: 7 }
    ]) {
      expect(parseAlbumCursor(toAlbumCursorString(cursor))).toEqual(cursor)
    }
  })

  it.each([
    '',
    'abc',
    '12',
    '12:',
    ':12',
    '1:2:3',
    '1.5:2',
    '1:x',
    '12345678901234567:1'
  ])('refuses %j', (value) => {
    expect(parseAlbumCursor(value)).toBeNull()
  })
})

describe('album facts and species chips', () => {
  const row = (
    id: string,
    overrides: Partial<
      Parameters<typeof computeGalleryAlbumFacts>[0][number]
    > = {}
  ): Parameters<typeof computeGalleryAlbumFacts>[0][number] => ({
    id,
    subjectName: null,
    subjectScientificName: null,
    subjectCategory: null,
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
    takenAt: Date.UTC(2026, 8, 12, 6),
    createdAt: Date.UTC(2026, 9, 1),
    addedAt: Date.UTC(2026, 9, 2),
    ...overrides
  })

  it('counts photos, species, places, countries and days', () => {
    const facts = computeGalleryAlbumFacts(
      [
        row('1', {
          subjectName: 'Leopard',
          subjectScientificName: 'Panthera pardus',
          subjectLookupStatus: 'resolved',
          subjectIucnCategory: 'LC',
          placeName: 'Satara',
          placePrecision: 'exact',
          placeLatitude: -24.4,
          placeLongitude: 31.7,
          placeCountryCode: 'ZA'
        }),
        row('2', {
          // The same species under another common name.
          subjectName: 'Spotted cat',
          subjectScientificName: 'panthera pardus',
          subjectLookupStatus: 'resolved',
          subjectIucnCategory: 'LC',
          takenAt: Date.UTC(2026, 8, 12, 18),
          placeName: 'Satara',
          placePrecision: 'exact',
          placeLatitude: -24.4,
          placeLongitude: 31.7,
          placeCountryCode: 'ZA'
        }),
        row('3', {
          subjectName: 'Lake',
          takenAt: Date.UTC(2026, 8, 19),
          placeName: 'South Africa',
          placePrecision: 'country',
          placeCountryCode: 'ZA'
        }),
        row('4', { takenAt: null, createdAt: Date.UTC(2026, 8, 13) })
      ],
      DEFAULT_GALLERY_SETTINGS
    )

    expect(facts).toMatchObject({
      photoCount: 4,
      speciesCount: 2,
      // The two exact photos share one place; the country one is its own.
      placeCount: 2,
      countryCount: 1,
      countryCodes: ['ZA'],
      countryName: 'South Africa',
      dayCount: 3,
      firstAt: '2026-09-12T06:00:00.000Z',
      lastAt: '2026-09-19T00:00:00.000Z'
    })
  })

  it('has no country name for two countries and zeros for no photos', () => {
    const two = computeGalleryAlbumFacts(
      [
        row('1', {
          placeName: 'A',
          placePrecision: 'area',
          placeCountryCode: 'ZA'
        }),
        row('2', {
          placeName: 'B',
          placePrecision: 'area',
          placeCountryCode: 'GB'
        })
      ],
      DEFAULT_GALLERY_SETTINGS
    )
    expect(two).toMatchObject({ countryCount: 2, countryName: null })

    expect(computeGalleryAlbumFacts([], DEFAULT_GALLERY_SETTINGS)).toEqual({
      photoCount: 0,
      speciesCount: 0,
      placeCount: 0,
      countryCount: 0,
      dayCount: 0,
      countryCodes: [],
      countryName: null,
      firstAt: null,
      lastAt: null
    })
  })

  it('lists species most photos first, then by name, named by the newest photo', () => {
    const chips = toSpeciesChips([
      row('1', {
        subjectName: 'Old name',
        subjectScientificName: 'Alcedo atthis',
        takenAt: 1
      }),
      row('2', {
        subjectName: 'Kingfisher',
        subjectScientificName: 'Alcedo atthis',
        takenAt: 3
      }),
      row('3', { subjectName: 'Zebra' }),
      row('4', { subjectName: 'Aardvark' }),
      row('5')
    ])

    expect(chips).toEqual([
      { key: 'sci:alcedo atthis', name: 'Kingfisher', count: 2 },
      { key: 'name:aardvark', name: 'Aardvark', count: 1 },
      { key: 'name:zebra', name: 'Zebra', count: 1 }
    ])
  })
})

describe('gallery album queries', () => {
  const { actors } = DatabaseSeed
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  describe.each(table)('%s', (_, database) => {
    const ownerId: string = actors.empty.id
    const followersUrl = `${ownerId}/followers`
    const ids: Record<string, string> = {}
    let albumId = ''

    const publicWithPlace = {
      placePrecision: 'exact',
      placeNameSource: 'owner'
    } as const

    const addPhoto = async (
      name: string,
      to: string[],
      details: Partial<MediaDetailsRecord>,
      lookup?: {
        status: 'resolved' | 'pending' | 'failed'
        iucn?: 'CR' | 'LC'
      },
      // What the place lookup writes: the country, and a geocoded name. Neither
      // can be set through `createMedia`.
      place?: { countryCode: string; name?: string }
    ) => {
      const media = await database.createMedia({
        actorId: ownerId,
        original: {
          path: `/test/album-queries-${name}.jpg`,
          bytes: 1000,
          mimeType: 'image/jpeg',
          metaData: { width: 100, height: 100 }
        },
        details: { inGallery: true, ...details }
      })
      ids[name] = media!.id
      if (lookup) {
        await database.setMediaSubjectLookup({
          mediaId: media!.id,
          expect: {
            subjectName: details.subjectName ?? null,
            subjectScientificName: details.subjectScientificName ?? null,
            subjectTaxonKey: null
          },
          patch: {
            subjectLookupStatus: lookup.status,
            subjectIucnCategory: lookup.iucn ?? null
          }
        })
      }
      if (place) {
        await database.setMediaPlaceLookup({
          mediaId: media!.id,
          expect: {
            placeLatitude: details.placeLatitude ?? null,
            placeLongitude: details.placeLongitude ?? null
          },
          patch: {
            placeLookupStatus: 'resolved',
            placeCountryCode: place.countryCode,
            ...(place.name ? { placeName: place.name } : {})
          }
        })
      }
      const statusId = `${ownerId}/statuses/album-queries-${name}`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ownerId,
        to,
        cc: [],
        text: name
      })
      await database.createAttachment({
        actorId: ownerId,
        statusId,
        mediaType: 'image/jpeg',
        url: `https://media.test/album-queries-${name}.jpg`,
        width: 100,
        height: 100,
        mediaId: media!.id
      })
    }

    beforeAll(async () => {
      await seedDatabase(database)

      await addPhoto(
        'kingfisher',
        [ACTIVITY_STREAM_PUBLIC],
        {
          subjectName: 'Common Kingfisher',
          subjectScientificName: 'Alcedo atthis',
          subjectCategory: 'bird',
          takenAt: Date.UTC(2026, 8, 12),
          placeName: 'River',
          placeLatitude: 51.5543,
          placeLongitude: -0.0231,
          ...publicWithPlace
        },
        { status: 'resolved', iucn: 'LC' }
      )
      await addPhoto(
        'snow-leopard',
        [ACTIVITY_STREAM_PUBLIC],
        {
          subjectName: 'Snow Leopard',
          subjectScientificName: 'Panthera uncia',
          subjectCategory: 'mammal',
          takenAt: Date.UTC(2026, 8, 13),
          placeName: 'Hemis',
          placeLatitude: 34.2,
          placeLongitude: 77.6,
          ...publicWithPlace
        },
        { status: 'resolved', iucn: 'CR' },
        { countryCode: 'IN' }
      )
      await addPhoto(
        'unchecked',
        [ACTIVITY_STREAM_PUBLIC],
        {
          subjectName: 'Pangolin',
          subjectScientificName: 'Manis javanica',
          subjectCategory: 'mammal',
          takenAt: Date.UTC(2026, 8, 14),
          placeName: 'Burrow',
          placeLatitude: 3.1,
          placeLongitude: 101.6,
          ...publicWithPlace
        },
        // The check has not finished, or failed: the place fails closed.
        { status: 'failed' }
      )
      await addPhoto('hidden-precision', [ACTIVITY_STREAM_PUBLIC], {
        subjectName: 'Lake',
        subjectCategory: 'landscape',
        takenAt: Date.UTC(2026, 8, 15),
        placeName: 'Home',
        placeLatitude: 10,
        placeLongitude: 10,
        placePrecision: 'hidden'
      })
      await addPhoto('zone', [ACTIVITY_STREAM_PUBLIC], {
        subjectName: 'Hill',
        subjectCategory: 'landscape',
        takenAt: Date.UTC(2026, 8, 16),
        placeName: 'Nest site',
        placeLatitude: 52,
        placeLongitude: 5,
        ...publicWithPlace
      })
      await addPhoto(
        'country',
        [ACTIVITY_STREAM_PUBLIC],
        {
          subjectName: 'Beach',
          subjectCategory: 'landscape',
          takenAt: Date.UTC(2026, 8, 17),
          placeLatitude: 14.7,
          placeLongitude: 101.4,
          placePrecision: 'country'
        },
        undefined,
        { countryCode: 'TH', name: 'Pak Chong, Thailand' }
      )
      await addPhoto(
        'followers-only',
        [followersUrl],
        {
          subjectName: 'Grey Heron',
          subjectScientificName: 'Ardea cinerea',
          subjectCategory: 'bird',
          takenAt: Date.UTC(2026, 8, 18),
          placeName: 'Marsh',
          placeLatitude: 20,
          placeLongitude: 20,
          ...publicWithPlace
        },
        { status: 'resolved', iucn: 'LC' },
        { countryCode: 'NL' }
      )

      await database.updateGallerySettings({
        actorId: ownerId,
        hiddenLocations: [
          { latitude: 52, longitude: 5, hideRadiusMeters: 1000 }
        ]
      })

      const created = await database.createGalleryAlbumWithinLimit({
        actorId: ownerId,
        title: 'Everything',
        limit: 200
      })
      if (created.status !== 'created') throw new Error('not created')
      albumId = created.album.id
      await database.addGalleryAlbumItems({
        albumId,
        actorId: ownerId,
        mediaIds: Object.values(ids),
        limit: 2000
      })
    })

    afterAll(async () => {
      await database.destroy()
    })

    const pageFor = async (audience: GalleryAudience) =>
      (await getGalleryAlbumPage({
        database,
        owner: { id: ownerId },
        audience,
        albumId,
        sort: 'taken_asc',
        limit: 50
      }))!.items

    const placeOf = (
      items: Awaited<ReturnType<typeof pageFor>>,
      name: string
    ) => items.find((item) => item.mediaId === ids[name])?.place

    it('shows the owner every stored place and a visitor only what getPublicPlace allows', async () => {
      const ownerItems = await pageFor(OWNER_GALLERY_AUDIENCE)
      const publicItems = await pageFor(PUBLIC_GALLERY_AUDIENCE)
      const settings = await database.getGallerySettings({ actorId: ownerId })

      // The owner: coordinates whatever the precision.
      expect(placeOf(ownerItems, 'snow-leopard')).toMatchObject({
        name: 'Hemis',
        latitude: 34.2,
        longitude: 77.6
      })
      expect(placeOf(ownerItems, 'hidden-precision')).toMatchObject({
        name: 'Home'
      })

      // A visitor: exactly the public projection of each stored row.
      const rows = await database.getGalleryAlbumIndex({
        albumId,
        actorId: ownerId,
        audience: PUBLIC_GALLERY_AUDIENCE
      })
      expect(rows).toHaveLength(publicItems.length)
      for (const row of rows) {
        const item = publicItems.find(
          (candidate) => candidate.mediaId === row.id
        )
        expect(item?.place ?? null).toEqual(getPublicPlace(row, settings))
      }

      // And the cases that matter, spelled out.
      expect(placeOf(publicItems, 'kingfisher')).toMatchObject({
        name: 'River',
        latitude: 51.5543
      })
      for (const name of [
        'snow-leopard',
        'unchecked',
        'hidden-precision',
        'zone'
      ]) {
        expect(placeOf(publicItems, name) ?? null).toBeNull()
      }
      expect(placeOf(publicItems, 'country')).toMatchObject({
        name: 'Thailand',
        countryCode: 'TH'
      })
      expect(publicItems.map((item) => item.mediaId)).not.toContain(
        ids['followers-only']
      )
    })

    it('computes the facts line from the public view, never counting a withheld place', async () => {
      const detail = await getGalleryAlbumDetail({
        database,
        owner: { id: ownerId },
        albumId,
        limit: 50
      })

      // Six public photos; the followers-only one is not in the public view.
      expect(detail!.facts).toMatchObject({
        photoCount: 6,
        speciesCount: 6,
        // River and Thailand: the threatened, unchecked, hidden and zone
        // places add nothing.
        placeCount: 2,
        countryCount: 1,
        countryCodes: ['TH'],
        countryName: 'Thailand'
      })
      expect(detail!.album.itemCount).toBe(7)
    })

    it('tells the owner how many places the public numbers leave out for threatened species', async () => {
      const detail = await getGalleryAlbumDetail({
        database,
        owner: { id: ownerId },
        albumId,
        limit: 50
      })

      // The snow leopard (CR) and the pangolin (check failed). The landscape
      // photos' places are withheld for other reasons and are not counted.
      expect(detail!.hiddenPlaceCount).toBe(2)

      const rows = await database.getGalleryAlbumIndex({
        albumId,
        actorId: ownerId,
        audience: OWNER_GALLERY_AUDIENCE
      })
      expect(
        countHiddenThreatenedPlaces(rows, { hideThreatenedPlaces: false })
      ).toBe(0)
    })

    it('lists the owner species chips from what the owner sees', async () => {
      const detail = await getGalleryAlbumDetail({
        database,
        owner: { id: ownerId },
        albumId,
        limit: 50
      })

      expect(detail!.species.map((chip) => chip.name).sort()).toEqual([
        'Beach',
        'Common Kingfisher',
        'Grey Heron',
        'Hill',
        'Lake',
        'Pangolin',
        'Snow Leopard'
      ])
    })

    it('puts the next cursor on the page and follows it', async () => {
      const first = await getGalleryAlbumPage({
        database,
        owner: { id: ownerId },
        audience: OWNER_GALLERY_AUDIENCE,
        albumId,
        sort: 'taken_asc',
        limit: 3
      })
      expect(first!.items).toHaveLength(3)
      expect(first!.nextMaxId).toBeString()

      const rest = await getGalleryAlbumPage({
        database,
        owner: { id: ownerId },
        audience: OWNER_GALLERY_AUDIENCE,
        albumId,
        sort: 'taken_asc',
        maxId: first!.nextMaxId!,
        limit: 10
      })
      expect(rest!.items).toHaveLength(4)
      expect(rest!.nextMaxId).toBeNull()
      expect(
        [...first!.items, ...rest!.items].map((item) => item.mediaId)
      ).toEqual(
        (await pageFor(OWNER_GALLERY_AUDIENCE)).map((item) => item.mediaId)
      )
    })

    it('answers null for a missing album and an empty page for a bad cursor', async () => {
      expect(
        await getGalleryAlbumPage({
          database,
          owner: { id: ownerId },
          audience: OWNER_GALLERY_AUDIENCE,
          albumId: 'missing',
          sort: 'taken_desc',
          limit: 10
        })
      ).toBeNull()
      expect(
        await getGalleryAlbumPage({
          database,
          owner: { id: ownerId },
          audience: OWNER_GALLERY_AUDIENCE,
          albumId,
          sort: 'taken_desc',
          maxId: 'garbage',
          limit: 10
        })
      ).toEqual({ items: [], nextMaxId: null })
    })

    it('lists albums with distinct visible photo counts and a collage', async () => {
      const second = await database.createGalleryAlbumWithinLimit({
        actorId: ownerId,
        title: 'Birds',
        limit: 200
      })
      if (second.status !== 'created') throw new Error('not created')
      await database.addGalleryAlbumItems({
        albumId: second.album.id,
        actorId: ownerId,
        mediaIds: [ids.kingfisher, ids['followers-only']],
        limit: 2000
      })

      const owner = await getGalleryAlbumList({
        database,
        owner: { id: ownerId },
        audience: OWNER_GALLERY_AUDIENCE
      })
      // Seven photos in total, two of them in both albums.
      expect(owner.photoCount).toBe(7)
      expect(owner.albums.map((album) => album.title).sort()).toEqual([
        'Birds',
        'Everything'
      ])
      const everything = owner.albums.find((album) => album.id === albumId)!
      expect(everything.itemCount).toBe(7)
      expect(everything.previews).toHaveLength(3)
      expect(everything.cover?.mediaId).toBe(everything.previews[0].mediaId)
      expect(everything.coverMediaId).toBeNull()

      const visitor = await getGalleryAlbumList({
        database,
        owner: { id: ownerId },
        audience: PUBLIC_GALLERY_AUDIENCE
      })
      expect(visitor.photoCount).toBe(6)
      const birds = visitor.albums.find((album) => album.title === 'Birds')!
      // Only the kingfisher: the heron is on a followers-only post.
      expect(birds.itemCount).toBe(1)
      expect(birds.previews.map((item) => item.mediaId)).toEqual([
        ids.kingfisher
      ])
      expect(birds.coverMediaId).toBeNull()
    })
  })
})
