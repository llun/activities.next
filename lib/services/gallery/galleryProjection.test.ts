import type {
  GalleryMapRow,
  GalleryMediaRow
} from '@/lib/database/sql/galleryMedia'
import {
  OWNER_GALLERY_AUDIENCE,
  PUBLIC_GALLERY_AUDIENCE
} from '@/lib/services/gallery/galleryAudience'
import {
  getGalleryGearIdsToResolve,
  toGalleryItemEntity,
  toGalleryMapPoint,
  toGalleryProjectionViewer
} from '@/lib/services/gallery/galleryProjection'
import {
  DEFAULT_GALLERY_SETTINGS,
  EMPTY_MEDIA_DETAILS,
  GalleryHiddenLocation,
  MediaDetailsRecord,
  MediaPlacePrecision
} from '@/lib/types/database/gallery'

const STORED = { latitude: 51.5543, longitude: -0.0231 }
// The `area` cell centre of STORED.
const SNAPPED = { latitude: 51.55, longitude: 0 }

const zoneAroundStored: GalleryHiddenLocation = {
  ...STORED,
  hideRadiusMeters: 200
}
// About 1.6 km from STORED: the stored point is outside, the snapped one in.
const zoneAroundSnappedOnly: GalleryHiddenLocation = {
  ...SNAPPED,
  hideRadiusMeters: 500
}

const mediaRow = (
  details: Partial<MediaDetailsRecord> = {}
): GalleryMediaRow => ({
  media: {
    id: '42',
    actorId: 'https://test.llun.dev/users/owner',
    original: {
      path: 'a.jpg',
      bytes: 1,
      mimeType: 'image/jpeg',
      metaData: { width: 1, height: 1 }
    },
    details: { ...EMPTY_MEDIA_DETAILS, inGallery: true, ...details }
  },
  attachment: {
    id: 'attachment-1',
    actorId: 'https://test.llun.dev/users/owner',
    statusId: 'https://test.llun.dev/users/owner/statuses/1',
    type: 'Document',
    mediaType: 'image/jpeg',
    url: 'https://test.llun.dev/a.jpg',
    name: 'alt',
    createdAt: 1,
    updatedAt: 1
  },
  statusId: 'https://test.llun.dev/users/owner/statuses/1',
  statusPublicId: 'public-status-id'
})

const mapRow = (overrides: Partial<GalleryMapRow> = {}): GalleryMapRow => ({
  id: '42',
  ...STORED,
  placePrecision: 'area',
  placeName: 'Lea Valley',
  subjectName: 'Common Kingfisher',
  takenAt: Date.UTC(2024, 4, 6),
  thumbnailUrl: 'https://test.llun.dev/a-thumb.jpg',
  statusId: 'https://test.llun.dev/users/owner/statuses/1',
  statusPublicId: null,
  ...overrides
})

const settingsWith = (
  overrides: Partial<typeof DEFAULT_GALLERY_SETTINGS> = {}
) => ({ ...DEFAULT_GALLERY_SETTINGS, ...overrides })

describe('toGalleryProjectionViewer', () => {
  it('projects for the owner only for the owner audience', () => {
    expect(toGalleryProjectionViewer(OWNER_GALLERY_AUDIENCE)).toBe('owner')
    expect(toGalleryProjectionViewer(PUBLIC_GALLERY_AUDIENCE)).toBe('public')
    expect(
      toGalleryProjectionViewer({
        kind: 'viewer',
        publicOnly: false,
        visibleToActorId: 'someone',
        includeFollowersOnly: true,
        followersAudience: null
      })
    ).toBe('public')
  })
})

describe('toGalleryItemEntity place', () => {
  type Zone = 'none' | 'stored' | 'snapped-only'
  const zones: Record<Zone, GalleryHiddenLocation[]> = {
    none: [],
    stored: [zoneAroundStored],
    'snapped-only': [zoneAroundSnappedOnly]
  }
  const name = 'Lea Valley'

  // [precision, viewer, zone, expected place]
  const cases: Array<
    [MediaPlacePrecision | null, 'owner' | 'public', Zone, unknown]
  > = []
  const precisions: Array<MediaPlacePrecision | null> = [
    'hidden',
    'country',
    'area',
    'exact',
    null
  ]
  for (const precision of precisions) {
    for (const zone of ['none', 'stored', 'snapped-only'] as Zone[]) {
      // The owner always sees the stored place, whatever the zones.
      cases.push([precision, 'owner', zone, { name, precision, ...STORED }])

      let expected: unknown
      if (precision === 'hidden' || zone === 'stored') {
        expected = null
      } else if (precision === 'area') {
        expected =
          zone === 'snapped-only' ? null : { name, precision, ...SNAPPED }
      } else if (precision === 'exact') {
        expected = { name, precision, ...STORED }
      } else {
        expected = { name, precision }
      }
      cases.push([precision, 'public', zone, expected])
    }
  }

  it.each(cases)(
    '%s precision for the %s with zone %s',
    (precision, viewer, zone, expected) => {
      const item = toGalleryItemEntity(
        mediaRow({
          placeName: name,
          placePrecision: precision,
          placeLatitude: STORED.latitude,
          placeLongitude: STORED.longitude
        }),
        {
          viewer,
          settings: settingsWith({ hiddenLocations: zones[zone] }),
          gearNames: {}
        }
      )

      expect(item.place).toEqual(expected)
    }
  )

  it('gives the owner no place when nothing is stored', () => {
    const item = toGalleryItemEntity(mediaRow(), {
      viewer: 'owner',
      settings: settingsWith(),
      gearNames: {}
    })

    expect(item.place).toBeNull()
  })
})

describe('toGalleryItemEntity gear and identity', () => {
  const row = mediaRow({
    subjectName: 'Common Kingfisher',
    subjectScientificName: 'Alcedo atthis',
    subjectCategory: 'bird',
    takenAt: Date.UTC(2024, 4, 6, 7, 8, 9),
    cameraGearId: 'gear-camera-1',
    lensGearId: 'gear-lens-1',
    exposure: { iso: 800 }
  })
  const gearNames = {
    'gear-camera-1': 'Canon EOS R5',
    'gear-lens-1': 'RF100-500mm'
  }

  it('gives the owner gear with ids and exposure even when gear is hidden', () => {
    const item = toGalleryItemEntity(row, {
      viewer: 'owner',
      settings: settingsWith({ showGear: false }),
      gearNames
    })

    expect(item.camera).toEqual({ id: 'gear-camera-1', name: 'Canon EOS R5' })
    expect(item.lens).toEqual({ id: 'gear-lens-1', name: 'RF100-500mm' })
    expect(item.exposure).toMatchObject({ iso: 800 })
  })

  it('gives the public gear names without ids when gear is shown', () => {
    const item = toGalleryItemEntity(row, {
      viewer: 'public',
      settings: settingsWith({ showGear: true }),
      gearNames
    })

    expect(item.camera).toEqual({ name: 'Canon EOS R5' })
    expect(item.lens).toEqual({ name: 'RF100-500mm' })
    expect(item.exposure).toMatchObject({ iso: 800 })
    expect(JSON.stringify(item)).not.toContain('gear-camera-1')
    expect(JSON.stringify(item)).not.toContain('gear-lens-1')
  })

  it('gives the public no gear and no exposure when gear is hidden', () => {
    const item = toGalleryItemEntity(row, {
      viewer: 'public',
      settings: settingsWith({ showGear: false }),
      gearNames
    })

    expect(item.camera).toBeNull()
    expect(item.lens).toBeNull()
    expect(item.exposure).toBeNull()
  })

  it('carries the client status id, attachment, subject and date', () => {
    const item = toGalleryItemEntity(row, {
      viewer: 'public',
      settings: settingsWith(),
      gearNames
    })

    expect(item).toMatchObject({
      mediaId: '42',
      statusId: 'public-status-id',
      attachment: { id: 'attachment-1' },
      subject: {
        name: 'Common Kingfisher',
        scientificName: 'Alcedo atthis',
        category: 'bird'
      },
      takenAt: '2024-05-06T07:08:09.000Z'
    })
  })

  it('needs no gear names for the public when gear is hidden', () => {
    expect(
      getGalleryGearIdsToResolve([row], {
        viewer: 'public',
        settings: settingsWith({ showGear: false })
      })
    ).toEqual([])
    expect(
      getGalleryGearIdsToResolve([row], {
        viewer: 'owner',
        settings: settingsWith({ showGear: false })
      }).sort()
    ).toEqual(['gear-camera-1', 'gear-lens-1'])
  })
})

describe('toGalleryMapPoint', () => {
  type Zone = 'none' | 'stored' | 'snapped-only'
  const zones: Record<Zone, GalleryHiddenLocation[]> = {
    none: [],
    stored: [zoneAroundStored],
    'snapped-only': [zoneAroundSnappedOnly]
  }

  it.each([
    ['hidden', 'none', null],
    ['country', 'none', null],
    [null, 'none', null],
    ['area', 'none', SNAPPED],
    ['area', 'stored', null],
    ['area', 'snapped-only', null],
    ['exact', 'none', STORED],
    ['exact', 'stored', null],
    ['exact', 'snapped-only', STORED]
  ] as const)(
    'public point for %s precision with zone %s',
    (precision, zone, expected) => {
      const point = toGalleryMapPoint(mapRow({ placePrecision: precision }), {
        viewer: 'public',
        settings: { hiddenLocations: zones[zone] }
      })

      if (expected === null) {
        expect(point).toBeNull()
      } else {
        expect(point).toMatchObject({ ...expected, precision })
        expect(point).not.toHaveProperty('publicState')
      }
    }
  )

  it.each([
    ['hidden', 'none', 'not-shown'],
    ['country', 'none', 'not-shown'],
    [null, 'none', 'not-shown'],
    ['area', 'none', 'shown-area'],
    ['area', 'stored', 'in-hidden-location'],
    ['area', 'snapped-only', 'in-hidden-location'],
    ['exact', 'none', 'shown-exact'],
    ['exact', 'stored', 'in-hidden-location'],
    ['exact', 'snapped-only', 'shown-exact']
  ] as const)(
    'owner point for %s precision with zone %s is %s at the stored point',
    (precision, zone, publicState) => {
      const point = toGalleryMapPoint(mapRow({ placePrecision: precision }), {
        viewer: 'owner',
        settings: { hiddenLocations: zones[zone] }
      })

      expect(point).toMatchObject({
        ...STORED,
        precision,
        publicState,
        placeName: 'Lea Valley'
      })
    }
  )

  it.each([
    ['exact', 'none', 'not-public-post'],
    ['area', 'stored', 'not-public-post'],
    ['hidden', 'none', 'not-shown']
  ] as const)(
    'marks a %s owner point with zone %s as %s when no public post uses it',
    (precision, zone, publicState) => {
      const point = toGalleryMapPoint(mapRow({ placePrecision: precision }), {
        viewer: 'owner',
        settings: { hiddenLocations: zones[zone] },
        publicMediaIds: new Set()
      })

      expect(point?.publicState).toBe(publicState)
    }
  )

  it('keeps the public state of an owner point a public post uses', () => {
    const row = mapRow({ placePrecision: 'exact' })
    const point = toGalleryMapPoint(row, {
      viewer: 'owner',
      settings: { hiddenLocations: [] },
      publicMediaIds: new Set([row.id])
    })

    expect(point?.publicState).toBe('shown-exact')
  })

  it('emits the client status id', () => {
    const point = toGalleryMapPoint(
      mapRow({ placePrecision: 'exact', statusPublicId: 'public-id' }),
      { viewer: 'public', settings: { hiddenLocations: [] } }
    )

    expect(point?.statusId).toBe('public-id')
    expect(point?.takenAt).toBe('2024-05-06T00:00:00.000Z')
  })
})
