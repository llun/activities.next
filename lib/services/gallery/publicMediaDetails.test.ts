import {
  AREA_PRECISION_DEGREES,
  buildPublicMediaDetails,
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
        longitude: -0.0231
      }
    ],
    [
      'area snaps to the 0.05 degree grid',
      { ...place, placePrecision: 'area' as const },
      {
        name: 'Lea Valley',
        precision: 'area',
        latitude: 51.55,
        longitude: 0
      }
    ],
    [
      'country keeps the name and drops the coordinates',
      { ...place, placePrecision: 'country' as const },
      { name: 'Lea Valley', precision: 'country' }
    ],
    [
      'hidden is no place at all',
      { ...place, placePrecision: 'hidden' as const },
      null
    ],
    [
      'no precision keeps the name and drops the coordinates',
      { ...place, placePrecision: null },
      { name: 'Lea Valley', precision: null }
    ],
    [
      'a name with no coordinates stays a name',
      {
        placeName: 'Somewhere',
        placePrecision: 'exact' as const,
        placeLatitude: null,
        placeLongitude: null
      },
      { name: 'Somewhere', precision: 'exact' }
    ],
    ['nothing stored is no place', {}, null]
  ])('%s', (_, details, expected) => {
    expect(getPublicPlace({ ...EMPTY_MEDIA_DETAILS, ...details })).toEqual(
      expected
    )
  })

  it.each([
    [51.5543, 51.55],
    [51.5751, 51.6],
    [-33.8688, -33.85],
    [0.01, 0],
    [-0.01, 0]
  ])('snaps %d to %d', (value, expected) => {
    const result = getPublicPlace({
      ...EMPTY_MEDIA_DETAILS,
      placePrecision: 'area',
      placeLatitude: value,
      placeLongitude: value
    })

    expect(result?.latitude).toBe(expected)
    // Never negative zero in JSON.
    expect(Object.is(result?.latitude, -0)).toBeFalse()
  })

  it('snaps by no more than half the grid step', () => {
    const result = getPublicPlace({
      ...EMPTY_MEDIA_DETAILS,
      placePrecision: 'area',
      placeLatitude: 48.8584,
      placeLongitude: 2.2945
    })

    expect(Math.abs(result!.latitude! - 48.8584)).toBeLessThanOrEqual(
      AREA_PRECISION_DEGREES / 2 + 1e-9
    )
    expect(Math.abs(result!.longitude! - 2.2945)).toBeLessThanOrEqual(
      AREA_PRECISION_DEGREES / 2 + 1e-9
    )
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
    inGallery: true
  }
  const names = { cam: 'Canon EOS R5', lens: 'RF100-500mm' }

  it('returns subject, date, gear, exposure and a rounded place when gear is shown', async () => {
    expect(
      await buildPublicMediaDetails({
        database: database(names),
        media: mediaWith(details),
        settings: { showGear: true }
      })
    ).toEqual({
      subject: {
        name: 'Common Kingfisher',
        scientificName: 'Alcedo atthis',
        category: 'bird'
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
        longitude: 0
      }
    })
  })

  it('withholds gear and exposure, and does not even look gear up, when the owner hides gear', async () => {
    const db = database(names)

    const result = await buildPublicMediaDetails({
      database: db,
      media: mediaWith(details),
      settings: { showGear: false }
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
      settings: { showGear: true }
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
      settings: { showGear: true }
    })

    expect(result.camera).toBeNull()
    expect(result.lens).toBeNull()
  })

  it('is all null for a media with no details', async () => {
    expect(
      await buildPublicMediaDetails({
        database: database(),
        media: { ...mediaWith({}), details: undefined },
        settings: { showGear: true }
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

  it('returns no place for a hidden one', async () => {
    const result = await buildPublicMediaDetails({
      database: database(),
      media: mediaWith({ ...details, placePrecision: 'hidden' }),
      settings: { showGear: true }
    })

    expect(result.place).toBeNull()
  })
})
