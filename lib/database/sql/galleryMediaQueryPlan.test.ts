import { CompiledQuery } from 'kysely'

import { castToTextOnSqlite } from '@/lib/database/kysely/dialect'
import { galleryMediaScope } from '@/lib/database/kysely/visibility/galleryMedia'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import {
  OWNER_GALLERY_AUDIENCE,
  PUBLIC_GALLERY_AUDIENCE
} from '@/lib/services/gallery/galleryAudience'

// `attachments.mediaId` is varchar on SQLite and `medias.id` an integer. Compared
// directly, SQLite converts the varchar side to a number and cannot use
// `attachments_mediaId_idx`, so every media row rescans the owner's attachments.
// The plan is read off SQLite, where the cast applies; PostgreSQL compares the
// two integer columns directly (dialect.test.ts pins both spellings).
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

// The scope's comparison relies on `attachments.mediaId` holding the canonical
// `String(id)`, on both backends.
describe('canonical attachment media ids', () => {
  const testDb = createTestDatabase()
  const { database, db } = testDb

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
  })

  afterAll(async () => {
    await testDb.destroy()
  })

  it('stores a canonical media id however the caller spells it', async () => {
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
    // varchar on SQLite, an integer on PostgreSQL.
    expect(rows.map((row) => String(row.mediaId))).toEqual(['12', '12', '12'])
  })

  it('joins each attachment to its media through castToTextOnSqlite', async () => {
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
        join.on('attachments.mediaId', '=', castToTextOnSqlite(db, 'medias.id'))
      )
      .select('medias.id')
      .where('attachments.statusId', '=', 'status-join')
      .execute()
    expect(rows.map((row) => Number(row.id))).toEqual([first.id])
    expect(first.id).not.toBe(second.id)
  })
})
