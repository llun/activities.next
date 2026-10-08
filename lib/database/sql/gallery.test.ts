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
        // Two rows written in the same millisecond tie on createdAt and fall
        // back to the random id, so the clock is moved between them.
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
        const first = await database.createGalleryGear({
          actorId: actors.empty.id,
          kind: 'camera',
          name: 'First body'
        })
        vi.setSystemTime(new Date('2026-01-01T00:00:01.000Z'))
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

        vi.useRealTimers()
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

    describe('gear edit, retire and delete', () => {
      const createCamera = (name: string, extra: object = {}) =>
        database.createGalleryGear({
          actorId: actors.primary.id,
          kind: 'camera',
          name,
          ...extra
        })

      it('updates only the fields given and never touches kind or deviceKey', async () => {
        const gear = await createCamera('Before', {
          brand: 'Canon',
          model: 'R5',
          productUrl: 'https://canon.test/r5',
          deviceKey: 'camera:update-keeps-key'
        })

        const updated = await database.updateGalleryGear({
          id: gear.id,
          actorId: actors.primary.id,
          name: 'After'
        })

        expect(updated).toMatchObject({
          id: gear.id,
          kind: 'camera',
          name: 'After',
          brand: 'Canon',
          model: 'R5',
          productUrl: 'https://canon.test/r5',
          deviceKey: 'camera:update-keeps-key'
        })
        expect(updated?.updatedAt).toBeGreaterThanOrEqual(gear.updatedAt)
      })

      it('clears an optional field given as null', async () => {
        const gear = await createCamera('Clearable', {
          brand: 'Canon',
          productUrl: 'https://canon.test/'
        })

        const updated = await database.updateGalleryGear({
          id: gear.id,
          actorId: actors.primary.id,
          brand: null,
          productUrl: null
        })

        expect(updated?.name).toBe('Clearable')
        expect(updated?.brand).toBeUndefined()
        expect(updated?.productUrl).toBeUndefined()
      })

      it('answers null for gear that is missing, foreign or deleted', async () => {
        const gear = await createCamera('Not yours')
        const gone = await createCamera('Gone')
        await database.deleteGalleryGear({
          id: gone.id,
          actorId: actors.primary.id
        })

        expect(
          await database.updateGalleryGear({
            id: gear.id,
            actorId: actors.replyAuthor.id,
            name: 'Hijacked'
          })
        ).toBeNull()
        expect(
          await database.updateGalleryGear({
            id: gone.id,
            actorId: actors.primary.id,
            name: 'Zombie'
          })
        ).toBeNull()
        expect(
          await database.getGalleryGear({
            id: gear.id,
            actorId: actors.primary.id
          })
        ).toMatchObject({ name: 'Not yours' })
      })

      it('retires and unretires, and a repeat does not move the date', async () => {
        const gear = await createCamera('Retirable')
        const args = { id: gear.id, actorId: actors.primary.id }

        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(new Date('2026-02-01T00:00:00.000Z'))
        const retired = await database.setGalleryGearRetired({
          ...args,
          retired: true
        })
        vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'))
        const again = await database.setGalleryGearRetired({
          ...args,
          retired: true
        })
        vi.useRealTimers()

        expect(retired?.retiredAt).toBe(Date.UTC(2026, 1, 1))
        expect(again?.retiredAt).toBe(Date.UTC(2026, 1, 1))

        const back = await database.setGalleryGearRetired({
          ...args,
          retired: false
        })
        expect(back?.retiredAt).toBeUndefined()
        // Unretiring gear that is not retired is a successful no-op.
        expect(
          await database.setGalleryGearRetired({ ...args, retired: false })
        ).toMatchObject({ id: gear.id })
      })

      it('answers null when retiring gear that is missing or foreign', async () => {
        const gear = await createCamera('Foreign retire')

        expect(
          await database.setGalleryGearRetired({
            id: gear.id,
            actorId: actors.replyAuthor.id,
            retired: true
          })
        ).toBeNull()
        expect(
          await database.setGalleryGearRetired({
            id: 'missing',
            actorId: actors.primary.id,
            retired: true
          })
        ).toBeNull()
        expect(
          (
            await database.getGalleryGear({
              id: gear.id,
              actorId: actors.primary.id
            })
          )?.retiredAt
        ).toBeUndefined()
      })

      describe('delete', () => {
        const mediaDetails = async (actorId: string, mediaId: string) => {
          const actor = await database.getActorFromId({ id: actorId })
          const stored = await database.getMediaByIdForAccount({
            mediaId,
            accountId: actor!.account!.id
          })
          return stored?.details
        }

        const createMedia = async (
          actorId: string,
          name: string,
          details: Parameters<typeof database.createMedia>[0]['details']
        ) => {
          const media = await database.createMedia({
            actorId,
            original: {
              path: `/test/gear-delete-${name}.jpg`,
              bytes: 1000,
              mimeType: 'image/jpeg',
              metaData: { width: 100, height: 100 }
            },
            details
          })
          return media!.id
        }

        it('removes the gear from every read and answers false the second time', async () => {
          const gear = await createCamera('Doomed')
          const args = { id: gear.id, actorId: actors.primary.id }

          expect(await database.deleteGalleryGear(args)).toBeTrue()
          expect(await database.getGalleryGear(args)).toBeNull()
          expect(
            (
              await database.getGalleryGearsByActor({
                actorId: actors.primary.id
              })
            ).map((row) => row.id)
          ).not.toContain(gear.id)
          expect(
            await database.getGalleryGearNamesByIds({ ids: [gear.id] })
          ).toEqual({})
          expect(await database.deleteGalleryGear(args)).toBeFalse()
        })

        it('does not delete another actor’s gear', async () => {
          const gear = await createCamera('Protected')

          expect(
            await database.deleteGalleryGear({
              id: gear.id,
              actorId: actors.replyAuthor.id
            })
          ).toBeFalse()
          expect(
            await database.getGalleryGear({
              id: gear.id,
              actorId: actors.primary.id
            })
          ).not.toBeNull()
        })

        it('releases the device key so the same camera can be created again', async () => {
          const key = 'camera:released-on-delete'
          const first = await createCamera('Keyed first', { deviceKey: key })

          await database.deleteGalleryGear({
            id: first.id,
            actorId: actors.primary.id
          })

          expect(
            await database.findGalleryGearByDeviceKey({
              actorId: actors.primary.id,
              deviceKey: key
            })
          ).toBeNull()
          const second = await createCamera('Keyed second', { deviceKey: key })
          expect(second.id).not.toBe(first.id)
          expect(
            await database.findGalleryGearByDeviceKey({
              actorId: actors.primary.id,
              deviceKey: key
            })
          ).toMatchObject({ id: second.id })
        })

        it('nulls the camera and lens references of that actor’s media only', async () => {
          const camera = await createCamera('Referenced camera')
          const lens = await database.createGalleryGear({
            actorId: actors.primary.id,
            kind: 'lens',
            name: 'Referenced lens'
          })
          const kept = await createMedia(actors.primary.id, 'kept', {
            cameraGearId: 'another-camera',
            lensGearId: 'another-lens'
          })
          const both = await createMedia(actors.primary.id, 'both', {
            cameraGearId: camera.id,
            lensGearId: lens.id
          })
          const lensOnly = await createMedia(actors.primary.id, 'lens-only', {
            lensGearId: camera.id
          })
          // A stale reference on somebody else's media is not this actor's to
          // rewrite.
          const foreign = await createMedia(actors.replyAuthor.id, 'foreign', {
            cameraGearId: camera.id
          })

          await database.deleteGalleryGear({
            id: camera.id,
            actorId: actors.primary.id
          })

          expect(await mediaDetails(actors.primary.id, both)).toMatchObject({
            cameraGearId: null,
            lensGearId: lens.id
          })
          expect(await mediaDetails(actors.primary.id, lensOnly)).toMatchObject(
            { lensGearId: null }
          )
          expect(await mediaDetails(actors.primary.id, kept)).toMatchObject({
            cameraGearId: 'another-camera',
            lensGearId: 'another-lens'
          })
          expect(
            await mediaDetails(actors.replyAuthor.id, foreign)
          ).toMatchObject({ cameraGearId: camera.id })
        })
      })
    })

    describe('settings', () => {
      it('returns the defaults for an actor with no row', async () => {
        // An actor no other test in this file writes settings for: the seeded
        // database is shared, so under a shuffled order a write to a shared
        // actor could land first.
        expect(
          await database.getGallerySettings({ actorId: actors.pollAuthor.id })
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
          hiddenLocations: [
            { latitude: 51.5, longitude: -0.1, hideRadiusMeters: 200 }
          ]
        })

        expect(next).toEqual({
          ...DEFAULT_GALLERY_SETTINGS,
          autoDescribe: false,
          galleryDefault: 'always',
          lifeListPublic: true,
          hiddenLocations: [
            { latitude: 51.5, longitude: -0.1, hideRadiusMeters: 200 }
          ]
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
        // The column defaults: the threatened-species rule starts on.
        expect(saved).toMatchObject({
          hideThreatenedPlaces: true,
          subjectSuggestionMode: 'model',
          subjectConfidenceThreshold: 70
        })
      })

      it('round-trips the subject and threatened-species settings', async () => {
        const saved = await database.updateGallerySettings({
          actorId: actors.followRequester.id,
          hideThreatenedPlaces: false,
          subjectSuggestionMode: 'off',
          subjectConfidenceThreshold: 85
        })

        expect(saved).toEqual({
          ...DEFAULT_GALLERY_SETTINGS,
          hideThreatenedPlaces: false,
          subjectSuggestionMode: 'off',
          subjectConfidenceThreshold: 85
        })
        expect(
          await database.getGallerySettings({
            actorId: actors.followRequester.id
          })
        ).toEqual(saved)

        const back = await database.updateGallerySettings({
          actorId: actors.followRequester.id,
          hideThreatenedPlaces: true
        })
        expect(back.hideThreatenedPlaces).toBeTrue()
        expect(back.subjectConfidenceThreshold).toBe(85)
      })

      it('reads an out-of-range threshold back as the default', async () => {
        const saved = await database.updateGallerySettings({
          actorId: actors.followRequester.id,
          subjectConfidenceThreshold: 72
        })

        expect(saved.subjectConfidenceThreshold).toBe(70)
      })
    })
  })
})
