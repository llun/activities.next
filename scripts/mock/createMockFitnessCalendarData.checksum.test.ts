import type { Insertable } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { DB } from '@/lib/database/kysely'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'

import {
  MOCK_APPLICATION_NAME,
  MOCK_PATH_PREFIX,
  checksumSeededRows
} from './createMockFitnessCalendarData'

const STARTED_AT = new Date('2026-09-01T06:30:00.000Z')

// Honours TEST_DATABASE_TYPE, so it runs on PostgreSQL in CI. The digest is the
// same on both backends: it is taken over the rows as Kysely reads them (epoch
// milliseconds, booleans, numbers), not over each driver's raw values.
describe('checksumSeededRows', () => {
  const testDb = createTestDatabase()
  const { db, database } = testDb

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
    await seedDatabase(database)

    await db
      .insertInto('statuses')
      .values([
        {
          id: `${ACTOR1_ID}/statuses/mock-1`,
          actorId: ACTOR1_ID,
          type: 'Note',
          content: '<p>Morning run</p>',
          applicationName: MOCK_APPLICATION_NAME,
          createdAt: STARTED_AT,
          updatedAt: STARTED_AT
        },
        // Not this script's: the application name differs.
        {
          id: `${ACTOR1_ID}/statuses/not-mock`,
          actorId: ACTOR1_ID,
          type: 'Note',
          content: '<p>Not seeded</p>',
          applicationName: 'other',
          createdAt: STARTED_AT,
          updatedAt: STARTED_AT
        }
      ])
      .execute()
    await db
      .insertInto('recipients')
      .values([
        {
          id: 'mock-recipient-1',
          statusId: `${ACTOR1_ID}/statuses/mock-1`,
          actorId: 'https://www.w3.org/ns/activitystreams#Public',
          type: 'to'
        },
        {
          id: 'mock-recipient-2',
          statusId: `${ACTOR1_ID}/statuses/mock-1`,
          actorId: `${ACTOR1_ID}/followers`,
          type: 'cc'
        }
      ])
      .execute()
    // One insert per row: a multi-row insert fills the columns a row leaves
    // out with NULL on SQLite, which `isPrimary` (NOT NULL) refuses.
    const files: Insertable<DB['fitness_files']>[] = [
      {
        id: 'mock-file-1',
        actorId: ACTOR1_ID,
        statusId: `${ACTOR1_ID}/statuses/mock-1`,
        path: `${MOCK_PATH_PREFIX}run.gpx`,
        fileName: 'run.gpx',
        fileType: 'gpx',
        mimeType: 'application/octet-stream',
        bytes: 130000,
        hasMapData: true,
        isPrimary: true,
        processingStatus: 'completed',
        totalDistanceMeters: 8210.5,
        totalDurationSeconds: 2538,
        activityType: 'run',
        activityStartTime: STARTED_AT,
        createdAt: STARTED_AT,
        updatedAt: STARTED_AT,
        deletedAt: null
      },
      {
        id: 'mock-file-2',
        actorId: ACTOR1_ID,
        path: `${MOCK_PATH_PREFIX}ride.fit`,
        fileName: 'ride.fit',
        fileType: 'fit',
        mimeType: 'application/octet-stream',
        bytes: 240000,
        hasMapData: false,
        isPrimary: false,
        processingStatus: 'failed',
        activityStartTime: STARTED_AT,
        createdAt: STARTED_AT,
        updatedAt: STARTED_AT,
        deletedAt: new Date(STARTED_AT.getTime() + 24 * 60 * 60 * 1000)
      },
      // Not this script's: the path is outside the mock prefix.
      {
        id: 'real-file',
        actorId: ACTOR1_ID,
        path: 'activities/real.fit',
        fileName: 'real.fit',
        fileType: 'fit',
        mimeType: 'application/octet-stream',
        bytes: 1
      }
    ]
    for (const file of files) {
      await db.insertInto('fitness_files').values(file).execute()
    }
  })

  afterAll(async () => {
    await testDb.destroy()
  })

  it('counts only the rows the script owns', async () => {
    expect(await checksumSeededRows(db, ACTOR1_ID)).toMatchObject({
      files: 2,
      statuses: 1,
      recipients: 2
    })
  })

  it('is the same digest on every call and on both backends', async () => {
    const first = await checksumSeededRows(db, ACTOR1_ID)
    const second = await checksumSeededRows(db, ACTOR1_ID)

    expect(second.digest).toBe(first.digest)
    expect(first.digest).toBe(
      'd098c22f38e44a4af8e170a1b9c3c9500fc538bac287a619f64451a49997c1ab'
    )
  })

  it('changes when a stored value changes', async () => {
    const before = await checksumSeededRows(db, ACTOR1_ID)
    await db
      .updateTable('fitness_files')
      .set({ isPrimary: true })
      .where('id', '=', 'mock-file-2')
      .execute()

    const after = await checksumSeededRows(db, ACTOR1_ID)

    expect(after.digest).not.toBe(before.digest)
  })
})
