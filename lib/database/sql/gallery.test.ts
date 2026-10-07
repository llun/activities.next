import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { DatabaseSeed } from '@/lib/stub/scenarios/database'
import { DEFAULT_GALLERY_SETTINGS } from '@/lib/types/database/gallery'

describe('GalleryDatabase', () => {
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

    describe('gear', () => {
      it('creates a camera with only the required fields', async () => {
        const gear = await database.createGalleryGear({
          actorId: actors.primary.id,
          kind: 'camera',
          name: 'Required only'
        })

        expect(gear).toMatchObject({
          actorId: actors.primary.id,
          kind: 'camera',
          name: 'Required only'
        })
        expect(gear.brand).toBeUndefined()
        expect(gear.deviceKey).toBeUndefined()
        expect(gear.deletedAt).toBeUndefined()
        expect(gear.createdAt).toBeNumber()
      })

      it('lists only the actor’s own non-deleted gear, oldest first', async () => {
        const first = await database.createGalleryGear({
          actorId: actors.empty.id,
          kind: 'camera',
          name: 'First body'
        })
        const second = await database.createGalleryGear({
          actorId: actors.empty.id,
          kind: 'lens',
          name: 'Second lens'
        })
        await database.createGalleryGear({
          actorId: actors.primary.id,
          kind: 'lens',
          name: 'Somebody else’s lens'
        })

        const gears = await database.getGalleryGearsByActor({
          actorId: actors.empty.id
        })

        expect(gears.map((gear) => gear.id)).toEqual([first.id, second.id])
      })

      it('scopes a single lookup to the owner', async () => {
        const gear = await database.createGalleryGear({
          actorId: actors.primary.id,
          kind: 'lens',
          name: 'Owner scoped'
        })

        expect(
          await database.getGalleryGear({
            id: gear.id,
            actorId: actors.primary.id
          })
        ).toMatchObject({ id: gear.id })
        expect(
          await database.getGalleryGear({
            id: gear.id,
            actorId: actors.replyAuthor.id
          })
        ).toBeNull()
      })

      it('finds gear by its device key, per actor', async () => {
        const gear = await database.createGalleryGear({
          actorId: actors.primary.id,
          kind: 'camera',
          name: 'Keyed',
          deviceKey: 'camera:canon|canon eos r5'
        })

        expect(
          await database.findGalleryGearByDeviceKey({
            actorId: actors.primary.id,
            deviceKey: 'camera:canon|canon eos r5'
          })
        ).toMatchObject({ id: gear.id, deviceKey: 'camera:canon|canon eos r5' })
        expect(
          await database.findGalleryGearByDeviceKey({
            actorId: actors.replyAuthor.id,
            deviceKey: 'camera:canon|canon eos r5'
          })
        ).toBeNull()
      })

      it('rejects a second row with the same device key for one actor', async () => {
        await database.createGalleryGear({
          actorId: actors.primary.id,
          kind: 'lens',
          name: 'Unique key',
          deviceKey: 'lens:unique'
        })

        await expect(
          database.createGalleryGear({
            actorId: actors.primary.id,
            kind: 'lens',
            name: 'Unique key again',
            deviceKey: 'lens:unique'
          })
        ).rejects.toThrow()
      })

      it('allows any number of rows without a device key', async () => {
        await database.createGalleryGear({
          actorId: actors.primary.id,
          kind: 'lens',
          name: 'By hand 1'
        })
        await expect(
          database.createGalleryGear({
            actorId: actors.primary.id,
            kind: 'lens',
            name: 'By hand 2'
          })
        ).resolves.toBeDefined()
      })

      it('maps ids to names in one lookup and ignores unknown ids', async () => {
        const camera = await database.createGalleryGear({
          actorId: actors.primary.id,
          kind: 'camera',
          name: 'Named camera'
        })

        expect(
          await database.getGalleryGearNamesByIds({
            ids: [camera.id, camera.id, 'missing']
          })
        ).toEqual({ [camera.id]: 'Named camera' })
        expect(await database.getGalleryGearNamesByIds({ ids: [] })).toEqual({})
      })
    })

    describe('settings', () => {
      it('returns the defaults for an actor with no row', async () => {
        expect(
          await database.getGallerySettings({ actorId: actors.extra.id })
        ).toEqual(DEFAULT_GALLERY_SETTINGS)
      })

      it('creates the row on first save and leaves omitted settings alone', async () => {
        const saved = await database.updateGallerySettings({
          actorId: actors.extra.id,
          autoDescribe: false,
          galleryDefault: 'always'
        })

        expect(saved).toEqual({
          ...DEFAULT_GALLERY_SETTINGS,
          autoDescribe: false,
          galleryDefault: 'always'
        })

        const next = await database.updateGallerySettings({
          actorId: actors.extra.id,
          lifeListPublic: true,
          hiddenLocations: [{ name: 'Home' }]
        })

        expect(next).toEqual({
          ...DEFAULT_GALLERY_SETTINGS,
          autoDescribe: false,
          galleryDefault: 'always',
          lifeListPublic: true,
          hiddenLocations: [{ name: 'Home' }]
        })
        expect(
          await database.getGallerySettings({ actorId: actors.extra.id })
        ).toEqual(next)
      })

      it('keeps settings per actor', async () => {
        await database.updateGallerySettings({
          actorId: actors.primary.id,
          showGear: false
        })

        expect(
          (await database.getGallerySettings({ actorId: actors.primary.id }))
            .showGear
        ).toBeFalse()
        expect(
          (await database.getGallerySettings({ actorId: actors.empty.id }))
            .showGear
        ).toBeTrue()
      })

      it('saves a no-op update as an existing row with defaults', async () => {
        const saved = await database.updateGallerySettings({
          actorId: actors.replyAuthor.id
        })

        expect(saved).toEqual(DEFAULT_GALLERY_SETTINGS)
      })
    })
  })
})
