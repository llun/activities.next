import type { Insertable } from 'kysely'

import type {
  FitnessFiles,
  FitnessRouteHeatmaps
} from '@/lib/database/kysely/db'
import { createSearchActor } from '@/lib/database/sql/searchTestHelpers'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'

const DOMAIN = 'heatq.test'

// Every `where`, `orderBy` and `limit` of the route heatmap queries, each
// pinned with a neighbouring row the query must not touch (another actor's
// heatmap, a deleted, cancelled, finished, sport-filtered or yearly one, one
// in another region, another actor's region label), every sort pinned with
// ids that sort against time and ties inserted against id order, and every
// write checked against the whole table, so a write that reaches a neighbour
// fails. Rows are written straight into the tables where a test needs a
// timestamp, an id or a shape no method produces. None of these methods runs
// in a transaction. Runs on PostgreSQL in CI.

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

afterEach(() => {
  vi.useRealTimers()
})

const NOW = '2026-06-15T10:30:00.000Z'
const freezeTime = (iso = NOW) =>
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(iso) })

let actorCount = 0
const newActor = async () => {
  actorCount += 1
  const username = `heatq${actorCount}`
  const id = `https://${DOMAIN}/users/${username}`
  await createSearchActor(database, { id, username, domain: DOMAIN })
  return id
}

let idCount = 0
const nextId = (prefix: string) => {
  idCount += 1
  return `${prefix}-${String(idCount).padStart(5, '0')}`
}

const at = (iso: string) => new Date(iso)
const ms = (iso: string) => at(iso).getTime()

// An all-activities, all-time, world-wide pending heatmap unless `values` says
// otherwise. The key's `periodKey` defaults to the id, so rows never collide
// on the (actorId, activityTypeKey, periodType, periodKey, region) key.
const seedHeatmap = async (
  actorId: string,
  values: Partial<Insertable<FitnessRouteHeatmaps>> = {}
) => {
  const id = values.id ?? nextId('heat')
  await db()
    .insertInto('fitness_route_heatmaps')
    .values({
      activityType: null,
      activityTypeKey: '',
      periodType: 'all_time',
      periodKey: id,
      region: '',
      status: 'pending',
      createdAt: at('2026-01-01T08:00:00.000Z'),
      updatedAt: at('2026-01-01T08:00:00.000Z'),
      ...values,
      id,
      actorId
    })
    .execute()
  return id
}

const heatmapRow = (id: string) =>
  db()
    .selectFrom('fitness_route_heatmaps')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow()

const allHeatmaps = () =>
  db().selectFrom('fitness_route_heatmaps').selectAll().orderBy('id').execute()

// Every row but `ids`, as they are now: what a write must leave alone.
const othersThan = async (ids: string[]) =>
  (await allHeatmaps()).filter((row) => !ids.includes(row.id))

// The statements issued while `action` runs.
const statementsOf = async (action: () => Promise<unknown>) => {
  const statements: string[] = []
  const record = ({ sql }: { sql: string }) => {
    statements.push(sql)
  }
  testDb.knex.on('query', record)
  try {
    await action()
  } finally {
    testDb.knex.removeListener('query', record)
  }
  return statements
}

// Identifier quoting differs per backend, so compare the bare names.
const bare = (sql: string) => sql.replaceAll('`', '').replaceAll('"', '')

describe('createFitnessRouteHeatmap', () => {
  it('writes a pending row for the key and returns it as it reads back', async () => {
    freezeTime()
    const actorId = await newActor()

    const created = await database.createFitnessRouteHeatmap({
      actorId,
      activityType: 'running',
      periodType: 'yearly',
      periodKey: '2026',
      region: 'create-region',
      periodStart: at('2026-01-01T00:00:00Z'),
      periodEnd: at('2027-01-01T00:00:00Z')
    })

    expect(await heatmapRow(created.id)).toEqual({
      id: created.id,
      actorId,
      activityType: 'running',
      activityTypeKey: 'running',
      periodType: 'yearly',
      periodKey: '2026',
      region: 'create-region',
      periodStart: ms('2026-01-01T00:00:00Z'),
      periodEnd: ms('2027-01-01T00:00:00Z'),
      bounds: null,
      segments: null,
      status: 'pending',
      error: null,
      activityCount: 0,
      pointCount: 0,
      totalCount: 0,
      cursorOffset: 0,
      isPartial: false,
      shareToken: null,
      createdAt: ms(NOW),
      updatedAt: ms(NOW),
      deletedAt: null
    })
    expect(created).toEqual(
      await database.getFitnessRouteHeatmap({ id: created.id })
    )
    expect(created).toEqual({
      id: created.id,
      actorId,
      activityType: 'running',
      periodType: 'yearly',
      periodKey: '2026',
      region: 'create-region',
      periodStart: ms('2026-01-01T00:00:00Z'),
      periodEnd: ms('2027-01-01T00:00:00Z'),
      bounds: undefined,
      segments: [],
      status: 'pending',
      error: undefined,
      activityCount: 0,
      pointCount: 0,
      totalCount: 0,
      cursorOffset: 0,
      isPartial: false,
      shareToken: null,
      createdAt: ms(NOW),
      updatedAt: ms(NOW),
      deletedAt: undefined
    })
  })

  it.each([
    { description: 'no activity type', activityType: undefined },
    { description: 'a null activity type', activityType: null }
  ])(
    'keys $description as all activities, world-wide, with no period bounds',
    async ({ activityType }) => {
      const actorId = await newActor()

      const created = await database.createFitnessRouteHeatmap({
        actorId,
        activityType,
        periodType: 'all_time',
        periodKey: 'all'
      })

      expect(await heatmapRow(created.id)).toMatchObject({
        activityType: null,
        activityTypeKey: '',
        region: '',
        periodStart: null,
        periodEnd: null
      })
      expect(created).toMatchObject({
        activityType: undefined,
        region: '',
        periodStart: undefined,
        periodEnd: undefined
      })
    }
  )

  it('returns an epoch-0 period start as 0, which reads back as unset', async () => {
    const actorId = await newActor()

    const created = await database.createFitnessRouteHeatmap({
      actorId,
      periodType: 'monthly',
      periodKey: '1970-01',
      periodStart: new Date(0),
      periodEnd: new Date(0)
    })

    expect(created.periodStart).toBe(0)
    expect(created.periodEnd).toBe(0)
    const fetched = await database.getFitnessRouteHeatmap({ id: created.id })
    expect(fetched?.periodStart).toBeUndefined()
    expect(fetched?.periodEnd).toBeUndefined()
  })

  it('refuses a second heatmap for the same key', async () => {
    const actorId = await newActor()
    const params = {
      actorId,
      periodType: 'all_time' as const,
      periodKey: 'all',
      region: 'twice'
    }
    await database.createFitnessRouteHeatmap(params)

    await expect(database.createFitnessRouteHeatmap(params)).rejects.toThrow()
    expect(
      (await allHeatmaps()).filter(
        (row) => row.actorId === actorId && row.region === 'twice'
      )
    ).toHaveLength(1)
  })
})

describe('getFitnessRouteHeatmap', () => {
  it('maps every column of a row', async () => {
    const actorId = await newActor()
    const bounds = { minLat: 52, maxLat: 53, minLng: 4, maxLng: 5 }
    const segments = [
      { points: [{ lat: 52.1, lng: 4.3 }] },
      { isHiddenByPrivacy: true, points: [{ lat: 52.3, lng: 4.5 }] }
    ]
    const id = await seedHeatmap(actorId, {
      activityType: 'cycling',
      activityTypeKey: 'cycling',
      periodType: 'monthly',
      periodKey: '2026-04',
      region: 'rect:52.00,4.00,53.00,5.00',
      periodStart: at('2026-04-01T00:00:00Z'),
      periodEnd: at('2026-05-01T00:00:00Z'),
      bounds: JSON.stringify(bounds),
      segments: JSON.stringify(segments),
      status: 'failed',
      error: 'tile server down',
      activityCount: 3,
      pointCount: 40,
      totalCount: 9,
      cursorOffset: 5,
      isPartial: true,
      shareToken: `token-${actorCount}`,
      createdAt: at('2026-04-02T00:00:00Z'),
      updatedAt: at('2026-04-03T00:00:00Z')
    })

    expect(await database.getFitnessRouteHeatmap({ id })).toEqual({
      id,
      actorId,
      activityType: 'cycling',
      periodType: 'monthly',
      periodKey: '2026-04',
      region: 'rect:52.00,4.00,53.00,5.00',
      periodStart: ms('2026-04-01T00:00:00Z'),
      periodEnd: ms('2026-05-01T00:00:00Z'),
      bounds,
      segments,
      status: 'failed',
      error: 'tile server down',
      activityCount: 3,
      pointCount: 40,
      totalCount: 9,
      cursorOffset: 5,
      isPartial: true,
      shareToken: `token-${actorCount}`,
      createdAt: ms('2026-04-02T00:00:00Z'),
      updatedAt: ms('2026-04-03T00:00:00Z'),
      deletedAt: undefined
    })
  })

  it('reads a corrupt payload as no bounds and no segments', async () => {
    const actorId = await newActor()
    const id = await seedHeatmap(actorId, {
      bounds: '{not json',
      segments: '[not json'
    })

    expect(await database.getFitnessRouteHeatmap({ id })).toMatchObject({
      bounds: undefined,
      segments: []
    })
  })

  it('finds only the live row with that id', async () => {
    const actorId = await newActor()
    const live = await seedHeatmap(actorId)
    const deleted = await seedHeatmap(actorId, {
      deletedAt: at('2026-02-01T00:00:00Z')
    })

    expect((await database.getFitnessRouteHeatmap({ id: live }))?.id).toBe(live)
    expect(await database.getFitnessRouteHeatmap({ id: deleted })).toBeNull()
    expect(
      await database.getFitnessRouteHeatmap({ id: 'no-such-heatmap' })
    ).toBeNull()
  })
})

describe('getFitnessRouteHeatmapByKey', () => {
  const key = {
    activityType: 'running',
    periodType: 'yearly' as const,
    periodKey: '2025',
    region: 'by-key-region'
  }

  it('finds the row matching every column of the key', async () => {
    const actorId = await newActor()
    const id = await seedHeatmap(actorId, {
      activityType: 'running',
      activityTypeKey: 'running',
      periodType: key.periodType,
      periodKey: key.periodKey,
      region: key.region
    })

    expect(
      (await database.getFitnessRouteHeatmapByKey({ actorId, ...key }))?.id
    ).toBe(id)
  })

  it.each([
    { description: 'actor', change: { actorId: 'https://heatq.test/users/x' } },
    { description: 'activity type', change: { activityType: 'cycling' } },
    {
      description: 'activity type (all activities)',
      change: { activityType: null }
    },
    { description: 'period type', change: { periodType: 'monthly' as const } },
    { description: 'period key', change: { periodKey: '2024' } },
    { description: 'region', change: { region: 'elsewhere' } },
    { description: 'region (world-wide)', change: { region: undefined } }
  ])('answers null for a key with another $description', async ({ change }) => {
    const actorId = await newActor()
    await seedHeatmap(actorId, {
      activityType: 'running',
      activityTypeKey: 'running',
      periodType: key.periodType,
      periodKey: key.periodKey,
      region: key.region
    })

    expect(
      await database.getFitnessRouteHeatmapByKey({ actorId, ...key, ...change })
    ).toBeNull()
  })

  it('keys a missing activity type and region as all activities, world-wide', async () => {
    const actorId = await newActor()
    const id = await seedHeatmap(actorId, { periodKey: 'all' })

    for (const activityType of [undefined, null]) {
      expect(
        (
          await database.getFitnessRouteHeatmapByKey({
            actorId,
            activityType,
            periodType: 'all_time',
            periodKey: 'all'
          })
        )?.id
      ).toBe(id)
    }
  })

  it('finds a deleted row only when asked to include deleted rows', async () => {
    const actorId = await newActor()
    const id = await seedHeatmap(actorId, {
      periodKey: 'all',
      deletedAt: at('2026-02-01T00:00:00Z')
    })
    const params = {
      actorId,
      periodType: 'all_time' as const,
      periodKey: 'all'
    }

    expect(await database.getFitnessRouteHeatmapByKey(params)).toBeNull()
    expect(
      await database.getFitnessRouteHeatmapByKey({
        ...params,
        includeDeleted: false
      })
    ).toBeNull()
    expect(
      await database.getFitnessRouteHeatmapByKey({
        ...params,
        includeDeleted: true
      })
    ).toMatchObject({ id, deletedAt: ms('2026-02-01T00:00:00Z') })
  })

  it('reads a deletion stamped at the epoch as unset', async () => {
    const actorId = await newActor()
    const id = await seedHeatmap(actorId, {
      periodKey: 'all',
      deletedAt: new Date(0)
    })

    const fetched = await database.getFitnessRouteHeatmapByKey({
      actorId,
      periodType: 'all_time',
      periodKey: 'all',
      includeDeleted: true
    })
    expect(fetched?.id).toBe(id)
    expect(fetched?.deletedAt).toBeUndefined()
  })
})

describe('share token reads', () => {
  const reads = [
    {
      method: 'getFitnessRouteHeatmapByShareToken',
      read: (shareToken: string) =>
        database.getFitnessRouteHeatmapByShareToken({ shareToken })
    },
    {
      method: 'getFitnessRouteHeatmapSummaryByShareToken',
      read: (shareToken: string) =>
        database.getFitnessRouteHeatmapSummaryByShareToken({ shareToken })
    }
  ]

  let actorId: string
  beforeAll(async () => {
    actorId = await newActor()
    await seedHeatmap(actorId, { id: 'share-live', shareToken: 'tok-live' })
    await seedHeatmap(actorId, {
      id: 'share-deleted',
      shareToken: 'tok-deleted',
      deletedAt: at('2026-02-01T00:00:00Z')
    })
    await seedHeatmap(actorId, {
      id: 'share-sport',
      shareToken: 'tok-sport',
      activityType: 'running',
      activityTypeKey: 'running'
    })
    await seedHeatmap(actorId, {
      id: 'share-yearly',
      shareToken: 'tok-yearly',
      periodType: 'yearly'
    })
    // An empty token no writer stores: only the empty-token guard keeps it
    // from resolving.
    await seedHeatmap(actorId, { id: 'share-empty', shareToken: '' })
  })

  describe.each(reads)('$method', ({ read }) => {
    it('resolves a live, all-activities, all-time share by its token', async () => {
      expect((await read('tok-live'))?.id).toBe('share-live')
    })

    it.each([
      { description: 'a token no heatmap has', token: 'tok-none' },
      { description: 'a deleted heatmap', token: 'tok-deleted' },
      { description: 'a sport-filtered heatmap', token: 'tok-sport' },
      { description: 'a yearly heatmap', token: 'tok-yearly' },
      { description: 'an empty token', token: '' }
    ])('answers null for $description', async ({ token }) => {
      expect(await read(token)).toBeNull()
    })
  })

  it('reads the full row, payload included, for the full read', async () => {
    const shareActorId = await newActor()
    const id = await seedHeatmap(shareActorId, {
      shareToken: `tok-full-${actorCount}`,
      bounds: JSON.stringify({ minLat: 1, maxLat: 2, minLng: 3, maxLng: 4 }),
      segments: JSON.stringify([{ points: [{ lat: 1, lng: 3 }] }])
    })

    expect(
      await database.getFitnessRouteHeatmapByShareToken({
        shareToken: `tok-full-${actorCount}`
      })
    ).toEqual(await database.getFitnessRouteHeatmap({ id }))
  })

  it('reads the summary columns alone for the summary read', async () => {
    const shareActorId = await newActor()
    const id = await seedHeatmap(shareActorId, {
      shareToken: `tok-summary-${actorCount}`,
      bounds: JSON.stringify({ minLat: 1, maxLat: 2, minLng: 3, maxLng: 4 }),
      segments: JSON.stringify([{ points: [{ lat: 1, lng: 3 }] }])
    })

    let summary: unknown
    const statements = await statementsOf(async () => {
      summary = await database.getFitnessRouteHeatmapSummaryByShareToken({
        shareToken: `tok-summary-${actorCount}`
      })
    })

    const {
      bounds: _bounds,
      segments: _segments,
      ...rest
    } = (await database.getFitnessRouteHeatmap({ id }))!
    expect(summary).toEqual(rest)
    expect(statements).toHaveLength(1)
    expect(bare(statements[0])).not.toMatch(/segments|bounds|\*/)
  })
})

describe('pyramid subscribers', () => {
  // Four subscribers whose ids sort against their creation time, two of them
  // tied and inserted against id order, in four different regions, and a
  // neighbour that fails each clause of the subscriber filter. The tied pair
  // shares a status and has period keys that sort against its ids, so a scan
  // of the table or of any index on it (by status, or by the unique key that
  // ends in periodKey) returns the pair against id order too.
  const seedSubscribers = async () => {
    const actorId = await newActor()
    const otherActorId = await newActor()
    const prefix = `sub${actorCount}`
    const subscribers = {
      late: await seedHeatmap(actorId, {
        id: `${prefix}-a`,
        region: 'r-late',
        status: 'generating',
        createdAt: at('2026-03-03T00:00:00Z')
      }),
      tiedSecond: await seedHeatmap(actorId, {
        id: `${prefix}-m`,
        periodKey: `${prefix}-tie-1`,
        region: 'r-tied-m',
        status: 'generating',
        createdAt: at('2026-03-02T00:00:00Z')
      }),
      tiedFirst: await seedHeatmap(actorId, {
        id: `${prefix}-c`,
        periodKey: `${prefix}-tie-2`,
        region: 'r-tied-c',
        status: 'generating',
        createdAt: at('2026-03-02T00:00:00Z')
      }),
      early: await seedHeatmap(actorId, {
        id: `${prefix}-z`,
        createdAt: at('2026-03-01T00:00:00Z')
      })
    }
    const neighbours = [
      await seedHeatmap(otherActorId),
      await seedHeatmap(actorId, { deletedAt: at('2026-03-04T00:00:00Z') }),
      await seedHeatmap(actorId, {
        activityType: 'running',
        activityTypeKey: 'running'
      }),
      await seedHeatmap(actorId, { periodType: 'yearly' }),
      await seedHeatmap(actorId, { status: 'completed' }),
      await seedHeatmap(actorId, { status: 'failed' }),
      await seedHeatmap(actorId, { status: 'cancelled' })
    ]
    return { actorId, subscribers, neighbours }
  }

  it('lists the in-flight all-time heatmaps of every region, oldest first, ties by id', async () => {
    const { actorId, subscribers } = await seedSubscribers()

    const rows = await database.getFitnessRouteHeatmapSubscribers({ actorId })

    expect(rows.map((row) => row.id)).toEqual([
      subscribers.early,
      subscribers.tiedFirst,
      subscribers.tiedSecond,
      subscribers.late
    ])
    expect(rows[0]).toEqual(
      expect.not.objectContaining({ segments: expect.anything() })
    )
  })

  it('reads the summary columns alone', async () => {
    const { actorId } = await seedSubscribers()

    const statements = await statementsOf(() =>
      database.getFitnessRouteHeatmapSubscribers({ actorId })
    )

    expect(statements).toHaveLength(1)
    expect(bare(statements[0])).not.toMatch(/segments|bounds|\*/)
  })

  it('mirrors build progress onto every subscriber and nothing else', async () => {
    const { actorId, subscribers } = await seedSubscribers()
    const ids = Object.values(subscribers)
    const before = await othersThan(ids)
    freezeTime()

    expect(
      await database.mirrorFitnessRouteHeatmapGenerationProgress({
        actorId,
        totalCount: 120,
        cursorOffset: 45
      })
    ).toBe(4)

    for (const id of ids) {
      expect(await heatmapRow(id)).toMatchObject({
        status: 'generating',
        totalCount: 120,
        cursorOffset: 45,
        updatedAt: ms(NOW)
      })
    }
    expect(await othersThan(ids)).toEqual(before)
  })

  it('mirrors onto nothing for an actor with no subscribers', async () => {
    const actorId = await newActor()
    await seedHeatmap(actorId, { status: 'completed' })
    const before = await allHeatmaps()

    expect(
      await database.mirrorFitnessRouteHeatmapGenerationProgress({
        actorId,
        totalCount: 1,
        cursorOffset: 1
      })
    ).toBe(0)
    expect(await allHeatmaps()).toEqual(before)
  })
})

describe('getFitnessRouteHeatmapsForActor and getFitnessRouteHeatmapSummariesForActor', () => {
  // Ids that sort against the newest-first order (the newest has the highest
  // id), a tie inserted against id order, and every combination of sport,
  // period and region the filters pick from.
  const seedForActor = async () => {
    const actorId = await newActor()
    const otherActorId = await newActor()
    const prefix = `list${actorCount}`
    const rows = {
      allWorld: await seedHeatmap(actorId, {
        id: `${prefix}-a`,
        updatedAt: at('2026-05-01T00:00:00Z')
      }),
      runningYearlyWorld: await seedHeatmap(actorId, {
        id: `${prefix}-b`,
        activityType: 'running',
        activityTypeKey: 'running',
        periodType: 'yearly',
        updatedAt: at('2026-05-02T00:00:00Z')
      }),
      allRegionTiedSecond: await seedHeatmap(actorId, {
        id: `${prefix}-d`,
        region: 'r1',
        updatedAt: at('2026-05-03T00:00:00Z')
      }),
      runningRegionTiedFirst: await seedHeatmap(actorId, {
        id: `${prefix}-c`,
        activityType: 'running',
        activityTypeKey: 'running',
        region: 'r1',
        updatedAt: at('2026-05-03T00:00:00Z')
      }),
      allYearlyRegion: await seedHeatmap(actorId, {
        id: `${prefix}-e`,
        periodType: 'yearly',
        region: 'r1',
        updatedAt: at('2026-05-04T00:00:00Z')
      })
    }
    await seedHeatmap(actorId, { deletedAt: at('2026-05-05T00:00:00Z') })
    await seedHeatmap(otherActorId)
    return { actorId, rows }
  }

  const listings = [
    {
      method: 'getFitnessRouteHeatmapsForActor',
      list: (
        params: Parameters<typeof database.getFitnessRouteHeatmapsForActor>[0]
      ) => database.getFitnessRouteHeatmapsForActor(params)
    },
    {
      method: 'getFitnessRouteHeatmapSummariesForActor',
      list: (
        params: Parameters<typeof database.getFitnessRouteHeatmapsForActor>[0]
      ) => database.getFitnessRouteHeatmapSummariesForActor(params)
    }
  ]

  describe.each(listings)('$method', ({ list }) => {
    it("lists the actor's live heatmaps, newest update first, ties by id", async () => {
      const { actorId, rows } = await seedForActor()

      expect((await list({ actorId })).map((row) => row.id)).toEqual([
        rows.allYearlyRegion,
        rows.runningRegionTiedFirst,
        rows.allRegionTiedSecond,
        rows.runningYearlyWorld,
        rows.allWorld
      ])
    })

    it.each([
      {
        description: 'activity type',
        filter: { activityType: 'running' },
        expected: ['runningRegionTiedFirst', 'runningYearlyWorld']
      },
      {
        description: 'null activity type (all activities)',
        filter: { activityType: null },
        expected: ['allYearlyRegion', 'allRegionTiedSecond', 'allWorld']
      },
      {
        description: 'period type',
        filter: { periodType: 'yearly' as const },
        expected: ['allYearlyRegion', 'runningYearlyWorld']
      },
      {
        description: 'region',
        filter: { region: 'r1' },
        expected: [
          'allYearlyRegion',
          'runningRegionTiedFirst',
          'allRegionTiedSecond'
        ]
      },
      {
        description: 'empty region (world-wide)',
        filter: { region: '' },
        expected: ['runningYearlyWorld', 'allWorld']
      },
      {
        description: 'activity type, period type and region together',
        filter: {
          activityType: null,
          periodType: 'yearly' as const,
          region: 'r1'
        },
        expected: ['allYearlyRegion']
      }
    ])('narrows by $description', async ({ filter, expected }) => {
      const { actorId, rows } = await seedForActor()

      expect((await list({ actorId, ...filter })).map((row) => row.id)).toEqual(
        expected.map((name) => rows[name as keyof typeof rows])
      )
    })
  })

  it('reads the payload for the full listing and leaves it out of the summaries', async () => {
    const actorId = await newActor()
    const id = await seedHeatmap(actorId, {
      bounds: JSON.stringify({ minLat: 1, maxLat: 2, minLng: 3, maxLng: 4 }),
      segments: JSON.stringify([{ points: [{ lat: 1, lng: 3 }] }])
    })
    const full = await database.getFitnessRouteHeatmap({ id })

    expect(await database.getFitnessRouteHeatmapsForActor({ actorId })).toEqual(
      [full]
    )
    let summaries: unknown
    const statements = await statementsOf(async () => {
      summaries = await database.getFitnessRouteHeatmapSummariesForActor({
        actorId
      })
    })
    const { bounds: _bounds, segments: _segments, ...rest } = full!
    expect(summaries).toEqual([rest])
    expect(statements).toHaveLength(1)
    expect(bare(statements[0])).not.toMatch(/segments|bounds|\*/)
  })
})

describe('updateFitnessRouteHeatmapStatus', () => {
  const fullRow = {
    bounds: JSON.stringify({ minLat: 1, maxLat: 2, minLng: 3, maxLng: 4 }),
    segments: JSON.stringify([{ points: [{ lat: 1, lng: 3 }] }]),
    status: 'generating',
    error: 'old error',
    activityCount: 2,
    pointCount: 20,
    totalCount: 10,
    cursorOffset: 4,
    isPartial: true,
    shareToken: null
  }

  it('writes the status and update time alone when nothing else is given', async () => {
    const actorId = await newActor()
    const id = await seedHeatmap(actorId, fullRow)
    const neighbour = await seedHeatmap(actorId, fullRow)
    const before = await heatmapRow(id)
    const others = await othersThan([id])
    freezeTime()

    expect(
      await database.updateFitnessRouteHeatmapStatus({
        id,
        status: 'completed'
      })
    ).toBe(true)

    expect(await heatmapRow(id)).toEqual({
      ...before,
      status: 'completed',
      updatedAt: ms(NOW)
    })
    expect(await othersThan([id])).toEqual(others)
    expect((await heatmapRow(neighbour)).status).toBe('generating')
  })

  it('writes each field it is given', async () => {
    const actorId = await newActor()
    const id = await seedHeatmap(actorId, fullRow)
    const bounds = { minLat: 5, maxLat: 6, minLng: 7, maxLng: 8 }
    const segments = [{ points: [{ lat: 5, lng: 7 }] }]

    await database.updateFitnessRouteHeatmapStatus({
      id,
      status: 'completed',
      bounds,
      segments,
      error: 'new error',
      activityCount: 7,
      pointCount: 70,
      totalCount: 30,
      cursorOffset: 0,
      isPartial: false
    })

    expect(await heatmapRow(id)).toMatchObject({
      status: 'completed',
      bounds: JSON.stringify(bounds),
      segments: JSON.stringify(segments),
      error: 'new error',
      activityCount: 7,
      pointCount: 70,
      totalCount: 30,
      cursorOffset: 0,
      isPartial: false
    })
  })

  it('clears the payload and the error when given null', async () => {
    const actorId = await newActor()
    const id = await seedHeatmap(actorId, fullRow)

    await database.updateFitnessRouteHeatmapStatus({
      id,
      status: 'pending',
      bounds: null,
      segments: null,
      error: null
    })

    expect(await heatmapRow(id)).toMatchObject({
      bounds: null,
      segments: null,
      error: null,
      activityCount: 2
    })
  })

  it('leaves a deleted row alone unless asked to restore it', async () => {
    const actorId = await newActor()
    const id = await seedHeatmap(actorId, {
      deletedAt: at('2026-02-01T00:00:00Z')
    })
    const before = await allHeatmaps()

    expect(
      await database.updateFitnessRouteHeatmapStatus({
        id,
        status: 'completed'
      })
    ).toBe(false)
    expect(
      await database.updateFitnessRouteHeatmapStatus({
        id: 'no-such-heatmap',
        status: 'completed'
      })
    ).toBe(false)
    expect(await allHeatmaps()).toEqual(before)
  })

  describe('restoring with clearDeleted', () => {
    const cutoff = '2026-02-01T00:00:00.000Z'

    it.each([
      {
        description: 'before the cutoff',
        deletedAt: '2026-01-31T00:00:00.000Z'
      },
      { description: 'at the cutoff', deletedAt: cutoff }
    ])(
      'restores a row deleted $description and drops its stale token',
      async ({ deletedAt }) => {
        const actorId = await newActor()
        const id = await seedHeatmap(actorId, {
          deletedAt: at(deletedAt),
          shareToken: `stale-${actorCount}`
        })

        expect(
          await database.updateFitnessRouteHeatmapStatus({
            id,
            status: 'generating',
            clearDeleted: true,
            clearDeletedBefore: ms(cutoff)
          })
        ).toBe(true)
        expect(await heatmapRow(id)).toMatchObject({
          status: 'generating',
          deletedAt: null,
          shareToken: null
        })
      }
    )

    it('does not restore a row deleted after the cutoff', async () => {
      const actorId = await newActor()
      const id = await seedHeatmap(actorId, {
        deletedAt: at('2026-02-01T00:00:01.000Z'),
        shareToken: `late-${actorCount}`
      })
      const before = await heatmapRow(id)

      expect(
        await database.updateFitnessRouteHeatmapStatus({
          id,
          status: 'generating',
          clearDeleted: true,
          clearDeletedBefore: ms(cutoff)
        })
      ).toBe(false)
      expect(await heatmapRow(id)).toEqual(before)
    })

    it('restores only a row deleted at the epoch when no cutoff is given', async () => {
      const actorId = await newActor()
      const epoch = await seedHeatmap(actorId, { deletedAt: new Date(0) })
      const later = await seedHeatmap(actorId, {
        deletedAt: at('2026-01-01T00:00:00Z')
      })

      for (const id of [epoch, later]) {
        await database.updateFitnessRouteHeatmapStatus({
          id,
          status: 'generating',
          clearDeleted: true
        })
      }

      expect((await heatmapRow(epoch)).deletedAt).toBeNull()
      expect((await heatmapRow(later)).deletedAt).toBe(
        ms('2026-01-01T00:00:00Z')
      )
    })

    it('keeps the token of a live row it is asked to restore', async () => {
      const actorId = await newActor()
      const id = await seedHeatmap(actorId, {
        status: 'completed',
        shareToken: `live-${actorCount}`
      })

      expect(
        await database.updateFitnessRouteHeatmapStatus({
          id,
          status: 'generating',
          clearDeleted: true,
          clearDeletedBefore: ms(cutoff)
        })
      ).toBe(true)
      expect(await heatmapRow(id)).toMatchObject({
        status: 'generating',
        deletedAt: null,
        shareToken: `live-${actorCount}`
      })
    })
  })

  describe('abortIfCancelled', () => {
    it('skips a cancelled row', async () => {
      const actorId = await newActor()
      const id = await seedHeatmap(actorId, { status: 'cancelled' })
      const before = await heatmapRow(id)

      expect(
        await database.updateFitnessRouteHeatmapStatus({
          id,
          status: 'completed',
          abortIfCancelled: true
        })
      ).toBe(false)
      expect(await heatmapRow(id)).toEqual(before)
    })

    it('writes a row in any other state', async () => {
      const actorId = await newActor()
      const id = await seedHeatmap(actorId, { status: 'generating' })

      expect(
        await database.updateFitnessRouteHeatmapStatus({
          id,
          status: 'completed',
          abortIfCancelled: true
        })
      ).toBe(true)
      expect((await heatmapRow(id)).status).toBe('completed')
    })

    it('is off by default, so a plain write revives a cancelled row', async () => {
      const actorId = await newActor()
      const id = await seedHeatmap(actorId, { status: 'cancelled' })

      expect(
        await database.updateFitnessRouteHeatmapStatus({
          id,
          status: 'generating'
        })
      ).toBe(true)
      expect((await heatmapRow(id)).status).toBe('generating')
    })
  })
})

describe('share token writes', () => {
  it('sets a token on a live, unshared heatmap of the owner only', async () => {
    const actorId = await newActor()
    const otherActorId = await newActor()
    const id = await seedHeatmap(actorId)
    const deleted = await seedHeatmap(actorId, {
      deletedAt: at('2026-02-01T00:00:00Z')
    })
    const shared = await seedHeatmap(actorId, {
      shareToken: `kept-${actorCount}`
    })
    const others = await othersThan([id])
    freezeTime()

    const token = `set-${actorCount}`
    expect(
      await database.setFitnessRouteHeatmapShareToken({
        actorId: otherActorId,
        id,
        shareToken: token
      })
    ).toBe(false)
    expect(
      await database.setFitnessRouteHeatmapShareToken({
        actorId,
        id: deleted,
        shareToken: token
      })
    ).toBe(false)
    expect(
      await database.setFitnessRouteHeatmapShareToken({
        actorId,
        id: shared,
        shareToken: token
      })
    ).toBe(false)
    expect(await othersThan([id])).toEqual(others)

    expect(
      await database.setFitnessRouteHeatmapShareToken({
        actorId,
        id,
        shareToken: token
      })
    ).toBe(true)
    expect(await heatmapRow(id)).toMatchObject({
      shareToken: token,
      updatedAt: ms(NOW)
    })
    expect(await othersThan([id])).toEqual(others)
  })

  it('clears the token of a live heatmap of the owner only', async () => {
    const actorId = await newActor()
    const otherActorId = await newActor()
    const id = await seedHeatmap(actorId, {
      shareToken: `clear-${actorCount}`
    })
    const deleted = await seedHeatmap(actorId, {
      shareToken: `clear-deleted-${actorCount}`,
      deletedAt: at('2026-02-01T00:00:00Z')
    })
    const others = await othersThan([id])
    freezeTime()

    expect(
      await database.clearFitnessRouteHeatmapShareToken({
        actorId: otherActorId,
        id
      })
    ).toBe(false)
    expect(
      await database.clearFitnessRouteHeatmapShareToken({
        actorId,
        id: deleted
      })
    ).toBe(false)
    expect(await othersThan([id])).toEqual(others)
    expect((await heatmapRow(id)).shareToken).toBe(`clear-${actorCount}`)

    expect(
      await database.clearFitnessRouteHeatmapShareToken({ actorId, id })
    ).toBe(true)
    expect(await heatmapRow(id)).toMatchObject({
      shareToken: null,
      updatedAt: ms(NOW)
    })
    // Clearing an unshared heatmap still matches the row.
    expect(
      await database.clearFitnessRouteHeatmapShareToken({ actorId, id })
    ).toBe(true)
    expect(await othersThan([id])).toEqual(others)
  })
})

describe('deleting heatmaps', () => {
  it('deleteFitnessRouteHeatmap soft-deletes a live heatmap of the owner and revokes its token', async () => {
    const actorId = await newActor()
    const otherActorId = await newActor()
    const id = await seedHeatmap(actorId, { shareToken: `del-${actorCount}` })
    const deleted = await seedHeatmap(actorId, {
      deletedAt: at('2026-02-01T00:00:00Z')
    })
    const others = await othersThan([id])
    freezeTime()

    expect(
      await database.deleteFitnessRouteHeatmap({ actorId: otherActorId, id })
    ).toBe(false)
    expect(
      await database.deleteFitnessRouteHeatmap({ actorId, id: deleted })
    ).toBe(false)
    expect((await heatmapRow(id)).deletedAt).toBeNull()

    expect(await database.deleteFitnessRouteHeatmap({ actorId, id })).toBe(true)
    expect(await heatmapRow(id)).toMatchObject({
      deletedAt: ms(NOW),
      shareToken: null,
      updatedAt: ms(NOW)
    })
    expect(await othersThan([id])).toEqual(others)
    expect(await database.deleteFitnessRouteHeatmap({ actorId, id })).toBe(
      false
    )
  })

  it("deleteFitnessRouteHeatmapsForActor soft-deletes the actor's live heatmaps and counts them", async () => {
    const actorId = await newActor()
    const otherActorId = await newActor()
    const live = [
      await seedHeatmap(actorId, { shareToken: `all-${actorCount}` }),
      await seedHeatmap(actorId, { status: 'completed' })
    ]
    const deleted = await seedHeatmap(actorId, {
      deletedAt: at('2026-02-01T00:00:00Z')
    })
    const other = await seedHeatmap(otherActorId)
    const others = await othersThan(live)
    freezeTime()

    expect(await database.deleteFitnessRouteHeatmapsForActor({ actorId })).toBe(
      2
    )

    for (const id of live) {
      expect(await heatmapRow(id)).toMatchObject({
        deletedAt: ms(NOW),
        shareToken: null,
        updatedAt: ms(NOW)
      })
    }
    // The earlier deletion's time and the other actor's row stay as they were.
    expect(await othersThan(live)).toEqual(others)
    expect((await heatmapRow(deleted)).deletedAt).toBe(
      ms('2026-02-01T00:00:00Z')
    )
    expect((await heatmapRow(other)).deletedAt).toBeNull()
    expect(await database.deleteFitnessRouteHeatmapsForActor({ actorId })).toBe(
      0
    )
  })
})

describe('cancelFitnessRouteHeatmapGeneration', () => {
  const inFlight = {
    bounds: JSON.stringify({ minLat: 1, maxLat: 2, minLng: 3, maxLng: 4 }),
    segments: JSON.stringify([{ points: [{ lat: 1, lng: 3 }] }]),
    error: 'transient',
    activityCount: 2,
    pointCount: 20,
    totalCount: 10,
    cursorOffset: 4,
    isPartial: true
  }

  it.each(['pending', 'generating'])(
    'cancels a %s run and resets it, keeping its progress denominator',
    async (status) => {
      const actorId = await newActor()
      const id = await seedHeatmap(actorId, { ...inFlight, status })
      // The same actor's other run, in the same state, must stay as it is.
      await seedHeatmap(actorId, { ...inFlight, status })
      const before = await heatmapRow(id)
      const others = await othersThan([id])
      freezeTime()

      expect(
        await database.cancelFitnessRouteHeatmapGeneration({ actorId, id })
      ).toBe(true)
      expect(await heatmapRow(id)).toEqual({
        ...before,
        status: 'cancelled',
        error: null,
        bounds: null,
        segments: null,
        activityCount: 0,
        pointCount: 0,
        cursorOffset: 0,
        isPartial: false,
        updatedAt: ms(NOW)
      })
      expect(await othersThan([id])).toEqual(others)
    }
  )

  it.each([
    { description: 'a completed run', values: { status: 'completed' } },
    { description: 'a failed run', values: { status: 'failed' } },
    { description: 'a cancelled run', values: { status: 'cancelled' } },
    {
      description: 'a deleted run',
      values: { status: 'pending', deletedAt: at('2026-02-01T00:00:00Z') }
    }
  ])('leaves $description alone', async ({ values }) => {
    const actorId = await newActor()
    const id = await seedHeatmap(actorId, { ...inFlight, ...values })
    const before = await allHeatmaps()

    expect(
      await database.cancelFitnessRouteHeatmapGeneration({ actorId, id })
    ).toBe(false)
    expect(await allHeatmaps()).toEqual(before)
  })

  it("leaves another actor's run alone", async () => {
    const actorId = await newActor()
    const otherActorId = await newActor()
    const id = await seedHeatmap(actorId, { ...inFlight, status: 'pending' })
    const before = await allHeatmaps()

    expect(
      await database.cancelFitnessRouteHeatmapGeneration({
        actorId: otherActorId,
        id
      })
    ).toBe(false)
    expect(await allHeatmaps()).toEqual(before)
  })
})

describe('getDistinctActivityTypesForActor', () => {
  const seedFile = async (
    actorId: string,
    values: Partial<Insertable<FitnessFiles>>
  ) => {
    const id = nextId('file')
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
        createdAt: at('2026-01-01T08:00:00Z'),
        updatedAt: at('2026-01-01T08:00:00Z'),
        ...values,
        id,
        actorId
      })
      .execute()
  }

  it("lists each type of the actor's countable activities once, in order", async () => {
    const actorId = await newActor()
    const otherActorId = await newActor()
    for (const activityType of ['swimming', 'running', 'cycling', 'running']) {
      await seedFile(actorId, { activityType })
    }
    await seedFile(actorId, { activityType: null })
    await seedFile(actorId, {
      activityType: 'rowing',
      processingStatus: 'failed'
    })
    await seedFile(actorId, { activityType: 'yoga', isPrimary: false })
    await seedFile(actorId, {
      activityType: 'skiing',
      deletedAt: at('2026-02-01T00:00:00Z')
    })
    await seedFile(otherActorId, { activityType: 'hiking' })

    expect(
      await database.getDistinctActivityTypesForActor({ actorId })
    ).toEqual(['cycling', 'running', 'swimming'])
  })
})

describe('getDistinctRouteHeatmapRegionsForActor', () => {
  it("lists each named region of the actor's heatmaps once, in order", async () => {
    const actorId = await newActor()
    const otherActorId = await newActor()
    await seedHeatmap(actorId, { region: 'charlie' })
    await seedHeatmap(actorId, { region: 'alpha' })
    await seedHeatmap(actorId, { region: 'alpha' })
    await seedHeatmap(actorId, { region: '' })
    await seedHeatmap(actorId, { region: 'bravo' })
    await seedHeatmap(actorId, {
      region: 'delta',
      deletedAt: at('2026-02-01T00:00:00Z')
    })
    await seedHeatmap(otherActorId, { region: 'echo' })

    expect(
      await database.getDistinctRouteHeatmapRegionsForActor({ actorId })
    ).toEqual(['alpha', 'bravo', 'charlie'])
    expect(
      await database.getDistinctRouteHeatmapRegionsForActor({
        actorId,
        includeDeleted: false
      })
    ).toEqual(['alpha', 'bravo', 'charlie'])
    expect(
      await database.getDistinctRouteHeatmapRegionsForActor({
        actorId,
        includeDeleted: true
      })
    ).toEqual(['alpha', 'bravo', 'charlie', 'delta'])
  })
})

describe('region names', () => {
  const nameRows = (actorId: string) =>
    db()
      .selectFrom('fitness_route_heatmap_region_names')
      .selectAll()
      .where('actorId', '=', actorId)
      .orderBy('region')
      .execute()

  const seedName = (actorId: string, region: string, name: string) =>
    db()
      .insertInto('fitness_route_heatmap_region_names')
      .values({
        actorId,
        region,
        name,
        createdAt: at('2026-01-01T00:00:00Z'),
        updatedAt: at('2026-01-01T00:00:00Z')
      })
      .execute()

  it("lists the actor's labels by region", async () => {
    const actorId = await newActor()
    const otherActorId = await newActor()
    await seedName(actorId, 'charlie', 'Coast')
    await seedName(actorId, 'alpha', 'Alps')
    await seedName(actorId, 'bravo', 'Bay')
    await seedName(otherActorId, 'aaa', 'Elsewhere')

    expect(
      await database.getFitnessRouteHeatmapRegionNames({ actorId })
    ).toEqual([
      { region: 'alpha', name: 'Alps' },
      { region: 'bravo', name: 'Bay' },
      { region: 'charlie', name: 'Coast' }
    ])
  })

  it('stores a trimmed label, then replaces it in place', async () => {
    const actorId = await newActor()
    freezeTime('2026-03-01T00:00:00Z')

    await database.setFitnessRouteHeatmapRegionName({
      actorId,
      region: 'alpha',
      name: '  Alps  '
    })
    expect(await nameRows(actorId)).toEqual([
      {
        actorId,
        region: 'alpha',
        name: 'Alps',
        createdAt: ms('2026-03-01T00:00:00Z'),
        updatedAt: ms('2026-03-01T00:00:00Z')
      }
    ])
    vi.setSystemTime(at('2026-03-02T00:00:00Z'))
    await database.setFitnessRouteHeatmapRegionName({
      actorId,
      region: 'alpha',
      name: '  High Alps  '
    })

    expect(await nameRows(actorId)).toEqual([
      {
        actorId,
        region: 'alpha',
        name: 'High Alps',
        createdAt: ms('2026-03-01T00:00:00Z'),
        updatedAt: ms('2026-03-02T00:00:00Z')
      }
    ])
  })

  it.each([
    { description: 'a null name', region: 'alpha', name: null },
    { description: 'a blank name', region: 'alpha', name: '   ' },
    { description: 'the world-wide region', region: '', name: 'World' }
  ])('deletes the one label for $description', async ({ region, name }) => {
    const actorId = await newActor()
    const otherActorId = await newActor()
    await seedName(actorId, region, 'Old')
    await seedName(actorId, 'bravo', 'Bay')
    await seedName(otherActorId, region, 'Theirs')

    await database.setFitnessRouteHeatmapRegionName({ actorId, region, name })

    expect((await nameRows(actorId)).map((row) => row.region)).toEqual([
      'bravo'
    ])
    expect((await nameRows(otherActorId)).map((row) => row.name)).toEqual([
      'Theirs'
    ])
  })
})
