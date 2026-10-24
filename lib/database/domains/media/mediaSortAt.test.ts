import fs from 'fs'
import { sql } from 'kysely'
import path from 'path'

import { timestampValue } from '@/lib/database/kysely/dialect'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'

import { createMedia, markMediaUploadVerified, updateMedia } from './writes'

const testDb = createTestDatabase()
const { database, db } = testDb

const DOMAIN = 'media-sort-at.test'

beforeAll(async () => {
  await testDb.prepare()
  await database.migrate()
})

afterAll(async () => {
  await database.destroy()
})

let sequence = 0
const nextKey = () => {
  sequence += 1
  return String(sequence).padStart(4, '0')
}

const newOwner = async () => {
  const key = nextKey()
  const accountId = `account-${key}`
  const actorId = `https://${DOMAIN}/users/owner${key}`
  await db.insertInto('accounts').values({ id: accountId }).execute()
  await db
    .insertInto('actors')
    .values({
      id: actorId,
      username: `owner${key}`,
      domain: DOMAIN,
      accountId,
      createdAt: new Date(1),
      updatedAt: new Date(1)
    })
    .execute()
  return { accountId, actorId }
}

describe('media sortAt synchronization on write', () => {
  it('creates media without EXIF and sets sortAt to approximately now as a number', async () => {
    const { actorId } = await newOwner()
    const before = Date.now()
    const media = await createMedia(db, {
      actorId,
      original: {
        path: 'medias/no-exif.jpg',
        bytes: 1234,
        mimeType: 'image/jpeg',
        metaData: { width: 800, height: 600 }
      }
    })
    const after = Date.now()
    expect(media).not.toBeNull()

    const row = await db
      .selectFrom('medias')
      .select(['id', 'sortAt', 'createdAt'])
      .where('id', '=', Number(media!.id))
      .executeTakeFirstOrThrow()

    expect(typeof row.sortAt).toBe('number')
    expect(row.sortAt).toBeGreaterThanOrEqual(before)
    expect(row.sortAt).toBeLessThanOrEqual(after)

    const queried = await db
      .selectFrom('medias')
      .select('id')
      .where('id', '=', Number(media!.id))
      .where('sortAt', '>=', timestampValue(before))
      .where('sortAt', '<=', timestampValue(after))
      .executeTakeFirst()
    expect(queried?.id).toBe(Number(media!.id))
  })

  it('creates media with takenAt and sets sortAt to the takenAt timestamp', async () => {
    const { actorId } = await newOwner()
    const takenAt = new Date('2023-08-15T14:30:00.000Z')
    const media = await createMedia(db, {
      actorId,
      original: {
        path: 'medias/with-taken-at.jpg',
        bytes: 2345,
        mimeType: 'image/jpeg',
        metaData: { width: 800, height: 600 }
      },
      details: {
        takenAt: takenAt.getTime()
      }
    })
    expect(media).not.toBeNull()

    const row = await db
      .selectFrom('medias')
      .select(['id', 'sortAt', 'takenAt'])
      .where('id', '=', Number(media!.id))
      .executeTakeFirstOrThrow()

    expect(row.sortAt).toBe(takenAt.getTime())
  })

  it('updates sortAt when updateMedia changes takenAt', async () => {
    const { accountId, actorId } = await newOwner()
    const initialTakenAt = new Date('2023-01-01T00:00:00.000Z')
    const media = await createMedia(db, {
      actorId,
      original: {
        path: 'medias/initial.jpg',
        bytes: 1000,
        mimeType: 'image/jpeg',
        metaData: { width: 800, height: 600 }
      },
      details: {
        takenAt: initialTakenAt.getTime()
      }
    })
    expect(media).not.toBeNull()

    const newTakenAt = new Date('2024-05-20T12:00:00.000Z')
    const result = await updateMedia(db, {
      mediaId: media!.id,
      accountId,
      actorId,
      details: {
        takenAt: newTakenAt.getTime()
      }
    })
    expect(result).not.toBeNull()

    const row = await db
      .selectFrom('medias')
      .select(['id', 'sortAt', 'takenAt'])
      .where('id', '=', Number(media!.id))
      .executeTakeFirstOrThrow()

    expect(row.sortAt).toBe(newTakenAt.getTime())
  })

  it("resets sortAt to row's createdAt when takenAt is cleared", async () => {
    const { accountId, actorId } = await newOwner()
    const takenAt = new Date('2023-02-02T10:00:00.000Z')

    // Seed a row without createdAt to test SQLite TEXT default (CURRENT_TIMESTAMP)
    const seeded = await db
      .insertInto('medias')
      .values({
        actorId,
        original: 'medias/seeded-no-created-at.jpg',
        originalBytes: 1000,
        originalMimeType: 'image/jpeg',
        originalMetaData: JSON.stringify({ width: 640, height: 480 }),
        takenAt,
        sortAt: takenAt
      })
      .returning('id')
      .executeTakeFirstOrThrow()

    const seededRow = await db
      .selectFrom('medias')
      .select(['id', 'createdAt', 'sortAt'])
      .where('id', '=', seeded.id)
      .executeTakeFirstOrThrow()

    expect(seededRow.createdAt).not.toBeNull()

    if (testDb.backend === 'sqlite') {
      const raw = await sql<{ rawCreatedAt: string; rawType: string }>`
        select cast(createdAt as text) as "rawCreatedAt", typeof(createdAt) as "rawType"
        from medias where id = ${seeded.id}
      `.execute(db)
      const { rawCreatedAt, rawType } = raw.rows[0] ?? {}
      expect(rawType).toBe('text')
      expect(typeof rawCreatedAt).toBe('string')
      const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(
        rawCreatedAt
      )
      expect(match).not.toBeNull()
      const [_, y, m, d, h, min, s] = match!
      const expectedUtc = Date.UTC(
        Number(y),
        Number(m) - 1,
        Number(d),
        Number(h),
        Number(min),
        Number(s)
      )
      expect(seededRow.createdAt).toBe(expectedUtc)
    }

    const updated = await updateMedia(db, {
      mediaId: String(seeded.id),
      accountId,
      actorId,
      details: {
        takenAt: null
      }
    })
    expect(updated).not.toBeNull()

    const finalRow = await db
      .selectFrom('medias')
      .select(['id', 'createdAt', 'sortAt'])
      .where('id', '=', seeded.id)
      .executeTakeFirstOrThrow()

    expect(finalRow.sortAt).toBe(finalRow.createdAt)
    if (testDb.backend === 'sqlite') {
      const raw = await sql<{ rawCreatedAt: string }>`
        select cast(createdAt as text) as "rawCreatedAt" from medias where id = ${seeded.id}
      `.execute(db)
      const rawCreatedAt = raw.rows[0]?.rawCreatedAt
      const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(
        rawCreatedAt
      )
      const [_, y, m, d, h, min, s] = match!
      const expectedUtc = Date.UTC(
        Number(y),
        Number(m) - 1,
        Number(d),
        Number(h),
        Number(min),
        Number(s)
      )
      expect(finalRow.sortAt).toBe(expectedUtc)
    }
  })

  it('leaves sortAt untouched when details update does not include takenAt', async () => {
    const { accountId, actorId } = await newOwner()
    const takenAt = new Date('2023-04-10T08:00:00.000Z')
    const media = await createMedia(db, {
      actorId,
      original: {
        path: 'medias/untouched.jpg',
        bytes: 1000,
        mimeType: 'image/jpeg',
        metaData: { width: 800, height: 600 }
      },
      details: {
        takenAt: takenAt.getTime()
      }
    })
    expect(media).not.toBeNull()

    await updateMedia(db, {
      mediaId: media!.id,
      accountId,
      actorId,
      details: {
        placeName: 'Kyoto'
      }
    })

    const afterDetails = await db
      .selectFrom('medias')
      .select(['id', 'sortAt', 'placeName'])
      .where('id', '=', Number(media!.id))
      .executeTakeFirstOrThrow()

    expect(afterDetails.sortAt).toBe(takenAt.getTime())
    expect(afterDetails.placeName).toBe('Kyoto')

    await updateMedia(db, {
      mediaId: media!.id,
      accountId,
      actorId,
      description: 'A photo without takenAt update'
    })

    const afterDesc = await db
      .selectFrom('medias')
      .select(['id', 'sortAt', 'description'])
      .where('id', '=', Number(media!.id))
      .executeTakeFirstOrThrow()

    expect(afterDesc.sortAt).toBe(takenAt.getTime())
    expect(afterDesc.description).toBe('A photo without takenAt update')
  })

  it('sets sortAt when markMediaUploadVerified includes takenAt', async () => {
    const { accountId, actorId } = await newOwner()
    const media = await createMedia(db, {
      actorId,
      original: {
        path: 'medias/pending-upload.jpg',
        bytes: 1000,
        mimeType: 'image/jpeg',
        metaData: {
          width: 800,
          height: 600,
          upload: {
            state: 'pending',
            clientPath: 'client/pending.jpg'
          }
        }
      }
    })
    expect(media).not.toBeNull()

    const verifiedTakenAt = new Date('2024-03-15T09:30:00.000Z')
    const verified = await markMediaUploadVerified(db, {
      mediaId: media!.id,
      accountId,
      verifiedAt: Date.now(),
      details: {
        takenAt: verifiedTakenAt.getTime()
      }
    })
    expect(verified?.transitioned).toBe(true)

    const row = await db
      .selectFrom('medias')
      .select(['id', 'sortAt', 'takenAt'])
      .where('id', '=', Number(media!.id))
      .executeTakeFirstOrThrow()

    expect(row.sortAt).toBe(verifiedTakenAt.getTime())
  })

  it("guards that insertInto('medias') appears ONLY in lib/database/domains/media/writes.ts across non-test files", () => {
    const roots = ['lib', 'app', 'scripts'].map((dir) =>
      path.join(process.cwd(), dir)
    )

    const collectNonTestSourceFiles = (directory: string): string[] => {
      if (!fs.existsSync(directory)) return []
      return fs
        .readdirSync(directory, { withFileTypes: true })
        .flatMap((entry) => {
          const fullPath = path.join(directory, entry.name)
          if (entry.isDirectory()) {
            return entry.name === 'node_modules'
              ? []
              : collectNonTestSourceFiles(fullPath)
          }
          if (
            entry.isFile() &&
            entry.name.endsWith('.ts') &&
            !entry.name.endsWith('.test.ts')
          ) {
            return [fullPath]
          }
          return []
        })
    }

    const allFiles = roots.flatMap((dir) => collectNonTestSourceFiles(dir))
    const filesWithInsert = allFiles.filter((filePath) => {
      const content = fs.readFileSync(filePath, 'utf8')
      return (
        content.includes("insertInto('medias')") ||
        content.includes('insertInto("medias")')
      )
    })

    const relativePaths = filesWithInsert
      .map((filePath) => path.relative(process.cwd(), filePath))
      .map((p) => p.replace(/\\/g, '/'))
      .sort()

    expect(relativePaths).toEqual(['lib/database/domains/media/writes.ts'])
  })
})
