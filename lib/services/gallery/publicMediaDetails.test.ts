import {
  AREA_PRECISION_DEGREES,
  PUBLIC_PLACE_INPUT_KEYS,
  buildPublicMediaDetails,
  countryDisplayName,
  getPublicPlace
} from '@/lib/services/gallery/publicMediaDetails'
import { EMPTY_MEDIA_DETAILS } from '@/lib/types/database/gallery'
import { Media } from '@/lib/types/database/operations'

const mediaWith = (details: Partial<typeof EMPTY_MEDIA_DETAILS>): Media => ({
  id: '1',
  actorId: 'actor',
  original: {
    path: 'a.jpg',
    bytes: 1,
    mimeType: 'image/jpeg',
    metaData: { width: 1, height: 1 }
  },
  details: { ...EMPTY_MEDIA_DETAILS, ...details }
})

const database = (names: Record<string, string> = {}) => ({
  getGalleryGearNamesByIds: vi.fn(async ({ ids }: { ids: string[] }) =>
    Object.fromEntries(
      ids.filter((id) => id in names).map((id) => [id, names[id]])
    )
  )
})

const NO_ZONES = { hiddenLocations: [], hideThreatenedPlaces: true }

describe('getPublicPlace', () => {
  const place = {
    placeName: 'Lea Valley',
    placeLatitude: 51.5543,
    placeLongitude: -0.0231
  }

  it.each([
    [
      'exact discloses the stored coordinates',
      { ...place, placePrecision: 'exact' as const },
      {
        name: 'Lea Valley',
        precision: 'exact',
        latitude: 51.5543,
        longitude: -0.0231,
        countryCode: null
      }
    ],
    [
      'area snaps to the 0.05 degree grid',
      { ...place, placePrecision: 'area' as const },
      {
        name: 'Lea Valley',
        precision: 'area',
        latitude: 51.55,
        longitude: 0,
        countryCode: null
      }
    ],
    [
      'country keeps the name and drops the coordinates',
      { ...place, placePrecision: 'country' as const },
      { name: 'Lea Valley', precision: 'country', countryCode: null }
    ],
    [
      'hidden is no place at all',
      { ...place, placePrecision: 'hidden' as const },
      null
    ],
    [
      'no precision keeps the name and drops the coordinates',
      { ...place, placePrecision: null },
      { name: 'Lea Valley', precision: null, countryCode: null }
    ],
    [
      'a name with no coordinates stays a name',
      {
        placeName: 'Somewhere',
        placePrecision: 'exact' as const,
        placeLatitude: null,
        placeLongitude: null
      },
      { name: 'Somewhere', precision: 'exact', countryCode: null }
    ],
    ['nothing stored is no place', {}, null]
  ])('%s', (_, details, expected) => {
    expect(
      getPublicPlace({ ...EMPTY_MEDIA_DETAILS, ...details }, NO_ZONES)
    ).toEqual(expected)
  })

  it.each([
    [51.5543, 51.55],
    [51.5751, 51.6],
    [-33.8688, -33.85],
    [0.01, 0],
    [-0.01, 0]
  ])('snaps %d to %d', (value, expected) => {
    const result = getPublicPlace(
      {
        ...EMPTY_MEDIA_DETAILS,
        placePrecision: 'area',
        placeLatitude: value,
        placeLongitude: value
      },
      NO_ZONES
    )

    expect(result?.latitude).toBe(expected)
    // Never negative zero in JSON.
    expect(Object.is(result?.latitude, -0)).toBeFalse()
  })

  it('snaps by no more than half the grid step', () => {
    const result = getPublicPlace(
      {
        ...EMPTY_MEDIA_DETAILS,
        placePrecision: 'area',
        placeLatitude: 48.8584,
        placeLongitude: 2.2945
      },
      NO_ZONES
    )

    expect(Math.abs(result!.latitude! - 48.8584)).toBeLessThanOrEqual(
      AREA_PRECISION_DEGREES / 2 + 1e-9
    )
    expect(Math.abs(result!.longitude! - 2.2945)).toBeLessThanOrEqual(
      AREA_PRECISION_DEGREES / 2 + 1e-9
    )
  })
})

describe('getPublicPlace with hidden locations', () => {
  const stored = {
    placeName: 'Lea Valley',
    placeLatitude: 51.5543,
    placeLongitude: -0.0231
  }
  // Around the stored point itself.
  const aroundStored = {
    latitude: 51.5543,
    longitude: -0.0231,
    hideRadiusMeters: 200 as const
  }
  // Around the `area` cell centre (51.55, 0), about 1.6 km from the stored
  // point: the true point is outside, the point that would be disclosed is in.
  const aroundSnapped = {
    latitude: 51.55,
    longitude: 0,
    hideRadiusMeters: 500 as const
  }
  const elsewhere = {
    latitude: 40.7,
    longitude: -74,
    hideRadiusMeters: 1000 as const
  }

  it.each([
    ['exact', 'around the stored point', aroundStored, false],
    ['area', 'around the stored point', aroundStored, false],
    ['country', 'around the stored point', aroundStored, false],
    [null, 'around the stored point', aroundStored, false],
    ['area', 'around the snapped point only', aroundSnapped, false],
    ['exact', 'around the snapped point only', aroundSnapped, true],
    ['country', 'around the snapped point only', aroundSnapped, true],
    ['exact', 'elsewhere', elsewhere, true],
    ['area', 'elsewhere', elsewhere, true]
  ] as const)(
    '%s precision with a zone %s discloses a place: %s',
    (precision, _, zone, disclosed) => {
      const result = getPublicPlace(
        { ...EMPTY_MEDIA_DETAILS, ...stored, placePrecision: precision },
        { hiddenLocations: [zone], hideThreatenedPlaces: true }
      )

      if (disclosed) expect(result).not.toBeNull()
      else expect(result).toBeNull()
    }
  )

  it('withholds a name-only place whose stored point is in a zone', () => {
    expect(
      getPublicPlace(
        { ...EMPTY_MEDIA_DETAILS, ...stored, placePrecision: 'country' },
        { hiddenLocations: [aroundStored], hideThreatenedPlaces: true }
      )
    ).toBeNull()
  })

  it('keeps a name with no coordinates, which no zone can contain', () => {
    expect(
      getPublicPlace(
        {
          ...EMPTY_MEDIA_DETAILS,
          placeName: 'Somewhere',
          placePrecision: 'country'
        },
        { hiddenLocations: [aroundStored], hideThreatenedPlaces: true }
      )
    ).toEqual({ name: 'Somewhere', precision: 'country', countryCode: null })
  })
})

describe('buildPublicMediaDetails', () => {
  const details = {
    subjectName: 'Common Kingfisher',
    subjectScientificName: 'Alcedo atthis',
    subjectCategory: 'bird' as const,
    takenAt: Date.UTC(2024, 4, 6, 7, 8, 9),
    cameraGearId: 'cam',
    lensGearId: 'lens',
    exposure: { iso: 800, aperture: 5.6 },
    placeName: 'Lea Valley',
    placeLatitude: 51.5543,
    placeLongitude: -0.0231,
    placePrecision: 'area' as const,
    inGallery: true,
    // Cleared by a lookup: Least Concern.
    subjectLookupStatus: 'resolved' as const,
    subjectIucnCategory: 'LC' as const
  }
  const names = { cam: 'Canon EOS R5', lens: 'RF100-500mm' }

  it('returns subject, date, gear, exposure and a rounded place when gear is shown', async () => {
    expect(
      await buildPublicMediaDetails({
        database: database(names),
        media: mediaWith(details),
        settings: {
          showGear: true,
          hiddenLocations: [],
          hideThreatenedPlaces: true
        }
      })
    ).toEqual({
      subject: {
        name: 'Common Kingfisher',
        scientificName: 'Alcedo atthis',
        category: 'bird',
        taxonKey: null,
        taxonPath: null
      },
      takenAt: '2024-05-06T07:08:09.000Z',
      camera: { name: 'Canon EOS R5' },
      lens: { name: 'RF100-500mm' },
      exposure: {
        focalLengthMm: null,
        aperture: 5.6,
        exposureTime: null,
        iso: 800
      },
      place: {
        name: 'Lea Valley',
        precision: 'area',
        latitude: 51.55,
        longitude: 0,
        countryCode: null
      }
    })
  })

  it('withholds gear and exposure, and does not even look gear up, when the owner hides gear', async () => {
    const db = database(names)

    const result = await buildPublicMediaDetails({
      database: db,
      media: mediaWith(details),
      settings: {
        showGear: false,
        hiddenLocations: [],
        hideThreatenedPlaces: true
      }
    })

    expect(result.camera).toBeNull()
    expect(result.lens).toBeNull()
    expect(result.exposure).toBeNull()
    expect(result.subject).not.toBeNull()
    expect(db.getGalleryGearNamesByIds).not.toHaveBeenCalled()
  })

  it('never exposes ids, the stored coordinates or the gallery flag', async () => {
    const result = await buildPublicMediaDetails({
      database: database(names),
      media: mediaWith(details),
      settings: {
        showGear: true,
        hiddenLocations: [],
        hideThreatenedPlaces: true
      }
    })

    const json = JSON.stringify(result)
    expect(json).not.toContain('cam"')
    expect(json).not.toContain('51.5543')
    expect(json).not.toContain('-0.0231')
    expect(json).not.toContain('inGallery')
  })

  it('treats gear that has since been deleted as no gear', async () => {
    const result = await buildPublicMediaDetails({
      database: database({}),
      media: mediaWith(details),
      settings: {
        showGear: true,
        hiddenLocations: [],
        hideThreatenedPlaces: true
      }
    })

    expect(result.camera).toBeNull()
    expect(result.lens).toBeNull()
  })

  it('is all null for a media with no details', async () => {
    expect(
      await buildPublicMediaDetails({
        database: database(),
        media: { ...mediaWith({}), details: undefined },
        settings: {
          showGear: true,
          hiddenLocations: [],
          hideThreatenedPlaces: true
        }
      })
    ).toEqual({
      subject: null,
      takenAt: null,
      camera: null,
      lens: null,
      exposure: null,
      place: null
    })
  })

  it('returns no place inside one of the owner hidden locations', async () => {
    const result = await buildPublicMediaDetails({
      database: database(names),
      media: mediaWith({ ...details, placePrecision: 'exact' }),
      settings: {
        showGear: true,
        hiddenLocations: [
          { latitude: 51.5543, longitude: -0.0231, hideRadiusMeters: 100 }
        ],
        hideThreatenedPlaces: true
      }
    })

    expect(result.place).toBeNull()
    expect(result.subject).not.toBeNull()
  })

  it('returns no place for a hidden one', async () => {
    const result = await buildPublicMediaDetails({
      database: database(),
      media: mediaWith({ ...details, placePrecision: 'hidden' }),
      settings: {
        showGear: true,
        hiddenLocations: [],
        hideThreatenedPlaces: true
      }
    })

    expect(result.place).toBeNull()
  })
})

describe('getPublicPlace and threatened species', () => {
  const placed = {
    placeName: 'Pak Chong, Thailand',
    placeLatitude: 14.4,
    placeLongitude: 101.4,
    placeCountryCode: 'TH'
  }
  const speciesLike = {
    subjectName: 'Great Hornbill',
    subjectScientificName: 'Buceros bicornis',
    subjectCategory: 'bird' as const
  }
  const notSpeciesLike = {
    subjectName: 'Sunset',
    subjectScientificName: null,
    subjectCategory: 'landscape' as const
  }

  type Lookup = Pick<
    typeof EMPTY_MEDIA_DETAILS,
    'subjectLookupStatus' | 'subjectIucnCategory'
  >
  // [label, lookup, cleared] — `cleared` is whether the lookup lets a
  // species-like subject's place be shown.
  const lookups: [string, Lookup, boolean][] = [
    [
      'never looked up',
      { subjectLookupStatus: null, subjectIucnCategory: null },
      false
    ],
    [
      'pending',
      { subjectLookupStatus: 'pending', subjectIucnCategory: null },
      false
    ],
    [
      'resolved CR',
      { subjectLookupStatus: 'resolved', subjectIucnCategory: 'CR' },
      false
    ],
    [
      'resolved EN',
      { subjectLookupStatus: 'resolved', subjectIucnCategory: 'EN' },
      false
    ],
    [
      'resolved VU',
      { subjectLookupStatus: 'resolved', subjectIucnCategory: 'VU' },
      false
    ],
    [
      'resolved NT',
      { subjectLookupStatus: 'resolved', subjectIucnCategory: 'NT' },
      true
    ],
    [
      'resolved LC',
      { subjectLookupStatus: 'resolved', subjectIucnCategory: 'LC' },
      true
    ],
    [
      'resolved DD',
      { subjectLookupStatus: 'resolved', subjectIucnCategory: 'DD' },
      true
    ],
    [
      'resolved NE',
      { subjectLookupStatus: 'resolved', subjectIucnCategory: 'NE' },
      true
    ],
    [
      'resolved with no category',
      { subjectLookupStatus: 'resolved', subjectIucnCategory: null },
      false
    ],
    [
      'no-match',
      { subjectLookupStatus: 'no-match', subjectIucnCategory: null },
      true
    ],
    [
      'failed',
      { subjectLookupStatus: 'failed', subjectIucnCategory: null },
      false
    ],
    [
      'disabled',
      { subjectLookupStatus: 'disabled', subjectIucnCategory: null },
      false
    ],
    // A stale category from before a failed retry does not clear the subject.
    [
      'failed with an old LC',
      { subjectLookupStatus: 'failed', subjectIucnCategory: 'LC' },
      false
    ]
  ]
  const precisions = ['exact', 'area', 'country', null] as const

  const cases = lookups.flatMap(([label, lookup, cleared]) =>
    precisions.flatMap((precision) =>
      [true, false].flatMap((hideThreatenedPlaces) =>
        [true, false].map(
          (isSpecies) =>
            [
              label,
              precision,
              hideThreatenedPlaces,
              isSpecies,
              lookup,
              // Shown unless the rule is on, the subject is a species, and the
              // lookup did not clear it.
              !(hideThreatenedPlaces && isSpecies && !cleared)
            ] as const
        )
      )
    )
  )

  it.each(cases)(
    'lookup %s, precision %s, hiding %s, species-like %s',
    (_, precision, hideThreatenedPlaces, isSpecies, lookup, shown) => {
      const result = getPublicPlace(
        {
          ...EMPTY_MEDIA_DETAILS,
          ...placed,
          ...(isSpecies ? speciesLike : notSpeciesLike),
          ...lookup,
          placePrecision: precision
        },
        { hiddenLocations: [], hideThreatenedPlaces }
      )

      if (shown) expect(result).not.toBeNull()
      else expect(result).toBeNull()
    }
  )

  it('withholds a threatened place whatever the precision, even with no coordinates', () => {
    expect(
      getPublicPlace(
        {
          ...EMPTY_MEDIA_DETAILS,
          ...speciesLike,
          placeName: 'Khao Yai',
          placePrecision: 'country',
          subjectLookupStatus: 'resolved',
          subjectIucnCategory: 'VU'
        },
        NO_ZONES
      )
    ).toBeNull()
  })

  it.each([
    ['a GBIF key alone', { subjectTaxonKey: '2480528' }],
    ['a scientific name alone', { subjectScientificName: 'Panthera pardus' }],
    [
      'a common name in a living category',
      { subjectName: 'Leopard', subjectCategory: 'mammal' as const }
    ]
  ])('treats %s as species-like', (_, subject) => {
    expect(
      getPublicPlace(
        {
          ...EMPTY_MEDIA_DETAILS,
          ...placed,
          placePrecision: 'exact',
          ...subject
        },
        NO_ZONES
      )
    ).toBeNull()
  })

  it.each([
    [
      'a landscape',
      { subjectName: 'Doi Inthanon', subjectCategory: 'landscape' as const }
    ],
    ['an other', { subjectName: 'Temple', subjectCategory: 'other' as const }],
    ['a name with no category', { subjectName: 'Thing' }],
    ['no subject', {}]
  ])('does not treat %s as species-like', (_, subject) => {
    expect(
      getPublicPlace(
        {
          ...EMPTY_MEDIA_DETAILS,
          ...placed,
          placePrecision: 'exact',
          ...subject
        },
        NO_ZONES
      )
    ).not.toBeNull()
  })
})

describe('getPublicPlace country names', () => {
  it('names a country place by its code, not the geocoded locality', () => {
    expect(
      getPublicPlace(
        {
          ...EMPTY_MEDIA_DETAILS,
          placeName: 'Pak Chong, Thailand',
          placePrecision: 'country',
          placeLatitude: 14.4,
          placeLongitude: 101.4,
          placeCountryCode: 'TH'
        },
        NO_ZONES
      )
    ).toEqual({ name: 'Thailand', precision: 'country', countryCode: 'TH' })
  })

  it('falls back to the stored name without a code', () => {
    expect(
      getPublicPlace(
        {
          ...EMPTY_MEDIA_DETAILS,
          placeName: 'Thailand',
          placePrecision: 'country'
        },
        NO_ZONES
      )
    ).toEqual({ name: 'Thailand', precision: 'country', countryCode: null })
  })

  it.each([
    ['no code', null],
    ['a code Intl cannot name', 'ZZ'],
    ['a malformed code', 'th']
  ])(
    'never shows a geocoded name for country with %s',
    (_, placeCountryCode) => {
      const place = getPublicPlace(
        {
          ...EMPTY_MEDIA_DETAILS,
          placeName: 'Pak Chong',
          placeNameSource: 'geocoder',
          placePrecision: 'country',
          placeLatitude: 14.4,
          placeLongitude: 101.4,
          placeCountryCode
        },
        NO_ZONES
      )
      expect(place?.name ?? null).toBeNull()
      expect(JSON.stringify(place)).not.toContain('Pak Chong')
    }
  )

  // No precision: the owner never chose to publish the place (an API client
  // set only the point, say). A geocoded name would name their town.
  it.each([
    ['a code', 'TH'],
    ['no code', null]
  ])(
    'shows no place for a geocoded name with no precision and %s',
    (_, placeCountryCode) => {
      expect(
        getPublicPlace(
          {
            ...EMPTY_MEDIA_DETAILS,
            placeName: 'Pak Chong, Thailand',
            placeNameSource: 'geocoder',
            placePrecision: null,
            placeLatitude: 14.4,
            placeLongitude: 101.4,
            placeCountryCode
          },
          NO_ZONES
        )
      ).toBeNull()
    }
  )

  it('keeps the owner’s own name with no precision', () => {
    expect(
      getPublicPlace(
        {
          ...EMPTY_MEDIA_DETAILS,
          placeName: 'Our garden',
          placeNameSource: 'owner',
          placePrecision: null,
          placeLatitude: 14.4,
          placeLongitude: 101.4
        },
        NO_ZONES
      )
    ).toEqual({ name: 'Our garden', precision: null, countryCode: null })
  })

  it('keeps the owner’s own name for country without a code', () => {
    expect(
      getPublicPlace(
        {
          ...EMPTY_MEDIA_DETAILS,
          placeName: 'Thailand',
          placeNameSource: 'owner',
          placePrecision: 'country'
        },
        NO_ZONES
      )
    ).toEqual({ name: 'Thailand', precision: 'country', countryCode: null })
  })

  it('keeps the locality for area and exact, with the code alongside', () => {
    expect(
      getPublicPlace(
        {
          ...EMPTY_MEDIA_DETAILS,
          placeName: 'Pak Chong, Thailand',
          placePrecision: 'area',
          placeLatitude: 14.4123,
          placeLongitude: 101.4123,
          placeCountryCode: 'TH'
        },
        NO_ZONES
      )
    ).toEqual({
      name: 'Pak Chong, Thailand',
      precision: 'area',
      latitude: 14.4,
      longitude: 101.4,
      countryCode: 'TH'
    })
  })

  it('ignores a malformed code', () => {
    expect(
      getPublicPlace(
        {
          ...EMPTY_MEDIA_DETAILS,
          placeName: 'Somewhere',
          placePrecision: 'country',
          placeCountryCode: 'th'
        },
        NO_ZONES
      )
    ).toEqual({ name: 'Somewhere', precision: 'country', countryCode: null })
  })

  it('never discloses a code for a hidden place', () => {
    expect(
      getPublicPlace(
        {
          ...EMPTY_MEDIA_DETAILS,
          placeName: 'Pak Chong, Thailand',
          placePrecision: 'hidden',
          placeCountryCode: 'TH'
        },
        NO_ZONES
      )
    ).toBeNull()
  })
})

describe('countryDisplayName', () => {
  it.each([
    ['TH', 'Thailand'],
    ['GB', 'United Kingdom'],
    ['ZZ', null],
    ['QQ', null],
    ['th', null],
    [null, null]
  ])('%s is %s', (code, name) => {
    expect(countryDisplayName(code)).toBe(name)
  })
})

describe('buildPublicMediaDetails and threatened species', () => {
  const threatened = {
    subjectName: 'Great Hornbill',
    subjectScientificName: 'Buceros bicornis',
    subjectCategory: 'bird' as const,
    subjectTaxonKey: '2481839',
    subjectTaxonPath: ['Animalia', 'Chordata', 'Aves', 'Bucerotiformes'],
    subjectIucnCategory: 'VU' as const,
    subjectLookupStatus: 'resolved' as const,
    subjectLookupAt: Date.UTC(2026, 9, 1),
    subjectSuggestions: {
      model: 'vision-1',
      generatedAt: '2026-10-01T00:00:00.000Z',
      checkedAgainst: 'gbif' as const,
      candidates: [],
      group: 'bird' as const
    },
    placeName: 'Khao Yai',
    placeLatitude: 14.4389,
    placeLongitude: 101.3722,
    placePrecision: 'exact' as const,
    placeCountryCode: 'TH',
    placeNameSource: 'geocoder' as const,
    placeLookupStatus: 'resolved' as const,
    inGallery: true
  }

  it('gives a threatened species no place, but keeps the public species facts', async () => {
    const result = await buildPublicMediaDetails({
      database: database(),
      media: mediaWith(threatened),
      settings: {
        showGear: true,
        hiddenLocations: [],
        hideThreatenedPlaces: true
      }
    })

    expect(result.place).toBeNull()
    expect(result.subject).toEqual({
      name: 'Great Hornbill',
      scientificName: 'Buceros bicornis',
      category: 'bird',
      taxonKey: '2481839',
      taxonPath: ['Animalia', 'Chordata', 'Aves', 'Bucerotiformes']
    })
  })

  it('never sends the IUCN category, lookup statuses, suggestions or the stored point', async () => {
    const json = JSON.stringify(
      await buildPublicMediaDetails({
        database: database(),
        media: mediaWith(threatened),
        settings: {
          showGear: true,
          hiddenLocations: [],
          hideThreatenedPlaces: true
        }
      })
    )

    for (const leak of [
      'VU',
      'iucn',
      'Iucn',
      'lookup',
      'Lookup',
      'uggestion',
      'vision-1',
      'Khao Yai',
      '14.4389',
      '101.3722',
      'TH',
      'geocoder'
    ]) {
      expect(json).not.toContain(leak)
    }
  })

  it('shows the place when the owner turns the rule off', async () => {
    const result = await buildPublicMediaDetails({
      database: database(),
      media: mediaWith(threatened),
      settings: {
        showGear: true,
        hiddenLocations: [],
        hideThreatenedPlaces: false
      }
    })

    expect(result.place).toEqual({
      name: 'Khao Yai',
      precision: 'exact',
      latitude: 14.4389,
      longitude: 101.3722,
      countryCode: 'TH'
    })
  })
})

describe('PUBLIC_PLACE_INPUT_KEYS', () => {
  it('lists every field getPublicPlace reads', () => {
    // Every key is read: changing any one of them away from a shown baseline
    // must be able to change the answer, or it does not belong in the input.
    const baseline = {
      ...EMPTY_MEDIA_DETAILS,
      placeName: 'Pak Chong, Thailand',
      placePrecision: 'exact' as const,
      placeLatitude: 14.4,
      placeLongitude: 101.4,
      placeCountryCode: 'TH'
    }
    expect(getPublicPlace(baseline, NO_ZONES)).not.toBeNull()
    expect([...PUBLIC_PLACE_INPUT_KEYS].sort()).toEqual(
      [
        'placeName',
        'placePrecision',
        'placeLatitude',
        'placeLongitude',
        'placeCountryCode',
        'placeNameSource',
        'subjectName',
        'subjectScientificName',
        'subjectCategory',
        'subjectTaxonKey',
        'subjectIucnCategory',
        'subjectLookupStatus'
      ].sort()
    )
  })
})
