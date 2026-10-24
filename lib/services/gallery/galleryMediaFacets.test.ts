import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import { ROUTE_MAP_ATTACHMENT_NAME } from '@/lib/services/fitness-files/mapAttachments'
import { getGalleryMediaFacets } from '@/lib/services/gallery/galleryMediaFacets'
import { seedDatabase } from '@/lib/stub/database'
import type { MediaSubjectCategory } from '@/lib/types/database/gallery'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

describe('galleryMediaFacets service', () => {
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

  const createMedia = async ({
    actorId,
    inGallery = true,
    placeName = null,
    sortAt,
    subjectName = null,
    subjectScientificName = null,
    subjectCategory = null,
    post = false
  }: {
    actorId: string
    inGallery?: boolean
    placeName?: string | null
    sortAt?: Date | number | null
    subjectName?: string | null
    subjectScientificName?: string | null
    subjectCategory?: MediaSubjectCategory | null
    post?: boolean
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

    if (post) {
      await postMedia({ actorId, mediaId: media.id })
    }

    return media.id
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

  it('merges place spellings and selects most-used raw spelling', async () => {
    const ownerId = await createActor()

    // 2 with "Box Hill, Surrey", 1 with "box hill,  surrey" -> merges to "Box Hill, Surrey" count 3
    await createMedia({
      actorId: ownerId,
      placeName: 'Box Hill, Surrey',
      post: true
    })
    await createMedia({
      actorId: ownerId,
      placeName: 'Box Hill, Surrey',
      post: true
    })
    await createMedia({
      actorId: ownerId,
      placeName: 'box hill,  surrey',
      post: true
    })

    // 1 with "Richmond Park"
    await createMedia({
      actorId: ownerId,
      placeName: 'Richmond Park',
      post: true
    })

    const facets = await getGalleryMediaFacets({
      database,
      owner: { id: ownerId }
    })

    expect(facets.total).toBe(4)
    expect(facets.noPlaceCount).toBe(0)
    expect(facets.places).toEqual([
      { name: 'Box Hill, Surrey', count: 3 },
      { name: 'Richmond Park', count: 1 }
    ])
  })

  it('groups blank and null places into noPlaceCount', async () => {
    const ownerId = await createActor()

    await createMedia({ actorId: ownerId, placeName: null, post: true })
    await createMedia({ actorId: ownerId, placeName: '', post: true })
    await createMedia({ actorId: ownerId, placeName: '   ', post: true })
    await createMedia({
      actorId: ownerId,
      placeName: 'Kew Gardens',
      post: true
    })

    const facets = await getGalleryMediaFacets({
      database,
      owner: { id: ownerId }
    })

    expect(facets.total).toBe(4)
    expect(facets.noPlaceCount).toBe(3)
    expect(facets.places).toEqual([{ name: 'Kew Gardens', count: 1 }])
  })

  it('sorts months newest first and excludes photos without sortAt', async () => {
    const ownerId = await createActor()

    await createMedia({
      actorId: ownerId,
      sortAt: new Date('2026-07-15T12:00:00.000Z'),
      post: true
    })
    await createMedia({
      actorId: ownerId,
      sortAt: new Date('2026-05-10T12:00:00.000Z'),
      post: true
    })
    await createMedia({
      actorId: ownerId,
      sortAt: new Date('2026-05-25T12:00:00.000Z'),
      post: true
    })
    await createMedia({
      actorId: ownerId,
      sortAt: new Date('2026-01-01T12:00:00.000Z'),
      post: true
    })
    await createMedia({
      actorId: ownerId,
      sortAt: null,
      post: true
    })

    const facets = await getGalleryMediaFacets({
      database,
      owner: { id: ownerId }
    })

    expect(facets.total).toBe(5)
    expect(facets.months).toEqual([
      { month: '2026-07', count: 1 },
      { month: '2026-05', count: 2 },
      { month: '2026-01', count: 1 }
    ])
  })

  it('unifies species by scientific and common name, picking details from largest group and omitting unidentified', async () => {
    const ownerId = await createActor()

    // 2x Common Kingfisher, 1x Kingfisher with same scientific name
    await createMedia({
      actorId: ownerId,
      subjectName: 'Common Kingfisher',
      subjectScientificName: 'Alcedo atthis',
      subjectCategory: 'bird',
      post: true
    })
    await createMedia({
      actorId: ownerId,
      subjectName: 'Common Kingfisher',
      subjectScientificName: 'Alcedo atthis',
      subjectCategory: 'bird',
      post: true
    })
    await createMedia({
      actorId: ownerId,
      subjectName: 'Kingfisher',
      subjectScientificName: 'alcedo atthis',
      subjectCategory: 'bird',
      post: true
    })

    // 2x Red Fox (common name only)
    await createMedia({
      actorId: ownerId,
      subjectName: 'Red Fox',
      subjectScientificName: null,
      subjectCategory: 'mammal',
      post: true
    })
    await createMedia({
      actorId: ownerId,
      subjectName: 'red fox',
      subjectScientificName: null,
      subjectCategory: 'mammal',
      post: true
    })

    // 1x Unidentified photo
    await createMedia({
      actorId: ownerId,
      subjectName: null,
      subjectScientificName: null,
      subjectCategory: null,
      post: true
    })

    const facets = await getGalleryMediaFacets({
      database,
      owner: { id: ownerId }
    })

    expect(facets.total).toBe(6)
    expect(facets.species).toEqual([
      {
        key: 'sci:alcedo atthis',
        name: 'Common Kingfisher',
        scientificName: 'Alcedo atthis',
        category: 'bird',
        count: 3
      },
      {
        key: 'name:red fox',
        name: 'Red Fox',
        scientificName: null,
        category: 'mammal',
        count: 2
      }
    ])
  })

  it('aggregates activities, counts distinct media, selects most-used place, and calculates notFromActivityCount', async () => {
    const ownerId = await createActor()

    // Activity 1: Running, start 2026-05-10
    const m1 = await createMedia({
      actorId: ownerId,
      placeName: 'Richmond Park'
    })
    const m2 = await createMedia({
      actorId: ownerId,
      placeName: 'Richmond Park'
    })
    noteSeq += 1
    const status1 = `${ownerId}/statuses/facet-note-${noteSeq}`
    await database.createNote({
      id: status1,
      url: status1,
      actorId: ownerId,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      text: 'Activity 1'
    })
    await database.createAttachment({
      actorId: ownerId,
      statusId: status1,
      mediaType: 'image/jpeg',
      url: 'https://media.test/1.jpg',
      width: 100,
      height: 100,
      mediaId: m1
    })
    await database.createAttachment({
      actorId: ownerId,
      statusId: status1,
      mediaType: 'image/jpeg',
      url: 'https://media.test/2.jpg',
      width: 100,
      height: 100,
      mediaId: m2
    })
    const file1Id = await createActivityFile({
      actorId: ownerId,
      statusId: status1,
      activityType: 'running',
      activityStartTime: new Date('2026-05-10T08:00:00.000Z'),
      totalDistanceMeters: 5000
    })

    // Activity 2: Cycling, start 2026-06-01 (newer than Activity 1)
    const m3 = await createMedia({
      actorId: ownerId,
      placeName: 'Box Hill'
    })
    const m4 = await createMedia({
      actorId: ownerId,
      placeName: 'Bushy Park'
    })
    const m5 = await createMedia({
      actorId: ownerId,
      placeName: 'Bushy Park'
    })
    noteSeq += 1
    const status2 = `${ownerId}/statuses/facet-note-${noteSeq}`
    await database.createNote({
      id: status2,
      url: status2,
      actorId: ownerId,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      text: 'Activity 2'
    })
    await database.createAttachment({
      actorId: ownerId,
      statusId: status2,
      mediaType: 'image/jpeg',
      url: 'https://media.test/3.jpg',
      width: 100,
      height: 100,
      mediaId: m3
    })
    await database.createAttachment({
      actorId: ownerId,
      statusId: status2,
      mediaType: 'image/jpeg',
      url: 'https://media.test/4.jpg',
      width: 100,
      height: 100,
      mediaId: m4
    })
    await database.createAttachment({
      actorId: ownerId,
      statusId: status2,
      mediaType: 'image/jpeg',
      url: 'https://media.test/5.jpg',
      width: 100,
      height: 100,
      mediaId: m5
    })
    const file2Id = await createActivityFile({
      actorId: ownerId,
      statusId: status2,
      activityType: 'cycling',
      activityStartTime: new Date('2026-06-01T09:00:00.000Z'),
      totalDistanceMeters: 25000
    })

    // Activity 3: Walking, start null, blank places
    const m6 = await createMedia({
      actorId: ownerId,
      placeName: null
    })
    const m7 = await createMedia({
      actorId: ownerId,
      placeName: '   '
    })
    noteSeq += 1
    const status3 = `${ownerId}/statuses/facet-note-${noteSeq}`
    await database.createNote({
      id: status3,
      url: status3,
      actorId: ownerId,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      text: 'Activity 3'
    })
    await database.createAttachment({
      actorId: ownerId,
      statusId: status3,
      mediaType: 'image/jpeg',
      url: 'https://media.test/6.jpg',
      width: 100,
      height: 100,
      mediaId: m6
    })
    await database.createAttachment({
      actorId: ownerId,
      statusId: status3,
      mediaType: 'image/jpeg',
      url: 'https://media.test/7.jpg',
      width: 100,
      height: 100,
      mediaId: m7
    })
    const file3Id = await createActivityFile({
      actorId: ownerId,
      statusId: status3,
      activityType: 'walking',
      activityStartTime: null,
      totalDistanceMeters: 3000
    })

    // Plain photos not in any activity
    await createMedia({ actorId: ownerId, post: true })
    await createMedia({ actorId: ownerId, post: true })

    const facets = await getGalleryMediaFacets({
      database,
      owner: { id: ownerId }
    })

    expect(facets.total).toBe(9)
    // 7 distinct media in activities, 2 plain photos
    expect(facets.notFromActivityCount).toBe(2)

    expect(facets.activities).toEqual([
      {
        id: file2Id,
        activityType: 'cycling',
        startTime: '2026-06-01T09:00:00.000Z',
        distanceMeters: 25000,
        placeName: 'Bushy Park',
        count: 3
      },
      {
        id: file1Id,
        activityType: 'running',
        startTime: '2026-05-10T08:00:00.000Z',
        distanceMeters: 5000,
        placeName: 'Richmond Park',
        count: 2
      },
      {
        id: file3Id,
        activityType: 'walking',
        startTime: null,
        distanceMeters: 3000,
        placeName: null,
        count: 2
      }
    ])
  })

  const attachMedia = async (
    actorId: string,
    statusId: string,
    mediaId: string,
    name = ''
  ) => {
    noteSeq += 1
    await database.createAttachment({
      actorId,
      statusId,
      mediaType: 'image/jpeg',
      url: `https://media.test/attach-${noteSeq}.jpg`,
      width: 100,
      height: 100,
      mediaId,
      name
    })
  }

  const createActivityStatus = async (actorId: string) => {
    noteSeq += 1
    const statusId = `${actorId}/statuses/facet-note-${noteSeq}`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      text: 'Activity'
    })
    return statusId
  }

  it('ignores the route map: a map-only activity is not listed and a map is not a photo', async () => {
    const ownerId = await createActor()
    const mapOnlyStatus = await createActivityStatus(ownerId)
    await attachMedia(
      ownerId,
      mapOnlyStatus,
      await createMedia({ actorId: ownerId }),
      ROUTE_MAP_ATTACHMENT_NAME
    )
    const mapOnlyFile = await createActivityFile({
      actorId: ownerId,
      statusId: mapOnlyStatus
    })

    const photoStatus = await createActivityStatus(ownerId)
    await attachMedia(
      ownerId,
      photoStatus,
      await createMedia({ actorId: ownerId }),
      ROUTE_MAP_ATTACHMENT_NAME
    )
    await attachMedia(
      ownerId,
      photoStatus,
      await createMedia({ actorId: ownerId })
    )
    const photoFile = await createActivityFile({
      actorId: ownerId,
      statusId: photoStatus
    })

    const facets = await getGalleryMediaFacets({
      database,
      owner: { id: ownerId },
      show: 'all'
    })
    expect(facets.activities.map((a) => [a.id, a.count])).toEqual([
      [photoFile, 1]
    ])
    expect(facets.activities.map((a) => a.id)).not.toContain(mapOnlyFile)
  })

  it('labels an activity place with the same merged spelling as the places facet', async () => {
    const ownerId = await createActor()
    await createMedia({
      actorId: ownerId,
      placeName: 'Box Hill, Surrey',
      post: true
    })
    await createMedia({
      actorId: ownerId,
      placeName: 'Box Hill, Surrey',
      post: true
    })
    const status = await createActivityStatus(ownerId)
    await attachMedia(
      ownerId,
      status,
      await createMedia({ actorId: ownerId, placeName: 'box hill, surrey' })
    )
    await createActivityFile({ actorId: ownerId, statusId: status })

    const facets = await getGalleryMediaFacets({
      database,
      owner: { id: ownerId },
      show: 'all'
    })
    expect(facets.places.map((p) => p.name)).toEqual(['Box Hill, Surrey'])
    expect(facets.activities.map((a) => a.placeName)).toEqual([
      'Box Hill, Surrey'
    ])
  })

  it('respects show parameter: in_gallery, all, hidden, not_posted, not_in_album', async () => {
    const ownerId = await createActor()

    // 1. in_gallery, posted, in an album
    const inGalleryMediaId = await createMedia({
      actorId: ownerId,
      inGallery: true,
      placeName: 'Gallery Place'
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

    // 2. hidden from gallery, posted
    const hiddenMediaId = await createMedia({
      actorId: ownerId,
      inGallery: false,
      placeName: 'Hidden Place'
    })
    await postMedia({ actorId: ownerId, mediaId: hiddenMediaId })

    // 3. not_posted (inGallery: true, added to gallery directly, no post)
    const notPostedMediaId = await createMedia({
      actorId: ownerId,
      inGallery: true,
      placeName: 'Unposted Place'
    })
    await database.addMediaToGallery({
      actorId: ownerId,
      mediaIds: [notPostedMediaId]
    })

    // 4. in_gallery, posted, not in an album
    const notInAlbumMediaId = await createMedia({
      actorId: ownerId,
      inGallery: true,
      placeName: 'NotInAlbum Place'
    })
    await postMedia({ actorId: ownerId, mediaId: notInAlbumMediaId })

    // Test show: 'in_gallery' (default behavior: 1, 3, 4)
    const inGalleryFacets = await getGalleryMediaFacets({
      database,
      owner: { id: ownerId },
      show: 'in_gallery'
    })
    expect(inGalleryFacets.total).toBe(3)
    expect(inGalleryFacets.places.map((p) => p.name).sort()).toEqual([
      'Gallery Place',
      'NotInAlbum Place',
      'Unposted Place'
    ])

    // Test show: 'hidden' (2)
    const hiddenFacets = await getGalleryMediaFacets({
      database,
      owner: { id: ownerId },
      show: 'hidden'
    })
    expect(hiddenFacets.total).toBe(1)
    expect(hiddenFacets.places).toEqual([{ name: 'Hidden Place', count: 1 }])

    // Test show: 'all' (1, 2, 3, 4)
    const allFacets = await getGalleryMediaFacets({
      database,
      owner: { id: ownerId },
      show: 'all'
    })
    expect(allFacets.total).toBe(4)

    // Test show: 'not_posted' (3)
    const notPostedFacets = await getGalleryMediaFacets({
      database,
      owner: { id: ownerId },
      show: 'not_posted'
    })
    expect(notPostedFacets.total).toBe(1)
    expect(notPostedFacets.places).toEqual([
      { name: 'Unposted Place', count: 1 }
    ])

    // Test show: 'not_in_album' (2, 3, 4)
    const notInAlbumFacets = await getGalleryMediaFacets({
      database,
      owner: { id: ownerId },
      show: 'not_in_album'
    })
    expect(notInAlbumFacets.total).toBe(3)
    expect(notInAlbumFacets.places.map((p) => p.name).sort()).toEqual([
      'Hidden Place',
      'NotInAlbum Place',
      'Unposted Place'
    ])
  })
})
