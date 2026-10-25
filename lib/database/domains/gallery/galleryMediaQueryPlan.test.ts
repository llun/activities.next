import { CompiledQuery } from 'kysely'

import { galleryMediaScope } from '@/lib/database/kysely/visibility/galleryMedia'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import {
  OWNER_GALLERY_AUDIENCE,
  PUBLIC_GALLERY_AUDIENCE
} from '@/lib/services/gallery/galleryAudience'

// `attachments.mediaId` and `medias.id` are both integers, so SQLite probes
// `attachments_mediaId_idx` for each media row instead of rescanning the owner's
// attachments. The plan is read off SQLite.
describe('gallery scope query plan on SQLite', () => {
  const planOf = async (
    audience: typeof OWNER_GALLERY_AUDIENCE | typeof PUBLIC_GALLERY_AUDIENCE
  ) => {
    const { database, db, destroy } = createTestDatabase({ backend: 'sqlite' })
    try {
      await database.migrate()
      const query = db
        .selectFrom('medias')
        .select('medias.id')
        .where(galleryMediaScope(db, 'actor', audience))
        .compile()
      const result = await db.executeQuery<{ detail: string }>(
        CompiledQuery.raw(`explain query plan ${query.sql}`, [
          ...query.parameters
        ])
      )
      return result.rows.map((row) => row.detail).join('\n')
    } finally {
      await destroy()
    }
  }

  it.each([
    ['owner', OWNER_GALLERY_AUDIENCE],
    ['logged out', PUBLIC_GALLERY_AUDIENCE]
  ])(
    'probes attachments_mediaId_idx for the %s audience',
    async (_, audience) => {
      const plan = await planOf(audience)

      expect(plan).toContain('USING INDEX attachments_mediaId_idx (mediaId=?)')
    }
  )
})

// Every statement the gallery reads and writes send that compares
// `attachments.mediaId` with `medias.id` (the scope's posted check, the
// attachment pick's join and the unattached check) probes the index on SQLite.
describe('gallery statements on SQLite', () => {
  it('probe attachments_mediaId_idx wherever they match attachments to media', async () => {
    const { database, db, captureQueries, destroy } = createTestDatabase({
      backend: 'sqlite'
    })
    try {
      await database.migrate()
      // In the owner's gallery without a post, so the read picks attachments.
      const media = await db
        .insertInto('medias')
        .values({
          actorId: 'actor',
          original: 'medias/plan.jpg',
          originalBytes: 1,
          originalMimeType: 'image/jpeg',
          originalMetaData: JSON.stringify({ width: 1, height: 1 }),
          inGallery: true,
          galleryAddedAt: new Date(1000),
          createdAt: new Date(1000),
          updatedAt: new Date(1000)
        })
        .returning('id')
        .executeTakeFirstOrThrow()
      const mediaIds = [String(media.id)]

      const statements = await captureQueries(async () => {
        const rows = await database.getGalleryMediaByIds({
          actorId: 'actor',
          audience: OWNER_GALLERY_AUDIENCE,
          mediaIds
        })
        expect(rows.map((row) => row.media.id)).toEqual(mediaIds)
        await database.getUnattachedMedia({ actorId: 'actor', mediaIds })
      })

      const matching = statements.filter((statement) =>
        statement.sql.includes('"mediaId" = "medias"."id"')
      )
      // The scope's posted check and the pick's join, then the unattached
      // check.
      expect(matching).toHaveLength(3)
      for (const statement of matching) {
        const plan = await db.executeQuery<{ detail: string }>(
          CompiledQuery.raw(
            `explain query plan ${statement.sql}`,
            statement.bindings
          )
        )
        expect(plan.rows.map((row) => row.detail).join('\n')).toContain(
          'attachments_mediaId_idx (mediaId=?)'
        )
      }
    } finally {
      await destroy()
    }
  })

  it('uses medias_actorId_sortAt_id_idx and avoids temp b-tree for date sorts', async () => {
    const { database, db, captureQueries, destroy } = createTestDatabase({
      backend: 'sqlite'
    })
    try {
      await database.migrate()

      const statements = await captureQueries(async () => {
        await database.getGalleryMedia({
          actorId: 'actor',
          audience: OWNER_GALLERY_AUDIENCE,
          limit: 10,
          sort: 'taken_desc'
        })
        await database.getGalleryMedia({
          actorId: 'actor',
          audience: OWNER_GALLERY_AUDIENCE,
          limit: 10,
          sort: 'taken_desc',
          cursor: { key: 1000, mediaId: 1 }
        })
      })

      const baseQuery = statements[0]
      const basePlan = await db.executeQuery<{ detail: string }>(
        CompiledQuery.raw(
          `explain query plan ${baseQuery.sql}`,
          baseQuery.bindings
        )
      )
      const basePlanText = basePlan.rows.map((row) => row.detail).join('\n')
      expect(basePlanText).toContain('medias_actorId_sortAt_id_idx')
      expect(basePlanText).not.toContain('USE TEMP B-TREE FOR ORDER BY')

      const cursorQuery = statements[1]
      const cursorPlan = await db.executeQuery<{ detail: string }>(
        CompiledQuery.raw(
          `explain query plan ${cursorQuery.sql}`,
          cursorQuery.bindings
        )
      )
      const cursorPlanText = cursorPlan.rows.map((row) => row.detail).join('\n')
      expect(cursorPlanText).toContain('medias_actorId_sortAt_id_idx')
      expect(
        cursorPlanText.includes('sortAt<?') ||
          cursorPlanText.includes('sortAt<')
      ).toBe(true)
      expect(cursorPlanText).not.toContain('USE TEMP B-TREE FOR ORDER BY')
    } finally {
      await destroy()
    }
  })

  it('uses medias_actorId_sortAt_id_idx for the date-sort day stats read', async () => {
    const { database, db, captureQueries, destroy } = createTestDatabase({
      backend: 'sqlite'
    })
    try {
      await database.migrate()

      const statements = await captureQueries(async () => {
        await database.getGalleryDayStats({
          actorId: 'actor',
          audience: OWNER_GALLERY_AUDIENCE,
          sort: 'taken_desc',
          fromDay: '2025-10-01',
          toDay: '2025-10-04'
        })
      })

      // The places read bounds sortAt directly; the activities read reaches
      // medias through the attachments join instead.
      const bounded = statements.filter(
        (statement) =>
          statement.sql.includes('from "medias"') &&
          statement.sql.includes('"sortAt" >=')
      )
      expect(bounded).toHaveLength(1)
      for (const statement of bounded) {
        const plan = await db.executeQuery<{ detail: string }>(
          CompiledQuery.raw(
            `explain query plan ${statement.sql}`,
            statement.bindings
          )
        )
        expect(plan.rows.map((row) => row.detail).join('\n')).toContain(
          'medias_actorId_sortAt_id_idx'
        )
      }
    } finally {
      await destroy()
    }
  })

  it('uses medias_actorId_sortAt_id_idx for dated day-key ids', async () => {
    const { database, db, captureQueries, destroy } = createTestDatabase({
      backend: 'sqlite'
    })
    try {
      await database.migrate()

      const statements = await captureQueries(async () => {
        await database.getGalleryMediaIds({
          actorId: 'actor',
          audience: OWNER_GALLERY_AUDIENCE,
          sort: 'taken_desc',
          dayKey: '2025-10-04',
          limit: 2000
        })
      })
      const query = statements.find(
        (statement) =>
          statement.sql.includes('from "medias"') &&
          statement.sql.includes('"sortAt" >=')
      )
      expect(query).toBeDefined()

      const plan = await db.executeQuery<{ detail: string }>(
        CompiledQuery.raw(`explain query plan ${query!.sql}`, query!.bindings)
      )
      expect(plan.rows.map((row) => row.detail).join('\n')).toContain(
        'medias_actorId_sortAt_id_idx'
      )
    } finally {
      await destroy()
    }
  })
})

// `attachments.mediaId` holds the media row's integer id, however the caller
// spells it, on both backends.
describe('attachment media ids', () => {
  const testDb = createTestDatabase()
  const { database, db } = testDb

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
  })

  afterAll(async () => {
    await testDb.destroy()
  })

  it('stores the media row id however the caller spells it', async () => {
    for (const mediaId of ['12', '12.0', '012']) {
      await database.createAttachment({
        actorId: 'actor',
        statusId: 'status',
        mediaType: 'image/jpeg',
        url: `https://media.test/${mediaId}.jpg`,
        mediaId
      })
    }

    const rows = await db.selectFrom('attachments').select('mediaId').execute()
    expect(rows.map((row) => row.mediaId)).toEqual([12, 12, 12])
  })

  it('refuses a media id that is not a row id rather than dropping the link', async () => {
    await expect(
      database.createAttachment({
        actorId: 'actor',
        statusId: 'status',
        mediaType: 'image/jpeg',
        url: 'https://media.test/bad.jpg',
        mediaId: 'not-a-row-id'
      })
    ).rejects.toThrow('Invalid media id')
  })

  it('joins each attachment to the media row it names', async () => {
    const insertMedia = (original: string) =>
      db
        .insertInto('medias')
        .values({
          actorId: 'actor',
          original,
          originalBytes: 1,
          originalMimeType: 'image/jpeg',
          originalMetaData: JSON.stringify({ width: 1, height: 1 }),
          createdAt: new Date(1000),
          updatedAt: new Date(1000)
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    const first = await insertMedia('medias/first.jpg')
    // A neighbour whose id the attachment does not name.
    const second = await insertMedia('medias/second.jpg')
    await database.createAttachment({
      actorId: 'actor',
      statusId: 'status-join',
      mediaType: 'image/jpeg',
      url: 'https://media.test/join.jpg',
      mediaId: `0${first.id}`
    })

    const rows = await db
      .selectFrom('attachments')
      .innerJoin('medias', (join) =>
        join.onRef('attachments.mediaId', '=', 'medias.id')
      )
      .select('medias.id')
      .where('attachments.statusId', '=', 'status-join')
      .execute()
    expect(rows.map((row) => Number(row.id))).toEqual([first.id])
    expect(first.id).not.toBe(second.id)
  })
})
