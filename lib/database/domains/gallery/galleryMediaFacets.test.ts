import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getGalleryMediaFacetRows } from '@/lib/database/domains/gallery/facets'
import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import type { MediaSubjectCategory } from '@/lib/types/database/gallery'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

describe('galleryMediaFacets', () => {
  const { database, db, prepare } = getTestDatabaseWithInstance(true)
  const TEST_DOMAIN = 'llun.test'
  let actorSeq = 0
  let mediaSeq = 0
  let noteSeq = 0
  let fitnessSeq = 0

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    await database.destroy()
  })

  const createActor = async () => {
    actorSeq += 1
    const username = `facet-user-${actorSeq}-${Date.now().toString(36)}`
    const actorId = `https://${TEST_DOMAIN}/users/${username}`
    await database.createAccount({
      email: `${username}@${TEST_DOMAIN}`,
      username,
      passwordHash: 'hash',
      domain: TEST_DOMAIN,
      privateKey: `privateKey-${username}`,
      publicKey: `publicKey-${username}`
    })
    return actorId
  }

  const createMedia = async ({
    actorId,
    inGallery = true,
    placeName = null,
    sortAt,
    subjectName = null,
    subjectScientificName = null,
    subjectCategory = null
  }: {
    actorId: string
    inGallery?: boolean
    placeName?: string | null
    sortAt?: Date | number | null
    subjectName?: string | null
    subjectScientificName?: string | null
    subjectCategory?: MediaSubjectCategory | null
  }) => {
    mediaSeq += 1
    const media = await database.createMedia({
      actorId,
      original: {
        path: `/test/facet-${mediaSeq}.jpg`,
        bytes: 1000,
        mimeType: 'image/jpeg',
        metaData: { width: 100, height: 100 }
      },
      details: {
        inGallery,
        placeName,
        subjectName,
        subjectScientificName,
        subjectCategory
      }
    })
    if (!media) throw new Error('createMedia failed')

    // undefined keeps what createMedia set; null really clears the column.
    if (sortAt !== undefined) {
      const date =
        sortAt === null
          ? null
          : sortAt instanceof Date
            ? sortAt
            : new Date(sortAt)
      await db
        .updateTable('medias')
        .set({ sortAt: date })
        .where('id', '=', Number(media.id))
        .execute()
    }

    return media.id
  }

  const postMedia = async ({
    actorId,
    mediaId,
    to = [ACTIVITY_STREAM_PUBLIC],
    cc = []
  }: {
    actorId: string
    mediaId: string
    to?: string[]
    cc?: string[]
  }) => {
    noteSeq += 1
    const statusId = `${actorId}/statuses/facet-note-${noteSeq}`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId,
      to,
      cc,
      text: `Facet note ${noteSeq}`
    })
    await database.createAttachment({
      actorId,
      statusId,
      mediaType: 'image/jpeg',
      url: `https://media.test/facet-${noteSeq}.jpg`,
      width: 100,
      height: 100,
      mediaId
    })
    return statusId
  }

  const createActivityFile = async ({
    actorId,
    statusId,
    activityType = 'running',
    activityStartTime = new Date('2026-05-10T08:00:00.000Z'),
    totalDistanceMeters = 5000,
    processingStatus = 'completed',
    isPrimary = true,
    deletedAt = null
  }: {
    actorId: string
    statusId?: string | null
    activityType?: string | null
    activityStartTime?: Date | number | null
    totalDistanceMeters?: number | null
    processingStatus?: 'completed' | 'pending' | 'failed'
    isPrimary?: boolean
    deletedAt?: Date | null
  }) => {
    fitnessSeq += 1
    const file = await database.createFitnessFile({
      actorId,
      ...(statusId ? { statusId } : {}),
      path: `fitness/facet-${fitnessSeq}.fit`,
      fileName: `facet-${fitnessSeq}.fit`,
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1024
    })
    if (!file) throw new Error('createFitnessFile failed')

    const startTime =
      activityStartTime instanceof Date
        ? activityStartTime
        : activityStartTime !== null && activityStartTime !== undefined
          ? new Date(activityStartTime)
          : null

    await db
      .updateTable('fitness_files')
      .set({
        processingStatus,
        isPrimary,
        activityType,
        activityStartTime: startTime,
        totalDistanceMeters,
        deletedAt
      })
      .where('id', '=', file.id)
      .execute()

    return file.id
  }

  describe('show filtering', () => {
    it('respects show parameter: in_gallery, all, hidden, not_posted, not_in_album', async () => {
      const ownerId = await createActor()
      const otherActorId = await createActor()

      // 1. in_gallery, posted, in an album
      const inGalleryMediaId = await createMedia({
        actorId: ownerId,
        inGallery: true
      })
      await postMedia({ actorId: ownerId, mediaId: inGalleryMediaId })
      const albumResult = await database.createGalleryAlbumWithinLimit({
        actorId: ownerId,
        title: 'Album 1',
        limit: 10
      })
      if (albumResult.status !== 'created') throw new Error('Album not created')
      await database.addGalleryAlbumItems({
        actorId: ownerId,
        albumId: albumResult.album.id,
        mediaIds: [inGalleryMediaId],
        limit: 100
      })

      // 2. hidden (inGallery: false), posted
      const hiddenMediaId = await createMedia({
        actorId: ownerId,
        inGallery: false
      })
      await postMedia({ actorId: ownerId, mediaId: hiddenMediaId })

      // 3. not_posted (inGallery: true, added to gallery directly, no post)
      const notPostedMediaId = await createMedia({
        actorId: ownerId,
        inGallery: true
      })
      await database.addMediaToGallery({
        actorId: ownerId,
        mediaIds: [notPostedMediaId]
      })

      // 4. in_gallery, posted, NOT in any album
      const notInAlbumMediaId = await createMedia({
        actorId: ownerId,
        inGallery: true
      })
      await postMedia({ actorId: ownerId, mediaId: notInAlbumMediaId })

      // 5. unposted and not added to gallery (never in scope)
      await createMedia({ actorId: ownerId, inGallery: true })

      // 6. foreign media (never in scope for owner)
      const foreignMediaId = await createMedia({
        actorId: otherActorId,
        inGallery: true
      })
      await postMedia({ actorId: otherActorId, mediaId: foreignMediaId })

      // Test default / in_gallery: 1 (album), 3 (not posted), 4 (not in album) -> 3
      const inGalleryFacets = await getGalleryMediaFacetRows(db, {
        actorId: ownerId,
        show: 'in_gallery'
      })
      expect(inGalleryFacets.total).toBe(3)

      // Test database method matches direct function
      const viaDatabase = await database.getGalleryMediaFacetRows({
        actorId: ownerId,
        show: 'in_gallery'
      })
      expect(viaDatabase.total).toBe(3)

      // Test hidden: 2 (hiddenMediaId) -> 1
      const hiddenFacets = await getGalleryMediaFacetRows(db, {
        actorId: ownerId,
        show: 'hidden'
      })
      expect(hiddenFacets.total).toBe(1)

      // Test all: 1, 2, 3, 4 -> 4
      const allFacets = await getGalleryMediaFacetRows(db, {
        actorId: ownerId,
        show: 'all'
      })
      expect(allFacets.total).toBe(4)

      // Test not_posted: 3 (notPostedMediaId) -> 1
      const notPostedFacets = await getGalleryMediaFacetRows(db, {
        actorId: ownerId,
        show: 'not_posted'
      })
      expect(notPostedFacets.total).toBe(1)

      // Test not_in_album: 2 (hidden), 3 (not_posted), 4 (not_in_album) -> 3
      const notInAlbumFacets = await getGalleryMediaFacetRows(db, {
        actorId: ownerId,
        show: 'not_in_album'
      })
      expect(notInAlbumFacets.total).toBe(3)
    })
  })

  describe('places grouping', () => {
    it('groups by placeName including null and blank strings', async () => {
      const ownerId = await createActor()

      const tokyo1 = await createMedia({
        actorId: ownerId,
        placeName: 'Tokyo'
      })
      const tokyo2 = await createMedia({
        actorId: ownerId,
        placeName: 'Tokyo'
      })
      const paris = await createMedia({
        actorId: ownerId,
        placeName: 'Paris'
      })
      const blank = await createMedia({ actorId: ownerId, placeName: '' })
      const noPlace = await createMedia({
        actorId: ownerId,
        placeName: null
      })

      for (const mId of [tokyo1, tokyo2, paris, blank, noPlace]) {
        await postMedia({ actorId: ownerId, mediaId: mId })
      }

      const facets = await getGalleryMediaFacetRows(db, {
        actorId: ownerId,
        show: 'in_gallery'
      })

      expect(facets.total).toBe(5)
      expect(facets.places).toEqual(
        expect.arrayContaining([
          { placeName: 'Tokyo', count: 2 },
          { placeName: 'Paris', count: 1 },
          { placeName: '', count: 1 },
          { placeName: null, count: 1 }
        ])
      )
      expect(facets.places).toHaveLength(4)
    })
  })

  describe('months grouping', () => {
    it('groups from sortAt including dateless media where sortAt is createdAt', async () => {
      const ownerId = await createActor()

      // Two in 2026-03
      const m1 = await createMedia({
        actorId: ownerId,
        sortAt: new Date('2026-03-10T10:00:00Z')
      })
      const m2 = await createMedia({
        actorId: ownerId,
        sortAt: new Date('2026-03-25T15:00:00Z')
      })

      // One in 2025-12
      const m3 = await createMedia({
        actorId: ownerId,
        sortAt: new Date('2025-12-01T00:00:00Z')
      })

      // One dateless media where sortAt was backfilled to createdAt
      const mDateless = await createMedia({ actorId: ownerId })
      // Explicitly set createdAt and sortAt to 2026-01
      const createdDate = new Date('2026-01-15T12:00:00Z')
      await db
        .updateTable('medias')
        .set({ createdAt: createdDate, sortAt: createdDate })
        .where('id', '=', Number(mDateless))
        .execute()

      // One media with sortAt: null
      const mNullSort = await createMedia({ actorId: ownerId, sortAt: null })

      for (const mId of [m1, m2, m3, mDateless, mNullSort]) {
        await postMedia({ actorId: ownerId, mediaId: mId })
      }

      const facets = await getGalleryMediaFacetRows(db, {
        actorId: ownerId,
        show: 'in_gallery'
      })

      expect(facets.total).toBe(5)
      // medias with sortAt null are excluded from months
      expect(facets.months).toEqual(
        expect.arrayContaining([
          { month: '2026-03', count: 2 },
          { month: '2025-12', count: 1 },
          { month: '2026-01', count: 1 }
        ])
      )
      expect(facets.months).toHaveLength(3)
    })
  })

  describe('subjects grouping', () => {
    it('groups by subjectName, subjectScientificName, and subjectCategory', async () => {
      const ownerId = await createActor()

      const s1 = await createMedia({
        actorId: ownerId,
        subjectName: 'Red Fox',
        subjectScientificName: 'Vulpes vulpes',
        subjectCategory: 'mammal'
      })
      const s2 = await createMedia({
        actorId: ownerId,
        subjectName: 'Red Fox',
        subjectScientificName: 'Vulpes vulpes',
        subjectCategory: 'mammal'
      })
      const s3 = await createMedia({
        actorId: ownerId,
        subjectName: 'Red Fox',
        subjectScientificName: 'Vulpes vulpes',
        subjectCategory: 'other'
      })
      const s4 = await createMedia({
        actorId: ownerId,
        subjectName: 'Common Raven',
        subjectScientificName: 'Corvus corax',
        subjectCategory: 'bird'
      })
      const s5 = await createMedia({
        actorId: ownerId,
        subjectName: null,
        subjectScientificName: null,
        subjectCategory: null
      })

      for (const mId of [s1, s2, s3, s4, s5]) {
        await postMedia({ actorId: ownerId, mediaId: mId })
      }

      const facets = await getGalleryMediaFacetRows(db, {
        actorId: ownerId,
        show: 'in_gallery'
      })

      expect(facets.total).toBe(5)
      expect(facets.subjects).toEqual(
        expect.arrayContaining([
          {
            subjectName: 'Red Fox',
            subjectScientificName: 'Vulpes vulpes',
            subjectCategory: 'mammal',
            count: 2
          },
          {
            subjectName: 'Red Fox',
            subjectScientificName: 'Vulpes vulpes',
            subjectCategory: 'other',
            count: 1
          },
          {
            subjectName: 'Common Raven',
            subjectScientificName: 'Corvus corax',
            subjectCategory: 'bird',
            count: 1
          },
          {
            subjectName: null,
            subjectScientificName: null,
            subjectCategory: null,
            count: 1
          }
        ])
      )
      expect(facets.subjects).toHaveLength(4)
    })
  })

  describe('activityPhotos', () => {
    it('counts only photos on valid activity posts with all exclusions and rules', async () => {
      const ownerId = await createActor()
      const otherActorId = await createActor()
      const followersUrl = `${ownerId}/followers`

      // 1. Valid activity post
      const validMediaId = await createMedia({
        actorId: ownerId,
        placeName: 'Central Park'
      })
      const validStatusId = await postMedia({
        actorId: ownerId,
        mediaId: validMediaId
      })
      const validStartTime = new Date('2026-05-01T08:00:00.000Z')
      const validFitnessFileId = await createActivityFile({
        actorId: ownerId,
        statusId: validStatusId,
        activityType: 'running',
        activityStartTime: validStartTime,
        totalDistanceMeters: 5200,
        processingStatus: 'completed',
        isPrimary: true
      })

      // 2. Post without activity (plain post)
      const plainMediaId = await createMedia({ actorId: ownerId })
      await postMedia({ actorId: ownerId, mediaId: plainMediaId })

      // 3. Activity post with deleted fitness file
      const delMediaId = await createMedia({ actorId: ownerId })
      const delStatusId = await postMedia({
        actorId: ownerId,
        mediaId: delMediaId
      })
      await createActivityFile({
        actorId: ownerId,
        statusId: delStatusId,
        processingStatus: 'completed',
        isPrimary: true,
        deletedAt: new Date()
      })

      // 4. Activity post with failed fitness file
      const failedMediaId = await createMedia({ actorId: ownerId })
      const failedStatusId = await postMedia({
        actorId: ownerId,
        mediaId: failedMediaId
      })
      await createActivityFile({
        actorId: ownerId,
        statusId: failedStatusId,
        processingStatus: 'failed',
        isPrimary: true
      })

      // 4b. Activity post with pending fitness file
      const pendingMediaId = await createMedia({ actorId: ownerId })
      const pendingStatusId = await postMedia({
        actorId: ownerId,
        mediaId: pendingMediaId
      })
      await createActivityFile({
        actorId: ownerId,
        statusId: pendingStatusId,
        processingStatus: 'pending',
        isPrimary: true
      })

      // 5. Activity post with non-primary fitness file
      const nonPrimaryMediaId = await createMedia({ actorId: ownerId })
      const nonPrimaryStatusId = await postMedia({
        actorId: ownerId,
        mediaId: nonPrimaryMediaId
      })
      await createActivityFile({
        actorId: ownerId,
        statusId: nonPrimaryStatusId,
        processingStatus: 'completed',
        isPrimary: false
      })

      // 6. Another actor's activity post and photo
      const foreignMediaId = await createMedia({ actorId: otherActorId })
      const foreignStatusId = await postMedia({
        actorId: otherActorId,
        mediaId: foreignMediaId
      })
      await createActivityFile({
        actorId: otherActorId,
        statusId: foreignStatusId,
        processingStatus: 'completed',
        isPrimary: true
      })

      // 7. Another actor attaching owner's media to their activity post
      const foreignAttStatusId = `${otherActorId}/statuses/foreign-att-post`
      await database.createNote({
        id: foreignAttStatusId,
        url: foreignAttStatusId,
        actorId: otherActorId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        text: 'Foreign attachment'
      })
      await database.createAttachment({
        actorId: otherActorId,
        statusId: foreignAttStatusId,
        mediaType: 'image/jpeg',
        url: 'https://media.test/foreign-att.jpg',
        width: 100,
        height: 100,
        mediaId: validMediaId
      })
      await createActivityFile({
        actorId: otherActorId,
        statusId: foreignAttStatusId,
        processingStatus: 'completed',
        isPrimary: true
      })

      // 8. Owner attaching foreign media to owner's activity post
      const foreignMedia2Id = await createMedia({ actorId: otherActorId })
      const ownPostForeignMediaStatusId = await postMedia({
        actorId: ownerId,
        mediaId: foreignMedia2Id
      })
      await createActivityFile({
        actorId: ownerId,
        statusId: ownPostForeignMediaStatusId,
        processingStatus: 'completed',
        isPrimary: true
      })

      // 9. Photo on a followers-only activity post (still visible to owner)
      const followersMediaId = await createMedia({
        actorId: ownerId,
        placeName: 'Track'
      })
      const followersStatusId = await postMedia({
        actorId: ownerId,
        mediaId: followersMediaId,
        to: [followersUrl],
        cc: []
      })
      const followersStartTime = new Date('2026-06-01T09:00:00.000Z')
      const followersFitnessFileId = await createActivityFile({
        actorId: ownerId,
        statusId: followersStatusId,
        activityType: 'walking',
        activityStartTime: followersStartTime,
        totalDistanceMeters: 3100,
        processingStatus: 'completed',
        isPrimary: true
      })

      // 10. Multiple photos on one activity post
      const multi1MediaId = await createMedia({
        actorId: ownerId,
        placeName: 'Loop A'
      })
      const multi2MediaId = await createMedia({
        actorId: ownerId,
        placeName: 'Loop B'
      })
      noteSeq += 1
      const multiStatusId = `${ownerId}/statuses/facet-note-${noteSeq}`
      await database.createNote({
        id: multiStatusId,
        url: multiStatusId,
        actorId: ownerId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        text: 'Multi photo activity'
      })
      await database.createAttachment({
        actorId: ownerId,
        statusId: multiStatusId,
        mediaType: 'image/jpeg',
        url: 'https://media.test/multi-1.jpg',
        width: 100,
        height: 100,
        mediaId: multi1MediaId
      })
      await database.createAttachment({
        actorId: ownerId,
        statusId: multiStatusId,
        mediaType: 'image/jpeg',
        url: 'https://media.test/multi-2.jpg',
        width: 100,
        height: 100,
        mediaId: multi2MediaId
      })
      const multiStartTime = new Date('2026-07-01T10:00:00.000Z')
      const multiFitnessFileId = await createActivityFile({
        actorId: ownerId,
        statusId: multiStatusId,
        activityType: 'cycling',
        activityStartTime: multiStartTime,
        totalDistanceMeters: 25000,
        processingStatus: 'completed',
        isPrimary: true
      })

      const facets = await getGalleryMediaFacetRows(db, {
        actorId: ownerId,
        show: 'in_gallery'
      })

      // Exactly 4 activity photos match:
      // 1 from valid post
      // 1 from followers-only post
      // 2 from multi-photo post
      expect(facets.activityPhotos).toHaveLength(4)
      expect(facets.activityPhotos).toEqual(
        expect.arrayContaining([
          {
            fitnessFileId: validFitnessFileId,
            activityType: 'running',
            activityStartTime: validStartTime.getTime(),
            totalDistanceMeters: 5200,
            mediaId: validMediaId,
            placeName: 'Central Park'
          },
          {
            fitnessFileId: followersFitnessFileId,
            activityType: 'walking',
            activityStartTime: followersStartTime.getTime(),
            totalDistanceMeters: 3100,
            mediaId: followersMediaId,
            placeName: 'Track'
          },
          {
            fitnessFileId: multiFitnessFileId,
            activityType: 'cycling',
            activityStartTime: multiStartTime.getTime(),
            totalDistanceMeters: 25000,
            mediaId: multi1MediaId,
            placeName: 'Loop A'
          },
          {
            fitnessFileId: multiFitnessFileId,
            activityType: 'cycling',
            activityStartTime: multiStartTime.getTime(),
            totalDistanceMeters: 25000,
            mediaId: multi2MediaId,
            placeName: 'Loop B'
          }
        ])
      )
    })
  })
})
