import { type Insertable, sql } from 'kysely'

import { MAX_FITNESS_IMPORT_ERROR_LENGTH } from '@/lib/database/domains/fitnessFile/rows'
import type { FitnessFiles } from '@/lib/database/kysely/db'
import { createSearchActor } from '@/lib/database/sql/searchTestHelpers'
import { CounterKey } from '@/lib/database/sql/utils/counter'
import { formatBucketHour } from '@/lib/database/sql/utils/counterBucket'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

const DOMAIN = 'fileq.test'

// Every `where`, `orderBy`, `limit` and `offset` in the fitness file queries,
// each pinned with a neighbouring row the query must not touch (another
// actor's, account's, status's or batch's file, a deleted, unfinished or
// non-primary one), every sort pinned with ids that sort against time and with
// ties inserted both in and against id order, the Knex paging rules, and the
// transactions of createFitnessFile and deleteFitnessFile rolling back as a
// whole, counters included, when their last write fails. Rows are written
// straight into the tables where a test needs a timestamp, an id order or a
// shape no method produces. Runs on PostgreSQL in CI.

const testDb = createTestDatabase()
const { database } = testDb
const db = () => testDb.db

beforeAll(async () => {
  await testDb.prepare()
  await database.migrate()
})

afterAll(async () => {
  await database.destroy()
})

let accountCount = 0
const newAccount = async () => {
  accountCount += 1
  const id = `fileq-account-${accountCount}`
  await db()
    .insertInto('accounts')
    .values({
      id,
      email: `${id}@${DOMAIN}`,
      createdAt: new Date(),
      updatedAt: new Date()
    })
    .execute()
  return id
}

let actorCount = 0
const newActor = async (accountId?: string) => {
  actorCount += 1
  const username = `fileq${actorCount}`
  const id = `https://${DOMAIN}/users/${username}`
  await createSearchActor(database, { id, username, domain: DOMAIN })
  if (accountId) {
    await db()
      .updateTable('actors')
      .set({ accountId })
      .where('id', '=', id)
      .execute()
  }
  return id
}

let statusCount = 0
const newStatus = async (actorId: string, to = [ACTIVITY_STREAM_PUBLIC]) => {
  statusCount += 1
  const id = `${actorId}/statuses/fileq-${statusCount}`
  await database.createNote({ id, url: id, actorId, text: id, to, cc: [] })
  return id
}

let idCount = 0
const nextId = (prefix: string) => {
  idCount += 1
  return `${prefix}-${String(idCount).padStart(5, '0')}`
}

const at = (iso: string) =>
  new Date(iso.includes('T') ? iso : `${iso}T08:00:00.000Z`)
const ms = (iso: string) => at(iso).getTime()

const seedFile = async (
  actorId: string,
  values: Partial<Insertable<FitnessFiles>> = {}
) => {
  const id = values.id ?? nextId('file')
  await db()
    .insertInto('fitness_files')
    .values({
      path: `fitness/${id}.fit`,
      fileName: `${id}.fit`,
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1,
      processingStatus: 'completed',
      isPrimary: true,
      createdAt: at('2026-01-01'),
      updatedAt: at('2026-01-01'),
      ...values,
      id,
      actorId
    })
    .execute()
  return id
}

const seedRoute = (fitnessFileId: string, actorId: string) =>
  db()
    .insertInto('fitness_file_routes')
    .values({
      fitnessFileId,
      actorId,
      points: '[]',
      pointCount: 0,
      createdAt: at('2026-01-01'),
      updatedAt: at('2026-01-01')
    })
    .execute()

const fileRow = (id: string) =>
  db()
    .selectFrom('fitness_files')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow()

const counterValue = async (id: string) => {
  const row = await db()
    .selectFrom('counters')
    .select('value')
    .where('id', '=', id)
    .executeTakeFirst()
  return row ? Number(row.value) : null
}

const setCounter = (id: string, value: number) =>
  db()
    .insertInto('counters')
    .values({ id, value, createdAt: new Date(), updatedAt: new Date() })
    .onConflict((conflict) => conflict.column('id').doUpdateSet({ value }))
    .execute()

const idsOf = (files: { id: string }[]) => files.map((file) => file.id)

const TABLES = ['fitness_files', 'fitness_file_routes', 'counters'] as const

const dumpTables = async () => {
  const dump: Record<string, unknown[]> = {}
  dump.fitness_files = await db()
    .selectFrom('fitness_files')
    .selectAll()
    .orderBy('id')
    .execute()
  dump.fitness_file_routes = await db()
    .selectFrom('fitness_file_routes')
    .selectAll()
    .orderBy('fitnessFileId')
    .execute()
  dump.counters = await db()
    .selectFrom('counters')
    .selectAll()
    .orderBy('id')
    .execute()
  return dump
}

// Makes the next write on `table` matching `condition` (SQL over `new` or
// `old`, valid on both backends) fail. Returns the function that removes the
// trigger again.
let triggerCount = 0
const failWrite = async (
  table: (typeof TABLES)[number],
  event: 'insert' | 'update' | 'delete',
  condition: string
) => {
  triggerCount += 1
  const name = `file_queries_fail_${triggerCount}`
  if (testDb.backend === 'pg') {
    await sql
      .raw(
        `create or replace function ${name}() returns trigger language plpgsql as $$ begin raise exception 'forced failure'; end $$`
      )
      .execute(db())
    await sql
      .raw(
        `create trigger ${name} before ${event} on "${table}" for each row when (${condition}) execute function ${name}()`
      )
      .execute(db())
    return async () => {
      await sql.raw(`drop trigger ${name} on "${table}"`).execute(db())
      await sql.raw(`drop function ${name}()`).execute(db())
    }
  }
  await sql
    .raw(
      `create trigger ${name} before ${event} on "${table}" when ${condition} begin select raise(abort, 'forced failure'); end`
    )
    .execute(db())
  return async () => {
    await sql.raw(`drop trigger ${name}`).execute(db())
  }
}

// Runs `action` expecting it to fail on the forced write, then checks every
// table the domain writes is exactly as it was.
const expectRolledBack = async (
  drop: () => Promise<void>,
  action: () => Promise<unknown>
) => {
  const before = await dumpTables()
  try {
    await expect(action()).rejects.toThrow('forced failure')
  } finally {
    await drop()
  }
  expect(await dumpTables()).toEqual(before)
}

describe('file reads', () => {
  it('getFitnessFile maps every column of the row', async () => {
    const actorId = await newActor()
    const statusId = await newStatus(actorId)
    const id = await seedFile(actorId, {
      statusId,
      path: 'fitness/full.fit',
      fileName: 'full.fit',
      fileType: 'gpx',
      mimeType: 'application/gpx+xml',
      bytes: 4096,
      description: 'Long ride',
      hasMapData: true,
      mapImagePath: 'maps/full.webp',
      mapImageEmailPath: 'maps/full.jpg',
      mapError: 'tile server down',
      processingStatus: 'failed',
      isPrimary: false,
      importBatchId: 'batch-full',
      importStatus: 'failed',
      importError: 'bad file',
      totalDistanceMeters: 1234.5,
      totalDurationSeconds: 600,
      movingTimeSeconds: 550,
      elevationGainMeters: 12.5,
      activityType: 'cycling',
      activityStartTime: at('2026-03-01T06:30:00.000Z'),
      deviceManufacturer: 'garmin',
      deviceName: 'Edge 540',
      sourceUrl: 'https://example.test/activity/1',
      gearId: 'gear-full',
      deviceGearId: 'device-full',
      avgPower: 210,
      maxPower: 800,
      avgHeartRate: 140,
      maxHeartRate: 180,
      totalWorkKj: 500,
      elevationSeries: JSON.stringify([1, '2', 'x', 3.5]),
      createdAt: at('2026-03-01T07:00:00.000Z'),
      updatedAt: at('2026-03-02T07:00:00.000Z')
    })

    expect(await database.getFitnessFile({ id })).toEqual({
      id,
      actorId,
      statusId,
      path: 'fitness/full.fit',
      fileName: 'full.fit',
      fileType: 'gpx',
      mimeType: 'application/gpx+xml',
      bytes: 4096,
      description: 'Long ride',
      hasMapData: true,
      mapImagePath: 'maps/full.webp',
      mapImageEmailPath: 'maps/full.jpg',
      mapError: 'tile server down',
      processingStatus: 'failed',
      isPrimary: false,
      importBatchId: 'batch-full',
      importStatus: 'failed',
      importError: 'bad file',
      totalDistanceMeters: 1234.5,
      totalDurationSeconds: 600,
      movingTimeSeconds: 550,
      elevationGainMeters: 12.5,
      avgPower: 210,
      maxPower: 800,
      avgHeartRate: 140,
      maxHeartRate: 180,
      totalWorkKj: 500,
      elevationSeries: [1, 2, 3.5],
      activityType: 'cycling',
      deviceManufacturer: 'garmin',
      deviceName: 'Edge 540',
      sourceUrl: 'https://example.test/activity/1',
      gearId: 'gear-full',
      deviceGearId: 'device-full',
      activityStartTime: ms('2026-03-01T06:30:00.000Z'),
      createdAt: ms('2026-03-01T07:00:00.000Z'),
      updatedAt: ms('2026-03-02T07:00:00.000Z'),
      deletedAt: undefined
    })
  })

  it('getFitnessFile maps the unset columns to their defaults', async () => {
    const actorId = await newActor()
    const id = await seedFile(actorId, {
      processingStatus: null,
      hasMapData: null,
      elevationSeries: 'not json'
    })

    expect(await database.getFitnessFile({ id })).toEqual({
      id,
      actorId,
      statusId: undefined,
      path: `fitness/${id}.fit`,
      fileName: `${id}.fit`,
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1,
      description: undefined,
      hasMapData: false,
      mapImagePath: undefined,
      mapImageEmailPath: undefined,
      mapError: undefined,
      processingStatus: 'pending',
      isPrimary: true,
      importBatchId: undefined,
      importStatus: undefined,
      importError: undefined,
      totalDistanceMeters: undefined,
      totalDurationSeconds: undefined,
      movingTimeSeconds: undefined,
      elevationGainMeters: undefined,
      avgPower: undefined,
      maxPower: undefined,
      avgHeartRate: undefined,
      maxHeartRate: undefined,
      totalWorkKj: undefined,
      elevationSeries: undefined,
      activityType: undefined,
      deviceManufacturer: undefined,
      deviceName: undefined,
      sourceUrl: undefined,
      gearId: undefined,
      deviceGearId: undefined,
      activityStartTime: undefined,
      createdAt: ms('2026-01-01'),
      updatedAt: ms('2026-01-01'),
      deletedAt: undefined
    })
  })

  it('getFitnessFile reads the asked file, never a neighbour or a deleted one', async () => {
    const actorId = await newActor()
    await seedFile(actorId, { createdAt: at('2026-01-01') })
    const id = await seedFile(actorId, { createdAt: at('2026-01-02') })
    const deletedId = await seedFile(actorId, {
      deletedAt: at('2026-01-03')
    })

    expect((await database.getFitnessFile({ id }))?.id).toBe(id)
    expect(await database.getFitnessFile({ id: deletedId })).toBeNull()
    expect(await database.getFitnessFile({ id: 'fileq-missing' })).toBeNull()
  })

  it('getFitnessFilesByIds answers in the asked order, without deleted or missing files', async () => {
    const actorId = await newActor()
    const first = await seedFile(actorId)
    const second = await seedFile(actorId)
    const deleted = await seedFile(actorId, { deletedAt: at('2026-01-02') })
    await seedFile(actorId)

    expect(
      idsOf(
        await database.getFitnessFilesByIds({
          fitnessFileIds: [second, 'fileq-missing', deleted, first, second]
        })
      )
    ).toEqual([second, first, second])
    expect(await database.getFitnessFilesByIds({ fitnessFileIds: [] })).toEqual(
      []
    )
  })

  describe('getFitnessFilesByActor and countFitnessFilesByActor', () => {
    let actorId: string
    // Ids sort against time, and the two tie groups are inserted one in id
    // order and one against it, so a missing tie-break shows whichever way
    // the database breaks a tie.
    const order = {
      t1: 'byactor-9',
      t2: 'byactor-8',
      t3: 'byactor-7',
      t4a: 'byactor-5',
      t4b: 'byactor-6',
      t5a: 'byactor-3',
      t5b: 'byactor-4'
    }

    beforeAll(async () => {
      actorId = await newActor()
      const otherActorId = await newActor()
      await seedFile(actorId, { id: order.t3, createdAt: at('2026-02-03') })
      await seedFile(actorId, { id: order.t1, createdAt: at('2026-02-01') })
      await seedFile(actorId, { id: order.t4a, createdAt: at('2026-02-04') })
      await seedFile(actorId, { id: order.t4b, createdAt: at('2026-02-04') })
      await seedFile(actorId, { id: order.t2, createdAt: at('2026-02-02') })
      await seedFile(actorId, { id: order.t5b, createdAt: at('2026-02-05') })
      await seedFile(actorId, { id: order.t5a, createdAt: at('2026-02-05') })
      await seedFile(actorId, {
        id: 'byactor-0',
        createdAt: at('2026-02-06'),
        deletedAt: at('2026-02-07')
      })
      await seedFile(otherActorId, {
        id: 'byactor-1',
        createdAt: at('2026-02-06')
      })
    })

    it('reads the actor’s files newest first, ties by id, deleted and other actors’ left out', async () => {
      expect(idsOf(await database.getFitnessFilesByActor({ actorId }))).toEqual(
        [
          order.t5b,
          order.t5a,
          order.t4b,
          order.t4a,
          order.t3,
          order.t2,
          order.t1
        ]
      )
      expect(await database.countFitnessFilesByActor({ actorId })).toBe(7)
    })

    it('reads oldest first with asc, and resumes strictly after a cursor', async () => {
      const ascending = [
        order.t1,
        order.t2,
        order.t3,
        order.t4a,
        order.t4b,
        order.t5a,
        order.t5b
      ]
      expect(
        idsOf(
          await database.getFitnessFilesByActor({
            actorId,
            orderDirection: 'asc'
          })
        )
      ).toEqual(ascending)

      // A cursor inside a tie group resumes at its next id.
      expect(
        idsOf(
          await database.getFitnessFilesByActor({
            actorId,
            orderDirection: 'asc',
            afterCursor: { createdAt: ms('2026-02-04'), id: order.t4a }
          })
        )
      ).toEqual([order.t4b, order.t5a, order.t5b])
      // At the last id of a group it moves on to the next timestamp.
      expect(
        idsOf(
          await database.getFitnessFilesByActor({
            actorId,
            orderDirection: 'asc',
            afterCursor: { createdAt: ms('2026-02-04'), id: order.t4b }
          })
        )
      ).toEqual([order.t5a, order.t5b])
    })

    it('ignores the cursor on a newest-first read', async () => {
      expect(
        idsOf(
          await database.getFitnessFilesByActor({
            actorId,
            afterCursor: { createdAt: ms('2026-02-04'), id: order.t4a }
          })
        )
      ).toHaveLength(7)
    })

    it('pages with limit and offset as Knex read them', async () => {
      const page = (limit: number, offset?: number) =>
        database
          .getFitnessFilesByActor({
            actorId,
            orderDirection: 'asc',
            limit,
            ...(offset === undefined ? {} : { offset })
          })
          .then(idsOf)

      expect(await page(2)).toEqual([order.t1, order.t2])
      expect(await page(2, 2)).toEqual([order.t3, order.t4a])
      expect(await page(0)).toEqual([])
      // Fractions are truncated, as Knex's parseInt did.
      expect(await page(2.9, 1.9)).toEqual([order.t2, order.t3])
      // A NaN limit or offset is dropped.
      expect(await page(Number.NaN)).toHaveLength(7)
      expect(await page(1, Number.NaN)).toEqual([order.t1])
      // An offset without a limit still skips (SQLite needs `limit -1`).
      expect(await page(Number.NaN, 5)).toEqual([order.t5a, order.t5b])
      await expect(page(2, -1)).rejects.toThrow(
        'A non-negative integer must be provided to offset.'
      )
    })

    it('answers 25 files by default', async () => {
      const busyActorId = await newActor()
      for (let index = 0; index < 26; index += 1) {
        await seedFile(busyActorId, {
          id: `busy-${String(index).padStart(3, '0')}`,
          createdAt: new Date(ms('2026-04-01') + index * 1000)
        })
      }
      const files = await database.getFitnessFilesByActor({
        actorId: busyActorId
      })
      expect(files).toHaveLength(25)
      expect(files[0].id).toBe('busy-025')
      expect(
        await database.countFitnessFilesByActor({ actorId: busyActorId })
      ).toBe(26)
    })
  })

  describe('the getFitnessFilesByActor filters', () => {
    let actorId: string
    const files: Record<string, string> = {}

    beforeAll(async () => {
      actorId = await newActor()
      const seed = async (
        key: string,
        values: Partial<Insertable<FitnessFiles>>
      ) => {
        files[key] = await seedFile(actorId, {
          id: `filter-${key}`,
          activityType: 'running',
          ...values
        })
      }
      await seed('a', {
        activityStartTime: at('2026-05-01'),
        createdAt: at('2026-05-01')
      })
      await seed('b', {
        processingStatus: 'failed',
        activityStartTime: at('2026-05-02'),
        createdAt: at('2026-05-02')
      })
      await seed('c', {
        isPrimary: false,
        activityType: 'cycling',
        activityStartTime: at('2026-05-03'),
        createdAt: at('2026-05-03')
      })
      await seed('d', {
        activityType: null,
        activityStartTime: at('2026-05-04'),
        createdAt: at('2026-05-04')
      })
      await seed('e', {
        activityStartTime: null,
        createdAt: at('2026-05-05')
      })
    })

    const both = async (filters: Record<string, unknown>) => {
      const params = { actorId, orderDirection: 'asc' as const, ...filters }
      const read = idsOf(await database.getFitnessFilesByActor(params))
      expect(await database.countFitnessFilesByActor(params)).toBe(read.length)
      return read.map((id) => id.replace('filter-', ''))
    }

    it('filters by processing status, ignoring an empty one', async () => {
      expect(await both({ processingStatus: 'failed' })).toEqual(['b'])
      expect(await both({ processingStatus: 'completed' })).toEqual([
        'a',
        'c',
        'd',
        'e'
      ])
      expect(await both({ processingStatus: '' })).toHaveLength(5)
    })

    it('filters by isPrimary either way', async () => {
      expect(await both({ isPrimary: false })).toEqual(['c'])
      expect(await both({ isPrimary: true })).toEqual(['a', 'b', 'd', 'e'])
    })

    it('filters by activity type, null meaning untyped', async () => {
      expect(await both({ activityType: null })).toEqual(['d'])
      expect(await both({ activityType: 'running' })).toEqual(['a', 'b', 'e'])
    })

    it('bounds the start time inclusively at both ends', async () => {
      expect(await both({ startDate: at('2026-05-02') })).toEqual([
        'b',
        'c',
        'd'
      ])
      expect(await both({ endDate: at('2026-05-02') })).toEqual(['a', 'b'])
      expect(
        await both({ startDate: at('2026-05-02'), endDate: at('2026-05-03') })
      ).toEqual(['b', 'c'])
    })
  })

  it('getRetriableFitnessImportBatchIds lists each batch with a failed or stranded file once', async () => {
    const actorId = await newActor()
    const otherActorId = await newActor()
    const statusId = await newStatus(actorId)
    const stuckBefore = at('2026-06-10')
    const old = at('2026-06-01')
    const fresh = new Date(stuckBefore.getTime() + 1)
    const recent = at('2026-06-20')
    const seed = (
      batch: string | null,
      values: Partial<Insertable<FitnessFiles>>,
      owner = actorId
    ) =>
      seedFile(owner, {
        importBatchId: batch,
        importStatus: 'completed',
        processingStatus: 'completed',
        updatedAt: recent,
        ...values
      })

    await seed('retry-import-failed', { importStatus: 'failed' })
    await seed('retry-import-failed', { importStatus: 'failed' })
    await seed('retry-processing-failed', { processingStatus: 'failed' })
    await seed('retry-processing-stuck', {
      processingStatus: 'processing',
      updatedAt: stuckBefore
    })
    await seed('retry-processing-fresh', {
      processingStatus: 'processing',
      updatedAt: fresh
    })
    await seed('retry-import-stuck', {
      importStatus: 'pending',
      updatedAt: stuckBefore
    })
    await seed('retry-import-posted', {
      importStatus: 'pending',
      statusId,
      updatedAt: old
    })
    await seed('retry-import-fresh', {
      importStatus: 'pending',
      updatedAt: fresh
    })
    // Old and settled: caught by any arm that loses its status predicate.
    await seed('retry-done', { updatedAt: old })
    await seed(null, { importStatus: 'failed' })
    await seed('retry-deleted', {
      importStatus: 'failed',
      deletedAt: recent
    })
    await seed('retry-other-actor', { importStatus: 'failed' }, otherActorId)

    const batchIds = await database.getRetriableFitnessImportBatchIds({
      actorId,
      stuckBefore
    })
    expect([...batchIds].sort()).toEqual([
      'retry-import-failed',
      'retry-import-stuck',
      'retry-processing-failed',
      'retry-processing-stuck'
    ])
  })

  describe('getFitnessFilesWithStatusForAccount', () => {
    let accountId: string
    const order = {
      t1: 'account-9',
      t2: 'account-8',
      t6: 'account-1'
    }

    beforeAll(async () => {
      accountId = await newAccount()
      const firstActor = await newActor(accountId)
      const secondActor = await newActor(accountId)
      const otherAccountActor = await newActor(await newAccount())
      const accountlessActor = await newActor()
      await seedFile(secondActor, { id: order.t2, createdAt: at('2026-07-02') })
      await seedFile(firstActor, { id: order.t6, createdAt: at('2026-07-06') })
      await seedFile(firstActor, { id: order.t1, createdAt: at('2026-07-01') })
      await seedFile(firstActor, {
        id: 'account-7',
        createdAt: at('2026-07-03'),
        deletedAt: at('2026-07-04')
      })
      await seedFile(otherAccountActor, {
        id: 'account-6',
        createdAt: at('2026-07-04')
      })
      await seedFile(accountlessActor, {
        id: 'account-5',
        createdAt: at('2026-07-05')
      })
      await setCounter(CounterKey.totalFitness(accountId), 42)
      await setCounter(CounterKey.fitnessUsage(accountId), 9999)
    })

    it('lists the account’s files across its actors, newest first, with the counter total', async () => {
      const result = await database.getFitnessFilesWithStatusForAccount({
        accountId
      })
      expect(idsOf(result.items)).toEqual([order.t6, order.t2, order.t1])
      expect(result.total).toBe(42)
    })

    it('bounds by maxCreatedAt strictly, 0 meaning no bound', async () => {
      expect(
        idsOf(
          (
            await database.getFitnessFilesWithStatusForAccount({
              accountId,
              maxCreatedAt: ms('2026-07-06')
            })
          ).items
        )
      ).toEqual([order.t2, order.t1])
      expect(
        (
          await database.getFitnessFilesWithStatusForAccount({
            accountId,
            maxCreatedAt: 0
          })
        ).items
      ).toHaveLength(3)
    })

    it('pages by limit and page as Knex read them', async () => {
      const page = async (limit: number, pageNumber: number) =>
        idsOf(
          (
            await database.getFitnessFilesWithStatusForAccount({
              accountId,
              limit,
              page: pageNumber
            })
          ).items
        )
      expect(await page(1, 2)).toEqual([order.t2])
      expect(await page(2, 2)).toEqual([order.t1])
      // A NaN offset is dropped, and a NaN limit with it.
      expect(await page(1, Number.NaN)).toEqual([order.t6])
      expect(await page(Number.NaN, 2)).toEqual([order.t6, order.t2, order.t1])
      await expect(page(1, 0)).rejects.toThrow(
        'A non-negative integer must be provided to offset.'
      )
    })

    it('answers 0 without a counter, and 100 files by default', async () => {
      const busyAccountId = await newAccount()
      const busyActorId = await newActor(busyAccountId)
      for (let index = 0; index < 101; index += 1) {
        await seedFile(busyActorId, {
          id: `account-busy-${String(index).padStart(3, '0')}`,
          createdAt: new Date(ms('2026-08-01') + index * 1000)
        })
      }
      const result = await database.getFitnessFilesWithStatusForAccount({
        accountId: busyAccountId
      })
      expect(result.total).toBe(0)
      expect(result.items).toHaveLength(100)
      expect(result.items[0].id).toBe('account-busy-100')
    })
  })

  describe('the files of a status', () => {
    let statusId: string
    // The order the reads promise: primary first, then start time, then
    // upload time. Each pair below is inserted so that dropping one sort key
    // reorders it, and the two tie groups go in opposite id orders.
    const expected = [
      'bystatus-p2',
      'bystatus-p1',
      'bystatus-p3',
      'bystatus-n3',
      'bystatus-n2'
    ]

    beforeAll(async () => {
      const actorId = await newActor()
      statusId = await newStatus(actorId)
      const otherStatusId = await newStatus(actorId)
      // Primary, same start: p2 was uploaded first, but is inserted last.
      await seedFile(actorId, {
        id: 'bystatus-p1',
        statusId,
        activityStartTime: at('2026-09-01'),
        createdAt: at('2026-09-12')
      })
      // Primary, later start, uploaded earliest of all.
      await seedFile(actorId, {
        id: 'bystatus-p3',
        statusId,
        activityStartTime: at('2026-09-02'),
        createdAt: at('2026-09-10')
      })
      await seedFile(actorId, {
        id: 'bystatus-p2',
        statusId,
        activityStartTime: at('2026-09-01'),
        createdAt: at('2026-09-11')
      })
      // Secondaries with the earliest start of all; the same start, so the
      // upload time orders them, inserted in that order.
      await seedFile(actorId, {
        id: 'bystatus-n3',
        statusId,
        isPrimary: false,
        activityStartTime: at('2026-08-01'),
        createdAt: at('2026-09-13')
      })
      await seedFile(actorId, {
        id: 'bystatus-n2',
        statusId,
        isPrimary: false,
        activityStartTime: at('2026-08-01'),
        createdAt: at('2026-09-14')
      })
      await seedFile(actorId, {
        id: 'bystatus-other',
        statusId: otherStatusId,
        activityStartTime: at('2026-07-01'),
        createdAt: at('2026-07-01')
      })
      await seedFile(actorId, {
        id: 'bystatus-deleted',
        statusId,
        activityStartTime: at('2026-07-01'),
        createdAt: at('2026-07-01'),
        deletedAt: at('2026-07-02')
      })
    })

    it('getFitnessFilesByStatus lists them primary first, then by start and upload time', async () => {
      expect(
        idsOf(await database.getFitnessFilesByStatus({ statusId }))
      ).toEqual(expected)
    })

    it('getFitnessFileByStatus answers the first of them', async () => {
      expect((await database.getFitnessFileByStatus({ statusId }))?.id).toBe(
        expected[0]
      )
      expect(
        await database.getFitnessFileByStatus({ statusId: 'fileq-missing' })
      ).toBeNull()
    })
  })

  it('getFitnessFilesByBatchId lists the batch oldest first', async () => {
    const actorId = await newActor()
    await seedFile(actorId, {
      id: 'batch-2',
      importBatchId: 'batch-x',
      createdAt: at('2026-10-02')
    })
    await seedFile(actorId, {
      id: 'batch-3',
      importBatchId: 'batch-x',
      createdAt: at('2026-10-01')
    })
    await seedFile(actorId, {
      id: 'batch-1',
      importBatchId: 'batch-x',
      createdAt: at('2026-10-03')
    })
    await seedFile(actorId, {
      id: 'batch-0',
      importBatchId: 'batch-x',
      createdAt: at('2026-09-01'),
      deletedAt: at('2026-09-02')
    })
    await seedFile(actorId, {
      id: 'batch-4',
      importBatchId: 'batch-y',
      createdAt: at('2026-09-01')
    })

    expect(
      idsOf(await database.getFitnessFilesByBatchId({ batchId: 'batch-x' }))
    ).toEqual(['batch-3', 'batch-2', 'batch-1'])
  })

  it('getFitnessStorageUsageForAccount reads the account’s usage counter', async () => {
    const accountId = await newAccount()
    await setCounter(CounterKey.fitnessUsage(accountId), 1234)
    await setCounter(CounterKey.totalFitness(accountId), 7)

    expect(await database.getFitnessStorageUsageForAccount({ accountId })).toBe(
      1234
    )
    expect(
      await database.getFitnessStorageUsageForAccount({
        accountId: await newAccount()
      })
    ).toBe(0)
  })
})

describe('the fitness overview reads', () => {
  let actorId: string
  let otherActorId: string
  const windowStart = ms('2026-03-10T00:00:00.000Z')
  const windowEnd = ms('2026-03-13T00:00:00.000Z')

  beforeAll(async () => {
    actorId = await newActor()
    otherActorId = await newActor()
    const seed = (values: Partial<Insertable<FitnessFiles>>, owner = actorId) =>
      seedFile(owner, { activityType: 'running', ...values })

    // Counted: the first instant of the window, and the last.
    await seed({
      id: 'overview-9',
      activityStartTime: new Date(windowStart),
      totalDistanceMeters: 1000,
      totalDurationSeconds: 100,
      elevationGainMeters: 10
    })
    await seed({
      id: 'overview-8',
      activityStartTime: new Date(windowEnd - 1),
      totalDistanceMeters: 2000,
      totalDurationSeconds: 200,
      elevationGainMeters: 20
    })
    // Counted, at the same instant: inserted against id order.
    await seed({
      id: 'overview-6',
      activityType: 'cycling',
      activityStartTime: at('2026-03-11T12:00:00.000Z'),
      totalDistanceMeters: 30000,
      totalDurationSeconds: 3000,
      elevationGainMeters: 300
    })
    await seed({
      id: 'overview-5',
      activityType: null,
      activityStartTime: at('2026-03-11T12:00:00.000Z'),
      totalDistanceMeters: null,
      totalDurationSeconds: 50,
      elevationGainMeters: null
    })
    // Left out: outside the window, not countable, or someone else's.
    await seed({
      id: 'overview-out-end',
      activityStartTime: new Date(windowEnd)
    })
    await seed({
      id: 'overview-out-start',
      activityStartTime: new Date(windowStart - 1)
    })
    await seed({
      id: 'overview-out-secondary',
      isPrimary: false,
      activityStartTime: at('2026-03-11T00:00:00.000Z')
    })
    await seed({
      id: 'overview-out-processing',
      processingStatus: 'processing',
      activityStartTime: at('2026-03-11T00:00:00.000Z')
    })
    await seed({
      id: 'overview-out-deleted',
      deletedAt: at('2026-03-12T00:00:00.000Z'),
      activityStartTime: at('2026-03-11T00:00:00.000Z')
    })
    await seed({ id: 'overview-out-untimed', activityStartTime: null })
    await seed(
      {
        id: 'overview-out-other',
        activityStartTime: at('2026-03-11T00:00:00.000Z')
      },
      otherActorId
    )
  })

  it('getFitnessActivitySummary totals the window by activity type', async () => {
    const summary = await database.getFitnessActivitySummary({
      actorId,
      startDate: windowStart,
      endDate: windowEnd
    })
    expect(
      [...summary].sort((a, b) =>
        String(a.activityType).localeCompare(String(b.activityType))
      )
    ).toEqual([
      {
        activityType: 'cycling',
        count: 1,
        totalDistanceMeters: 30000,
        totalDurationSeconds: 3000,
        totalElevationGainMeters: 300
      },
      {
        activityType: null,
        count: 1,
        totalDistanceMeters: 0,
        totalDurationSeconds: 50,
        totalElevationGainMeters: 0
      },
      {
        activityType: 'running',
        count: 2,
        totalDistanceMeters: 3000,
        totalDurationSeconds: 300,
        totalElevationGainMeters: 30
      }
    ])
  })

  it('getFitnessActivityCalendarData buckets the window by local day', async () => {
    expect(
      await database.getFitnessActivityCalendarData({
        actorId,
        startDate: windowStart,
        endDate: windowEnd,
        timeZone: 'UTC'
      })
    ).toEqual([
      {
        date: '2026-03-10',
        count: 1,
        totalDistanceMeters: 1000,
        totalDurationSeconds: 100,
        totalElevationGainMeters: 10
      },
      {
        date: '2026-03-11',
        count: 2,
        totalDistanceMeters: 30000,
        totalDurationSeconds: 3050,
        totalElevationGainMeters: 300
      },
      {
        date: '2026-03-12',
        count: 1,
        totalDistanceMeters: 2000,
        totalDurationSeconds: 200,
        totalElevationGainMeters: 20
      }
    ])
    // In Tokyo the last activity (23:59:59.999 UTC) is on the 13th.
    expect(
      (
        await database.getFitnessActivityCalendarData({
          actorId,
          startDate: windowStart,
          endDate: windowEnd,
          timeZone: 'Asia/Tokyo'
        })
      ).map((day) => day.date)
    ).toEqual(['2026-03-10', '2026-03-11', '2026-03-13'])
  })

  it('getFitnessActivityCalendarData filters by activity type and refuses an unknown zone', async () => {
    expect(
      await database.getFitnessActivityCalendarData({
        actorId,
        startDate: windowStart,
        endDate: windowEnd,
        timeZone: 'UTC',
        activityType: 'cycling'
      })
    ).toEqual([
      {
        date: '2026-03-11',
        count: 1,
        totalDistanceMeters: 30000,
        totalDurationSeconds: 3000,
        totalElevationGainMeters: 300
      }
    ])
    await expect(
      database.getFitnessActivityCalendarData({
        actorId,
        startDate: windowStart,
        endDate: windowEnd,
        timeZone: 'Not/AZone'
      })
    ).rejects.toThrow('Invalid time zone: "Not/AZone"')
  })

  it('getFitnessActivitiesInWindow pages the window oldest first, ties by id', async () => {
    const page = (limit: number, offset: number) =>
      database.getFitnessActivitiesInWindow({
        actorId,
        startDate: windowStart,
        endDate: windowEnd,
        limit,
        offset
      })

    const all = await page(10, 0)
    expect(all.hasMore).toBe(false)
    expect(all.activities).toEqual([
      {
        id: 'overview-9',
        statusId: null,
        activityType: 'running',
        startTime: windowStart,
        totalDistanceMeters: 1000,
        totalDurationSeconds: 100,
        elevationGainMeters: 10,
        description: null,
        fileName: 'overview-9.fit'
      },
      expect.objectContaining({ id: 'overview-5', activityType: null }),
      expect.objectContaining({ id: 'overview-6' }),
      expect.objectContaining({ id: 'overview-8', startTime: windowEnd - 1 })
    ])
    expect(all.activities[1]).toMatchObject({
      totalDistanceMeters: null,
      totalDurationSeconds: 50,
      elevationGainMeters: null
    })

    const first = await page(2, 0)
    expect(idsOf(first.activities)).toEqual(['overview-9', 'overview-5'])
    expect(first.hasMore).toBe(true)
    const second = await page(2, 2)
    expect(idsOf(second.activities)).toEqual(['overview-6', 'overview-8'])
    expect(second.hasMore).toBe(false)
    // Fractions round down, and a page holds at least one activity.
    expect(idsOf((await page(1.9, 1.9)).activities)).toEqual(['overview-5'])
    expect(idsOf((await page(0, 0)).activities)).toEqual(['overview-9'])
  })

  it('getFitnessActivitiesInWindow caps a page at 100 activities', async () => {
    const busyActorId = await newActor()
    for (let index = 0; index < 101; index += 1) {
      await seedFile(busyActorId, {
        id: `window-busy-${String(index).padStart(3, '0')}`,
        activityType: 'running',
        activityStartTime: new Date(windowStart + index * 1000)
      })
    }
    const result = await database.getFitnessActivitiesInWindow({
      actorId: busyActorId,
      startDate: windowStart,
      endDate: windowEnd,
      limit: 500,
      offset: 0
    })
    expect(result.activities).toHaveLength(100)
    expect(result.hasMore).toBe(true)
  })

  it('getFitnessActivityTimeBounds answers the earliest countable activity', async () => {
    expect(await database.getFitnessActivityTimeBounds({ actorId })).toEqual({
      earliest: windowStart - 1
    })
    expect(
      await database.getFitnessActivityTimeBounds({ actorId: otherActorId })
    ).toEqual({ earliest: ms('2026-03-11T00:00:00.000Z') })

    const quietActorId = await newActor()
    await seedFile(quietActorId, { activityStartTime: null })
    await seedFile(quietActorId, {
      isPrimary: false,
      activityStartTime: at('2026-01-01')
    })
    expect(
      await database.getFitnessActivityTimeBounds({ actorId: quietActorId })
    ).toEqual({ earliest: null })
  })

  it('getFitnessActivityTimeBounds reads a SQLite text timestamp', async () => {
    if (testDb.backend !== 'sqlite') return
    const textActorId = await newActor()
    const id = await seedFile(textActorId)
    await sql`update fitness_files set "activityStartTime" = '2026-02-03 04:05:06' where id = ${id}`.execute(
      db()
    )
    expect(
      await database.getFitnessActivityTimeBounds({ actorId: textActorId })
    ).toEqual({ earliest: ms('2026-02-03T04:05:06.000Z') })
  })

  describe('getActorHasFitnessData', () => {
    it('needs a completed, primary, typed and timed file of the actor’s own', async () => {
      const qualifies = await newActor()
      await seedFile(qualifies, {
        activityType: 'running',
        activityStartTime: at('2026-01-01')
      })
      expect(
        await database.getActorHasFitnessData({ actorId: qualifies })
      ).toBe(true)

      const shapes: Partial<Insertable<FitnessFiles>>[] = [
        { processingStatus: 'processing' },
        { isPrimary: false },
        { deletedAt: at('2026-01-02') },
        { activityType: null },
        { activityStartTime: null }
      ]
      for (const shape of shapes) {
        const lacking = await newActor()
        await seedFile(lacking, {
          activityType: 'running',
          activityStartTime: at('2026-01-01'),
          ...shape
        })
        expect(
          await database.getActorHasFitnessData({ actorId: lacking })
        ).toBe(false)
      }
      expect(
        await database.getActorHasFitnessData({ actorId: await newActor() })
      ).toBe(false)
    })

    it('counts only files on a status the audience may see', async () => {
      const owner = await newActor()
      const viewer = await newActor()
      const stranger = await newActor()
      const followersOnly = await newStatus(owner, [`${owner}/followers`])
      const direct = await newStatus(owner, [viewer])
      const timed = {
        activityType: 'running',
        activityStartTime: at('2026-01-01')
      }
      await seedFile(owner, { ...timed, statusId: followersOnly })
      await seedFile(owner, { ...timed, statusId: direct })
      // Never posted: only the owner's unfiltered view counts it.
      await seedFile(owner, timed)

      const has = (audience: Record<string, unknown>) =>
        database.getActorHasFitnessData({ actorId: owner, ...audience })

      expect(await has({})).toBe(true)
      expect(await has({ publicOnly: true })).toBe(false)
      expect(await has({ visibleToActorId: stranger })).toBe(false)
      expect(await has({ visibleToActorId: viewer })).toBe(true)
      expect(await has({ includeFollowersOnly: true })).toBe(true)

      const publicOwner = await newActor()
      await seedFile(publicOwner, {
        ...timed,
        statusId: await newStatus(publicOwner)
      })
      expect(
        await database.getActorHasFitnessData({
          actorId: publicOwner,
          publicOnly: true
        })
      ).toBe(true)
    })
  })
})

describe('createFitnessFile', () => {
  const bucketId = (type: string) =>
    CounterKey.bucketKey(type, formatBucketHour(new Date()))

  it('writes the file and moves the account and bucket counters', async () => {
    const accountId = await newAccount()
    const actorId = await newActor(accountId)
    await setCounter(CounterKey.fitnessUsage(accountId), 100)
    const filesBucket = (await counterValue(bucketId('fitness-files'))) ?? 0
    const bytesBucket = (await counterValue(bucketId('fitness-bytes'))) ?? 0
    const before = Date.now()

    const created = await database.createFitnessFile({
      actorId,
      statusId: undefined,
      path: 'fitness/created.fit',
      fileName: 'created.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 2048,
      description: 'Commute',
      hasMapData: true,
      mapImagePath: 'maps/created.webp',
      importBatchId: 'batch-created',
      sourceUrl: 'https://example.test/created'
    })

    expect(created).toEqual(await database.getFitnessFile({ id: created!.id }))
    expect(created).toMatchObject({
      actorId,
      bytes: 2048,
      description: 'Commute',
      hasMapData: true,
      mapImagePath: 'maps/created.webp',
      importBatchId: 'batch-created',
      importStatus: 'pending',
      processingStatus: 'pending',
      isPrimary: true,
      sourceUrl: 'https://example.test/created',
      gearId: undefined,
      statusId: undefined
    })
    expect(created!.createdAt).toBeGreaterThanOrEqual(before)
    expect(created!.updatedAt).toBe(created!.createdAt)

    expect(await counterValue(CounterKey.fitnessUsage(accountId))).toBe(2148)
    expect(await counterValue(CounterKey.totalFitness(accountId))).toBe(1)
    expect(await counterValue(bucketId('fitness-files'))).toBe(filesBucket + 1)
    expect(await counterValue(bucketId('fitness-bytes'))).toBe(
      bytesBucket + 2048
    )
    const bucketRow = await db()
      .selectFrom('counters')
      .select('bucketHour')
      .where('id', '=', bucketId('fitness-bytes'))
      .executeTakeFirstOrThrow()
    expect(bucketRow.bucketHour).not.toBeNull()
  })

  it('leaves the byte counters alone for an empty file and an accountless actor', async () => {
    const accountId = await newAccount()
    const actorId = await newActor(accountId)
    const bytesBucket = await counterValue(bucketId('fitness-bytes'))

    const created = await database.createFitnessFile({
      actorId,
      path: 'fitness/empty.gpx',
      fileName: 'empty.gpx',
      fileType: 'gpx',
      mimeType: 'application/gpx+xml',
      bytes: 0
    })
    expect(created).toMatchObject({
      importStatus: undefined,
      hasMapData: false,
      description: undefined
    })
    expect(await counterValue(CounterKey.fitnessUsage(accountId))).toBeNull()
    expect(await counterValue(CounterKey.totalFitness(accountId))).toBe(1)
    expect(await counterValue(bucketId('fitness-bytes'))).toBe(bytesBucket)

    const accountlessActorId = await newActor()
    const countersBefore = await db()
      .selectFrom('counters')
      .select(['id', 'value'])
      .where('id', 'not like', 'bucket:%')
      .orderBy('id')
      .execute()
    await database.createFitnessFile({
      actorId: accountlessActorId,
      path: 'fitness/accountless.fit',
      fileName: 'accountless.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 10
    })
    expect(
      await db()
        .selectFrom('counters')
        .select(['id', 'value'])
        .where('id', 'not like', 'bucket:%')
        .orderBy('id')
        .execute()
    ).toEqual(countersBefore)
  })

  it('rolls back the file and every counter when its last write fails', async () => {
    const accountId = await newAccount()
    const actorId = await newActor(accountId)
    await setCounter(CounterKey.fitnessUsage(accountId), 500)
    // The hour's byte bucket is created afresh, so the bucketHour update after
    // its upsert is a real write, and the last one.
    await db()
      .deleteFrom('counters')
      .where('id', 'like', 'bucket:fitness-bytes:%')
      .execute()
    const drop = await failWrite(
      'counters',
      'update',
      `new.id like 'bucket:fitness-bytes:%' and new."bucketHour" is not null and old."bucketHour" is null`
    )
    await expectRolledBack(drop, () =>
      database.createFitnessFile({
        actorId,
        path: 'fitness/rollback.fit',
        fileName: 'rollback.fit',
        fileType: 'fit',
        mimeType: 'application/vnd.ant.fit',
        bytes: 64
      })
    )
  })
})

describe('deleteFitnessFile', () => {
  it('soft-deletes the file, drops its route and moves the account counters', async () => {
    const accountId = await newAccount()
    const actorId = await newActor(accountId)
    const id = await seedFile(actorId, { bytes: 100 })
    const neighbour = await seedFile(actorId, { bytes: 300 })
    await seedRoute(id, actorId)
    await seedRoute(neighbour, actorId)
    await setCounter(CounterKey.fitnessUsage(accountId), 1000)
    await setCounter(CounterKey.totalFitness(accountId), 5)
    const before = Date.now()

    expect(await database.deleteFitnessFile({ id })).toBe(true)

    const row = await fileRow(id)
    expect(row.deletedAt).toBeGreaterThanOrEqual(before)
    expect(row.updatedAt).toBe(row.deletedAt)
    expect((await fileRow(neighbour)).deletedAt).toBeNull()
    expect(
      await db()
        .selectFrom('fitness_file_routes')
        .select('fitnessFileId')
        .where('fitnessFileId', 'in', [id, neighbour])
        .execute()
    ).toEqual([{ fitnessFileId: neighbour }])
    expect(await counterValue(CounterKey.fitnessUsage(accountId))).toBe(900)
    expect(await counterValue(CounterKey.totalFitness(accountId))).toBe(4)

    // Already deleted, or never there: nothing moves.
    expect(await database.deleteFitnessFile({ id })).toBe(false)
    expect(await database.deleteFitnessFile({ id: 'fileq-missing' })).toBe(
      false
    )
    expect(await counterValue(CounterKey.fitnessUsage(accountId))).toBe(900)
    expect(await counterValue(CounterKey.totalFitness(accountId))).toBe(4)
  })

  it('moves no counter for an accountless actor', async () => {
    const actorId = await newActor()
    const id = await seedFile(actorId, { bytes: 100 })
    const counters = (await dumpTables()).counters

    expect(await database.deleteFitnessFile({ id })).toBe(true)
    expect((await fileRow(id)).deletedAt).not.toBeNull()
    expect((await dumpTables()).counters).toEqual(counters)
  })

  it('rolls back the file, its route and the counters when its last write fails', async () => {
    const accountId = await newAccount()
    const actorId = await newActor(accountId)
    const id = await seedFile(actorId, { bytes: 100 })
    await seedRoute(id, actorId)
    await setCounter(CounterKey.fitnessUsage(accountId), 1000)
    await setCounter(CounterKey.totalFitness(accountId), 5)
    const drop = await failWrite(
      'counters',
      'insert',
      `new.id = '${CounterKey.totalFitness(accountId)}'`
    )
    await expectRolledBack(drop, () => database.deleteFitnessFile({ id }))
  })

  it('rolls back the soft delete when an accountless actor’s route delete fails', async () => {
    const actorId = await newActor()
    const id = await seedFile(actorId, { bytes: 100 })
    await seedRoute(id, actorId)
    const drop = await failWrite(
      'fitness_file_routes',
      'delete',
      `old."fitnessFileId" = '${id}'`
    )
    await expectRolledBack(drop, () => database.deleteFitnessFile({ id }))
  })
})

describe('status and activity writes', () => {
  let actorId: string
  let neighbour: string
  let neighbourBefore: unknown

  beforeAll(async () => {
    actorId = await newActor()
    neighbour = await seedFile(actorId, {
      importStatus: 'failed',
      importError: 'neighbour',
      processingStatus: 'failed'
    })
    neighbourBefore = await fileRow(neighbour)
  })

  afterEach(async () => {
    expect(await fileRow(neighbour)).toEqual(neighbourBefore)
  })

  it('updateFitnessFileStatus sets the status of the one file', async () => {
    const id = await seedFile(actorId)
    const statusId = await newStatus(actorId)

    expect(await database.updateFitnessFileStatus(id, statusId)).toBe(true)
    const row = await fileRow(id)
    expect(row.statusId).toBe(statusId)
    expect(row.updatedAt).toBeGreaterThan(ms('2026-01-01'))
    expect(
      await database.updateFitnessFileStatus('fileq-missing', statusId)
    ).toBe(false)
  })

  it('updateFitnessFileProcessingStatus keeps importError in step', async () => {
    const id = await seedFile(actorId, { importError: 'earlier' })
    const write = async (
      status: 'pending' | 'processing' | 'completed' | 'failed',
      reason?: string
    ) => {
      expect(
        await database.updateFitnessFileProcessingStatus(id, status, reason)
      ).toBe(true)
      const row = await fileRow(id)
      expect(row.processingStatus).toBe(status)
      return row.importError
    }

    expect(await write('failed')).toBe('earlier')
    expect(await write('processing')).toBe('earlier')
    expect(await write('failed', 'x'.repeat(1500))).toBe(
      'x'.repeat(MAX_FITNESS_IMPORT_ERROR_LENGTH)
    )
    expect(await write('completed')).toBeNull()
    await database.updateFitnessFileProcessingStatus(id, 'failed', 'again')
    expect(await write('pending')).toBeNull()
    expect(
      await database.updateFitnessFileProcessingStatus(
        'fileq-missing',
        'completed'
      )
    ).toBe(false)
  })

  it('updateFitnessFilesProcessingStatus writes the listed, undeleted files', async () => {
    const first = await seedFile(actorId, { importError: 'first' })
    const second = await seedFile(actorId, { importError: 'second' })
    const deleted = await seedFile(actorId, { deletedAt: at('2026-01-02') })
    const deletedBefore = await fileRow(deleted)

    expect(
      await database.updateFitnessFilesProcessingStatus({
        fitnessFileIds: [first, second, deleted, 'fileq-missing'],
        processingStatus: 'failed',
        processingError: 'y'.repeat(1200)
      })
    ).toBe(2)
    for (const id of [first, second]) {
      expect(await fileRow(id)).toMatchObject({
        processingStatus: 'failed',
        importError: 'y'.repeat(MAX_FITNESS_IMPORT_ERROR_LENGTH)
      })
    }
    expect(await fileRow(deleted)).toEqual(deletedBefore)
    expect(
      await database.updateFitnessFilesProcessingStatus({
        fitnessFileIds: [],
        processingStatus: 'completed'
      })
    ).toBe(0)
  })

  it('updateFitnessFileImportStatus records a capped reason or clears it', async () => {
    const id = await seedFile(actorId, { importError: 'earlier' })

    expect(
      await database.updateFitnessFileImportStatus(
        id,
        'failed',
        'z'.repeat(1001)
      )
    ).toBe(true)
    expect(await fileRow(id)).toMatchObject({
      importStatus: 'failed',
      importError: 'z'.repeat(MAX_FITNESS_IMPORT_ERROR_LENGTH)
    })
    expect(await database.updateFitnessFileImportStatus(id, 'completed')).toBe(
      true
    )
    expect(await fileRow(id)).toMatchObject({
      importStatus: 'completed',
      importError: null
    })
    expect(
      await database.updateFitnessFileImportStatus('fileq-missing', 'failed')
    ).toBe(false)
  })

  it('updateFitnessFilesImportStatus writes the listed, undeleted files', async () => {
    const first = await seedFile(actorId)
    const second = await seedFile(actorId, { importError: 'second' })
    const deleted = await seedFile(actorId, { deletedAt: at('2026-01-02') })
    const deletedBefore = await fileRow(deleted)

    expect(
      await database.updateFitnessFilesImportStatus({
        fitnessFileIds: [first, second, deleted],
        importStatus: 'failed',
        importError: 'batch failed'
      })
    ).toBe(2)
    expect(await fileRow(first)).toMatchObject({
      importStatus: 'failed',
      importError: 'batch failed'
    })
    expect(
      await database.updateFitnessFilesImportStatus({
        fitnessFileIds: [second],
        importStatus: 'pending'
      })
    ).toBe(1)
    expect(await fileRow(second)).toMatchObject({
      importStatus: 'pending',
      importError: null
    })
    expect(await fileRow(deleted)).toEqual(deletedBefore)
    expect(
      await database.updateFitnessFilesImportStatus({
        fitnessFileIds: [],
        importStatus: 'failed'
      })
    ).toBe(0)
  })

  it('updateFitnessFilePrimary flips the one file', async () => {
    const id = await seedFile(actorId)

    expect(await database.updateFitnessFilePrimary(id, false)).toBe(true)
    expect((await fileRow(id)).isPrimary).toBe(false)
    expect(await database.updateFitnessFilePrimary(id, true)).toBe(true)
    expect((await fileRow(id)).isPrimary).toBe(true)
    expect(await database.updateFitnessFilePrimary('fileq-missing', true)).toBe(
      false
    )
  })

  it('assignFitnessFilesToImportedStatus makes one primary and the rest completed secondaries', async () => {
    const statusId = await newStatus(actorId)
    const primary = await seedFile(actorId, {
      isPrimary: false,
      processingStatus: 'completed',
      importStatus: 'pending',
      importError: 'primary'
    })
    const secondary = await seedFile(actorId, {
      isPrimary: true,
      processingStatus: 'failed',
      importStatus: 'failed',
      importError: 'secondary'
    })
    const deleted = await seedFile(actorId, { deletedAt: at('2026-01-02') })
    const deletedBefore = await fileRow(deleted)

    expect(
      await database.assignFitnessFilesToImportedStatus({
        fitnessFileIds: [secondary, primary, deleted],
        primaryFitnessFileId: primary,
        statusId
      })
    ).toBe(2)
    expect(await fileRow(primary)).toMatchObject({
      statusId,
      importStatus: 'completed',
      importError: null,
      isPrimary: true,
      processingStatus: 'pending'
    })
    expect(await fileRow(secondary)).toMatchObject({
      statusId,
      importStatus: 'completed',
      importError: null,
      isPrimary: false,
      processingStatus: 'completed'
    })
    expect(await fileRow(deleted)).toEqual(deletedBefore)
    expect(
      await database.assignFitnessFilesToImportedStatus({
        fitnessFileIds: [],
        primaryFitnessFileId: primary,
        statusId
      })
    ).toBe(0)
  })

  it('assignFitnessFilesToImportedStatus refuses a missing primary id and writes nothing', async () => {
    const statusId = await newStatus(actorId)
    const id = await seedFile(actorId)
    const before = await fileRow(id)

    await expect(
      database.assignFitnessFilesToImportedStatus({
        fitnessFileIds: [id],
        primaryFitnessFileId: undefined as unknown as string,
        statusId
      })
    ).rejects.toThrow()
    expect(await fileRow(id)).toEqual(before)
  })

  it('updateFitnessFileActivityData writes only the keys it is given', async () => {
    const id = await seedFile(actorId, {
      activityType: 'running',
      deviceName: 'Kept',
      totalWorkKj: 99
    })

    expect(
      await database.updateFitnessFileActivityData(id, {
        totalDistanceMeters: 5000,
        totalDurationSeconds: 1800,
        movingTimeSeconds: 1700,
        elevationGainMeters: 42,
        avgPower: 200,
        maxPower: 600,
        avgHeartRate: 150,
        maxHeartRate: 175,
        activityStartTime: at('2026-02-01T06:00:00.000Z'),
        hasMapData: true,
        mapImagePath: 'maps/a.webp',
        mapImageEmailPath: 'maps/a.jpg',
        mapError: 'm'.repeat(1100),
        deviceManufacturer: 'wahoo',
        sourceUrl: 'https://example.test/a',
        deviceGearId: 'device-a',
        elevationSeries: [1, 2, 3]
      })
    ).toBe(true)
    expect(await fileRow(id)).toMatchObject({
      totalDistanceMeters: 5000,
      totalDurationSeconds: 1800,
      movingTimeSeconds: 1700,
      elevationGainMeters: 42,
      avgPower: 200,
      maxPower: 600,
      avgHeartRate: 150,
      maxHeartRate: 175,
      activityStartTime: ms('2026-02-01T06:00:00.000Z'),
      hasMapData: true,
      mapImagePath: 'maps/a.webp',
      mapImageEmailPath: 'maps/a.jpg',
      mapError: 'm'.repeat(MAX_FITNESS_IMPORT_ERROR_LENGTH),
      deviceManufacturer: 'wahoo',
      sourceUrl: 'https://example.test/a',
      deviceGearId: 'device-a',
      elevationSeries: '[1,2,3]',
      // Absent keys are left alone.
      activityType: 'running',
      deviceName: 'Kept',
      totalWorkKj: 99
    })

    expect(
      await database.updateFitnessFileActivityData(id, {
        totalDistanceMeters: null,
        avgPower: undefined,
        activityType: null,
        activityStartTime: null,
        hasMapData: null,
        mapImagePath: null,
        mapImageEmailPath: null,
        mapError: '',
        deviceManufacturer: null,
        deviceName: null,
        sourceUrl: null,
        deviceGearId: null,
        elevationSeries: '[4]'
      })
    ).toBe(true)
    expect(await fileRow(id)).toMatchObject({
      totalDistanceMeters: null,
      avgPower: null,
      totalDurationSeconds: 1800,
      activityType: null,
      activityStartTime: null,
      hasMapData: false,
      mapImagePath: null,
      mapImageEmailPath: null,
      mapError: null,
      deviceManufacturer: null,
      deviceName: null,
      sourceUrl: null,
      deviceGearId: null,
      elevationSeries: '[4]'
    })

    await database.updateFitnessFileActivityData(id, { elevationSeries: null })
    expect((await fileRow(id)).elevationSeries).toBeNull()
    expect(
      await database.updateFitnessFileActivityData('fileq-missing', {
        activityType: 'running'
      })
    ).toBe(false)
  })
})
