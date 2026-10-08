import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import sharp from 'sharp'

import { MediaStorageType } from '@/lib/config/mediaStorage'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { readMediaExif } from '@/lib/services/medias/exif/readMediaExif'
import { LocalFileStorage } from '@/lib/services/medias/localFile'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { Actor } from '@/lib/types/domain/actor'

// The whole upload path against a real database and a real media root: the
// EXIF has to be read from the ORIGINAL (the stored copy has none), and it has
// to land on the media row, the gear table and the owner's entity.
describe('uploading a photo with EXIF', () => {
  const database = getTestSQLDatabase()
  let tempDir: string
  let actor: Actor

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    actor = (await database.getActorFromId({ id: ACTOR1_ID }))!
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'activities-exif-'))
    await database.updateGallerySettings({
      actorId: ACTOR1_ID,
      galleryDefault: 'subject',
      defaultPlacePrecision: 'area'
    })
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  const storage = () =>
    new LocalFileStorage(
      { type: MediaStorageType.LocalFile, path: tempDir },
      'llun.test',
      database
    )

  const photo = async (withExif = true) => {
    const image = sharp({
      create: { width: 16, height: 16, channels: 3, background: '#a0a0a0' }
    }).jpeg()
    const buffer = await (
      withExif
        ? image.withExif({
            IFD0: { Make: 'Canon', Model: 'Canon EOS R5' },
            IFD2: {
              DateTimeOriginal: '2024:05:06 07:08:09',
              ExposureTime: '1/2000',
              FNumber: '56/10',
              ISOSpeedRatings: '800',
              FocalLength: '500/1',
              LensModel: 'RF100-500mm'
            },
            IFD3: {
              GPSLatitudeRef: 'N',
              GPSLatitude: '51/1 30/1 0/1',
              GPSLongitudeRef: 'W',
              GPSLongitude: '0/1 7/1 30/1'
            }
          })
        : image
    ).toBuffer()
    return new File([new Uint8Array(buffer)], 'bird.jpg', {
      type: 'image/jpeg'
    })
  }

  it('records the date, gear, exposure and place on the media and its owner entity', async () => {
    const entity = await storage().saveFile(
      actor,
      { file: await photo() },
      { withGalleryDetails: true }
    )

    expect(entity?.details).toEqual({
      subject: null,
      takenAt: '2024-05-06T07:08:09.000Z',
      camera: { id: expect.any(String), name: 'Canon EOS R5' },
      lens: { id: expect.any(String), name: 'RF100-500mm' },
      exposure: {
        focalLengthMm: 500,
        aperture: 5.6,
        exposureTime: '1/2000',
        iso: 800
      },
      // The owner gets the exact coordinates; precision only limits others.
      place: {
        name: null,
        latitude: 51.5,
        longitude: -0.125,
        precision: 'area',
        countryCode: null,
        nameSource: null,
        // Queued for its place lookup by the upload; not stale yet.
        lookupStatus: 'pending',
        lookupAt: expect.any(String),
        lookupStale: false
      },
      inGallery: false,
      subjectSuggestions: null
    })

    const stored = await database.getMediaByIdForAccount({
      mediaId: entity!.id,
      accountId: actor.account!.id
    })
    expect(stored?.details).toMatchObject({
      takenAt: Date.UTC(2024, 4, 6, 7, 8, 9),
      cameraGearId: entity!.details!.camera!.id,
      lensGearId: entity!.details!.lens!.id,
      placeLatitude: 51.5,
      placeLongitude: -0.125
    })
  })

  it('does not keep the EXIF in the stored file', async () => {
    const entity = await storage().saveFile(
      actor,
      { file: await photo() },
      { withGalleryDetails: true }
    )
    const stored = await database.getMediaByIdForAccount({
      mediaId: entity!.id,
      accountId: actor.account!.id
    })

    const bytes = await fs.readFile(path.join(tempDir, stored!.original.path))
    const exif = await readMediaExif(bytes)

    expect(exif.latitude).toBeNull()
    expect(exif.make).toBeNull()
    expect(exif.takenAt).toBeNull()
  })

  it('reuses one gear row across uploads from the same camera', async () => {
    const first = await storage().saveFile(
      actor,
      { file: await photo() },
      { withGalleryDetails: true }
    )
    const second = await storage().saveFile(
      actor,
      { file: await photo() },
      { withGalleryDetails: true }
    )

    expect(second!.details!.camera!.id).toBe(first!.details!.camera!.id)
    expect(second!.details!.lens!.id).toBe(first!.details!.lens!.id)
  })

  it('applies the owner’s default place precision', async () => {
    await database.updateGallerySettings({
      actorId: ACTOR1_ID,
      defaultPlacePrecision: 'hidden'
    })

    const entity = await storage().saveFile(
      actor,
      { file: await photo() },
      { withGalleryDetails: true }
    )

    expect(entity!.details!.place!.precision).toBe('hidden')
  })

  it.each([
    ['always', true],
    ['never', false],
    ['subject', false]
  ] as const)(
    'puts the upload in the gallery for the "%s" default: %s',
    async (galleryDefault, inGallery) => {
      await database.updateGallerySettings({
        actorId: ACTOR1_ID,
        galleryDefault
      })

      const entity = await storage().saveFile(
        actor,
        { file: await photo() },
        { withGalleryDetails: true }
      )

      expect(entity!.details!.inGallery).toBe(inGallery)
    }
  )

  it('uploads a photo with no EXIF with empty details', async () => {
    const entity = await storage().saveFile(
      actor,
      { file: await photo(false) },
      { withGalleryDetails: true }
    )

    expect(entity!.details).toEqual({
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

  it('skips gallery details unless the caller opts in', async () => {
    await database.updateGallerySettings({
      actorId: ACTOR1_ID,
      galleryDefault: 'always'
    })
    const gearBefore = await database.getGalleryGearsByActor({
      actorId: ACTOR1_ID
    })

    const entity = await storage().saveFile(actor, { file: await photo() })

    expect(entity!.details).toMatchObject({
      camera: null,
      lens: null,
      place: null,
      inGallery: false
    })
    const stored = await database.getMediaByIdForAccount({
      mediaId: entity!.id,
      accountId: actor.account!.id
    })
    expect(stored?.details?.inGallery ?? false).toBe(false)
    expect(stored?.details?.placeLatitude ?? null).toBeNull()
    expect(
      await database.getGalleryGearsByActor({ actorId: ACTOR1_ID })
    ).toHaveLength(gearBefore.length)
  })
})
