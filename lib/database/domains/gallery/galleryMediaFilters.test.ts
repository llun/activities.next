import type { Insertable } from 'kysely'

import { ROUTE_MAP_NAME } from '@/lib/database/domains/gallery/activityPhotos'
import type {
  Attachments,
  FitnessFiles,
  Medias
} from '@/lib/database/kysely/db'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { createSearchActor } from '@/lib/database/testing/searchTestHelpers'
import { ROUTE_MAP_ATTACHMENT_NAME } from '@/lib/services/fitness-files/mapAttachments'
import {
  OWNER_GALLERY_AUDIENCE,
  PUBLIC_GALLERY_AUDIENCE
} from '@/lib/services/gallery/galleryAudience'
import {
  toPlaceKey,
  toSubjectKey
} from '@/lib/services/gallery/galleryEntities'
import { GALLERY_FILTER_NONE } from '@/lib/types/database/gallery'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

const DOMAIN = 'filters.test'

describe('gallery media filters and ordering', () => {
  const testDb = createTestDatabase()
  const { database } = testDb
  const db = () => testDb.db

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
  })

  afterAll(async () => {
    await testDb.destroy()
  })

  let actorCount = 0
  const newActor = async () => {
    actorCount += 1
    const username = `owner${actorCount}`
    const id = `https://${DOMAIN}/users/${username}`
    await createSearchActor(database, { id, username, domain: DOMAIN })
    return id
  }

  let statusCount = 0
  const createPublicNote = async (actorId: string) => {
    statusCount += 1
    const id = `${actorId}/statuses/${statusCount}`
    await database.createNote({
      id,
      url: id,
      actorId,
      text: `Status ${statusCount}`,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    return id
  }

  let mediaCount = 0
  const seedMedia = async (
    actorId: string,
    values: Partial<Insertable<Medias>> = {}
  ): Promise<string> => {
    mediaCount += 1
    const id = mediaCount
    const createdAt = values.createdAt ?? new Date(1000)
    const sortAt = values.sortAt ?? values.takenAt ?? createdAt
    await db()
      .insertInto('medias')
      .values({
        id,
        actorId,
        original: `medias/${id}.jpg`,
        originalBytes: 1000,
        originalMimeType: 'image/jpeg',
        originalMetaData: JSON.stringify({ width: 640, height: 480 }),
        inGallery: true,
        galleryAddedAt: new Date(1000),
        createdAt,
        updatedAt: createdAt,
        sortAt,
        ...values
      })
      .execute()
    return String(id)
  }

  let attachmentCount = 0
  const seedAttachment = async (
    mediaId: string,
    statusId: string,
    actorId: string,
    values: Partial<Insertable<Attachments>> = {}
  ) => {
    attachmentCount += 1
    const id = `attachment-${attachmentCount}`
    await db()
      .insertInto('attachments')
      .values({
        id,
        actorId,
        statusId,
        type: 'Document',
        mediaType: 'image/jpeg',
        url: `https://${DOMAIN}/files/${id}.jpg`,
        width: 640,
        height: 480,
        name: '',
        mediaId: Number(mediaId),
        createdAt: new Date(1000),
        updatedAt: new Date(1000),
        ...values
      })
      .execute()
    return id
  }

  const seedFitnessFile = async (
    id: string,
    actorId: string,
    statusId: string,
    values: Partial<Insertable<FitnessFiles>> = {}
  ) => {
    await db()
      .insertInto('fitness_files')
      .values({
        id,
        actorId,
        statusId,
        path: `fitness/${id}.fit`,
        fileName: `${id}.fit`,
        fileType: 'fit',
        mimeType: 'application/octet-stream',
        bytes: 1000,
        processingStatus: 'completed',
        isPrimary: true,
        deletedAt: null,
        createdAt: new Date(1000),
        updatedAt: new Date(1000),
        ...values
      })
      .execute()
  }

  describe('individual and combined filters', () => {
    it('filters by gearId for camera or lens', async () => {
      const actorId = await newActor()
      const cameraMediaId = await seedMedia(actorId, { cameraGearId: 'cam-1' })
      const lensMediaId = await seedMedia(actorId, { lensGearId: 'lens-1' })
      const otherMediaId = await seedMedia(actorId, { cameraGearId: 'other' })

      const byCam = await database.getGalleryMedia({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        limit: 10,
        gearId: 'cam-1'
      })
      expect(byCam.map((r) => r.media.id)).toEqual([cameraMediaId])

      const byLens = await database.getGalleryMedia({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        limit: 10,
        gearId: 'lens-1'
      })
      expect(byLens.map((r) => r.media.id)).toEqual([lensMediaId])

      const none = await database.getGalleryMedia({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        limit: 10,
        gearId: 'unknown'
      })
      expect(none).toEqual([])
      expect(otherMediaId).toBeDefined()
    })

    it('filters by category alone and combined with other filters', async () => {
      const actorId = await newActor()
      const m1 = await seedMedia(actorId, {
        subjectCategory: 'mammal',
        placeName: 'Paris',
        cameraGearId: 'cam-combo'
      })
      const m2 = await seedMedia(actorId, {
        subjectCategory: 'plant',
        placeName: 'Paris',
        cameraGearId: 'cam-combo'
      })
      const m3 = await seedMedia(actorId, {
        subjectCategory: 'mammal',
        placeName: 'London',
        cameraGearId: 'cam-combo'
      })

      const byCategory = await database.getGalleryMedia({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        limit: 10,
        filters: { category: 'mammal' }
      })
      expect(byCategory.map((r) => r.media.id).sort()).toEqual([m1, m3].sort())

      const combined = await database.getGalleryMedia({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        limit: 10,
        gearId: 'cam-combo',
        filters: {
          category: 'mammal',
          placeKey: toPlaceKey('Paris')
        }
      })
      expect(combined.map((r) => r.media.id)).toEqual([m1])
      expect(m2).toBeDefined()
    })

    it('filters by takenFrom and takenTo alone and combined', async () => {
      const actorId = await newActor()
      const jan = await seedMedia(actorId, {
        sortAt: new Date(Date.UTC(2024, 0, 15))
      })
      const jun = await seedMedia(actorId, {
        sortAt: new Date(Date.UTC(2024, 5, 15))
      })
      const dec = await seedMedia(actorId, {
        sortAt: new Date(Date.UTC(2024, 11, 15))
      })

      const fromJun = await database.getGalleryMedia({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        limit: 10,
        filters: { takenFrom: '2024-06-01' }
      })
      expect(fromJun.map((r) => r.media.id).sort()).toEqual([jun, dec].sort())

      const toJun = await database.getGalleryMedia({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        limit: 10,
        filters: { takenTo: '2024-06-30' }
      })
      expect(toJun.map((r) => r.media.id).sort()).toEqual([jan, jun].sort())

      const exactJun = await database.getGalleryMedia({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        limit: 10,
        filters: {
          takenFrom: '2024-06-01',
          takenTo: '2024-06-30'
        }
      })
      expect(exactJun.map((r) => r.media.id)).toEqual([jun])
    })

    it('filters when all filters are combined together', async () => {
      const actorId = await newActor()
      const statusId = await createPublicNote(actorId)
      await seedFitnessFile('fit-all', actorId, statusId)

      const targetMedia = await seedMedia(actorId, {
        subjectCategory: 'bird',
        subjectName: 'House Sparrow',
        subjectScientificName: 'Passer domesticus',
        placeName: 'London',
        cameraGearId: 'cam-combo-all',
        sortAt: new Date(Date.UTC(2024, 4, 10))
      })
      await seedAttachment(targetMedia, statusId, actorId)

      // Media differing by gear
      const diffGear = await seedMedia(actorId, {
        subjectCategory: 'bird',
        subjectScientificName: 'Passer domesticus',
        placeName: 'London',
        cameraGearId: 'different-cam',
        sortAt: new Date(Date.UTC(2024, 4, 10))
      })
      await seedAttachment(diffGear, statusId, actorId)

      // Media differing by date
      const diffDate = await seedMedia(actorId, {
        subjectCategory: 'bird',
        subjectScientificName: 'Passer domesticus',
        placeName: 'London',
        cameraGearId: 'cam-combo-all',
        sortAt: new Date(Date.UTC(2024, 6, 10))
      })
      await seedAttachment(diffDate, statusId, actorId)

      // Media differing by place
      const diffPlace = await seedMedia(actorId, {
        subjectCategory: 'bird',
        subjectScientificName: 'Passer domesticus',
        placeName: 'Bristol',
        cameraGearId: 'cam-combo-all',
        sortAt: new Date(Date.UTC(2024, 4, 10))
      })
      await seedAttachment(diffPlace, statusId, actorId)

      const combinedResult = await database.getGalleryMedia({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        limit: 10,
        gearId: 'cam-combo-all',
        filters: {
          category: 'bird',
          subjectKey: toSubjectKey({ scientificName: 'Passer domesticus' })!,
          placeKey: toPlaceKey('London'),
          takenFrom: '2024-05-01',
          takenTo: '2024-05-31',
          activityId: 'fit-all'
        }
      })
      expect(combinedResult.map((r) => r.media.id)).toEqual([targetMedia])
    })
  })

  describe('species filtering', () => {
    it('matches scientific vs common name with case, whitespace, and NFC variants', async () => {
      const actorId = await newActor()
      // NFC and case variants of scientific name: 'Ébène' / 'ébène'
      const sci1 = await seedMedia(actorId, {
        subjectName: 'Ebony Wood',
        subjectScientificName: 'Ébène'
      })
      const sci2 = await seedMedia(actorId, {
        subjectName: 'Black Tree',
        subjectScientificName: 'ébène'
      })

      // Common name variants: 'Red  Fox' / 'red fox' with no scientific name
      const name1 = await seedMedia(actorId, {
        subjectName: 'Red  Fox',
        subjectScientificName: null
      })
      const name2 = await seedMedia(actorId, {
        subjectName: 'red fox',
        subjectScientificName: null
      })

      // Another species
      const other = await seedMedia(actorId, {
        subjectName: 'Lion',
        subjectScientificName: 'Panthera leo'
      })

      // Common name match where scientific name is whitespace or empty (testing rawSciWithEmptyNorm)
      const emptySci = await seedMedia(actorId, {
        subjectName: 'Sparrow',
        subjectScientificName: '  '
      })

      const sciKey = toSubjectKey({ scientificName: 'ébène' })!
      const sciRows = await database.getGalleryMedia({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        limit: 10,
        filters: { subjectKey: sciKey }
      })
      expect(sciRows.map((r) => r.media.id).sort()).toEqual([sci1, sci2].sort())

      // NFD variant of scientific name produces the same normalized NFC key
      const nfdSciKey = toSubjectKey({ scientificName: 'E\u0301be\u0300ne' })!
      expect(nfdSciKey).toBe(sciKey)
      const nfdSciRows = await database.getGalleryMedia({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        limit: 10,
        filters: { subjectKey: nfdSciKey }
      })
      expect(nfdSciRows.map((r) => r.media.id).sort()).toEqual(
        [sci1, sci2].sort()
      )

      const nameKey = toSubjectKey({ name: 'Red   Fox' })!
      const nameRows = await database.getGalleryMedia({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        limit: 10,
        filters: { subjectKey: nameKey }
      })
      expect(nameRows.map((r) => r.media.id).sort()).toEqual(
        [name1, name2].sort()
      )

      const sparrowKey = toSubjectKey({ name: 'sparrow' })!
      const sparrowRows = await database.getGalleryMedia({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        limit: 10,
        filters: { subjectKey: sparrowKey }
      })
      expect(sparrowRows.map((r) => r.media.id)).toEqual([emptySci])

      // Scientific name takes precedence: sci2 has name 'Black Tree' but scientificName 'ébène'
      // Querying by common name 'Black Tree' does not return sci2
      const blackTreeKey = toSubjectKey({ name: 'Black Tree' })!
      const blackTreeRows = await database.getGalleryMedia({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        limit: 10,
        filters: { subjectKey: blackTreeKey }
      })
      expect(blackTreeRows).toEqual([])

      const unkKey = 'sci:nonexistent'
      const unkRows = await database.getGalleryMedia({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        limit: 10,
        filters: { subjectKey: unkKey }
      })
      expect(unkRows).toEqual([])
      expect(other).toBeDefined()
    })
  })

  describe('place filtering', () => {
    it('matches place spellings and handles placeKey empty (none)', async () => {
      const actorId = await newActor()
      const p1 = await seedMedia(actorId, { placeName: 'Paris' })
      const p2 = await seedMedia(actorId, { placeName: 'paris' })
      const p3 = await seedMedia(actorId, { placeName: '  Paris  ' })
      const pNull = await seedMedia(actorId, { placeName: null })
      const pBlank = await seedMedia(actorId, { placeName: '   ' })
      const pOther = await seedMedia(actorId, { placeName: 'Berlin' })
      const pMontreal1 = await seedMedia(actorId, { placeName: 'Montréal' })
      const pMontreal2 = await seedMedia(actorId, { placeName: 'montréal' })

      // Specific place
      const parisRows = await database.getGalleryMedia({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        limit: 10,
        filters: { placeKey: toPlaceKey('Paris') }
      })
      expect(parisRows.map((r) => r.media.id).sort()).toEqual(
        [p1, p2, p3].sort()
      )

      // Accented place with NFC and NFD spellings
      const montrealRows = await database.getGalleryMedia({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        limit: 10,
        filters: { placeKey: toPlaceKey('Montre\u0301al') }
      })
      expect(montrealRows.map((r) => r.media.id).sort()).toEqual(
        [pMontreal1, pMontreal2].sort()
      )

      // None filter with empty string (null and blank)
      const noneRows = await database.getGalleryMedia({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        limit: 10,
        filters: { placeKey: '' }
      })
      expect(noneRows.map((r) => r.media.id).sort()).toEqual(
        [pNull, pBlank].sort()
      )

      // A real place named "None" is a place, not "no place"
      const pNamedNone = await seedMedia(actorId, { placeName: 'None' })
      const namedNoneRows = await database.getGalleryMedia({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        limit: 10,
        filters: { placeKey: toPlaceKey('None') }
      })
      expect(namedNoneRows.map((r) => r.media.id)).toEqual([pNamedNone])

      // Unmatched place returns []
      const unkRows = await database.getGalleryMedia({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        limit: 10,
        filters: { placeKey: toPlaceKey('Nowhere') }
      })
      expect(unkRows).toEqual([])
      expect(pOther).toBeDefined()
    })
  })

  describe('date bounds and dateless photos', () => {
    it('handles inclusive date bounds at 00:00 and 23:59:59.999 UTC and matches dateless photos by upload date', async () => {
      const actorId = await newActor()

      // Target day: 2024-06-15
      const exactStart = new Date(Date.UTC(2024, 5, 15, 0, 0, 0, 0))
      const exactEnd = new Date(Date.UTC(2024, 5, 15, 23, 59, 59, 999))
      const justBefore = new Date(Date.UTC(2024, 5, 14, 23, 59, 59, 999))
      const justAfter = new Date(Date.UTC(2024, 5, 16, 0, 0, 0, 0))

      const mStart = await seedMedia(actorId, {
        takenAt: exactStart,
        sortAt: exactStart
      })
      const mEnd = await seedMedia(actorId, {
        takenAt: exactEnd,
        sortAt: exactEnd
      })
      const mBefore = await seedMedia(actorId, {
        takenAt: justBefore,
        sortAt: justBefore
      })
      const mAfter = await seedMedia(actorId, {
        takenAt: justAfter,
        sortAt: justAfter
      })

      // Dateless photo matching by upload date on 2024-06-15
      const datelessUpload = new Date(Date.UTC(2024, 5, 15, 12, 0, 0))
      const mDateless = await seedMedia(actorId, {
        takenAt: null,
        createdAt: datelessUpload,
        sortAt: datelessUpload
      })

      // Dateless photo outside target date
      const datelessOtherDay = new Date(Date.UTC(2024, 5, 14, 12, 0, 0))
      const mDatelessOther = await seedMedia(actorId, {
        takenAt: null,
        createdAt: datelessOtherDay,
        sortAt: datelessOtherDay
      })

      // Both bounds (single day)
      const rows = await database.getGalleryMedia({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        limit: 10,
        filters: {
          takenFrom: '2024-06-15',
          takenTo: '2024-06-15'
        }
      })
      const resultIds = rows.map((r) => r.media.id).sort()
      expect(resultIds).toEqual([mStart, mEnd, mDateless].sort())
      expect(resultIds).not.toContain(mBefore)
      expect(resultIds).not.toContain(mAfter)
      expect(resultIds).not.toContain(mDatelessOther)

      // takenFrom alone
      const fromRows = await database.getGalleryMedia({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        limit: 10,
        filters: { takenFrom: '2024-06-15' }
      })
      const fromIds = fromRows.map((r) => r.media.id)
      expect(fromIds).toContain(mStart)
      expect(fromIds).toContain(mEnd)
      expect(fromIds).toContain(mDateless)
      expect(fromIds).toContain(mAfter)
      expect(fromIds).not.toContain(mBefore)
      expect(fromIds).not.toContain(mDatelessOther)

      // takenTo alone
      const toRows = await database.getGalleryMedia({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        limit: 10,
        filters: { takenTo: '2024-06-15' }
      })
      const toIds = toRows.map((r) => r.media.id)
      expect(toIds).toContain(mBefore)
      expect(toIds).toContain(mDatelessOther)
      expect(toIds).toContain(mStart)
      expect(toIds).toContain(mEnd)
      expect(toIds).toContain(mDateless)
      expect(toIds).not.toContain(mAfter)
    })
  })

  describe('activity filtering', () => {
    it('filters by activity id, excludes non-countable activities, and handles none', async () => {
      const actorId = await newActor()
      const statusCountable = await createPublicNote(actorId)
      const statusDeleted = await createPublicNote(actorId)
      const statusFailed = await createPublicNote(actorId)
      const statusNonPrimary = await createPublicNote(actorId)
      const statusNoActivity = await createPublicNote(actorId)

      await seedFitnessFile('fit-good', actorId, statusCountable, {
        processingStatus: 'completed',
        isPrimary: true,
        deletedAt: null
      })
      await seedFitnessFile('fit-deleted', actorId, statusDeleted, {
        processingStatus: 'completed',
        isPrimary: true,
        deletedAt: new Date()
      })
      await seedFitnessFile('fit-failed', actorId, statusFailed, {
        processingStatus: 'failed',
        isPrimary: true
      })
      await seedFitnessFile('fit-nonprimary', actorId, statusNonPrimary, {
        processingStatus: 'completed',
        isPrimary: false
      })

      // Multiple photos on a single countable activity post
      const mGood1 = await seedMedia(actorId)
      await seedAttachment(mGood1, statusCountable, actorId)
      const mGood2 = await seedMedia(actorId)
      await seedAttachment(mGood2, statusCountable, actorId)

      const mDeleted = await seedMedia(actorId)
      await seedAttachment(mDeleted, statusDeleted, actorId)

      const mFailed = await seedMedia(actorId)
      await seedAttachment(mFailed, statusFailed, actorId)

      const mNonPrimary = await seedMedia(actorId)
      await seedAttachment(mNonPrimary, statusNonPrimary, actorId)

      const mNoActivity = await seedMedia(actorId)
      await seedAttachment(mNoActivity, statusNoActivity, actorId)

      // Countable activity match returns both photos on the activity post
      const goodRows = await database.getGalleryMedia({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        limit: 10,
        filters: { activityId: 'fit-good' }
      })
      expect(goodRows.map((r) => r.media.id).sort()).toEqual(
        [mGood1, mGood2].sort()
      )

      // Non-countable activities do not match
      const deletedRows = await database.getGalleryMedia({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        limit: 10,
        filters: { activityId: 'fit-deleted' }
      })
      expect(deletedRows).toEqual([])

      const failedRows = await database.getGalleryMedia({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        limit: 10,
        filters: { activityId: 'fit-failed' }
      })
      expect(failedRows).toEqual([])

      const nonPrimaryRows = await database.getGalleryMedia({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        limit: 10,
        filters: { activityId: 'fit-nonprimary' }
      })
      expect(nonPrimaryRows).toEqual([])

      // Not from activity (activityId: null)
      const noneRows = await database.getGalleryMedia({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        limit: 10,
        filters: { activityId: null }
      })
      const noneIds = noneRows.map((r) => r.media.id)
      expect(noneIds).toContain(mNoActivity)
      expect(noneIds).toContain(mDeleted)
      expect(noneIds).toContain(mFailed)
      expect(noneIds).toContain(mNonPrimary)
      expect(noneIds).not.toContain(mGood1)
      expect(noneIds).not.toContain(mGood2)

      // Not from activity (activityId: GALLERY_FILTER_NONE)
      const noneConstRows = await database.getGalleryMedia({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        limit: 10,
        filters: { activityId: GALLERY_FILTER_NONE }
      })
      expect(noneConstRows.map((r) => r.media.id).sort()).toEqual(
        noneIds.sort()
      )
    })
  })

  describe('cross-actor isolation and security', () => {
    it('never matches other actors media or attachments pointing at owner media', async () => {
      const ownerId = await newActor()
      const strangerId = await newActor()

      const ownerStatus = await createPublicNote(ownerId)
      const strangerStatus = await createPublicNote(strangerId)

      await seedFitnessFile('fit-stranger', strangerId, strangerStatus)

      const ownerMedia = await seedMedia(ownerId, { placeName: 'Paris' })
      await seedAttachment(ownerMedia, ownerStatus, ownerId)

      const strangerMedia = await seedMedia(strangerId, { placeName: 'Paris' })
      await seedAttachment(strangerMedia, strangerStatus, strangerId)

      // Stranger tries to attach owner's media
      await seedAttachment(ownerMedia, strangerStatus, strangerId)

      // Owner query never sees strangerMedia
      const ownerRows = await database.getGalleryMedia({
        actorId: ownerId,
        audience: OWNER_GALLERY_AUDIENCE,
        limit: 10,
        filters: { placeKey: toPlaceKey('Paris') }
      })
      expect(ownerRows.map((r) => r.media.id)).toEqual([ownerMedia])
      expect(ownerRows.map((r) => r.media.id)).not.toContain(strangerMedia)

      // Stranger query never sees ownerMedia
      const strangerRows = await database.getGalleryMedia({
        actorId: strangerId,
        audience: OWNER_GALLERY_AUDIENCE,
        limit: 10,
        filters: { placeKey: toPlaceKey('Paris') }
      })
      expect(strangerRows.map((r) => r.media.id)).toEqual([strangerMedia])

      // Stranger filtering by stranger activity id never returns owner's media
      const strangerActivityRows = await database.getGalleryMedia({
        actorId: strangerId,
        audience: OWNER_GALLERY_AUDIENCE,
        limit: 10,
        filters: { activityId: 'fit-stranger' }
      })
      expect(strangerActivityRows.map((r) => r.media.id)).toEqual([
        strangerMedia
      ])

      // Owner filtering by stranger's activity id returns []
      const ownerStrangerActivityRows = await database.getGalleryMedia({
        actorId: ownerId,
        audience: OWNER_GALLERY_AUDIENCE,
        limit: 10,
        filters: { activityId: 'fit-stranger' }
      })
      expect(ownerStrangerActivityRows).toEqual([])
    })
  })

  describe('audience handling', () => {
    it('visitor audience ignores owner-only filters but applies shared filters', async () => {
      const actorId = await newActor()
      const statusId = await createPublicNote(actorId)

      const animalMedia = await seedMedia(actorId, {
        subjectCategory: 'mammal',
        placeName: 'Paris',
        cameraGearId: 'cam-pub'
      })
      await seedAttachment(animalMedia, statusId, actorId)

      const plantMedia = await seedMedia(actorId, {
        subjectCategory: 'plant',
        placeName: 'Tokyo',
        cameraGearId: 'cam-pub'
      })
      await seedAttachment(plantMedia, statusId, actorId)

      // Unposted media of owner is never shown to visitor
      const unpostedMedia = await seedMedia(actorId, {
        subjectCategory: 'mammal',
        placeName: 'Paris',
        cameraGearId: 'cam-pub'
      })

      // Visitor with owner-only filters (placeKey, takenFrom, takenTo, activityId)
      // Owner-only filters must be ignored for visitor
      const visitorRows = await database.getGalleryMedia({
        actorId,
        audience: PUBLIC_GALLERY_AUDIENCE,
        limit: 10,
        filters: {
          placeKey: toPlaceKey('Paris'),
          takenFrom: '2020-01-01',
          takenTo: '2020-01-02',
          activityId: 'fit-xyz'
        }
      })
      // Both public media returned because owner-only filters are ignored
      const returnedIds = visitorRows.map((r) => r.media.id).sort()
      expect(returnedIds).toEqual([animalMedia, plantMedia].sort())
      expect(returnedIds).not.toContain(unpostedMedia)

      // Shared filters (category and gearId) ARE respected for visitor
      const visitorCategoryRows = await database.getGalleryMedia({
        actorId,
        audience: PUBLIC_GALLERY_AUDIENCE,
        limit: 10,
        gearId: 'cam-pub',
        filters: {
          category: 'mammal',
          placeKey: toPlaceKey('Tokyo') // ignored
        }
      })
      expect(visitorCategoryRows.map((r) => r.media.id)).toEqual([animalMedia])
    })
  })

  describe('false filter paths and query avoidance', () => {
    it('returns [] without running list query on provably false filter paths', async () => {
      const actorId = await newActor()
      await seedMedia(actorId, { placeName: 'Rome' })

      // 1. Unmatched placeKey probe: only probes distinct place names, avoids list query
      const placeStatements = await testDb.captureQueries(async () => {
        const rows = await database.getGalleryMedia({
          actorId,
          audience: OWNER_GALLERY_AUDIENCE,
          limit: 10,
          filters: { placeKey: toPlaceKey('Nowhere') }
        })
        expect(rows).toEqual([])
      })
      // Only the distinct place probe ran; no media list query with gallery scope / sort / limit
      expect(
        placeStatements.some(
          (s) =>
            s.sql.toLowerCase().includes('order by') ||
            s.sql.includes('gallerySortAt') ||
            s.sql.includes('galleryUploadedAt')
        )
      ).toBe(false)

      // 2. Unmatched subjectKey probe: only probes distinct subjects, avoids list query
      const subjectStatements = await testDb.captureQueries(async () => {
        const rows = await database.getGalleryMedia({
          actorId,
          audience: OWNER_GALLERY_AUDIENCE,
          limit: 10,
          filters: { subjectKey: 'sci:unmatched' }
        })
        expect(rows).toEqual([])
      })
      expect(
        subjectStatements.some(
          (s) =>
            s.sql.toLowerCase().includes('order by') ||
            s.sql.includes('gallerySortAt') ||
            s.sql.includes('galleryUploadedAt')
        )
      ).toBe(false)

      // 3. Invalid date bound: parseDateBound returns null -> false path with zero queries run
      const dateStatements = await testDb.captureQueries(async () => {
        const rows = await database.getGalleryMedia({
          actorId,
          audience: OWNER_GALLERY_AUDIENCE,
          limit: 10,
          filters: { takenFrom: 'not-a-date' }
        })
        expect(rows).toEqual([])
      })
      expect(dateStatements).toHaveLength(0)

      const toDateStatements = await testDb.captureQueries(async () => {
        const rows = await database.getGalleryMedia({
          actorId,
          audience: OWNER_GALLERY_AUDIENCE,
          limit: 10,
          filters: { takenTo: '9999-99-99' }
        })
        expect(rows).toEqual([])
      })
      expect(toDateStatements).toHaveLength(0)
    })
  })

  describe('sorting and tie-breaking', () => {
    it('leaves NULL sortAt rows out of date orders but keeps them in uploaded order', async () => {
      const actorId = await newActor()
      const dated = await seedMedia(actorId, { sortAt: new Date(5000) })
      const undated = await seedMedia(actorId, { sortAt: new Date(1) })
      await db()
        .updateTable('medias')
        .set({ sortAt: null })
        .where('id', '=', Number(undated))
        .execute()

      for (const sort of ['taken_desc', 'taken_asc'] as const) {
        const rows = await database.getGalleryMedia({
          actorId,
          audience: OWNER_GALLERY_AUDIENCE,
          limit: 10,
          sort
        })
        expect(rows.map((r) => r.media.id)).toEqual([dated])
      }

      const uploaded = await database.getGalleryMedia({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        limit: 10,
        sort: 'uploaded'
      })
      expect(uploaded.map((r) => r.media.id)).toEqual([undated, dated])
    })

    it('orders by taken_desc, taken_asc, and uploaded with sortAt tie-breaking by id', async () => {
      const actorId = await newActor()

      // Insert media with intentional sortAt tie
      const t1 = new Date(1000)
      const t2 = new Date(2000)
      const t3 = new Date(3000)

      const m1 = await seedMedia(actorId, { sortAt: t1 }) // id lower
      const m2a = await seedMedia(actorId, { sortAt: t2 }) // tie 1
      const m2b = await seedMedia(actorId, { sortAt: t2 }) // tie 2 (higher id)
      const m3 = await seedMedia(actorId, { sortAt: t3 }) // highest sortAt

      // taken_desc: sortAt desc, id desc (higher id breaks tie first)
      // Expected: m3, m2b (higher id), m2a, m1
      const descRows = await database.getGalleryMedia({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        limit: 10,
        sort: 'taken_desc'
      })
      expect(descRows.map((r) => r.media.id)).toEqual([m3, m2b, m2a, m1])

      // taken_asc: sortAt asc, id asc (lower id breaks tie first)
      // Expected: m1, m2a (lower id), m2b, m3
      const ascRows = await database.getGalleryMedia({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        limit: 10,
        sort: 'taken_asc'
      })
      expect(ascRows.map((r) => r.media.id)).toEqual([m1, m2a, m2b, m3])

      // uploaded: id desc regardless of sortAt
      // Expected: m3, m2b, m2a, m1
      const uploadedRows = await database.getGalleryMedia({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        limit: 10,
        sort: 'uploaded'
      })
      expect(uploadedRows.map((r) => r.media.id)).toEqual([m3, m2b, m2a, m1])

      // Non-owner always gets uploaded sort
      const visitorRows = await database.getGalleryMedia({
        actorId,
        audience: PUBLIC_GALLERY_AUDIENCE,
        limit: 10,
        sort: 'taken_asc'
      })
      // (no attachments seeded for these, so visitor gets [])
      expect(visitorRows).toEqual([])
    })

    it('pages across tie boundary with cursor returning every row once', async () => {
      const actorId = await newActor()
      const t = new Date(2000)

      const m1 = await seedMedia(actorId, { sortAt: new Date(1000) })
      const m2 = await seedMedia(actorId, { sortAt: t })
      const m3 = await seedMedia(actorId, { sortAt: t })
      const m4 = await seedMedia(actorId, { sortAt: new Date(3000) })

      // Page with limit 2 in taken_desc:
      // Page 1: [m4, m3]
      const p1 = await database.getGalleryMedia({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        limit: 2,
        sort: 'taken_desc'
      })
      expect(p1.map((r) => r.media.id)).toEqual([m4, m3])
      const cursor1 = {
        key: p1[1].sortAt!,
        mediaId: Number(p1[1].media.id)
      }

      // Page 2: [m2, m1]
      const p2 = await database.getGalleryMedia({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        limit: 2,
        sort: 'taken_desc',
        cursor: cursor1
      })
      expect(p2.map((r) => r.media.id)).toEqual([m2, m1])

      // Paged in taken_asc:
      // Page 1: [m1, m2]
      const pAsc1 = await database.getGalleryMedia({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        limit: 2,
        sort: 'taken_asc'
      })
      expect(pAsc1.map((r) => r.media.id)).toEqual([m1, m2])
      const cursorAsc1 = {
        key: pAsc1[1].sortAt!,
        mediaId: Number(pAsc1[1].media.id)
      }

      // Page 2: [m3, m4]
      const pAsc2 = await database.getGalleryMedia({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        limit: 2,
        sort: 'taken_asc',
        cursor: cursorAsc1
      })
      expect(pAsc2.map((r) => r.media.id)).toEqual([m3, m4])
    })

    it('pages across multiple ties on the same sortAt returning every row once', async () => {
      const actorId = await newActor()
      const t = new Date(2000)

      const m1 = await seedMedia(actorId, { sortAt: new Date(1000) })
      const m2a = await seedMedia(actorId, { sortAt: t })
      const m2b = await seedMedia(actorId, { sortAt: t })
      const m2c = await seedMedia(actorId, { sortAt: t })
      const m3 = await seedMedia(actorId, { sortAt: new Date(3000) })

      // Page with limit 2 in taken_desc across a 3-way tie:
      // Page 1: [m3, m2c]
      const p1 = await database.getGalleryMedia({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        limit: 2,
        sort: 'taken_desc'
      })
      expect(p1.map((r) => r.media.id)).toEqual([m3, m2c])

      // Page 2: [m2b, m2a]
      const p2 = await database.getGalleryMedia({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        limit: 2,
        sort: 'taken_desc',
        cursor: { key: p1[1].sortAt!, mediaId: Number(p1[1].media.id) }
      })
      expect(p2.map((r) => r.media.id)).toEqual([m2b, m2a])

      // Page 3: [m1]
      const p3 = await database.getGalleryMedia({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        limit: 2,
        sort: 'taken_desc',
        cursor: { key: p2[1].sortAt!, mediaId: Number(p2[1].media.id) }
      })
      expect(p3.map((r) => r.media.id)).toEqual([m1])

      const allPaged = [
        ...p1.map((r) => r.media.id),
        ...p2.map((r) => r.media.id),
        ...p3.map((r) => r.media.id)
      ]
      expect(allPaged).toEqual([m3, m2c, m2b, m2a, m1])
    })
  })

  describe('route map and date sorts', () => {
    it('does not treat the route map as an activity photo', async () => {
      expect(ROUTE_MAP_NAME).toBe(ROUTE_MAP_ATTACHMENT_NAME)
      const actorId = await newActor()
      const mapOnly = await createPublicNote(actorId)
      const mixed = await createPublicNote(actorId)
      await seedFitnessFile('fit-map-only', actorId, mapOnly)
      await seedFitnessFile('fit-mixed', actorId, mixed)
      const mapA = await seedMedia(actorId)
      await seedAttachment(mapA, mapOnly, actorId, {
        name: ROUTE_MAP_ATTACHMENT_NAME
      })
      const mapB = await seedMedia(actorId)
      await seedAttachment(mapB, mixed, actorId, {
        name: ROUTE_MAP_ATTACHMENT_NAME
      })
      const photo = await seedMedia(actorId)
      await seedAttachment(photo, mixed, actorId)

      const ids = async (activityId: string | null) =>
        (
          await database.getGalleryMedia({
            actorId,
            audience: OWNER_GALLERY_AUDIENCE,
            limit: 10,
            filters: { activityId }
          })
        )
          .map((r) => r.media.id)
          .sort()
      expect(await ids('fit-map-only')).toEqual([])
      expect(await ids('fit-mixed')).toEqual([photo])
      // The maps are media of an activity's post, so not "not from an activity".
      expect(await ids(null)).toEqual([])
    })

    it('still excludes a renamed route map found by mapImagePath, and lists it as from the activity', async () => {
      const actorId = await newActor()
      const mapOnly = await createPublicNote(actorId)
      const mixed = await createPublicNote(actorId)
      const mapPath = (id: string) => `medias/${actorId}/${id}_map.png`
      await seedFitnessFile('fit-edit-map-only', actorId, mapOnly, {
        mapImagePath: mapPath('a')
      })
      await seedFitnessFile('fit-edit-mixed', actorId, mixed, {
        mapImagePath: mapPath('b')
      })
      // A post edit renamed both maps (name from the resent description).
      const mapA = await seedMedia(actorId)
      await seedAttachment(mapA, mapOnly, actorId, {
        name: 'edited description',
        url: `https://${DOMAIN}/api/v1/files/${mapPath('a')}`
      })
      const mapB = await seedMedia(actorId)
      await seedAttachment(mapB, mixed, actorId, {
        name: '',
        url: `https://${DOMAIN}/api/v1/files/${mapPath('b')}`
      })
      const photo = await seedMedia(actorId)
      await seedAttachment(photo, mixed, actorId)
      const plain = await seedMedia(actorId)
      const plainStatus = await createPublicNote(actorId)
      await seedAttachment(plain, plainStatus, actorId)

      const ids = async (activityId: string | null) =>
        (
          await database.getGalleryMedia({
            actorId,
            audience: OWNER_GALLERY_AUDIENCE,
            limit: 10,
            filters: { activityId }
          })
        )
          .map((r) => r.media.id)
          .sort()
      expect(await ids('fit-edit-map-only')).toEqual([])
      expect(await ids('fit-edit-mixed')).toEqual([photo])
      // The maps are media of an activity's post, so not "not from an activity".
      expect(await ids(null)).toEqual([plain])

      const facets = await database.getGalleryMediaFacetRows({ actorId })
      expect(facets.activityPhotos.map((r) => r.fitnessFileId)).toEqual([
        'fit-edit-mixed'
      ])
      expect(facets.activityMediaCount).toBe(3)
      expect(facets.total).toBe(4)
    })

    it('counts the same rows a date sort lists, leaving out NULL sortAt', async () => {
      const actorId = await newActor()
      const statusId = await createPublicNote(actorId)
      const dated = await seedMedia(actorId)
      await seedAttachment(dated, statusId, actorId)
      const undated = await seedMedia(actorId)
      await seedAttachment(undated, statusId, actorId)
      await db()
        .updateTable('medias')
        .set({ sortAt: null })
        .where('id', '=', Number(undated))
        .execute()

      const count = (sort?: 'uploaded' | 'taken_desc' | 'taken_asc') =>
        database
          .countGalleryMedia({
            actorId,
            audience: OWNER_GALLERY_AUDIENCE,
            sort
          })
          .then((c) => c.total)
      expect(await count()).toBe(2)
      expect(await count('uploaded')).toBe(2)
      expect(await count('taken_desc')).toBe(1)
      expect(await count('taken_asc')).toBe(1)
    })
  })

  describe('countGalleryMedia and album counts', () => {
    it('counts total and inAlbum correctly with foreign album id counting 0', async () => {
      const actorId = await newActor()
      const strangerId = await newActor()

      const statusId = await createPublicNote(actorId)

      const m1 = await seedMedia(actorId, { subjectCategory: 'mammal' })
      await seedAttachment(m1, statusId, actorId)
      const m2 = await seedMedia(actorId, { subjectCategory: 'mammal' })
      await seedAttachment(m2, statusId, actorId)
      const m3 = await seedMedia(actorId, { subjectCategory: 'plant' })
      // m3 is unposted

      const mOther = await seedMedia(strangerId, { subjectCategory: 'mammal' })

      // Create owner album
      const albumResult = await database.createGalleryAlbumWithinLimit({
        actorId,
        title: 'Owner Album',
        limit: 10,
        mediaIds: [m1]
      })
      expect(albumResult.status).toBe('created')
      const ownerAlbumId =
        albumResult.status === 'created' ? albumResult.album.id : ''

      // Create stranger album
      const strangerAlbumResult = await database.createGalleryAlbumWithinLimit({
        actorId: strangerId,
        title: 'Stranger Album',
        limit: 10,
        mediaIds: [mOther]
      })
      expect(strangerAlbumResult.status).toBe('created')
      const strangerAlbumId =
        strangerAlbumResult.status === 'created'
          ? strangerAlbumResult.album.id
          : ''

      // Count without albumId for owner
      const countNoAlbum = await database.countGalleryMedia({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE
      })
      expect(countNoAlbum).toEqual({ total: 3, inAlbum: null })

      // Count with owner albumId
      const countWithAlbum = await database.countGalleryMedia({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        albumId: ownerAlbumId
      })
      expect(countWithAlbum).toEqual({ total: 3, inAlbum: 1 })

      // Count with foreign albumId
      const countWithStrangerAlbum = await database.countGalleryMedia({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        albumId: strangerAlbumId
      })
      expect(countWithStrangerAlbum).toEqual({ total: 3, inAlbum: 0 })

      // Count with category filter
      const countFiltered = await database.countGalleryMedia({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        filters: { category: 'mammal' },
        albumId: ownerAlbumId
      })
      expect(countFiltered).toEqual({ total: 2, inAlbum: 1 })

      // Count on provably empty filter path
      const countProvablyEmpty = await database.countGalleryMedia({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        filters: { placeKey: toPlaceKey('Nowhere') },
        albumId: ownerAlbumId
      })
      expect(countProvablyEmpty).toEqual({ total: 0, inAlbum: 0 })

      // Count for visitor audience only counts posted media (m1 and m2, not unposted m3)
      const countVisitor = await database.countGalleryMedia({
        actorId,
        audience: PUBLIC_GALLERY_AUDIENCE,
        albumId: ownerAlbumId
      })
      expect(countVisitor).toEqual({ total: 2, inAlbum: 1 })

      expect(m2).toBeDefined()
      expect(m3).toBeDefined()
    })
  })
})
