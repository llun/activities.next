import sharp from 'sharp'

import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { getPublicPlace } from '@/lib/services/gallery/publicMediaDetails'
import {
  buildUploadMediaDetails,
  getGallerySettingsOrDefaults,
  toExposure
} from '@/lib/services/gallery/uploadMediaDetails'
import { EMPTY_MEDIA_EXIF } from '@/lib/services/medias/exif/readMediaExif'
import { seedDatabase } from '@/lib/stub/database'
import { DatabaseSeed } from '@/lib/stub/scenarios/database'
import { DEFAULT_GALLERY_SETTINGS } from '@/lib/types/database/gallery'
import type { Media } from '@/lib/types/database/operations'

const createPhoto = (withGps = true) =>
  sharp({
    create: { width: 8, height: 8, channels: 3, background: '#808080' }
  })
    .jpeg()
    .withExif({
      IFD0: { Make: 'Canon', Model: 'Canon EOS R5' },
      IFD2: {
        DateTimeOriginal: '2024:05:06 07:08:09',
        ExposureTime: '1/1000',
        FNumber: '56/10',
        ISOSpeedRatings: '800',
        FocalLength: '500/1',
        LensModel: 'RF100-500mm'
      },
      ...(withGps
        ? {
            IFD3: {
              GPSLatitudeRef: 'N',
              GPSLatitude: '51/1 30/1 0/1',
              GPSLongitudeRef: 'W',
              GPSLongitude: '0/1 7/1 30/1'
            }
          }
        : {})
    })
    .toBuffer()

describe('buildUploadMediaDetails', () => {
  const { actors } = DatabaseSeed
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  describe.each(table)('%s', (_, database) => {
    beforeAll(async () => {
      await seedDatabase(database)
    })

    afterAll(async () => {
      await database.destroy()
    })

    it('reads the date, gear, exposure and place from the original', async () => {
      const details = await buildUploadMediaDetails({
        database,
        actorId: actors.primary.id,
        original: await createPhoto()
      })

      const names = await database.getGalleryGearNamesByIds({
        ids: [details.cameraGearId!, details.lensGearId!]
      })
      expect(names).toEqual({
        [details.cameraGearId!]: 'Canon EOS R5',
        [details.lensGearId!]: 'RF100-500mm'
      })
      expect(details).toMatchObject({
        takenAt: Date.UTC(2024, 4, 6, 7, 8, 9),
        exposure: {
          focalLengthMm: 500,
          aperture: 5.6,
          exposureTime: '1/1000',
          iso: 800
        },
        placeLatitude: 51.5,
        placeLongitude: -0.125,
        // No settings row yet: the default precision applies, and it
        // discloses nothing.
        placePrecision: 'hidden',
        inGallery: false
      })
    })

    it('reuses the gear of an earlier upload from the same camera', async () => {
      const first = await buildUploadMediaDetails({
        database,
        actorId: actors.primary.id,
        original: await createPhoto()
      })
      const second = await buildUploadMediaDetails({
        database,
        actorId: actors.primary.id,
        original: await createPhoto()
      })

      expect(second.cameraGearId).toBe(first.cameraGearId)
      expect(second.lensGearId).toBe(first.lensGearId)
    })

    it('stores no place for a photo without GPS', async () => {
      const details = await buildUploadMediaDetails({
        database,
        actorId: actors.primary.id,
        original: await createPhoto(false)
      })

      expect(details).not.toHaveProperty('placeLatitude')
      expect(details).not.toHaveProperty('placeLongitude')
      expect(details).not.toHaveProperty('placePrecision')
    })

    it('leaves a photo without EXIF at the gallery default', async () => {
      const plain = await sharp({
        create: { width: 8, height: 8, channels: 3, background: '#fff' }
      })
        .jpeg()
        .toBuffer()

      expect(
        await buildUploadMediaDetails({
          database,
          actorId: actors.primary.id,
          original: plain
        })
      ).toEqual({ inGallery: false })
    })

    it.each([
      ['always', true],
      ['never', false],
      ['subject', false]
    ] as const)(
      'applies the "%s" gallery default to a video (inGallery %s)',
      async (galleryDefault, inGallery) => {
        await database.updateGallerySettings({
          actorId: actors.empty.id,
          galleryDefault
        })

        expect(
          await buildUploadMediaDetails({
            database,
            actorId: actors.empty.id,
            original: null
          })
        ).toEqual({ inGallery })
      }
    )

    it('discloses no public coordinates for a GPS upload from an actor with no settings row', async () => {
      expect(
        await getGallerySettingsOrDefaults(database, actors.pollAuthor.id)
      ).toMatchObject({ defaultPlacePrecision: 'hidden' })

      const details = await buildUploadMediaDetails({
        database,
        actorId: actors.pollAuthor.id,
        original: await createPhoto()
      })

      // The coordinates are kept for the owner, but nothing is public.
      expect(details.placeLatitude).toBeCloseTo(51.5, 3)
      expect(details.placePrecision).toBe('hidden')
      expect(getPublicPlace(details as Media['details'])).toBeNull()
    })

    it.each(['hidden', 'country', 'area', 'exact'] as const)(
      'stamps GPS with the owner’s "%s" default precision',
      async (defaultPlacePrecision) => {
        await database.updateGallerySettings({
          actorId: actors.extra.id,
          defaultPlacePrecision
        })

        const details = await buildUploadMediaDetails({
          database,
          actorId: actors.extra.id,
          original: await createPhoto()
        })

        expect(details.placePrecision).toBe(defaultPlacePrecision)
      }
    )
  })

  it('never throws when the database misbehaves', async () => {
    const database = {
      getGallerySettings: vi.fn().mockRejectedValue(new Error('down')),
      findGalleryGearByDeviceKey: vi.fn().mockRejectedValue(new Error('down')),
      createGalleryGearWithinLimit: vi.fn()
    }

    const details = await buildUploadMediaDetails({
      database: database as never,
      actorId: 'actor',
      original: await createPhoto()
    })

    // Settings fall back to their defaults, gear is skipped, EXIF still lands.
    expect(details).toMatchObject({
      inGallery: false,
      takenAt: Date.UTC(2024, 4, 6, 7, 8, 9),
      placePrecision: 'hidden'
    })
    expect(details).not.toHaveProperty('cameraGearId')
  })
})

describe('getGallerySettingsOrDefaults', () => {
  it('falls back to the defaults when the read fails', async () => {
    const database = {
      getGallerySettings: vi.fn().mockRejectedValue(new Error('down'))
    }

    expect(
      await getGallerySettingsOrDefaults(database as never, 'actor')
    ).toEqual(DEFAULT_GALLERY_SETTINGS)
  })
})

describe('toExposure', () => {
  it('keeps only the fields the file carried', () => {
    expect(toExposure({ ...EMPTY_MEDIA_EXIF, iso: 200 })).toEqual({ iso: 200 })
  })

  it('is null when the file carried none', () => {
    expect(toExposure(EMPTY_MEDIA_EXIF)).toBeNull()
  })
})
