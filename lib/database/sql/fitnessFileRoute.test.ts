import {
  databaseBeforeAll,
  getTestDatabaseTable,
  getTestSQLDatabaseWithInstance
} from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { seedDatabase } from '@/lib/stub/database'
import { DatabaseSeed } from '@/lib/stub/scenarios/database'

describe('FitnessFileRouteDatabase', () => {
  const { actors } = DatabaseSeed
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  describe.each(table)('%s', (_, database) => {
    beforeAll(async () => {
      await seedDatabase(database)
    })

    afterAll(async () => {
      await database.destroy()
    })

    // The database is shared by every test in this file, so the aggregate
    // tests below — which assert exact counts and an exact union — get an
    // actor of their own rather than a seeded one another test may have left
    // routes on.
    const createIsolatedActor = async (db: Database, username: string) => {
      const actorId = `https://llun.test/users/${username}`
      await db.createActor({
        actorId,
        username,
        domain: 'llun.test',
        inboxUrl: `${actorId}/inbox`,
        outboxUrl: `${actorId}/outbox`,
        followersUrl: `${actorId}/followers`,
        sharedInboxUrl: 'https://llun.test/inbox',
        publicKey: `public-key-${username}`,
        privateKey: `private-key-${username}`,
        createdAt: Date.now()
      })
      return actorId
    }

    // Creates a completed, primary activity — the only shape the aggregates
    // count — and returns its id.
    const createActivity = async (
      db: Database,
      {
        actorId,
        pathSuffix,
        processingStatus = 'completed',
        isPrimary = true
      }: {
        actorId: string
        pathSuffix: string
        processingStatus?: 'pending' | 'processing' | 'completed' | 'failed'
        isPrimary?: boolean
      }
    ) => {
      const file = await db.createFitnessFile({
        actorId,
        path: `fitness/route-${pathSuffix}.fit`,
        fileName: `route-${pathSuffix}.fit`,
        fileType: 'fit',
        mimeType: 'application/vnd.ant.fit',
        bytes: 1024
      })
      await db.updateFitnessFileProcessingStatus(file!.id, processingStatus)
      if (!isPrimary) {
        await db.updateFitnessFilePrimary(file!.id, false)
      }
      return file!.id
    }

    describe('upsertFitnessFileRoute and getFitnessFileRoutes', () => {
      it('round-trips the points, count and derived bounds', async () => {
        const fitnessFileId = await createActivity(database, {
          actorId: actors.primary.id,
          pathSuffix: 'roundtrip'
        })

        await database.upsertFitnessFileRoute({
          fitnessFileId,
          actorId: actors.primary.id,
          points: [
            [1.3, 103.8],
            [1.4, 103.9],
            [1.2, 103.7]
          ],
          sourceVersion: 1
        })

        const [route] = await database.getFitnessFileRoutes({
          fitnessFileIds: [fitnessFileId]
        })
        expect(route).toMatchObject({
          fitnessFileId,
          actorId: actors.primary.id,
          pointCount: 3,
          sourceVersion: 1,
          points: [
            [1.3, 103.8],
            [1.4, 103.9],
            [1.2, 103.7]
          ],
          bounds: { minLat: 1.2, maxLat: 1.4, minLng: 103.7, maxLng: 103.9 }
        })
      })

      it('replaces an existing route instead of inserting a second row', async () => {
        const fitnessFileId = await createActivity(database, {
          actorId: actors.primary.id,
          pathSuffix: 'replace'
        })

        await database.upsertFitnessFileRoute({
          fitnessFileId,
          actorId: actors.primary.id,
          points: [
            [10, 10],
            [11, 11]
          ],
          sourceVersion: 1
        })
        await database.upsertFitnessFileRoute({
          fitnessFileId,
          actorId: actors.primary.id,
          points: [
            [20, 20],
            [21, 21],
            [22, 22]
          ],
          sourceVersion: 2
        })

        const routes = await database.getFitnessFileRoutes({
          fitnessFileIds: [fitnessFileId]
        })
        expect(routes).toHaveLength(1)
        expect(routes[0]).toMatchObject({
          pointCount: 3,
          sourceVersion: 2,
          bounds: { minLat: 20, maxLat: 22, minLng: 20, maxLng: 22 }
        })
      })

      it('stores a route with no points as a negative cache with no bounds', async () => {
        const fitnessFileId = await createActivity(database, {
          actorId: actors.primary.id,
          pathSuffix: 'treadmill'
        })

        await database.upsertFitnessFileRoute({
          fitnessFileId,
          actorId: actors.primary.id,
          points: [],
          sourceVersion: 1
        })

        const [route] = await database.getFitnessFileRoutes({
          fitnessFileIds: [fitnessFileId]
        })
        // The row must exist — that is the whole point of caching the absence —
        // but carry no bounds.
        expect(route).toBeDefined()
        expect(route.points).toEqual([])
        expect(route.pointCount).toBe(0)
        expect(route.bounds).toBeUndefined()
      })

      it('returns nothing for ids with no cached route', async () => {
        const routes = await database.getFitnessFileRoutes({
          fitnessFileIds: ['missing-1', 'missing-2']
        })
        expect(routes).toEqual([])
      })

      it('returns an empty list without querying for an empty id list', async () => {
        expect(
          await database.getFitnessFileRoutes({ fitnessFileIds: [] })
        ).toEqual([])
      })

      it('splits an oversized id list into several statements', async () => {
        // Asserted on the statements actually issued, because a result-shape
        // assertion cannot see this: better-sqlite3 is built with a
        // SQLITE_MAX_VARIABLE_NUMBER far above the project's conservative
        // 999-binding floor, so an unchunked query of this size still succeeds
        // HERE and would only fail on a stricter build or another backend
        // (PostgreSQL caps parameters at 65535). Needs the raw knex instance
        // for its query event, so it builds its own database rather than using
        // the shared one; no rows are required, only the statements.
        const { database: isolated, instance } =
          getTestSQLDatabaseWithInstance()
        await isolated.migrate()
        try {
          const statements: string[] = []
          instance.on('query', ({ sql }: { sql: string }) => {
            if (sql.includes('fitness_file_routes')) statements.push(sql)
          })

          await isolated.getFitnessFileRoutes({
            fitnessFileIds: Array.from(
              { length: 2_500 },
              (_unused, index) => `absent-${index}`
            )
          })

          // ceil(2500 / 999)
          expect(statements).toHaveLength(3)
        } finally {
          await isolated.destroy()
        }
      })

      it('assembles results from every chunk of an oversized id list', async () => {
        // The companion to the statement-count test above: with real rows
        // placed in the first, second and last chunk, a request this long
        // returns all three only if every chunk's rows are collected.
        const chunkSize = 999
        const ids: string[] = []
        for (const suffix of ['chunk-a', 'chunk-b', 'chunk-c']) {
          const fitnessFileId = await createActivity(database, {
            actorId: actors.primary.id,
            pathSuffix: suffix
          })
          await database.upsertFitnessFileRoute({
            fitnessFileId,
            actorId: actors.primary.id,
            points: [
              [5, 5],
              [6, 6]
            ],
            sourceVersion: 1
          })
          ids.push(fitnessFileId)
        }

        const padding = (count: number, tag: string) =>
          Array.from({ length: count }, (_unused, index) => `${tag}-${index}`)
        const request = [
          ids[0],
          ...padding(chunkSize - 1, 'a'),
          ids[1],
          ...padding(chunkSize - 1, 'b'),
          ids[2]
        ]
        expect(request).toHaveLength(chunkSize * 2 + 1)

        const routes = await database.getFitnessFileRoutes({
          fitnessFileIds: request
        })
        expect(routes.map((route) => route.fitnessFileId).sort()).toEqual(
          [...ids].sort()
        )
      })
    })

    describe('deleteFitnessFileRoute and deleteFitnessFileRoutesForActor', () => {
      it('deletes a single route and reports whether a row went', async () => {
        const fitnessFileId = await createActivity(database, {
          actorId: actors.replyAuthor.id,
          pathSuffix: 'delete-one'
        })
        await database.upsertFitnessFileRoute({
          fitnessFileId,
          actorId: actors.replyAuthor.id,
          points: [
            [1, 1],
            [2, 2]
          ],
          sourceVersion: 1
        })

        expect(await database.deleteFitnessFileRoute({ fitnessFileId })).toBe(
          true
        )
        expect(
          await database.getFitnessFileRoutes({
            fitnessFileIds: [fitnessFileId]
          })
        ).toEqual([])
        expect(await database.deleteFitnessFileRoute({ fitnessFileId })).toBe(
          false
        )
      })

      it('deletes every route belonging to one actor and leaves others alone', async () => {
        const ownId = await createActivity(database, {
          actorId: actors.pollAuthor.id,
          pathSuffix: 'actor-purge-own'
        })
        const otherId = await createActivity(database, {
          actorId: actors.extra.id,
          pathSuffix: 'actor-purge-other'
        })
        for (const [fitnessFileId, actorId] of [
          [ownId, actors.pollAuthor.id],
          [otherId, actors.extra.id]
        ] as const) {
          await database.upsertFitnessFileRoute({
            fitnessFileId,
            actorId,
            points: [
              [3, 3],
              [4, 4]
            ],
            sourceVersion: 1
          })
        }

        const deleted = await database.deleteFitnessFileRoutesForActor({
          actorId: actors.pollAuthor.id
        })
        expect(deleted).toBeGreaterThanOrEqual(1)
        expect(
          await database.getFitnessFileRoutes({ fitnessFileIds: [ownId] })
        ).toEqual([])
        expect(
          await database.getFitnessFileRoutes({ fitnessFileIds: [otherId] })
        ).toHaveLength(1)
      })
    })

    describe('countFitnessFileRoutesIntersecting', () => {
      const singapore = { minLat: 1.2, maxLat: 1.5, minLng: 103.6, maxLng: 104 }
      let actorId: string

      beforeAll(async () => {
        actorId = await createIsolatedActor(database, 'route-intersect')
        const inside = await createActivity(database, {
          actorId,
          pathSuffix: 'intersect-inside'
        })
        await database.upsertFitnessFileRoute({
          fitnessFileId: inside,
          actorId,
          points: [
            [1.3, 103.8],
            [1.35, 103.85]
          ],
          sourceVersion: 1
        })

        const outside = await createActivity(database, {
          actorId,
          pathSuffix: 'intersect-outside'
        })
        await database.upsertFitnessFileRoute({
          fitnessFileId: outside,
          actorId,
          points: [
            [52.3, 4.9],
            [52.4, 5.0]
          ],
          sourceVersion: 1
        })

        const noGps = await createActivity(database, {
          actorId,
          pathSuffix: 'intersect-nogps'
        })
        await database.upsertFitnessFileRoute({
          fitnessFileId: noGps,
          actorId,
          points: [],
          sourceVersion: 1
        })
      })

      it('counts only the routes whose bounding box overlaps', async () => {
        expect(
          await database.countFitnessFileRoutesIntersecting({
            actorId,
            bounds: singapore
          })
        ).toBe(1)
      })

      it('counts a route that only straddles the edge of the region', async () => {
        const straddling = await createActivity(database, {
          actorId,
          pathSuffix: 'intersect-straddle'
        })
        // Starts inside Singapore and runs north past the region's edge, so
        // its box overlaps without being contained.
        await database.upsertFitnessFileRoute({
          fitnessFileId: straddling,
          actorId,
          points: [
            [1.45, 103.9],
            [2.5, 104.5]
          ],
          sourceVersion: 1
        })

        expect(
          await database.countFitnessFileRoutesIntersecting({
            actorId,
            bounds: singapore
          })
        ).toBe(2)
      })

      it.each([
        {
          description: 'is still processing',
          processingStatus: 'pending' as const,
          isPrimary: true
        },
        {
          description: 'failed to process',
          processingStatus: 'failed' as const,
          isPrimary: true
        },
        {
          description: 'is a non-primary file of a merged ride',
          processingStatus: 'completed' as const,
          isPrimary: false
        }
      ])(
        'excludes an activity that $description',
        async ({ processingStatus, isPrimary }) => {
          // A fresh actor per case: the count must be exactly zero, which a
          // shared actor's other fixtures would spoil.
          const suffix = `uncountable-${processingStatus}-${String(isPrimary)}`
          const caseActorId = await createIsolatedActor(
            database,
            `route-${suffix}`
          )
          const fitnessFileId = await createActivity(database, {
            actorId: caseActorId,
            pathSuffix: suffix,
            processingStatus,
            isPrimary
          })
          await database.upsertFitnessFileRoute({
            fitnessFileId,
            actorId: caseActorId,
            points: [
              [1.3, 103.8],
              [1.35, 103.85]
            ],
            sourceVersion: 1
          })

          expect(
            await database.countFitnessFileRoutesIntersecting({
              actorId: caseActorId,
              bounds: singapore
            })
          ).toBe(0)
        }
      )
    })

    describe('getFitnessFileRouteBounds', () => {
      let actorId: string

      beforeAll(async () => {
        actorId = await createIsolatedActor(database, 'route-bounds')
        const first = await createActivity(database, {
          actorId,
          pathSuffix: 'bounds-first'
        })
        await database.upsertFitnessFileRoute({
          fitnessFileId: first,
          actorId,
          points: [
            [1.2, 103.6],
            [1.3, 103.7]
          ],
          sourceVersion: 1
        })

        const second = await createActivity(database, {
          actorId,
          pathSuffix: 'bounds-second'
        })
        await database.upsertFitnessFileRoute({
          fitnessFileId: second,
          actorId,
          points: [
            [52.3, 4.8],
            [52.4, 4.9]
          ],
          sourceVersion: 1
        })
      })

      it('unions the bounds of every countable route', async () => {
        expect(await database.getFitnessFileRouteBounds({ actorId })).toEqual({
          minLat: 1.2,
          maxLat: 52.4,
          minLng: 4.8,
          maxLng: 103.7
        })
      })

      it('restricts the union to the routes intersecting a region', async () => {
        expect(
          await database.getFitnessFileRouteBounds({
            actorId,
            bounds: { minLat: 52, maxLat: 53, minLng: 4, maxLng: 6 }
          })
        ).toEqual({ minLat: 52.3, maxLat: 52.4, minLng: 4.8, maxLng: 4.9 })
      })

      it('returns null when no route qualifies', async () => {
        expect(
          await database.getFitnessFileRouteBounds({
            actorId,
            bounds: { minLat: -80, maxLat: -70, minLng: -20, maxLng: -10 }
          })
        ).toBeNull()
      })
    })
  })
})
