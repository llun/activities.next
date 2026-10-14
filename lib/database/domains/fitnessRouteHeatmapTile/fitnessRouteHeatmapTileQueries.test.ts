import { type Insertable, sql } from 'kysely'

import type {
  FitnessRouteHeatmapPyramids,
  FitnessRouteHeatmapTiles
} from '@/lib/database/kysely/db'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import {
  failStatement,
  interfereAfterStatement
} from '@/lib/database/testing/fitnessRouteHeatmapTileTestHelpers'
import { createSearchActor } from '@/lib/database/testing/searchTestHelpers'

const DOMAIN = 'heattile.test'

// Every `where` and `limit` of the route heatmap pyramid and tile queries,
// each pinned with a neighbouring row the query must not touch (another
// actor's pyramid holding the same token, another actor's tiles under the same
// key, another zoom level, keys just outside a range, a version either side of
// the sweep's boundary), and every write checked against both whole tables.
// Each transaction's last write is forced to fail and checked for a full
// rollback, as is the claim's compare-and-swap when the read that confirms it
// fails. The module has no `orderBy` and no keyset cursor. Rows are written
// straight into the tables where a test needs a state no method produces.
// Runs on PostgreSQL in CI.

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

const T0 = '2026-01-01T08:00:00.000Z'
const NOW = '2026-06-15T10:30:00.000Z'
const freezeTime = (iso = NOW) =>
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(iso) })

const at = (iso: string) => new Date(iso)
const ms = (iso: string) => at(iso).getTime()
const STALE_BEFORE = ms(NOW) - 120_000

let actorCount = 0
const newActor = async () => {
  actorCount += 1
  const username = `heattile${actorCount}`
  const id = `https://${DOMAIN}/users/${username}`
  await createSearchActor(database, { id, username, domain: DOMAIN })
  return id
}

let idCount = 0
const nextId = (prefix: string) => {
  idCount += 1
  return `${prefix}-${String(idCount).padStart(5, '0')}`
}

// An idle pyramid seeded at T0 unless `values` says otherwise.
const seedPyramid = async (
  actorId: string,
  values: Partial<Insertable<FitnessRouteHeatmapPyramids>> = {}
) => {
  const id = values.id === undefined ? nextId('pyramid') : values.id
  await db()
    .insertInto('fitness_route_heatmap_pyramids')
    .values({
      status: 'idle',
      error: null,
      version: 0,
      claimSeq: 0,
      totalCount: 0,
      scannedCount: 0,
      activityCount: 0,
      tileCount: 0,
      pointCount: 0,
      cursorCreatedAt: null,
      cursorId: null,
      completedAt: null,
      createdAt: at(T0),
      updatedAt: at(T0),
      ...values,
      id,
      actorId
    })
    .execute()
  return id
}

// A generating build at token 4, heartbeated at T0, so the fence tests have a
// neighbour holding the SAME token.
const seedBuild = async (actorId: string) => ({
  actorId,
  id: await seedPyramid(actorId, {
    status: 'generating',
    version: 2,
    claimSeq: 4,
    totalCount: 30,
    scannedCount: 10,
    activityCount: 6,
    tileCount: 5,
    pointCount: 50,
    cursorCreatedAt: at('2025-12-01T00:00:00.000Z'),
    cursorId: 'cursor-0'
  }),
  claimSeq: 4
})

const seedTile = async (
  actorId: string,
  tileKey: string,
  values: Partial<Insertable<FitnessRouteHeatmapTiles>> = {}
) => {
  const [z, x, y] = tileKey.split(':').map(Number)
  await db()
    .insertInto('fitness_route_heatmap_tiles')
    .values({
      z,
      x,
      y,
      version: 1,
      segments: `segments ${tileKey}`,
      pointCount: 1,
      createdAt: at(T0),
      updatedAt: at(T0),
      ...values,
      actorId,
      tileKey
    })
    .execute()
}

const tileInput = (tileKey: string, pointCount: number, segments?: string) => {
  const [z, x, y] = tileKey.split(':').map(Number)
  return {
    tileKey,
    z,
    x,
    y,
    segments: segments ?? `new ${tileKey}`,
    pointCount
  }
}

const pyramidRow = (actorId: string) =>
  db()
    .selectFrom('fitness_route_heatmap_pyramids')
    .selectAll()
    .where('actorId', '=', actorId)
    .executeTakeFirst()

const tileRows = (actorId: string) =>
  db()
    .selectFrom('fitness_route_heatmap_tiles')
    .selectAll()
    .where('actorId', '=', actorId)
    .orderBy('tileKey')
    .execute()

const dumpTables = async () => ({
  pyramids: await db()
    .selectFrom('fitness_route_heatmap_pyramids')
    .selectAll()
    .orderBy('actorId')
    .execute(),
  tiles: await db()
    .selectFrom('fitness_route_heatmap_tiles')
    .selectAll()
    .orderBy('actorId')
    .orderBy('tileKey')
    .execute()
})

type Dump = Awaited<ReturnType<typeof dumpTables>>

// Both tables as they are, less `actorIds`' rows: what a write must leave
// alone.
const othersThan = (dump: Dump, actorIds: string[]) => ({
  pyramids: dump.pyramids.filter((row) => !actorIds.includes(row.actorId)),
  tiles: dump.tiles.filter((row) => !actorIds.includes(row.actorId))
})

const byTileKey = <T extends { tileKey: string }>(rows: T[]) =>
  [...rows].sort((a, b) => (a.tileKey < b.tileKey ? -1 : 1))

// The statements, with their bindings, issued while `action` runs.
const statementsOf = async (action: () => Promise<unknown>) =>
  (await testDb.captureQueries(action)).map(({ sql, bindings }) => ({
    sql: sql.trimStart(),
    bindings
  }))

const isStatement =
  (verb: 'select' | 'insert' | 'update' | 'delete', table: string) =>
  (sql: string) =>
    sql.trimStart().toLowerCase().startsWith(verb) &&
    sql.includes(`${table}`) &&
    !sql.includes(`${table}_`)

const PYRAMIDS = 'fitness_route_heatmap_pyramids'
const TILES = 'fitness_route_heatmap_tiles'

const claimNowFor = (
  actorId: string,
  resumeBuild?: { pyramidId: string; claimSeq: number }
) =>
  database.claimFitnessRouteHeatmapPyramidBuild({
    actorId,
    requestedAt: ms(NOW),
    staleBefore: STALE_BEFORE,
    ...(resumeBuild ? { resumeBuild } : {})
  })

// Makes the next write on `table` matching `condition` (SQL over `new` or
// `old`, valid on both backends) fail. Returns the function that removes the
// trigger again.
let triggerCount = 0
const failWrite = async (
  table: typeof PYRAMIDS | typeof TILES,
  event: 'insert' | 'update' | 'delete',
  condition: string
) => {
  triggerCount += 1
  const name = `heatmap_tile_queries_fail_${triggerCount}`
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

// Runs `action` expecting it to fail on the forced write, then checks both
// tables are exactly as they were.
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

describe('getFitnessRouteHeatmapPyramid', () => {
  it('reads the named actor row with every column mapped', async () => {
    const neighbour = await newActor()
    const actorId = await newActor()
    await seedPyramid(neighbour, { status: 'failed', version: 9 })
    const id = await seedPyramid(actorId, {
      status: 'generating',
      error: 'boom',
      version: 3,
      claimSeq: 7,
      totalCount: 11,
      scannedCount: 5,
      activityCount: 4,
      tileCount: 9,
      pointCount: 123,
      cursorCreatedAt: at('2026-02-01T00:00:00.000Z'),
      cursorId: 'cursor-1',
      completedAt: at('2026-03-01T00:00:00.000Z'),
      createdAt: at(T0),
      updatedAt: at('2026-04-01T00:00:00.000Z')
    })

    expect(await database.getFitnessRouteHeatmapPyramid({ actorId })).toEqual({
      id,
      actorId,
      status: 'generating',
      error: 'boom',
      version: 3,
      claimSeq: 7,
      totalCount: 11,
      scannedCount: 5,
      activityCount: 4,
      tileCount: 9,
      pointCount: 123,
      cursor: { createdAt: ms('2026-02-01T00:00:00.000Z'), id: 'cursor-1' },
      completedAt: ms('2026-03-01T00:00:00.000Z'),
      createdAt: ms(T0),
      updatedAt: ms('2026-04-01T00:00:00.000Z')
    })
  })

  it.each([
    {
      name: 'no cursor and no completion',
      values: {},
      cursor: undefined,
      completedAt: undefined
    },
    {
      name: 'a cursor missing its id',
      values: { cursorCreatedAt: at('2026-02-01T00:00:00.000Z') },
      cursor: undefined,
      completedAt: undefined
    },
    {
      name: 'a cursor missing its time',
      values: { cursorId: 'half' },
      cursor: undefined,
      completedAt: undefined
    },
    {
      name: 'an epoch-0 cursor and completion',
      values: {
        cursorCreatedAt: new Date(0),
        cursorId: 'epoch',
        completedAt: new Date(0)
      },
      cursor: { createdAt: 0, id: 'epoch' },
      completedAt: 0
    }
  ])(
    'reads $name, and a null error as undefined',
    async ({ values, cursor, completedAt }) => {
      const actorId = await newActor()
      await seedPyramid(actorId, values)

      const pyramid = await database.getFitnessRouteHeatmapPyramid({ actorId })
      expect(pyramid?.cursor).toEqual(cursor)
      expect(pyramid?.completedAt).toEqual(completedAt)
      expect(pyramid).toHaveProperty('error', undefined)
    }
  )

  it('returns null for an actor without a row while another actor has one', async () => {
    const neighbour = await newActor()
    const actorId = await newActor()
    await seedPyramid(neighbour)

    expect(await database.getFitnessRouteHeatmapPyramid({ actorId })).toBeNull()
  })
})

// The same token on a neighbour's row, so each half of the fence is what
// refuses the write: another actor's actorId with this build's row id, this
// actor with the neighbour's row id, and this build one token behind.
type BuildRef = { actorId: string; id: string }
type Fence = { actorId: string; pyramidId: string; claimSeq: number }
const fenceMismatches: Array<{
  name: string
  fence: (build: BuildRef, other: BuildRef) => Fence
}> = [
  {
    name: 'another actor',
    fence: (build, other) => ({
      actorId: other.actorId,
      pyramidId: build.id,
      claimSeq: 4
    })
  },
  {
    name: 'another build row',
    fence: (build, other) => ({
      actorId: build.actorId,
      pyramidId: other.id,
      claimSeq: 4
    })
  },
  {
    name: 'a stale token',
    fence: (build) => ({
      actorId: build.actorId,
      pyramidId: build.id,
      claimSeq: 3
    })
  }
]

describe('updateFitnessRouteHeatmapPyramid', () => {
  it('writes every field and the heartbeat to the named build only', async () => {
    freezeTime()
    const neighbour = await seedBuild(await newActor())
    const build = await seedBuild(await newActor())
    const before = await dumpTables()

    expect(
      await database.updateFitnessRouteHeatmapPyramid({
        actorId: build.actorId,
        pyramidId: build.id,
        claimSeq: 4,
        status: 'completed',
        error: 'partial',
        cursor: { createdAt: ms('2026-05-01T00:00:00.000Z'), id: 'cursor-9' },
        totalCount: 41,
        scannedCount: 40,
        activityCount: 39,
        tileCount: 38,
        pointCount: 37,
        completedAt: ms('2026-06-01T00:00:00.000Z')
      })
    ).toBe(true)

    expect(await pyramidRow(build.actorId)).toEqual({
      id: build.id,
      actorId: build.actorId,
      status: 'completed',
      error: 'partial',
      version: 2,
      claimSeq: 4,
      totalCount: 41,
      scannedCount: 40,
      activityCount: 39,
      tileCount: 38,
      pointCount: 37,
      cursorCreatedAt: ms('2026-05-01T00:00:00.000Z'),
      cursorId: 'cursor-9',
      completedAt: ms('2026-06-01T00:00:00.000Z'),
      createdAt: ms(T0),
      updatedAt: ms(NOW)
    })
    expect(othersThan(await dumpTables(), [build.actorId])).toEqual(
      othersThan(before, [build.actorId])
    )
    expect(await pyramidRow(neighbour.actorId)).toMatchObject({
      updatedAt: ms(T0)
    })
  })

  it('leaves the fields it is not given, and clears the nullable ones on null', async () => {
    freezeTime()
    const build = await seedBuild(await newActor())
    await db()
      .updateTable('fitness_route_heatmap_pyramids')
      .set({ error: 'old', completedAt: at('2026-03-01T00:00:00.000Z') })
      .where('id', '=', build.id)
      .execute()
    const row = await pyramidRow(build.actorId)

    expect(
      await database.updateFitnessRouteHeatmapPyramid({
        actorId: build.actorId,
        pyramidId: build.id,
        claimSeq: 4,
        status: 'failed'
      })
    ).toBe(true)
    expect(await pyramidRow(build.actorId)).toEqual({
      ...row,
      status: 'failed',
      updatedAt: ms(NOW)
    })

    expect(
      await database.updateFitnessRouteHeatmapPyramid({
        actorId: build.actorId,
        pyramidId: build.id,
        claimSeq: 4,
        error: null,
        cursor: null,
        completedAt: null
      })
    ).toBe(true)
    expect(await pyramidRow(build.actorId)).toEqual({
      ...row,
      status: 'failed',
      error: null,
      cursorCreatedAt: null,
      cursorId: null,
      completedAt: null,
      updatedAt: ms(NOW)
    })
  })

  it.each(fenceMismatches)(
    'refuses a write fenced on $name and changes nothing',
    async ({ fence }) => {
      freezeTime()
      const other = await seedBuild(await newActor())
      const build = await seedBuild(await newActor())
      const before = await dumpTables()

      expect(
        await database.updateFitnessRouteHeatmapPyramid({
          ...fence(build, other),
          status: 'completed',
          tileCount: 99
        })
      ).toBe(false)
      expect(await dumpTables()).toEqual(before)
    }
  )
})

describe('getFitnessRouteHeatmapTilesByKeys', () => {
  it('reads only the named keys of the named actor', async () => {
    const actorId = await newActor()
    const neighbour = await newActor()
    await seedTile(actorId, '5:1:1', { pointCount: 3, version: 2 })
    await seedTile(actorId, '5:1:2')
    await seedTile(actorId, '6:2:2', {
      segments: null,
      updatedAt: at('2026-02-01T00:00:00.000Z')
    })
    await seedTile(neighbour, '5:1:1')
    await seedTile(neighbour, '5:1:2')

    const tiles = await database.getFitnessRouteHeatmapTilesByKeys({
      actorId,
      tileKeys: ['5:1:1', '6:2:2', '9:9:9']
    })

    expect(byTileKey(tiles)).toEqual([
      {
        actorId,
        tileKey: '5:1:1',
        z: 5,
        x: 1,
        y: 1,
        version: 2,
        segments: 'segments 5:1:1',
        pointCount: 3,
        createdAt: ms(T0),
        updatedAt: ms(T0)
      },
      {
        actorId,
        tileKey: '6:2:2',
        z: 6,
        x: 2,
        y: 2,
        version: 1,
        // A NULL segments column reads as an empty string.
        segments: '',
        pointCount: 1,
        createdAt: ms(T0),
        updatedAt: ms('2026-02-01T00:00:00.000Z')
      }
    ])
  })

  it('asks for a key repeated across chunks once', async () => {
    const actorId = await newActor()
    await seedTile(actorId, '5:1:1')
    await seedTile(actorId, '5:1:2')

    let tiles: Awaited<
      ReturnType<typeof database.getFitnessRouteHeatmapTilesByKeys>
    > = []
    const statements = await statementsOf(async () => {
      tiles = await database.getFitnessRouteHeatmapTilesByKeys({
        actorId,
        tileKeys: [...Array(1500).fill('5:1:1'), '5:1:2']
      })
    })

    expect(statements).toHaveLength(1)
    expect(statements[0].bindings).toHaveLength(3)
    expect(byTileKey(tiles).map(({ tileKey }) => tileKey)).toEqual([
      '5:1:1',
      '5:1:2'
    ])
  })

  it('issues no statement for an empty key list', async () => {
    const actorId = await newActor()
    await seedTile(actorId, '5:1:1')

    let tiles: unknown
    const statements = await statementsOf(async () => {
      tiles = await database.getFitnessRouteHeatmapTilesByKeys({
        actorId,
        tileKeys: []
      })
    })
    expect(tiles).toEqual([])
    expect(statements).toEqual([])
  })

  it('splits a long key list at the old batch size, reserving the actor binding', async () => {
    const actorId = await newActor()
    const keys = Array.from({ length: 1997 }, (_, index) => `7:${index}:0`)
    await seedTile(actorId, keys[0])
    await seedTile(actorId, keys[998])
    await seedTile(actorId, keys[1996])

    let tiles: Awaited<
      ReturnType<typeof database.getFitnessRouteHeatmapTilesByKeys>
    > = []
    const statements = await statementsOf(async () => {
      tiles = await database.getFitnessRouteHeatmapTilesByKeys({
        actorId,
        tileKeys: keys
      })
    })

    // SQLite: 998 keys and the actor id (999 bindings); PostgreSQL: 1000 keys.
    expect(statements.map(({ bindings }) => bindings.length)).toEqual(
      testDb.backend === 'pg' ? [1001, 998] : [999, 999, 2]
    )
    expect(byTileKey(tiles).map(({ tileKey }) => tileKey)).toEqual(
      byTileKey(
        [keys[0], keys[998], keys[1996]].map((tileKey) => ({ tileKey }))
      ).map(({ tileKey }) => tileKey)
    )
  })
})

describe('getFitnessRouteHeatmapTilesInRange and sumFitnessRouteHeatmapTilePoints', () => {
  // Point counts are powers of two, so every sum names exactly the tiles in
  // it.
  const seedWindow = async () => {
    const actorId = await newActor()
    const neighbour = await newActor()
    await seedTile(actorId, '10:4:7', { pointCount: 1 })
    await seedTile(actorId, '10:6:9', { pointCount: 2 })
    await seedTile(actorId, '10:5:8', { pointCount: 4, segments: null })
    await seedTile(actorId, '10:3:8', { pointCount: 8 })
    await seedTile(actorId, '10:7:8', { pointCount: 16 })
    await seedTile(actorId, '10:5:6', { pointCount: 32 })
    await seedTile(actorId, '10:5:10', { pointCount: 64 })
    await seedTile(actorId, '11:5:8', { pointCount: 128 })
    await seedTile(neighbour, '10:5:8', { pointCount: 256 })
    return actorId
  }

  it('reads the window inclusive of its edges, at that zoom, for that actor', async () => {
    const actorId = await seedWindow()
    const range = { actorId, z: 10, minX: 4, maxX: 6, minY: 7, maxY: 9 }

    const tiles = await database.getFitnessRouteHeatmapTilesInRange(range)
    expect(byTileKey(tiles).map(({ tileKey }) => tileKey)).toEqual([
      '10:4:7',
      '10:5:8',
      '10:6:9'
    ])
    expect(tiles.find(({ tileKey }) => tileKey === '10:5:8')).toEqual({
      actorId,
      tileKey: '10:5:8',
      z: 10,
      x: 5,
      y: 8,
      version: 1,
      segments: '',
      pointCount: 4,
      createdAt: ms(T0),
      updatedAt: ms(T0)
    })
    expect(await database.sumFitnessRouteHeatmapTilePoints(range)).toBe(7)
  })

  it('matches nothing for a window whose edges are reversed', async () => {
    const actorId = await seedWindow()
    for (const range of [
      { actorId, z: 10, minX: 6, maxX: 4, minY: 7, maxY: 9 },
      { actorId, z: 10, minX: 4, maxX: 6, minY: 9, maxY: 7 }
    ]) {
      expect(await database.getFitnessRouteHeatmapTilesInRange(range)).toEqual(
        []
      )
      expect(await database.sumFitnessRouteHeatmapTilePoints(range)).toBe(0)
    }
  })
})

describe('getFitnessRouteHeatmapTileTotals', () => {
  it('counts and sums one version of one actor', async () => {
    const actorId = await newActor()
    const neighbour = await newActor()
    await seedTile(actorId, '5:0:0', { version: 2, pointCount: 1 })
    await seedTile(actorId, '5:0:1', { version: 2, pointCount: 2 })
    await seedTile(actorId, '5:0:2', { version: 3, pointCount: 4 })
    await seedTile(neighbour, '5:0:0', { version: 2, pointCount: 8 })

    expect(
      await database.getFitnessRouteHeatmapTileTotals({ actorId, version: 2 })
    ).toEqual({ tileCount: 2, pointCount: 3 })
    expect(
      await database.getFitnessRouteHeatmapTileTotals({ actorId, version: 3 })
    ).toEqual({ tileCount: 1, pointCount: 4 })
    expect(
      await database.getFitnessRouteHeatmapTileTotals({ actorId, version: 9 })
    ).toEqual({ tileCount: 0, pointCount: 0 })
  })
})

describe('upsertFitnessRouteHeatmapTiles', () => {
  it('writes the tiles, the heartbeat and the progress for the named build only', async () => {
    freezeTime()
    const neighbour = await seedBuild(await newActor())
    const build = await seedBuild(await newActor())
    await seedTile(build.actorId, '5:1:1', { pointCount: 3 })
    await seedTile(neighbour.actorId, '5:1:1', { pointCount: 3 })
    const row = await pyramidRow(build.actorId)
    const before = await dumpTables()

    expect(
      await database.upsertFitnessRouteHeatmapTiles({
        actorId: build.actorId,
        pyramidId: build.id,
        claimSeq: 4,
        version: 3,
        tiles: [
          tileInput('5:1:1', 5, 'replaced'),
          tileInput('5:1:2', 6, 'added')
        ],
        progress: {
          scannedCount: 12,
          activityCount: 3,
          totalCount: 40,
          cursor: { createdAt: ms('2026-05-01T00:00:00.000Z'), id: 'cursor-5' }
        }
      })
    ).toBe(true)

    expect(await tileRows(build.actorId)).toEqual([
      {
        actorId: build.actorId,
        tileKey: '5:1:1',
        z: 5,
        x: 1,
        y: 1,
        version: 3,
        segments: 'replaced',
        pointCount: 5,
        // A tile written again keeps the time it was first written.
        createdAt: ms(T0),
        updatedAt: ms(NOW)
      },
      {
        actorId: build.actorId,
        tileKey: '5:1:2',
        z: 5,
        x: 1,
        y: 2,
        version: 3,
        segments: 'added',
        pointCount: 6,
        createdAt: ms(NOW),
        updatedAt: ms(NOW)
      }
    ])
    expect(await pyramidRow(build.actorId)).toEqual({
      ...row,
      scannedCount: 12,
      activityCount: 3,
      totalCount: 40,
      cursorCreatedAt: ms('2026-05-01T00:00:00.000Z'),
      cursorId: 'cursor-5',
      updatedAt: ms(NOW)
    })
    expect(othersThan(await dumpTables(), [build.actorId])).toEqual(
      othersThan(before, [build.actorId])
    )
  })

  it('writes only the progress fields it is given', async () => {
    freezeTime()
    const build = await seedBuild(await newActor())
    const row = await pyramidRow(build.actorId)

    expect(
      await database.upsertFitnessRouteHeatmapTiles({
        actorId: build.actorId,
        pyramidId: build.id,
        claimSeq: 4,
        version: 2,
        tiles: [],
        progress: { scannedCount: 13 }
      })
    ).toBe(true)
    expect(await pyramidRow(build.actorId)).toEqual({
      ...row,
      scannedCount: 13,
      updatedAt: ms(NOW)
    })
  })

  it('heartbeats a flush with no tiles and no progress without writing a tile', async () => {
    freezeTime()
    const build = await seedBuild(await newActor())
    const row = await pyramidRow(build.actorId)

    const statements = await statementsOf(async () => {
      expect(
        await database.upsertFitnessRouteHeatmapTiles({
          actorId: build.actorId,
          pyramidId: build.id,
          claimSeq: 4,
          version: 2,
          tiles: []
        })
      ).toBe(true)
    })
    expect(await pyramidRow(build.actorId)).toEqual({
      ...row,
      updatedAt: ms(NOW)
    })
    expect(statements.filter(({ sql }) => sql.includes(TILES))).toEqual([])
  })

  it.each(fenceMismatches)(
    'refuses a flush fenced on $name and changes nothing',
    async ({ fence }) => {
      freezeTime()
      const other = await seedBuild(await newActor())
      const build = await seedBuild(await newActor())
      const before = await dumpTables()

      expect(
        await database.upsertFitnessRouteHeatmapTiles({
          ...fence(build, other),
          version: 2,
          tiles: [tileInput('5:3:3', 1)],
          progress: { scannedCount: 99 }
        })
      ).toBe(false)
      expect(await dumpTables()).toEqual(before)
    }
  )

  it('writes a large flush in the old insert batches', async () => {
    const build = await seedBuild(await newActor())
    const tiles = Array.from({ length: 1001 }, (_, index) =>
      tileInput(`12:${index}:0`, 1)
    )

    const statements = await statementsOf(async () => {
      expect(
        await database.upsertFitnessRouteHeatmapTiles({
          actorId: build.actorId,
          pyramidId: build.id,
          claimSeq: 4,
          version: 2,
          tiles
        })
      ).toBe(true)
    })

    // Ten columns a row: 99 rows a statement on SQLite, 1000 on PostgreSQL.
    expect(
      statements
        .filter(({ sql }) => isStatement('insert', TILES)(sql))
        .map(({ bindings }) => bindings.length / 10)
    ).toEqual(testDb.backend === 'pg' ? [1000, 1] : [...Array(10).fill(99), 11])
    expect(await tileRows(build.actorId)).toHaveLength(1001)
  })

  it('rolls back the heartbeat, the progress and every earlier batch when the last tile fails', async () => {
    freezeTime()
    const build = await seedBuild(await newActor())
    await seedTile(build.actorId, '12:0:0', { pointCount: 7 })
    const tiles = Array.from({ length: 250 }, (_, index) =>
      tileInput(`12:${index}:0`, 1)
    )
    const drop = await failWrite(
      TILES,
      'insert',
      `new."actorId" = '${build.actorId}' and new."tileKey" = '12:249:0'`
    )

    await expectRolledBack(drop, () =>
      database.upsertFitnessRouteHeatmapTiles({
        actorId: build.actorId,
        pyramidId: build.id,
        claimSeq: 4,
        version: 3,
        tiles,
        progress: { scannedCount: 20 }
      })
    )
  })
})

describe('deleteStaleFitnessRouteHeatmapTiles', () => {
  it('deletes the actor tiles below the version and heartbeats the build', async () => {
    freezeTime()
    const neighbour = await seedBuild(await newActor())
    const build = await seedBuild(await newActor())
    await seedTile(build.actorId, '5:0:1', { version: 1 })
    await seedTile(build.actorId, '5:0:2', { version: 2 })
    await seedTile(build.actorId, '5:0:3', { version: 3 })
    await seedTile(neighbour.actorId, '5:0:1', { version: 1 })
    const row = await pyramidRow(build.actorId)
    const before = await dumpTables()

    expect(
      await database.deleteStaleFitnessRouteHeatmapTiles({
        actorId: build.actorId,
        pyramidId: build.id,
        claimSeq: 4,
        beforeVersion: 2
      })
    ).toBe(1)

    expect(
      (await tileRows(build.actorId)).map(({ tileKey }) => tileKey)
    ).toEqual(['5:0:2', '5:0:3'])
    expect(await pyramidRow(build.actorId)).toEqual({
      ...row,
      updatedAt: ms(NOW)
    })
    expect(othersThan(await dumpTables(), [build.actorId])).toEqual(
      othersThan(before, [build.actorId])
    )
  })

  it.each(fenceMismatches)(
    'refuses a sweep fenced on $name and changes nothing',
    async ({ fence }) => {
      freezeTime()
      const other = await seedBuild(await newActor())
      const build = await seedBuild(await newActor())
      await seedTile(build.actorId, '5:0:1', { version: 1 })
      await seedTile(other.actorId, '5:0:1', { version: 1 })
      const before = await dumpTables()

      expect(
        await database.deleteStaleFitnessRouteHeatmapTiles({
          ...fence(build, other),
          beforeVersion: 2
        })
      ).toBe(0)
      expect(await dumpTables()).toEqual(before)
    }
  )

  it('rolls back the heartbeat when the tile delete fails', async () => {
    freezeTime()
    const build = await seedBuild(await newActor())
    await seedTile(build.actorId, '5:0:1', { version: 1 })
    await seedTile(build.actorId, '5:0:2', { version: 1 })
    const drop = await failWrite(
      TILES,
      'delete',
      `old."actorId" = '${build.actorId}' and old."tileKey" = '5:0:2'`
    )

    await expectRolledBack(drop, () =>
      database.deleteStaleFitnessRouteHeatmapTiles({
        actorId: build.actorId,
        pyramidId: build.id,
        claimSeq: 4,
        beforeVersion: 2
      })
    )
  })
})

describe('deleteFitnessRouteHeatmapPyramidAndTilesForActor', () => {
  it('deletes the actor row and tiles and counts the tiles', async () => {
    const neighbour = await seedBuild(await newActor())
    const build = await seedBuild(await newActor())
    await seedTile(build.actorId, '5:0:1')
    await seedTile(build.actorId, '6:0:1')
    await seedTile(neighbour.actorId, '5:0:1')
    const before = await dumpTables()

    expect(
      await database.deleteFitnessRouteHeatmapPyramidAndTilesForActor({
        actorId: build.actorId
      })
    ).toBe(2)
    expect(await pyramidRow(build.actorId)).toBeUndefined()
    expect(await tileRows(build.actorId)).toEqual([])
    expect(await dumpTables()).toEqual(othersThan(before, [build.actorId]))
  })

  it('leaves no row behind for an actor that never built, or has nothing at all', async () => {
    const withTile = await newActor()
    const empty = await newActor()
    await seedTile(withTile, '5:0:1')

    expect(
      await database.deleteFitnessRouteHeatmapPyramidAndTilesForActor({
        actorId: withTile
      })
    ).toBe(1)
    expect(
      await database.deleteFitnessRouteHeatmapPyramidAndTilesForActor({
        actorId: empty
      })
    ).toBe(0)
    for (const actorId of [withTile, empty]) {
      expect(await pyramidRow(actorId)).toBeUndefined()
      expect(await tileRows(actorId)).toEqual([])
    }
  })

  it('keeps the build row when the tile delete fails', async () => {
    const build = await seedBuild(await newActor())
    await seedTile(build.actorId, '5:0:1')
    const drop = await failWrite(
      TILES,
      'delete',
      `old."actorId" = '${build.actorId}'`
    )

    await expectRolledBack(drop, () =>
      database.deleteFitnessRouteHeatmapPyramidAndTilesForActor({
        actorId: build.actorId
      })
    )
  })

  it('does not leave the row it created when the tile delete fails', async () => {
    const actorId = await newActor()
    await seedTile(actorId, '5:0:1')
    const drop = await failWrite(
      TILES,
      'delete',
      `old."actorId" = '${actorId}'`
    )

    await expectRolledBack(drop, () =>
      database.deleteFitnessRouteHeatmapPyramidAndTilesForActor({ actorId })
    )
    expect(await pyramidRow(actorId)).toBeUndefined()
  })
})

describe('claimFitnessRouteHeatmapPyramidBuild', () => {
  it('creates and claims the row of an actor that never built, and no other', async () => {
    freezeTime()
    const neighbour = await seedBuild(await newActor())
    const actorId = await newActor()
    const before = await dumpTables()

    const claim = await claimNowFor(actorId)
    const row = await pyramidRow(actorId)
    expect(row).toEqual({
      id: expect.any(String),
      actorId,
      status: 'generating',
      error: null,
      version: 1,
      claimSeq: 1,
      totalCount: 0,
      scannedCount: 0,
      activityCount: 0,
      tileCount: 0,
      pointCount: 0,
      cursorCreatedAt: null,
      cursorId: null,
      completedAt: null,
      createdAt: ms(NOW),
      updatedAt: ms(NOW)
    })
    expect(claim).toEqual({
      claimed: true,
      resumed: false,
      reason: 'claimed',
      pyramid: {
        id: row?.id,
        actorId,
        status: 'generating',
        error: undefined,
        version: 1,
        claimSeq: 1,
        totalCount: 0,
        scannedCount: 0,
        activityCount: 0,
        tileCount: 0,
        pointCount: 0,
        cursor: undefined,
        completedAt: undefined,
        createdAt: ms(NOW),
        updatedAt: ms(NOW)
      }
    })
    expect(othersThan(await dumpTables(), [actorId])).toEqual(
      othersThan(before, [actorId])
    )
    expect(await pyramidRow(neighbour.actorId)).toMatchObject({ claimSeq: 4 })
  })

  it('starts a fresh version over an outdated completed build, keeping what describes its tiles', async () => {
    freezeTime()
    const actorId = await newActor()
    const id = await seedPyramid(actorId, {
      status: 'completed',
      error: 'old',
      version: 3,
      claimSeq: 5,
      totalCount: 20,
      scannedCount: 9,
      activityCount: 2,
      tileCount: 7,
      pointCount: 70,
      cursorCreatedAt: at('2025-12-01T00:00:00.000Z'),
      cursorId: 'cursor-old',
      completedAt: at('2026-01-02T00:00:00.000Z')
    })

    const claim = await claimNowFor(actorId)
    expect(claim).toMatchObject({ claimed: true, resumed: false })
    expect(await pyramidRow(actorId)).toEqual({
      id,
      actorId,
      status: 'generating',
      error: null,
      version: 4,
      claimSeq: 6,
      totalCount: 20,
      scannedCount: 0,
      activityCount: 0,
      tileCount: 7,
      pointCount: 70,
      cursorCreatedAt: null,
      cursorId: null,
      completedAt: null,
      createdAt: ms(T0),
      updatedAt: ms(NOW)
    })
  })

  // The compare-and-swap repeats the read's verdict as SQL, so the two must
  // agree on a row that only looks fresh: a completion time newer than the
  // request on a build that is not `completed` does not answer it.
  it.each(['failed', 'generating'])(
    'claims a %s build whose completion time is newer than the request',
    async (status) => {
      freezeTime()
      const actorId = await newActor()
      await seedPyramid(actorId, {
        status,
        version: 2,
        claimSeq: 3,
        completedAt: at(NOW)
      })

      expect(await claimNowFor(actorId)).toMatchObject({
        claimed: true,
        resumed: false,
        pyramid: { version: 3, claimSeq: 4 }
      })
    }
  )

  it.each([
    {
      reason: 'already-fresh',
      values: { status: 'completed', completedAt: at(NOW) }
    },
    {
      reason: 'build-in-progress',
      values: { status: 'generating', updatedAt: at(NOW) }
    }
  ])(
    'answers $reason from the read, without opening a transaction',
    async ({ reason, values }) => {
      freezeTime()
      const actorId = await newActor()
      await seedPyramid(actorId, { version: 2, claimSeq: 3, ...values })
      const before = await dumpTables()

      const statements = await statementsOf(async () => {
        expect(await claimNowFor(actorId)).toMatchObject({
          claimed: false,
          reason,
          pyramid: { version: 2, claimSeq: 3 }
        })
      })
      expect(
        statements.filter(({ sql }) => /^(begin|update)/i.test(sql))
      ).toEqual([])
      expect(await dumpTables()).toEqual(before)
    }
  )

  it('resumes its own build, moving only the status, error, token and heartbeat', async () => {
    freezeTime()
    const build = await seedBuild(await newActor())
    await db()
      .updateTable('fitness_route_heatmap_pyramids')
      .set({ error: 'transient', updatedAt: at(NOW) })
      .where('id', '=', build.id)
      .execute()
    const row = await pyramidRow(build.actorId)

    const claim = await claimNowFor(build.actorId, {
      pyramidId: build.id,
      claimSeq: 4
    })
    expect(claim).toMatchObject({
      claimed: true,
      resumed: true,
      pyramid: {
        version: 2,
        claimSeq: 5,
        cursor: { createdAt: ms('2025-12-01T00:00:00.000Z'), id: 'cursor-0' }
      }
    })
    expect(await pyramidRow(build.actorId)).toEqual({
      ...row,
      error: null,
      claimSeq: 5,
      updatedAt: ms(NOW)
    })
  })

  it('loses the race to a row replaced between its read and its compare-and-swap', async () => {
    freezeTime()
    const actorId = await newActor()
    await seedPyramid(actorId, { status: 'failed', version: 2, claimSeq: 3 })
    const before = await pyramidRow(actorId)
    // The row a clear and a fresh claim to the same token would leave: same
    // actor, same token, another id.
    const replace = interfereAfterStatement(
      isStatement('select', PYRAMIDS),
      () =>
        testDb.db
          .updateTable('fitness_route_heatmap_pyramids')
          .set({ id: 'replacement-row' })
          .where('actorId', '=', actorId)
    )

    const claim = await claimNowFor(actorId)
    expect(replace.fired).toBe(true)
    expect(claim).toMatchObject({
      claimed: false,
      reason: 'lost-race',
      pyramid: { id: 'replacement-row', claimSeq: 3 }
    })
    expect(await pyramidRow(actorId)).toEqual({
      ...before,
      id: 'replacement-row'
    })
  })

  it('rolls the compare-and-swap back when the read confirming it fails', async () => {
    freezeTime()
    const actorId = await newActor()
    await seedPyramid(actorId, { status: 'failed', version: 2, claimSeq: 3 })
    const before = await dumpTables()
    let pyramidSelects = 0
    const fail = failStatement((sql) => {
      if (!isStatement('select', PYRAMIDS)(sql)) return false
      pyramidSelects += 1
      return pyramidSelects === 2
    })

    await expect(claimNowFor(actorId)).rejects.toThrow(
      'forced statement failure'
    )
    expect(fail.fired).toBe(true)
    expect(await dumpTables()).toEqual(before)
  })

  it('leaves the row untouched when the compare-and-swap itself fails', async () => {
    freezeTime()
    const actorId = await newActor()
    await seedPyramid(actorId, { status: 'failed', version: 2, claimSeq: 3 })
    const drop = await failWrite(
      PYRAMIDS,
      'update',
      `old."actorId" = '${actorId}'`
    )

    await expectRolledBack(drop, () => claimNowFor(actorId))
  })

  it('creates the row again after two clears, and gives up after three', async () => {
    freezeTime()
    const clearAfterInsert = (actorId: string) =>
      interfereAfterStatement(isStatement('insert', PYRAMIDS), () =>
        testDb.db
          .deleteFrom('fitness_route_heatmap_pyramids')
          .where('actorId', '=', actorId)
      )

    const survivor = await newActor()
    clearAfterInsert(survivor)
    clearAfterInsert(survivor)
    const statements = await statementsOf(async () => {
      expect(await claimNowFor(survivor)).toMatchObject({
        claimed: true,
        pyramid: { version: 1, claimSeq: 1 }
      })
    })
    expect(
      statements.filter(({ sql }) => isStatement('insert', PYRAMIDS)(sql))
    ).toHaveLength(3)

    const cleared = await newActor()
    clearAfterInsert(cleared)
    clearAfterInsert(cleared)
    clearAfterInsert(cleared)
    await expect(claimNowFor(cleared)).rejects.toThrow(
      `Route heatmap pyramid row for actor ${cleared} was cleared during every claim attempt`
    )
    expect(await pyramidRow(cleared)).toBeUndefined()
  })
})

// How the driver treats values the types forbid and how it reports errors,
// pinned on the backend each applies to.
describe('driver edge cases', () => {
  const gone = undefined as unknown as string
  const goneNumber = undefined as unknown as number

  // An undefined binding is bound as NULL, which matches nothing.
  describe('an undefined argument matches nothing instead of throwing', () => {
    it('in the reads', async () => {
      const actorId = await newActor()
      await seedPyramid(actorId)
      await seedTile(actorId, '10:5:8', { version: 1, pointCount: 2 })
      const range = { actorId, z: 10, minX: 5, maxX: 5, minY: 8, maxY: 8 }

      expect(
        await database.getFitnessRouteHeatmapPyramid({ actorId: gone })
      ).toBeNull()
      expect(
        await database.getFitnessRouteHeatmapTilesByKeys({
          actorId: gone,
          tileKeys: ['10:5:8']
        })
      ).toEqual([])
      expect(
        (
          await database.getFitnessRouteHeatmapTilesByKeys({
            actorId,
            tileKeys: ['10:5:8', gone]
          })
        ).map(({ tileKey }) => tileKey)
      ).toEqual(['10:5:8'])
      for (const field of ['actorId', 'z', 'minX', 'maxX', 'minY', 'maxY']) {
        const partial = { ...range, [field]: undefined } as typeof range
        expect(
          await database.getFitnessRouteHeatmapTilesInRange(partial)
        ).toEqual([])
        expect(await database.sumFitnessRouteHeatmapTilePoints(partial)).toBe(0)
      }
      expect(
        await database.getFitnessRouteHeatmapTileTotals({
          actorId: gone,
          version: 1
        })
      ).toEqual({ tileCount: 0, pointCount: 0 })
      expect(
        await database.getFitnessRouteHeatmapTileTotals({
          actorId,
          version: goneNumber
        })
      ).toEqual({ tileCount: 0, pointCount: 0 })
    })

    it.each(['actorId', 'pyramidId', 'claimSeq'] as const)(
      'in a fence missing its %s',
      async (field) => {
        freezeTime()
        const build = await seedBuild(await newActor())
        await seedTile(build.actorId, '5:0:1', { version: 1 })
        const fence = {
          actorId: build.actorId,
          pyramidId: build.id,
          claimSeq: 4,
          [field]: undefined
        } as { actorId: string; pyramidId: string; claimSeq: number }
        const before = await dumpTables()

        expect(
          await database.updateFitnessRouteHeatmapPyramid({
            ...fence,
            status: 'failed'
          })
        ).toBe(false)
        expect(
          await database.upsertFitnessRouteHeatmapTiles({
            ...fence,
            version: 2,
            tiles: [tileInput('5:0:2', 1)]
          })
        ).toBe(false)
        expect(
          await database.upsertFitnessRouteHeatmapTiles({
            ...fence,
            version: 2,
            tiles: []
          })
        ).toBe(false)
        expect(
          await database.deleteStaleFitnessRouteHeatmapTiles({
            ...fence,
            beforeVersion: 2
          })
        ).toBe(0)
        expect(await dumpTables()).toEqual(before)
      }
    )

    it('in the sweep boundary, after the heartbeat has committed', async () => {
      freezeTime()
      const build = await seedBuild(await newActor())
      await seedTile(build.actorId, '5:0:1', { version: 1 })
      const row = await pyramidRow(build.actorId)

      expect(
        await database.deleteStaleFitnessRouteHeatmapTiles({
          actorId: build.actorId,
          pyramidId: build.id,
          claimSeq: 4,
          beforeVersion: goneNumber
        })
      ).toBe(0)
      expect(await tileRows(build.actorId)).toHaveLength(1)
      expect(await pyramidRow(build.actorId)).toEqual({
        ...row,
        updatedAt: ms(NOW)
      })
    })

    it.each(['pyramidId', 'claimSeq'] as const)(
      'in a resume token missing its %s, which claims a fresh version',
      async (field) => {
        freezeTime()
        const actorId = await newActor()
        const id = await seedPyramid(actorId, {
          status: 'failed',
          version: 2,
          claimSeq: 3
        })
        const resumeBuild = {
          pyramidId: id,
          claimSeq: 3,
          [field]: undefined
        } as { pyramidId: string; claimSeq: number }

        expect(
          await database.claimFitnessRouteHeatmapPyramidBuild({
            actorId,
            requestedAt: ms(NOW),
            staleBefore: STALE_BEFORE,
            resumeBuild
          })
        ).toMatchObject({
          claimed: true,
          resumed: false,
          pyramid: { version: 3, claimSeq: 4 }
        })
      }
    )
  })

  // Kysely leaves an undefined value out of a multi-row insert, so the column
  // takes its default on both backends.
  it('writes the column default for a version or point count left undefined', async () => {
    const build = await seedBuild(await newActor())

    expect(
      await database.upsertFitnessRouteHeatmapTiles({
        actorId: build.actorId,
        pyramidId: build.id,
        claimSeq: 4,
        version: goneNumber,
        tiles: [
          { ...tileInput('5:0:1', 1), pointCount: goneNumber },
          { ...tileInput('5:0:2', 1), pointCount: goneNumber }
        ]
      })
    ).toBe(true)
    expect(
      (await tileRows(build.actorId)).map(({ version, pointCount }) => ({
        version,
        pointCount
      }))
    ).toEqual([
      { version: 0, pointCount: 0 },
      { version: 0, pointCount: 0 }
    ])
  })

  // The pyramid id is nullable on SQLite only. No code path writes a NULL id,
  // and the fence compares with `=`, which matches no such row.
  describe.runIf(testDb.backend === 'sqlite')(
    'a NULL pyramid id on SQLite',
    () => {
      it('is no longer matched by a fence or a claim', async () => {
        freezeTime()
        const actorId = await newActor()
        await seedPyramid(actorId, {
          id: null as unknown as string,
          status: 'generating',
          version: 2,
          claimSeq: 4,
          cursorCreatedAt: at('2025-12-01T00:00:00.000Z'),
          cursorId: 'cursor-0'
        })
        await seedTile(actorId, '5:0:1', { version: 1 })
        const before = await dumpTables()
        const fence = {
          actorId,
          pyramidId: null as unknown as string,
          claimSeq: 4
        }

        expect(
          await database.updateFitnessRouteHeatmapPyramid({
            ...fence,
            status: 'failed'
          })
        ).toBe(false)
        expect(
          await database.upsertFitnessRouteHeatmapTiles({
            ...fence,
            version: 2,
            tiles: [tileInput('5:0:2', 1)]
          })
        ).toBe(false)
        expect(
          await database.deleteStaleFitnessRouteHeatmapTiles({
            ...fence,
            beforeVersion: 2
          })
        ).toBe(0)
        // Stale (heartbeated at T0) and its own continuation: both now lose.
        expect(await claimNowFor(actorId)).toMatchObject({
          claimed: false,
          reason: 'lost-race'
        })
        expect(
          await claimNowFor(actorId, {
            pyramidId: null as unknown as string,
            claimSeq: 4
          })
        ).toMatchObject({ claimed: false, reason: 'lost-race' })
        expect(await dumpTables()).toEqual(before)
      })
    }
  )

  // The errors carry the driver's message alone, without the statement.
  describe('driver errors without the statement in front', () => {
    it('for a NOT NULL column', async () => {
      const build = await seedBuild(await newActor())
      await expect(
        database.upsertFitnessRouteHeatmapTiles({
          actorId: build.actorId,
          pyramidId: build.id,
          claimSeq: 4,
          version: 2,
          tiles: [{ ...tileInput('5:0:1', 1), z: null as unknown as number }]
        })
      ).rejects.toThrow(
        testDb.backend === 'pg'
          ? /^null value in column "z" of relation "fitness_route_heatmap_tiles" violates not-null constraint$/
          : /^NOT NULL constraint failed: fitness_route_heatmap_tiles\.z$/
      )
    })

    it('for an actor that does not exist', async () => {
      const actorId = `https://${DOMAIN}/users/nobody`
      const message =
        testDb.backend === 'pg'
          ? /^insert or update on table "fitness_route_heatmap_pyramids" violates foreign key constraint "fitness_route_heatmap_pyramids_actorid_foreign"$/
          : /^FOREIGN KEY constraint failed$/
      await expect(claimNowFor(actorId)).rejects.toThrow(message)
      await expect(
        database.deleteFitnessRouteHeatmapPyramidAndTilesForActor({ actorId })
      ).rejects.toThrow(message)
    })

    it.runIf(testDb.backend === 'pg')(
      'for a clock that is not a number',
      async () => {
        const actorId = await newActor()
        await seedPyramid(actorId)
        await expect(
          database.claimFitnessRouteHeatmapPyramidBuild({
            actorId,
            requestedAt: ms(NOW),
            staleBefore: Number.NaN
          })
        ).rejects.toThrow(
          /^invalid input syntax for type timestamp with time zone: "/
        )
      }
    )
  })
})

// A sum or a count PostgreSQL returns as int8 is read through the driver's
// int8 parser, which refuses a value past Number.MAX_SAFE_INTEGER rather than
// round it. The table is swapped for a view in this worker's
// separate database, as four million real rows would take minutes to write.
describe.runIf(testDb.backend === 'pg')('an int8 total past 2^53 - 1', () => {
  // Created in `beforeAll`: `describe.runIf` still runs this body when the
  // suite is collected on SQLite, and a database made here would never be
  // destroyed.
  let isolated: ReturnType<typeof createTestDatabase>

  beforeAll(async () => {
    isolated = createTestDatabase({ isolated: true })
    await isolated.prepare()
    await isolated.database.migrate()
    await sql
      .raw(
        'alter table fitness_route_heatmap_tiles rename to fitness_route_heatmap_tiles_table'
      )
      .execute(isolated.db)
    // 4,194,305 tiles of 2,147,483,647 points: 9,007,201,398,030,335 in all.
    await sql
      .raw(
        `create view fitness_route_heatmap_tiles as
          select 'actor-int8'::varchar(255) as "actorId",
            ('5:' || g || ':0')::varchar(255) as "tileKey",
            5 as z, g as x, 0 as y, 1 as version, null::text as segments,
            2147483647 as "pointCount", now() as "createdAt", now() as "updatedAt"
          from generate_series(1, 4194305) as g`
      )
      .execute(isolated.db)
  })

  afterAll(async () => {
    await isolated.destroy()
  })

  it('throws a RangeError rather than returning a rounded number', async () => {
    const message =
      /^PostgreSQL bigint value 9007201398030335 is outside the safe integer range/
    await expect(
      isolated.database.sumFitnessRouteHeatmapTilePoints({
        actorId: 'actor-int8',
        z: 5,
        minX: 0,
        maxX: 5_000_000,
        minY: 0,
        maxY: 0
      })
    ).rejects.toThrow(message)
    await expect(
      isolated.database.getFitnessRouteHeatmapTileTotals({
        actorId: 'actor-int8',
        version: 1
      })
    ).rejects.toThrow(RangeError)
  }, 60_000)
})
