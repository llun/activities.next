import {
  STALE_SUBJECT_LOOKUP_MS,
  buildOwnerMediaDetails,
  getOwnerMediaAttachment
} from '@/lib/services/medias/mediaDetails'
import { EMPTY_MEDIA_DETAILS } from '@/lib/types/database/gallery'
import { Media } from '@/lib/types/database/operations'

const media = (details?: Partial<typeof EMPTY_MEDIA_DETAILS>): Media => ({
  id: '7',
  actorId: 'actor',
  original: {
    path: 'a.jpg',
    bytes: 1,
    mimeType: 'image/jpeg',
    metaData: { width: 4, height: 3 }
  },
  ...(details ? { details: { ...EMPTY_MEDIA_DETAILS, ...details } } : {})
})

const database = (names: Record<string, string> = {}) => ({
  getGalleryGearNamesByIds: vi.fn(async ({ ids }: { ids: string[] }) =>
    Object.fromEntries(
      ids.filter((id) => id in names).map((id) => [id, names[id]])
    )
  )
})

describe('buildOwnerMediaDetails', () => {
  it('describes a media with no details as empty and not in the gallery', async () => {
    expect(await buildOwnerMediaDetails(database(), media())).toEqual({
      subject: null,
      takenAt: null,
      camera: null,
      lens: null,
      exposure: null,
      place: null,
      inGallery: false,
      subjectSuggestions: null
    })
  })

  it('returns every field, with the stored coordinates, to the owner', async () => {
    const db = database({ cam: 'Canon EOS R5', lens: 'RF100-500mm' })

    expect(
      await buildOwnerMediaDetails(
        db,
        media({
          subjectName: 'Common Kingfisher',
          subjectScientificName: 'Alcedo atthis',
          subjectCategory: 'bird',
          takenAt: Date.UTC(2024, 4, 6, 7, 8, 9),
          cameraGearId: 'cam',
          lensGearId: 'lens',
          exposure: { focalLengthMm: 500, exposureTime: '1/2000' },
          placeName: 'Lea Valley',
          placeLatitude: 51.5543,
          placeLongitude: -0.0231,
          placePrecision: 'area',
          inGallery: true
        })
      )
    ).toEqual({
      subject: {
        name: 'Common Kingfisher',
        scientificName: 'Alcedo atthis',
        category: 'bird',
        taxonKey: null,
        taxonPath: null,
        iucnCategory: null,
        threatStatus: 'unchecked',
        lookupStatus: null,
        lookupStale: false
      },
      takenAt: '2024-05-06T07:08:09.000Z',
      camera: { id: 'cam', name: 'Canon EOS R5' },
      lens: { id: 'lens', name: 'RF100-500mm' },
      exposure: {
        focalLengthMm: 500,
        aperture: null,
        exposureTime: '1/2000',
        iso: null
      },
      place: {
        name: 'Lea Valley',
        latitude: 51.5543,
        longitude: -0.0231,
        precision: 'area',
        countryCode: null,
        nameSource: null,
        lookupStatus: null,
        lookupStale: false
      },
      inGallery: true,
      subjectSuggestions: null
    })
    expect(db.getGalleryGearNamesByIds).toHaveBeenCalledOnce()
  })

  it('does not query gear for a media that has none', async () => {
    const db = database()

    await buildOwnerMediaDetails(db, media({ subjectName: 'Otter' }))

    expect(db.getGalleryGearNamesByIds).not.toHaveBeenCalled()
  })

  it('reads deleted gear as no gear', async () => {
    const result = await buildOwnerMediaDetails(
      database({}),
      media({ cameraGearId: 'gone', lensGearId: 'gone-too' })
    )

    expect(result.camera).toBeNull()
    expect(result.lens).toBeNull()
  })

  it('describes a place with only a name', async () => {
    const result = await buildOwnerMediaDetails(
      database(),
      media({ placeName: 'Garden' })
    )

    expect(result.place).toEqual({
      name: 'Garden',
      latitude: null,
      longitude: null,
      precision: null,
      countryCode: null,
      nameSource: null,
      lookupStatus: null,
      lookupStale: false
    })
  })

  it('gives the owner the IUCN verdict, both lookups and the suggestions', async () => {
    const suggestions = {
      model: 'vision-1',
      generatedAt: '2026-10-08T08:00:00.000Z',
      checkedAgainst: 'gbif' as const,
      candidates: [
        {
          name: 'Great Hornbill',
          scientificName: 'Buceros bicornis',
          category: 'bird' as const,
          confidence: 0.9,
          taxonKey: '2481839',
          rank: 'SPECIES',
          taxonPath: ['Animalia', 'Chordata', 'Aves']
        }
      ],
      group: 'bird' as const
    }
    const result = await buildOwnerMediaDetails(
      database(),
      media({
        subjectName: 'Great Hornbill',
        subjectScientificName: 'Buceros bicornis',
        subjectCategory: 'bird',
        subjectTaxonKey: '2481839',
        subjectTaxonPath: ['Animalia', 'Chordata', 'Aves'],
        subjectIucnCategory: 'VU',
        subjectLookupStatus: 'resolved',
        subjectSuggestions: suggestions,
        placeName: 'Pak Chong, Thailand',
        placeLatitude: 14.4,
        placeLongitude: 101.4,
        placePrecision: 'exact',
        placeCountryCode: 'TH',
        placeNameSource: 'geocoder',
        placeLookupStatus: 'failed'
      })
    )

    expect(result.subject).toEqual({
      name: 'Great Hornbill',
      scientificName: 'Buceros bicornis',
      category: 'bird',
      taxonKey: '2481839',
      taxonPath: ['Animalia', 'Chordata', 'Aves'],
      iucnCategory: 'VU',
      threatStatus: 'threatened',
      lookupStatus: 'resolved',
      lookupStale: false
    })
    expect(result.place).toMatchObject({
      countryCode: 'TH',
      nameSource: 'geocoder',
      lookupStatus: 'failed'
    })
    expect(result.subjectSuggestions).toEqual(suggestions)
  })
})

describe('buildOwnerMediaDetails lookupStale', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-08T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const staleOf = async (details: Partial<typeof EMPTY_MEDIA_DETAILS>) =>
    (
      await buildOwnerMediaDetails(
        database(),
        media({ subjectScientificName: 'Alcedo atthis', ...details })
      )
    ).subject?.lookupStale

  it('is false for a lookup that only just became pending', async () => {
    expect(
      await staleOf({
        subjectLookupStatus: 'pending',
        subjectLookupAt: Date.now() - (STALE_SUBJECT_LOOKUP_MS - 1)
      })
    ).toBe(false)
  })

  it('is true once pending for too long, or with no start time', async () => {
    expect(
      await staleOf({
        subjectLookupStatus: 'pending',
        subjectLookupAt: Date.now() - STALE_SUBJECT_LOOKUP_MS
      })
    ).toBe(true)
    expect(
      await staleOf({ subjectLookupStatus: 'pending', subjectLookupAt: null })
    ).toBe(true)
  })

  it('is false for any status but pending', async () => {
    expect(
      await staleOf({ subjectLookupStatus: 'failed', subjectLookupAt: 0 })
    ).toBe(false)
  })

  // The place lookup follows the same rule, from `placeLookupAt`.
  const placeStaleOf = async (details: Partial<typeof EMPTY_MEDIA_DETAILS>) =>
    (
      await buildOwnerMediaDetails(
        database(),
        media({ placeLatitude: 14.4, placeLongitude: 101.4, ...details })
      )
    ).place?.lookupStale

  it('marks a place lookup stale only once pending for too long', async () => {
    expect(
      await placeStaleOf({
        placeLookupStatus: 'pending',
        placeLookupAt: Date.now() - (STALE_SUBJECT_LOOKUP_MS - 1)
      })
    ).toBe(false)
    expect(
      await placeStaleOf({
        placeLookupStatus: 'pending',
        placeLookupAt: Date.now() - STALE_SUBJECT_LOOKUP_MS
      })
    ).toBe(true)
    expect(
      await placeStaleOf({ placeLookupStatus: 'failed', placeLookupAt: 0 })
    ).toBe(false)
  })
})

describe('getOwnerMediaAttachment', () => {
  it('adds details to the Mastodon entity without changing the rest', async () => {
    const entity = await getOwnerMediaAttachment(
      database(),
      media({ subjectName: 'Otter' }),
      'llun.test'
    )

    expect(entity).toMatchObject({
      id: '7',
      type: 'image',
      description: null,
      details: { subject: { name: 'Otter' }, inGallery: false }
    })
  })
})
