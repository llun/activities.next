import type { Insertable } from 'kysely'

import type { FitnessFileRoutes, FitnessFiles } from '@/lib/database/kysely/db'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { createSearchActor } from '@/lib/database/testing/searchTestHelpers'

const DOMAIN = 'routeq.test'

// Every `where`, `limit` and chunk of the cached route queries, each pinned
// with a neighbouring row the query must not touch: another actor's route, an
// unrequested route, a GPS-less negative cache, a route whose activity is
// deleted, unfinished or not the primary file of its post, and a route just
// outside each edge of a region. Rows are written straight into the tables
// where a test needs a shape no method produces (a corrupt payload, half a
// bounding box). None of these methods runs in a transaction. Runs on
// PostgreSQL in CI.

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

let actorCount = 0
const newActor = async () => {
  actorCount += 1
  const username = `routeq${actorCount}`
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

// A completed, primary activity unless `values` says otherwise: the only shape
// the aggregates count.
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
      createdAt: at('2026-01-01T08:00:00.000Z'),
      updatedAt: at('2026-01-01T08:00:00.000Z'),
      ...values,
      id,
      actorId
    })
    .execute()
  return id
}

type Box = { minLat: number; maxLat: number; minLng: number; maxLng: number }

// A route row written directly, with the box given rather than derived.
const seedRoute = async (
  actorId: string,
  box: Partial<Box> | null,
  {
    file = {},
    route = {}
  }: {
    file?: Partial<Insertable<FitnessFiles>>
    route?: Partial<Insertable<FitnessFileRoutes>>
  } = {}
) => {
  const fitnessFileId = await seedFile(actorId, file)
  await db()
    .insertInto('fitness_file_routes')
    .values({
      fitnessFileId,
      actorId,
      points: '[]',
      pointCount: 0,
      minLat: box?.minLat ?? null,
      maxLat: box?.maxLat ?? null,
      minLng: box?.minLng ?? null,
      maxLng: box?.maxLng ?? null,
      sourceVersion: 1,
      createdAt: at('2026-01-01T08:00:00.000Z'),
      updatedAt: at('2026-01-01T08:00:00.000Z'),
      ...route
    })
    .execute()
  return fitnessFileId
}

const routeRows = (fitnessFileIds: string[]) =>
  db()
    .selectFrom('fitness_file_routes')
    .selectAll()
    .where('fitnessFileId', 'in', fitnessFileIds)
    .orderBy('fitnessFileId')
    .execute()

// The statements issued against `fitness_file_routes` while `action` runs.
const routeStatements = async (action: () => Promise<unknown>) => {
  const statements: string[] = []
  const record = ({ sql }: { sql: string }) => {
    if (sql.includes('fitness_file_routes')) statements.push(sql)
  }
  testDb.knex.on('query', record)
  try {
    await action()
  } finally {
    testDb.knex.removeListener('query', record)
  }
  return statements
}

describe('upsertFitnessFileRoute', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('writes the points, their count and the box they span', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: at('2026-04-02T10:00:00Z') })
    const actorId = await newActor()
    const fitnessFileId = await seedFile(actorId)

    await database.upsertFitnessFileRoute({
      fitnessFileId,
      actorId,
      points: [
        [1.25, 103.75],
        [1.5, 103.5],
        [1, 104]
      ],
      sourceVersion: 3
    })

    expect(await routeRows([fitnessFileId])).toEqual([
      {
        fitnessFileId,
        actorId,
        points: '[[1.25,103.75],[1.5,103.5],[1,104]]',
        pointCount: 3,
        minLat: 1,
        maxLat: 1.5,
        minLng: 103.5,
        maxLng: 104,
        sourceVersion: 3,
        createdAt: ms('2026-04-02T10:00:00Z'),
        updatedAt: ms('2026-04-02T10:00:00Z')
      }
    ])
  })

  it('writes a route with no points as a negative cache with no box', async () => {
    const actorId = await newActor()
    const fitnessFileId = await seedFile(actorId)

    await database.upsertFitnessFileRoute({
      fitnessFileId,
      actorId,
      points: [],
      sourceVersion: 1
    })

    expect(await routeRows([fitnessFileId])).toMatchObject([
      {
        points: '[]',
        pointCount: 0,
        minLat: null,
        maxLat: null,
        minLng: null,
        maxLng: null
      }
    ])
  })

  it('leaves a non-finite point out of the box', async () => {
    const actorId = await newActor()
    const fitnessFileId = await seedFile(actorId)

    await database.upsertFitnessFileRoute({
      fitnessFileId,
      actorId,
      points: [
        [2, 3],
        [Number.POSITIVE_INFINITY, 50],
        [4, 5]
      ],
      sourceVersion: 1
    })

    const [row] = await routeRows([fitnessFileId])
    expect(row).toMatchObject({
      pointCount: 3,
      minLat: 2,
      maxLat: 4,
      minLng: 3,
      maxLng: 5
    })
    // JSON has no Infinity: the stored point reads back without it.
    const [route] = await database.getFitnessFileRoutes({
      fitnessFileIds: [fitnessFileId]
    })
    expect(route.points).toEqual([
      [2, 3],
      [4, 5]
    ])
  })

  it('replaces every column but createdAt on a second write, and only that row', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: at('2026-04-02T10:00:00Z') })
    const actorId = await newActor()
    const otherActorId = await newActor()
    const fitnessFileId = await seedFile(actorId)
    const neighbourId = await seedRoute(actorId, {
      minLat: 7,
      maxLat: 8,
      minLng: 7,
      maxLng: 8
    })
    const neighbourBefore = await routeRows([neighbourId])

    await database.upsertFitnessFileRoute({
      fitnessFileId,
      actorId,
      points: [
        [10, 10],
        [11, 11]
      ],
      sourceVersion: 1
    })
    vi.setSystemTime(at('2026-04-03T11:00:00Z'))
    await database.upsertFitnessFileRoute({
      fitnessFileId,
      // The writer re-runs with whatever it was given; the row follows.
      actorId: otherActorId,
      points: [],
      sourceVersion: 2
    })

    expect(await routeRows([fitnessFileId])).toEqual([
      {
        fitnessFileId,
        actorId: otherActorId,
        points: '[]',
        pointCount: 0,
        minLat: null,
        maxLat: null,
        minLng: null,
        maxLng: null,
        sourceVersion: 2,
        createdAt: ms('2026-04-02T10:00:00Z'),
        updatedAt: ms('2026-04-03T11:00:00Z')
      }
    ])
    expect(await routeRows([neighbourId])).toEqual(neighbourBefore)
  })
})

describe('getFitnessFileRoutes', () => {
  it('maps every column of a row', async () => {
    const actorId = await newActor()
    const fitnessFileId = await seedRoute(
      actorId,
      { minLat: 1.5, maxLat: 2.5, minLng: 3.5, maxLng: 4.5 },
      {
        route: {
          points: '[[1.5,3.5],[2.5,4.5]]',
          pointCount: 2,
          sourceVersion: 4,
          createdAt: at('2026-02-01T00:00:00Z'),
          updatedAt: at('2026-02-03T00:00:00Z')
        }
      }
    )

    expect(
      await database.getFitnessFileRoutes({ fitnessFileIds: [fitnessFileId] })
    ).toEqual([
      {
        fitnessFileId,
        actorId,
        points: [
          [1.5, 3.5],
          [2.5, 4.5]
        ],
        pointCount: 2,
        bounds: { minLat: 1.5, maxLat: 2.5, minLng: 3.5, maxLng: 4.5 },
        sourceVersion: 4,
        createdAt: ms('2026-02-01T00:00:00Z'),
        updatedAt: ms('2026-02-03T00:00:00Z')
      }
    ])
  })

  it.each([
    {
      description: 'a corrupt payload as no points',
      points: '{not json',
      expected: []
    },
    {
      description: 'a payload that is not a list as no points',
      points: '{"lat":1,"lng":2}',
      expected: []
    },
    {
      description: 'a NULL payload as no points',
      points: null,
      expected: []
    },
    {
      description: 'only the well-formed points of a payload',
      points: '[[1,2],[3],[4,"5"],"x",[6,7,8],[9,10]]',
      expected: [
        [1, 2],
        [9, 10]
      ]
    }
  ])('reads $description', async ({ points, expected }) => {
    const actorId = await newActor()
    const fitnessFileId = await seedRoute(actorId, null, {
      route: { points, pointCount: 6 }
    })

    const [route] = await database.getFitnessFileRoutes({
      fitnessFileIds: [fitnessFileId]
    })
    expect(route.points).toEqual(expected)
    // The stored count, not the parsed one.
    expect(route.pointCount).toBe(6)
  })

  it.each(['minLat', 'maxLat', 'minLng', 'maxLng'] as const)(
    'reads a box without %s as no box',
    async (missing) => {
      const actorId = await newActor()
      const box: Partial<Box> = { minLat: 1, maxLat: 2, minLng: 3, maxLng: 4 }
      delete box[missing]
      const fitnessFileId = await seedRoute(actorId, box)

      const [route] = await database.getFitnessFileRoutes({
        fitnessFileIds: [fitnessFileId]
      })
      expect(route.bounds).toBeUndefined()
    }
  )

  it('returns only the requested routes, once each', async () => {
    const actorId = await newActor()
    const first = await seedRoute(actorId, null)
    const second = await seedRoute(actorId, null)
    const unrequested = await seedRoute(actorId, null)

    const routes = await database.getFitnessFileRoutes({
      fitnessFileIds: [second, first, second, 'no-such-file']
    })
    const ids = routes.map((route) => route.fitnessFileId).sort()
    expect(ids).toEqual([first, second].sort())
    expect(ids).not.toContain(unrequested)
  })

  it('answers an empty list without a statement', async () => {
    const statements = await routeStatements(async () => {
      expect(
        await database.getFitnessFileRoutes({ fitnessFileIds: [] })
      ).toEqual([])
    })
    expect(statements).toEqual([])
  })

  it.each([
    // SQLite binds at most 999 values in one statement; PostgreSQL takes
    // 1000 per IN list.
    { ids: 999, sqlite: 1, pg: 1 },
    { ids: 1000, sqlite: 2, pg: 1 },
    { ids: 2000, sqlite: 3, pg: 2 },
    // Duplicates are dropped before the ids are split.
    { ids: 1000, duplicate: true, sqlite: 2, pg: 1 }
  ])(
    'reads $ids ids in $sqlite statements on SQLite and $pg on PostgreSQL',
    async ({ ids, duplicate, sqlite, pg }) => {
      const actorId = await newActor()
      const kept = [
        await seedRoute(actorId, null),
        await seedRoute(actorId, null)
      ]
      const padding = Array.from(
        { length: ids - kept.length },
        (_unused, index) => `absent-${index}`
      )
      // The two real ids sit at either end, so they land in the first and
      // the last statement.
      const request = [kept[0], ...padding, kept[1]]
      const asked = duplicate ? [...request, ...request] : request

      let routes: { fitnessFileId: string }[] = []
      const statements = await routeStatements(async () => {
        routes = await database.getFitnessFileRoutes({ fitnessFileIds: asked })
      })

      expect(statements).toHaveLength(testDb.backend === 'pg' ? pg : sqlite)
      expect(routes.map((route) => route.fitnessFileId).sort()).toEqual(
        [...kept].sort()
      )
    }
  )
})

describe('deleteFitnessFileRoute and deleteFitnessFileRoutesForActor', () => {
  it('deletes one route and says whether it did', async () => {
    const actorId = await newActor()
    const doomed = await seedRoute(actorId, null)
    const neighbour = await seedRoute(actorId, null)

    expect(
      await database.deleteFitnessFileRoute({ fitnessFileId: doomed })
    ).toBe(true)
    expect(
      await database.deleteFitnessFileRoute({ fitnessFileId: doomed })
    ).toBe(false)
    expect(
      (await routeRows([doomed, neighbour])).map((row) => row.fitnessFileId)
    ).toEqual([neighbour])
  })

  it("deletes every route of one actor, counts them, and keeps another actor's", async () => {
    const actorId = await newActor()
    const otherActorId = await newActor()
    const own = [await seedRoute(actorId, null), await seedRoute(actorId, null)]
    const other = await seedRoute(otherActorId, null)

    expect(await database.deleteFitnessFileRoutesForActor({ actorId })).toBe(2)
    expect(
      (await routeRows([...own, other])).map((row) => row.fitnessFileId)
    ).toEqual([other])
    expect(await database.deleteFitnessFileRoutesForActor({ actorId })).toBe(0)
  })
})

describe('the route aggregates', () => {
  const region: Box = { minLat: 10, maxLat: 20, minLng: 10, maxLng: 20 }

  // Inside, touching each edge from outside (which counts), and one step past
  // each edge (which does not), so every comparison and its `=` are pinned.
  const regionRoutes: { name: string; box: Box; counted: boolean }[] = [
    {
      name: 'inside',
      box: { minLat: 12, maxLat: 13, minLng: 12, maxLng: 13 },
      counted: true
    },
    {
      name: 'touching the top',
      box: { minLat: 20, maxLat: 25, minLng: 12, maxLng: 13 },
      counted: true
    },
    {
      name: 'touching the bottom',
      box: { minLat: 5, maxLat: 10, minLng: 12, maxLng: 13 },
      counted: true
    },
    {
      name: 'touching the east edge',
      box: { minLat: 12, maxLat: 13, minLng: 20, maxLng: 25 },
      counted: true
    },
    {
      name: 'touching the west edge',
      box: { minLat: 12, maxLat: 13, minLng: 5, maxLng: 10 },
      counted: true
    },
    {
      name: 'above',
      box: { minLat: 20.5, maxLat: 25, minLng: 12, maxLng: 13 },
      counted: false
    },
    {
      name: 'below',
      box: { minLat: 5, maxLat: 9.5, minLng: 12, maxLng: 13 },
      counted: false
    },
    {
      name: 'east',
      box: { minLat: 12, maxLat: 13, minLng: 20.5, maxLng: 25 },
      counted: false
    },
    {
      name: 'west',
      box: { minLat: 12, maxLat: 13, minLng: 5, maxLng: 9.5 },
      counted: false
    }
  ]

  // An actor whose only routes are `regionRoutes`.
  const regionActor = async () => {
    const actorId = await newActor()
    for (const { box } of regionRoutes) await seedRoute(actorId, box)
    return actorId
  }

  describe('countFitnessFileRoutesIntersecting', () => {
    it('counts the routes whose box meets the region, edges included', async () => {
      const actorId = await regionActor()

      expect(
        await database.countFitnessFileRoutesIntersecting({
          actorId,
          bounds: region
        })
      ).toBe(regionRoutes.filter(({ counted }) => counted).length)
    })

    it.each(regionRoutes)(
      'counts a route $name only if it meets the region',
      async ({ box, counted }) => {
        const actorId = await newActor()
        await seedRoute(actorId, box)

        expect(
          await database.countFitnessFileRoutesIntersecting({
            actorId,
            bounds: region
          })
        ).toBe(counted ? 1 : 0)
      }
    )

    it.each([
      {
        description: 'is deleted',
        file: { deletedAt: at('2026-01-02T00:00:00Z') }
      },
      {
        description: 'is still processing',
        file: { processingStatus: 'pending' }
      },
      {
        description: 'has no processing status',
        file: { processingStatus: null }
      },
      {
        description: 'is not the primary file of its post',
        file: { isPrimary: false }
      }
    ])('leaves out a route whose activity $description', async ({ file }) => {
      const actorId = await newActor()
      const box = regionRoutes[0].box
      await seedRoute(actorId, box)
      await seedRoute(actorId, box, { file })

      expect(
        await database.countFitnessFileRoutesIntersecting({
          actorId,
          bounds: region
        })
      ).toBe(1)
    })

    it("leaves out another actor's routes and the GPS-less ones", async () => {
      const actorId = await newActor()
      const otherActorId = await newActor()
      await seedRoute(actorId, regionRoutes[0].box)
      await seedRoute(actorId, null)
      await seedRoute(otherActorId, regionRoutes[0].box)

      expect(
        await database.countFitnessFileRoutesIntersecting({
          actorId,
          bounds: region
        })
      ).toBe(1)
    })

    it('counts nothing for an actor with no routes', async () => {
      const actorId = await newActor()
      expect(
        await database.countFitnessFileRoutesIntersecting({
          actorId,
          bounds: region
        })
      ).toBe(0)
    })
  })

  describe('getFitnessFileRouteBounds', () => {
    it("unions every countable route's box when no region is given", async () => {
      const actorId = await newActor()
      // Each extreme comes from a different route, so each MIN and MAX is
      // pinned by a row of its own.
      await seedRoute(actorId, { minLat: -5, maxLat: 1, minLng: 0, maxLng: 1 })
      await seedRoute(actorId, { minLat: 0, maxLat: 30, minLng: 0, maxLng: 1 })
      await seedRoute(actorId, { minLat: 0, maxLat: 1, minLng: -40, maxLng: 1 })
      await seedRoute(actorId, { minLat: 0, maxLat: 1, minLng: 0, maxLng: 50 })

      expect(await database.getFitnessFileRouteBounds({ actorId })).toEqual({
        minLat: -5,
        maxLat: 30,
        minLng: -40,
        maxLng: 50
      })
    })

    it('unions only the routes that meet the region, whole boxes included', async () => {
      const actorId = await regionActor()

      expect(
        await database.getFitnessFileRouteBounds({ actorId, bounds: region })
      ).toEqual({ minLat: 5, maxLat: 25, minLng: 5, maxLng: 25 })
    })

    it.each([
      {
        description: 'is deleted',
        file: { deletedAt: at('2026-01-02T00:00:00Z') }
      },
      {
        description: 'is still processing',
        file: { processingStatus: 'pending' }
      },
      {
        description: 'is not the primary file of its post',
        file: { isPrimary: false }
      }
    ])('leaves out a route whose activity $description', async ({ file }) => {
      const actorId = await newActor()
      await seedRoute(actorId, { minLat: 1, maxLat: 2, minLng: 1, maxLng: 2 })
      await seedRoute(
        actorId,
        { minLat: -60, maxLat: 60, minLng: -60, maxLng: 60 },
        { file }
      )

      expect(await database.getFitnessFileRouteBounds({ actorId })).toEqual({
        minLat: 1,
        maxLat: 2,
        minLng: 1,
        maxLng: 2
      })
    })

    it("leaves out another actor's routes and a route with no minLat", async () => {
      const actorId = await newActor()
      const otherActorId = await newActor()
      await seedRoute(actorId, { minLat: 1, maxLat: 2, minLng: 1, maxLng: 2 })
      await seedRoute(otherActorId, {
        minLat: -60,
        maxLat: 60,
        minLng: -60,
        maxLng: 60
      })
      // Half a box no writer produces: only `minLat is not null` keeps its
      // other three columns out of the union.
      await seedRoute(actorId, { maxLat: 60, minLng: -60, maxLng: 60 })

      expect(await database.getFitnessFileRouteBounds({ actorId })).toEqual({
        minLat: 1,
        maxLat: 2,
        minLng: 1,
        maxLng: 2
      })
    })

    it.each([
      { description: 'an actor with no routes', box: null },
      {
        description: 'a region no route meets',
        box: { minLat: 1, maxLat: 2, minLng: 1, maxLng: 2 }
      }
    ])('returns null for $description', async ({ box }) => {
      const actorId = await newActor()
      if (box) await seedRoute(actorId, box)

      expect(
        await database.getFitnessFileRouteBounds({
          actorId,
          bounds: { minLat: -80, maxLat: -70, minLng: -20, maxLng: -10 }
        })
      ).toBeNull()
    })
  })
})
