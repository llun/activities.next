import type { Insertable } from 'kysely'
import { sql } from 'kysely'

import { ROUTE_MAP_NAME } from '@/lib/database/domains/gallery/activityPhotos'
import type { GalleryMediaFilters } from '@/lib/database/domains/gallery/types'
import type { Attachments, Medias } from '@/lib/database/kysely/db'
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
import type { GalleryShow } from '@/lib/types/database/gallery'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

const DOMAIN = 'day-stats.test'

describe('gallery day stats and day ids', () => {
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
    values: {
      processingStatus?: string
      isPrimary?: boolean
      deletedAt?: Date | null
      activityType?: string | null
      totalDistanceMeters?: number | null
      activityStartTime?: number | null
      mapImagePath?: string | null
    } = {}
  ) => {
    const file = await database.createFitnessFile({
      actorId,
      statusId,
      path: `fitness/${id}.fit`,
      fileName: `${id}.fit`,
      fileType: 'fit',
      mimeType: 'application/octet-stream',
      bytes: 1000
    })
    expect(file).not.toBeNull()
    await db()
      .updateTable('fitness_files')
      .set({
        id,
        processingStatus: values.processingStatus ?? 'completed',
        isPrimary: values.isPrimary ?? true,
        deletedAt: values.deletedAt ?? null,
        activityType: values.activityType ?? null,
        totalDistanceMeters: values.totalDistanceMeters ?? null,
        activityStartTime:
          values.activityStartTime !== undefined &&
          values.activityStartTime !== null
            ? new Date(values.activityStartTime)
            : null,
        mapImagePath: values.mapImagePath ?? null
      })
      .where('id', '=', file!.id)
      .execute()
    return id
  }

  describe('getGalleryDayStats', () => {
    it('counts a day under a date sort, cutting the bound at the UTC day edges', async () => {
      const actorId = await newActor()
      const dayStart = new Date(Date.UTC(2025, 9, 4, 0, 0, 0, 0))
      const dayEnd = new Date(Date.UTC(2025, 9, 4, 23, 59, 59, 999))
      const justBefore = new Date(Date.UTC(2025, 9, 3, 23, 59, 59, 999))
      const justAfter = new Date(Date.UTC(2025, 9, 5, 0, 0, 0, 0))
      await seedMedia(actorId, { sortAt: dayStart, takenAt: dayStart })
      await seedMedia(actorId, { sortAt: dayEnd, takenAt: dayEnd })
      await seedMedia(actorId, { sortAt: justBefore, takenAt: justBefore })
      await seedMedia(actorId, { sortAt: justAfter, takenAt: justAfter })

      const stats = await database.getGalleryDayStats({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        sort: 'taken_desc',
        fromDay: '2025-10-04',
        toDay: '2025-10-04'
      })

      expect(stats.places).toEqual([
        {
          day: '2025-10-04',
          dateless: false,
          placeName: null,
          count: 2,
          inAlbum: null
        }
      ])
      expect(stats.activities).toEqual([])
    })

    it('splits a day into dated and dateless rows', async () => {
      const actorId = await newActor()
      const day = new Date(Date.UTC(2025, 9, 4, 12, 0, 0))
      await seedMedia(actorId, { sortAt: day, takenAt: day })
      await seedMedia(actorId, {
        sortAt: day,
        takenAt: null,
        createdAt: day
      })

      const stats = await database.getGalleryDayStats({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        sort: 'taken_desc',
        fromDay: '2025-10-04',
        toDay: '2025-10-04'
      })

      expect(
        stats.places
          .map((row) => [row.dateless, row.count])
          .sort((a, b) => Number(a[0]) - Number(b[0]))
      ).toEqual([
        [false, 1],
        [true, 1]
      ])
      expect(stats.places.every((row) => row.day === '2025-10-04')).toBe(true)
    })

    it('keys a dateless date-sort photo by its upload day in stats and ids', async () => {
      const actorId = await newActor()
      const mediaId = await seedMedia(actorId, {
        sortAt: new Date(Date.UTC(2025, 9, 3, 23, 59, 59, 900)),
        takenAt: null,
        createdAt: new Date(Date.UTC(2025, 9, 4, 0, 0, 0, 100))
      })

      const stats = await database.getGalleryDayStats({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        sort: 'taken_desc',
        fromDay: '2025-10-03',
        toDay: '2025-10-03'
      })

      expect(stats.places).toEqual([
        {
          day: '2025-10-04',
          dateless: true,
          placeName: null,
          count: 1,
          inAlbum: null
        }
      ])

      const idsParams = {
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        sort: 'taken_desc' as const,
        limit: 2000
      }
      await expect(
        database.getGalleryMediaIds({
          ...idsParams,
          dayKey: 'uploaded:2025-10-04'
        })
      ).resolves.toEqual([mediaId])
      await expect(
        database.getGalleryMediaIds({
          ...idsParams,
          dayKey: 'uploaded:2025-10-03'
        })
      ).resolves.toEqual([])
    })

    it('groups by the createdAt day under sort=uploaded, dated and dateless alike', async () => {
      const actorId = await newActor()
      const uploadDay = new Date(Date.UTC(2025, 9, 4, 12, 0, 0))
      const takenDay = new Date(Date.UTC(2025, 0, 1, 12, 0, 0))
      // Dated, but uploaded on the 4th.
      await seedMedia(actorId, {
        sortAt: takenDay,
        takenAt: takenDay,
        createdAt: uploadDay
      })
      // Dateless, uploaded on the 4th.
      await seedMedia(actorId, {
        sortAt: uploadDay,
        takenAt: null,
        createdAt: uploadDay
      })
      // Uploaded on another day.
      await seedMedia(actorId, {
        sortAt: uploadDay,
        takenAt: null,
        createdAt: new Date(Date.UTC(2025, 9, 5, 12, 0, 0))
      })

      const stats = await database.getGalleryDayStats({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        sort: 'uploaded',
        fromDay: '2025-10-04',
        toDay: '2025-10-04'
      })

      expect(stats.places.reduce((total, row) => total + row.count, 0)).toBe(2)
      expect(stats.places.every((row) => row.day === '2025-10-04')).toBe(true)
    })

    it('lands a TEXT createdAt row on the right day on SQLite', async () => {
      if (testDb.backend !== 'sqlite') return
      const actorId = await newActor()
      // No createdAt: the column default writes CURRENT_TIMESTAMP as TEXT.
      const seeded = await db()
        .insertInto('medias')
        .values({
          // An explicit id past the seeded ones: the column default picks
          // max(id) + 1, which the next seedMedia would collide with.
          id: 900001,
          actorId,
          original: 'medias/day-stats-text-created-at.jpg',
          originalBytes: 1000,
          originalMimeType: 'image/jpeg',
          originalMetaData: JSON.stringify({ width: 640, height: 480 }),
          inGallery: true,
          galleryAddedAt: new Date(1000),
          sortAt: new Date(1000),
          updatedAt: new Date(1000)
        })
        .returning('id')
        .executeTakeFirstOrThrow()

      const raw = await sql<{ rawCreatedAt: string }>`
        select cast(createdAt as text) as "rawCreatedAt"
        from medias where id = ${seeded.id}
      `.execute(db())
      const day = /^(\d{4}-\d{2}-\d{2})/.exec(raw.rows[0]?.rawCreatedAt ?? '')

      const stats = await database.getGalleryDayStats({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        sort: 'uploaded',
        fromDay: day![1],
        toDay: day![1]
      })

      expect(stats.places.reduce((total, row) => total + row.count, 0)).toBe(1)
    })

    it('narrows the counts by the filters and honours show', async () => {
      const actorId = await newActor()
      const day = new Date(Date.UTC(2025, 9, 4, 12, 0, 0))
      const sparrow = await seedMedia(actorId, {
        sortAt: day,
        takenAt: day,
        subjectName: 'House Sparrow',
        subjectScientificName: 'Passer domesticus',
        placeName: 'London'
      })
      const robin = await seedMedia(actorId, {
        sortAt: day,
        takenAt: day,
        subjectName: 'European Robin',
        subjectScientificName: 'Erithacus rubecula',
        placeName: 'Paris'
      })
      // Same day, hidden from the gallery.
      const hidden = await seedMedia(actorId, {
        sortAt: day,
        takenAt: day,
        subjectName: 'House Sparrow',
        subjectScientificName: 'Passer domesticus',
        inGallery: false
      })

      const dayParams = {
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        sort: 'taken_desc' as const,
        fromDay: '2025-10-04',
        toDay: '2025-10-04'
      }
      const count = (filters?: GalleryMediaFilters, show?: GalleryShow) =>
        database
          .getGalleryDayStats({ ...dayParams, filters, show })
          .then((stats) =>
            stats.places.reduce((total, row) => total + row.count, 0)
          )

      expect(await count()).toBe(2)
      expect(
        await count({
          subjectKey: toSubjectKey({ scientificName: 'Passer domesticus' })!
        })
      ).toBe(1)
      expect(await count({ placeKey: toPlaceKey('London') })).toBe(1)
      expect(await count(undefined, 'hidden')).toBe(1)
      expect(await count(undefined, 'all')).toBe(3)
      expect(sparrow).toBeDefined()
      expect(robin).toBeDefined()
      expect(hidden).toBeDefined()
    })

    it('narrows the counts by an activity filter', async () => {
      const actorId = await newActor()
      const statusId = await createPublicNote(actorId)
      await seedFitnessFile('fit-day', actorId, statusId, {
        activityType: 'Ride'
      })
      const day = new Date(Date.UTC(2025, 9, 4, 12, 0, 0))
      const onActivity = await seedMedia(actorId, {
        sortAt: day,
        takenAt: day
      })
      await seedAttachment(onActivity, statusId, actorId)
      const plain = await seedMedia(actorId, { sortAt: day, takenAt: day })
      await seedAttachment(plain, await createPublicNote(actorId), actorId)

      const stats = await database.getGalleryDayStats({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        sort: 'taken_desc',
        fromDay: '2025-10-04',
        toDay: '2025-10-04',
        filters: { activityId: 'fit-day' }
      })

      expect(stats.places.reduce((total, row) => total + row.count, 0)).toBe(1)
    })

    it('sums inAlbum only with albumId, and a foreign album counts 0', async () => {
      const actorId = await newActor()
      const strangerId = await newActor()
      const day = new Date(Date.UTC(2025, 9, 4, 12, 0, 0))
      const first = await seedMedia(actorId, { sortAt: day, takenAt: day })
      const second = await seedMedia(actorId, { sortAt: day, takenAt: day })

      const album = await database.createGalleryAlbumWithinLimit({
        actorId,
        title: 'Day album',
        mediaIds: [first],
        limit: 10
      })
      expect(album.status).toBe('created')
      const strangerAlbum = await database.createGalleryAlbumWithinLimit({
        actorId: strangerId,
        title: 'Stranger album',
        mediaIds: [],
        limit: 10
      })
      expect(strangerAlbum.status).toBe('created')

      const dayParams = {
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        sort: 'taken_desc' as const,
        fromDay: '2025-10-04',
        toDay: '2025-10-04'
      }
      const withoutAlbum = await database.getGalleryDayStats(dayParams)
      expect(withoutAlbum.places.every((row) => row.inAlbum === null)).toBe(
        true
      )

      const withAlbum = await database.getGalleryDayStats({
        ...dayParams,
        albumId: album.status === 'created' ? album.album.id : 'missing'
      })
      expect(
        withAlbum.places.reduce((total, row) => total + row.inAlbum!, 0)
      ).toBe(1)

      const withStrangerAlbum = await database.getGalleryDayStats({
        ...dayParams,
        albumId:
          strangerAlbum.status === 'created'
            ? strangerAlbum.album.id
            : 'missing'
      })
      expect(
        withStrangerAlbum.places.reduce((total, row) => total + row.inAlbum!, 0)
      ).toBe(0)
      expect(second).toBeDefined()
    })

    it('returns one row per place spelling', async () => {
      const actorId = await newActor()
      const day = new Date(Date.UTC(2025, 9, 4, 12, 0, 0))
      await seedMedia(actorId, {
        sortAt: day,
        takenAt: day,
        placeName: 'Box Hill, Surrey'
      })
      await seedMedia(actorId, {
        sortAt: day,
        takenAt: day,
        placeName: 'box hill, surrey'
      })

      const stats = await database.getGalleryDayStats({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        sort: 'taken_desc',
        fromDay: '2025-10-04',
        toDay: '2025-10-04'
      })

      // No ORDER BY in the read: PG and SQLite collate the spellings differently.
      expect(
        stats.places.map((row) => [row.placeName, row.count]).sort()
      ).toEqual([
        ['Box Hill, Surrey', 1],
        ['box hill, surrey', 1]
      ])
    })

    it('excludes the route map and non-countable files from the activity rows', async () => {
      const actorId = await newActor()
      const countable = await createPublicNote(actorId)
      const failed = await createPublicNote(actorId)
      await seedFitnessFile('fit-countable', actorId, countable, {
        activityType: 'Ride',
        totalDistanceMeters: 64200,
        activityStartTime: Date.UTC(2025, 9, 4, 8, 0, 0)
      })
      await seedFitnessFile('fit-failed', actorId, failed, {
        processingStatus: 'failed'
      })

      const photo = await seedMedia(actorId, {
        sortAt: new Date(Date.UTC(2025, 9, 4, 9, 0, 0)),
        takenAt: new Date(Date.UTC(2025, 9, 4, 9, 0, 0))
      })
      await seedAttachment(photo, countable, actorId)
      const map = await seedMedia(actorId, {
        sortAt: new Date(Date.UTC(2025, 9, 4, 9, 0, 0)),
        takenAt: new Date(Date.UTC(2025, 9, 4, 9, 0, 0))
      })
      await seedAttachment(map, countable, actorId, {
        name: ROUTE_MAP_ATTACHMENT_NAME
      })
      const failedPhoto = await seedMedia(actorId, {
        sortAt: new Date(Date.UTC(2025, 9, 4, 10, 0, 0)),
        takenAt: new Date(Date.UTC(2025, 9, 4, 10, 0, 0))
      })
      await seedAttachment(failedPhoto, failed, actorId)

      const stats = await database.getGalleryDayStats({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        sort: 'taken_desc',
        fromDay: '2025-10-04',
        toDay: '2025-10-04'
      })

      expect(stats.activities).toEqual([
        {
          day: '2025-10-04',
          dateless: false,
          fitnessFileId: 'fit-countable',
          activityType: 'Ride',
          totalDistanceMeters: 64200,
          activityStartTime: Date.UTC(2025, 9, 4, 8, 0, 0),
          count: 1
        }
      ])
      expect(ROUTE_MAP_NAME).toBe(ROUTE_MAP_ATTACHMENT_NAME)
    })

    it('answers an empty result for a visitor audience', async () => {
      const actorId = await newActor()
      const day = new Date(Date.UTC(2025, 9, 4, 12, 0, 0))
      const media = await seedMedia(actorId, { sortAt: day, takenAt: day })
      const statusId = await createPublicNote(actorId)
      await seedAttachment(media, statusId, actorId)

      const stats = await database.getGalleryDayStats({
        actorId,
        audience: PUBLIC_GALLERY_AUDIENCE,
        sort: 'taken_desc',
        fromDay: '2025-10-04',
        toDay: '2025-10-04'
      })

      expect(stats).toEqual({ places: [], activities: [] })
    })
  })

  describe('getGalleryMediaIds', () => {
    it('returns the ids of one day in sort order, honouring limit', async () => {
      const actorId = await newActor()
      const ids = [
        await seedMedia(actorId, {
          sortAt: new Date(Date.UTC(2025, 9, 4, 1, 0, 0)),
          takenAt: new Date(Date.UTC(2025, 9, 4, 1, 0, 0)),
          createdAt: new Date(Date.UTC(2025, 9, 4, 1, 0, 0))
        }),
        await seedMedia(actorId, {
          sortAt: new Date(Date.UTC(2025, 9, 4, 2, 0, 0)),
          takenAt: new Date(Date.UTC(2025, 9, 4, 2, 0, 0)),
          createdAt: new Date(Date.UTC(2025, 9, 4, 2, 0, 0))
        }),
        await seedMedia(actorId, {
          sortAt: new Date(Date.UTC(2025, 9, 4, 3, 0, 0)),
          takenAt: new Date(Date.UTC(2025, 9, 4, 3, 0, 0)),
          createdAt: new Date(Date.UTC(2025, 9, 4, 3, 0, 0))
        }),
        // Another day, never returned.
        await seedMedia(actorId, {
          sortAt: new Date(Date.UTC(2025, 9, 5, 3, 0, 0)),
          takenAt: new Date(Date.UTC(2025, 9, 5, 3, 0, 0)),
          createdAt: new Date(Date.UTC(2025, 9, 5, 3, 0, 0))
        })
      ]

      const params = {
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        dayKey: '2025-10-04',
        limit: 2000
      }
      expect(
        await database.getGalleryMediaIds({ ...params, sort: 'taken_desc' })
      ).toEqual([ids[2], ids[1], ids[0]])
      expect(
        await database.getGalleryMediaIds({ ...params, sort: 'taken_asc' })
      ).toEqual([ids[0], ids[1], ids[2]])
      expect(
        await database.getGalleryMediaIds({ ...params, sort: 'uploaded' })
      ).toEqual([ids[2], ids[1], ids[0]])
      expect(
        await database.getGalleryMediaIds({
          ...params,
          sort: 'taken_desc',
          limit: 2
        })
      ).toEqual([ids[2], ids[1]])
      expect(
        await database.getGalleryMediaIds({
          ...params,
          sort: 'taken_desc',
          limit: 2,
          offset: 1
        })
      ).toEqual([ids[1], ids[0]])
    })

    it('pages through tied sortAt values without a duplicate or a gap', async () => {
      const actorId = await newActor()
      const day = new Date(Date.UTC(2025, 9, 4, 12, 0, 0))
      // Five photos on one day, all with the same sortAt (and takenAt): the
      // id tiebreak is the only thing that tells the pages apart.
      const tied: string[] = []
      for (let index = 0; index < 5; index += 1) {
        tied.push(await seedMedia(actorId, { sortAt: day, takenAt: day }))
      }

      const params = {
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        dayKey: '2025-10-04',
        limit: 2000
      }
      const descending = await database.getGalleryMediaIds({
        ...params,
        sort: 'taken_desc'
      })
      const ascending = await database.getGalleryMediaIds({
        ...params,
        sort: 'taken_asc'
      })
      // The id tiebreak: the newest id first descending, the oldest first
      // ascending.
      expect(descending).toEqual([...tied].reverse())
      expect(ascending).toEqual(tied)

      const readPages = async (sort: 'taken_desc' | 'taken_asc') => {
        const pages = await Promise.all(
          [0, 2, 4].map((offset) =>
            database.getGalleryMediaIds({
              ...params,
              sort,
              limit: 2,
              offset
            })
          )
        )
        return pages.flat()
      }

      // The concatenation of the limit-2 pages at offsets 0, 2 and 4 is the
      // full ordered list: no id twice, none skipped.
      expect(await readPages('taken_desc')).toEqual(descending)
      expect(await readPages('taken_asc')).toEqual(ascending)
    })

    it('leaves out the excluded album members', async () => {
      const actorId = await newActor()
      const day = new Date(Date.UTC(2025, 9, 4, 12, 0, 0))
      const first = await seedMedia(actorId, { sortAt: day, takenAt: day })
      const second = await seedMedia(actorId, { sortAt: day, takenAt: day })

      const album = await database.createGalleryAlbumWithinLimit({
        actorId,
        title: 'Exclusion album',
        mediaIds: [first],
        limit: 10
      })
      expect(album.status).toBe('created')

      expect(
        await database.getGalleryMediaIds({
          actorId,
          audience: OWNER_GALLERY_AUDIENCE,
          sort: 'taken_desc',
          dayKey: '2025-10-04',
          limit: 2000,
          excludeAlbumId:
            album.status === 'created' ? album.album.id : 'missing'
        })
      ).toEqual([second])
    })

    it('separates the uploaded: key from the plain key under a date sort', async () => {
      const actorId = await newActor()
      const day = new Date(Date.UTC(2025, 9, 4, 12, 0, 0))
      const dated = await seedMedia(actorId, { sortAt: day, takenAt: day })
      const dateless = await seedMedia(actorId, {
        sortAt: day,
        takenAt: null,
        createdAt: day
      })

      const params = {
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        sort: 'taken_desc' as const,
        limit: 2000
      }
      expect(
        await database.getGalleryMediaIds({ ...params, dayKey: '2025-10-04' })
      ).toEqual([dated])
      expect(
        await database.getGalleryMediaIds({
          ...params,
          dayKey: 'uploaded:2025-10-04'
        })
      ).toEqual([dateless])
    })

    it('reads the uploaded: key under sort=uploaded for dated and dateless alike', async () => {
      const actorId = await newActor()
      const uploadDay = new Date(Date.UTC(2025, 9, 4, 12, 0, 0))
      const dated = await seedMedia(actorId, {
        sortAt: new Date(Date.UTC(2025, 0, 1, 12, 0, 0)),
        takenAt: new Date(Date.UTC(2025, 0, 1, 12, 0, 0)),
        createdAt: uploadDay
      })
      const dateless = await seedMedia(actorId, {
        sortAt: uploadDay,
        takenAt: null,
        createdAt: uploadDay
      })

      const ids = await database.getGalleryMediaIds({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        sort: 'uploaded',
        dayKey: 'uploaded:2025-10-04',
        limit: 2000
      })

      expect(ids.sort()).toEqual([dated, dateless].sort())
    })

    it('never returns another actor rows', async () => {
      const actorId = await newActor()
      const strangerId = await newActor()
      const day = new Date(Date.UTC(2025, 9, 4, 12, 0, 0))
      const own = await seedMedia(actorId, { sortAt: day, takenAt: day })
      await seedMedia(strangerId, { sortAt: day, takenAt: day })

      expect(
        await database.getGalleryMediaIds({
          actorId,
          audience: OWNER_GALLERY_AUDIENCE,
          sort: 'taken_desc',
          dayKey: '2025-10-04',
          limit: 2000
        })
      ).toEqual([own])
    })

    it('answers [] for a visitor audience', async () => {
      const actorId = await newActor()
      const day = new Date(Date.UTC(2025, 9, 4, 12, 0, 0))
      const media = await seedMedia(actorId, { sortAt: day, takenAt: day })
      const statusId = await createPublicNote(actorId)
      await seedAttachment(media, statusId, actorId)

      expect(
        await database.getGalleryMediaIds({
          actorId,
          audience: PUBLIC_GALLERY_AUDIENCE,
          sort: 'taken_desc',
          dayKey: '2025-10-04',
          limit: 2000
        })
      ).toEqual([])
    })
  })
})
