import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { DatabaseSeed } from '@/lib/stub/scenarios/database'
import { EMPTY_MEDIA_DETAILS } from '@/lib/types/database/gallery'

describe('MediaDatabase details', () => {
  const { actors } = DatabaseSeed
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  describe.each(table)('%s', (_, database) => {
    let accountId: string

    beforeAll(async () => {
      await seedDatabase(database)
      const actor = await database.getActorFromId({ id: actors.primary.id })
      accountId = actor!.account!.id
    })

    afterAll(async () => {
      await database.destroy()
    })

    const createMedia = (
      name: string,
      details?: Parameters<typeof database.createMedia>[0]['details']
    ) =>
      database.createMedia({
        actorId: actors.primary.id,
        original: {
          path: `/test/details-${name}.jpg`,
          bytes: 1000,
          mimeType: 'image/jpeg',
          metaData: { width: 100, height: 100 }
        },
        ...(details ? { details } : {})
      })

    it('gives a media created without details the empty details', async () => {
      const media = await createMedia('empty')

      const stored = await database.getMediaByIdForAccount({
        mediaId: media!.id,
        accountId
      })

      expect(stored?.details).toEqual(EMPTY_MEDIA_DETAILS)
    })

    it('round-trips every details field written at creation', async () => {
      const takenAt = Date.UTC(2024, 4, 6, 7, 8, 9)
      const media = await createMedia('full', {
        subjectName: 'Common Kingfisher',
        subjectScientificName: 'Alcedo atthis',
        subjectCategory: 'bird',
        takenAt,
        cameraGearId: 'camera-1',
        lensGearId: 'lens-1',
        exposure: {
          focalLengthMm: 400,
          aperture: 5.6,
          exposureTime: '1/2000',
          iso: 800
        },
        placeName: 'Lea Valley',
        placeLatitude: 51.55,
        placeLongitude: -0.02,
        placePrecision: 'area',
        inGallery: true
      })

      const stored = await database.getMediaByIdForAccount({
        mediaId: media!.id,
        accountId
      })

      expect(stored?.details).toEqual({
        subjectName: 'Common Kingfisher',
        subjectScientificName: 'Alcedo atthis',
        subjectCategory: 'bird',
        takenAt,
        cameraGearId: 'camera-1',
        lensGearId: 'lens-1',
        exposure: {
          focalLengthMm: 400,
          aperture: 5.6,
          exposureTime: '1/2000',
          iso: 800
        },
        placeName: 'Lea Valley',
        placeLatitude: 51.55,
        placeLongitude: -0.02,
        placePrecision: 'area',
        inGallery: true
      })
    })

    it('updates only the details keys that are present', async () => {
      const media = await createMedia('partial', {
        subjectName: 'Grey Heron',
        placeName: 'Marsh',
        inGallery: true
      })

      const result = await database.updateMedia({
        mediaId: media!.id,
        accountId,
        details: { subjectScientificName: 'Ardea cinerea' }
      })

      expect(result?.media.details).toMatchObject({
        subjectName: 'Grey Heron',
        subjectScientificName: 'Ardea cinerea',
        placeName: 'Marsh',
        inGallery: true
      })
    })

    it('clears a details column when its key is null', async () => {
      const media = await createMedia('clear', {
        subjectName: 'Red Fox',
        exposure: { iso: 100 },
        takenAt: Date.UTC(2024, 0, 1),
        placeLatitude: 1,
        placeLongitude: 2
      })

      const result = await database.updateMedia({
        mediaId: media!.id,
        accountId,
        details: {
          subjectName: null,
          exposure: null,
          takenAt: null,
          placeLatitude: null,
          placeLongitude: null
        }
      })

      expect(result?.media.details).toMatchObject({
        subjectName: null,
        exposure: null,
        takenAt: null,
        placeLatitude: null,
        placeLongitude: null
      })
    })

    it('flips inGallery both ways', async () => {
      const media = await createMedia('gallery')

      const on = await database.updateMedia({
        mediaId: media!.id,
        accountId,
        details: { inGallery: true }
      })
      const off = await database.updateMedia({
        mediaId: media!.id,
        accountId,
        details: { inGallery: false }
      })

      expect(on?.media.details?.inGallery).toBeTrue()
      expect(off?.media.details?.inGallery).toBeFalse()
    })

    it('leaves the details alone on a description-only update', async () => {
      const media = await createMedia('description', {
        subjectName: 'Otter'
      })

      const result = await database.updateMedia({
        mediaId: media!.id,
        accountId,
        description: 'An otter'
      })

      expect(result?.media.details?.subjectName).toBe('Otter')
    })

    describe('getMediaWithAttachedStatusIds', () => {
      it('returns the media with every status it is attached to', async () => {
        const media = await createMedia('attached')
        const statuses = await database.getActorStatuses({
          actorId: actors.primary.id,
          limit: 2
        })
        expect(statuses.length).toBeGreaterThanOrEqual(2)
        for (const status of statuses) {
          await database.createAttachment({
            actorId: actors.primary.id,
            statusId: status.id,
            mediaType: 'image/jpeg',
            url: media!.original.path,
            mediaId: media!.id
          })
        }

        const found = await database.getMediaWithAttachedStatusIds({
          mediaId: media!.id
        })

        expect(found?.media.id).toBe(media!.id)
        expect(found?.statusIds.toSorted()).toEqual(
          statuses.map((status) => status.id).toSorted()
        )
      })

      it('ignores an attachment written by an actor that does not own the media', async () => {
        const media = await createMedia('foreign-attachment')
        const [status] = await database.getActorStatuses({
          actorId: actors.replyAuthor.id,
          limit: 1
        })
        expect(status).toBeDefined()
        await database.createAttachment({
          actorId: actors.replyAuthor.id,
          statusId: status.id,
          mediaType: 'image/jpeg',
          url: 'x',
          mediaId: media!.id
        })

        expect(
          await database.getMediaWithAttachedStatusIds({ mediaId: media!.id })
        ).toMatchObject({ statusIds: [] })
      })

      it('returns no statuses for an unattached media', async () => {
        const media = await createMedia('unattached')

        expect(
          await database.getMediaWithAttachedStatusIds({ mediaId: media!.id })
        ).toMatchObject({ statusIds: [] })
      })

      it.each(['999999999', 'abc', '', '1e3', '2147483648'])(
        'returns null for %j',
        async (mediaId) => {
          expect(
            await database.getMediaWithAttachedStatusIds({ mediaId })
          ).toBeNull()
        }
      )
    })
  })
})
