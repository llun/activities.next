import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import {
  buildCameraGearSeed,
  buildLensGearSeed,
  getCameraGearKey,
  getLensGearKey,
  resolveGalleryGear,
  resolveGalleryGearFromExif
} from '@/lib/services/gallery/galleryGear'
import { MAX_GALLERY_GEAR_PER_ACTOR } from '@/lib/services/gallery/galleryRequests'
import { seedDatabase } from '@/lib/stub/database'
import { DatabaseSeed } from '@/lib/stub/scenarios/database'

describe('gallery gear identity', () => {
  describe('getCameraGearKey', () => {
    it.each([
      ['Canon', 'Canon EOS R5', 'camera:canon|canon eos r5'],
      ['  CANON ', 'canon   eos  r5', 'camera:canon|canon eos r5'],
      [null, 'iPhone 15 Pro', 'camera:|iphone 15 pro'],
      ['Apple', '', null],
      ['Apple', null, null],
      [null, null, null]
    ])('keys %j / %j as %j', (make, model, expected) => {
      expect(getCameraGearKey(make, model)).toBe(expected)
    })

    it('caps the key to the column width', () => {
      expect(getCameraGearKey('Make', 'x'.repeat(400))?.length).toBe(255)
    })
  })

  describe('getLensGearKey', () => {
    it.each([
      ['RF100-500mm F4.5-7.1 L IS USM', 'lens:rf100-500mm f4.5-7.1 l is usm'],
      ['  EF 50mm  f/1.8 ', 'lens:ef 50mm f/1.8'],
      ['', null],
      ['   ', null],
      [null, null]
    ])('keys %j as %j', (lensModel, expected) => {
      expect(getLensGearKey(lensModel)).toBe(expected)
    })
  })

  describe('buildCameraGearSeed', () => {
    it.each([
      // The maker is not repeated when the model already starts with it.
      [
        'Canon',
        'Canon EOS R5',
        { name: 'Canon EOS R5', brand: 'Canon', model: 'EOS R5' }
      ],
      [
        'NIKON CORPORATION',
        'NIKON Z 9',
        { name: 'NIKON Z 9', brand: 'Nikon', model: 'Z 9' }
      ],
      [
        'SONY',
        'ILCE-7M4',
        { name: 'Sony ILCE-7M4', brand: 'Sony', model: 'ILCE-7M4' }
      ],
      ['DJI', 'FC3582', { name: 'DJI FC3582', brand: 'DJI', model: 'FC3582' }],
      [null, 'Pixel 8', { name: 'Pixel 8', brand: null, model: 'Pixel 8' }]
    ])('names %j / %j', (make, model, expected) => {
      expect(buildCameraGearSeed(make, model)).toMatchObject(expected)
    })

    it('has no seed without a model', () => {
      expect(buildCameraGearSeed('Canon', null)).toBeNull()
    })
  })

  describe('buildLensGearSeed', () => {
    it('names the lens after its model', () => {
      expect(buildLensGearSeed('EF 50mm f/1.8')).toEqual({
        deviceKey: 'lens:ef 50mm f/1.8',
        name: 'EF 50mm f/1.8',
        brand: null,
        model: 'EF 50mm f/1.8'
      })
    })

    it('has no seed without a lens model', () => {
      expect(buildLensGearSeed(null)).toBeNull()
    })
  })
})

describe('resolveGalleryGear', () => {
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

    it('creates the row once and resolves every later upload to it', async () => {
      const seed = buildCameraGearSeed('Canon', 'Canon EOS R5')

      const first = await resolveGalleryGear({
        database,
        actorId: actors.primary.id,
        kind: 'camera',
        seed
      })
      const second = await resolveGalleryGear({
        database,
        actorId: actors.primary.id,
        kind: 'camera',
        seed
      })

      expect(first).not.toBeNull()
      expect(second).toEqual(first)
      const gears = await database.getGalleryGearsByActor({
        actorId: actors.primary.id
      })
      expect(gears.filter((gear) => gear.name === 'Canon EOS R5')).toHaveLength(
        1
      )
    })

    it('never mutates an existing row, whatever the seed says', async () => {
      const seed = buildLensGearSeed('RF 24-70mm F2.8')
      const created = await resolveGalleryGear({
        database,
        actorId: actors.replyAuthor.id,
        kind: 'lens',
        seed
      })
      const before = await database.getGalleryGear({
        id: created!.id,
        actorId: actors.replyAuthor.id
      })

      await resolveGalleryGear({
        database,
        actorId: actors.replyAuthor.id,
        kind: 'lens',
        seed: { ...seed!, name: 'Renamed by a later upload' }
      })

      expect(
        await database.getGalleryGear({
          id: created!.id,
          actorId: actors.replyAuthor.id
        })
      ).toEqual(before)
    })

    it('keeps each actor’s gear separate', async () => {
      const seed = buildLensGearSeed('Shared lens model')

      const mine = await resolveGalleryGear({
        database,
        actorId: actors.primary.id,
        kind: 'lens',
        seed
      })
      const theirs = await resolveGalleryGear({
        database,
        actorId: actors.pollAuthor.id,
        kind: 'lens',
        seed
      })

      expect(mine!.id).not.toBe(theirs!.id)
    })

    it('resolves to null without a seed', async () => {
      expect(
        await resolveGalleryGear({
          database,
          actorId: actors.primary.id,
          kind: 'camera',
          seed: null
        })
      ).toBeNull()
    })

    it('resolves a camera and a lens from EXIF together', async () => {
      const resolved = await resolveGalleryGearFromExif({
        database,
        actorId: actors.extra.id,
        exif: {
          make: 'FUJIFILM',
          model: 'X-T5',
          lensModel: 'XF16-55mmF2.8 R LM WR'
        }
      })

      expect(resolved.cameraGearId).toBeString()
      expect(resolved.lensGearId).toBeString()
      expect(
        await database.getGalleryGearNamesByIds({
          ids: [resolved.cameraGearId!, resolved.lensGearId!]
        })
      ).toEqual({
        [resolved.cameraGearId!]: 'Fujifilm X-T5',
        [resolved.lensGearId!]: 'XF16-55mmF2.8 R LM WR'
      })
    })

    it('creates no gear past the per-actor cap and links none', async () => {
      const actorId = actors.empty.id
      const existing = await database.getGalleryGearsByActor({ actorId })
      for (
        let index = existing.length;
        index < MAX_GALLERY_GEAR_PER_ACTOR;
        index += 1
      ) {
        await database.createGalleryGear({
          actorId,
          kind: 'lens',
          name: `Lens ${index}`,
          deviceKey: `lens:cap-${index}`
        })
      }

      const resolved = await resolveGalleryGearFromExif({
        database,
        actorId,
        exif: { make: 'Canon', model: 'Forged Model', lensModel: 'Forged Lens' }
      })

      expect(resolved).toEqual({ cameraGearId: null, lensGearId: null })
      expect(await database.getGalleryGearsByActor({ actorId })).toHaveLength(
        MAX_GALLERY_GEAR_PER_ACTOR
      )
      // Gear already held still resolves at the cap.
      expect(
        (
          await resolveGalleryGear({
            database,
            actorId,
            kind: 'lens',
            seed: buildLensGearSeed('cap-0')
          })
        )?.id
      ).toBeString()
    })

    it('serialises concurrent creates of one device into one row', async () => {
      const seed = buildCameraGearSeed('Nikon', 'Z 9 concurrent')
      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          resolveGalleryGear({
            database,
            actorId: actors.extra.id,
            kind: 'camera',
            seed
          })
        )
      )

      expect(new Set(results.map((result) => result?.id)).size).toBe(1)
      const gears = await database.getGalleryGearsByActor({
        actorId: actors.extra.id
      })
      expect(
        gears.filter((gear) => gear.deviceKey === seed!.deviceKey)
      ).toHaveLength(1)
    })

    it('resolves to nulls when EXIF names no gear', async () => {
      expect(
        await resolveGalleryGearFromExif({
          database,
          actorId: actors.extra.id,
          exif: { make: null, model: null, lensModel: null }
        })
      ).toEqual({ cameraGearId: null, lensGearId: null })
    })
  })

  describe('failure handling', () => {
    const seed = buildCameraGearSeed('Canon', 'Canon EOS R6')

    it('re-reads the row a racing upload inserted first', async () => {
      const winner = { id: 'winner' }
      const database = {
        findGalleryGearByDeviceKey: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(winner),
        createGalleryGearWithinLimit: vi
          .fn()
          .mockRejectedValue(new Error('unique violation'))
      }

      const resolved = await resolveGalleryGear({
        database: database as never,
        actorId: 'actor',
        kind: 'camera',
        seed
      })

      expect(resolved).toEqual({ id: 'winner' })
    })

    it('returns null when the lookup fails', async () => {
      const database = {
        findGalleryGearByDeviceKey: vi
          .fn()
          .mockRejectedValue(new Error('down')),
        createGalleryGearWithinLimit: vi.fn()
      }

      expect(
        await resolveGalleryGear({
          database: database as never,
          actorId: 'actor',
          kind: 'camera',
          seed
        })
      ).toBeNull()
      expect(database.createGalleryGearWithinLimit).not.toHaveBeenCalled()
    })

    it('returns null when the create fails and nobody else created the row', async () => {
      const database = {
        findGalleryGearByDeviceKey: vi.fn().mockResolvedValue(null),
        createGalleryGearWithinLimit: vi
          .fn()
          .mockRejectedValue(new Error('down'))
      }

      expect(
        await resolveGalleryGear({
          database: database as never,
          actorId: 'actor',
          kind: 'camera',
          seed
        })
      ).toBeNull()
    })
  })
})
