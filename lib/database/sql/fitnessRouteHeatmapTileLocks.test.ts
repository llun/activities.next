import {
  createActor,
  fence,
  pauseAfterStatement,
  tile
} from '@/lib/database/sql/fitnessRouteHeatmapTileTestHelpers'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'

// The row locks the route heatmap pyramid writes rely on, raced on two real
// PostgreSQL connections. Each test stops one operation inside its
// transaction, right after the statement that takes the lock, starts the
// other, waits until PostgreSQL reports that one waiting on a lock (polling
// pg_stat_activity; no sleep stands in for it), then lets the first finish and
// checks the outcome the comments in
// lib/database/domains/fitnessRouteHeatmapTile/ promise. If the second
// operation finishes instead of waiting, the lock was not there and the test
// fails at once. SQLite serialises every write on its one connection, so
// there is nothing to race there.

const testDb = createTestDatabase()
const { database } = testDb
const db = () => testDb.db

const PYRAMIDS = 'fitness_route_heatmap_pyramids'

const isStatement =
  (verb: 'select' | 'insert' | 'update' | 'delete') => (sql: string) =>
    sql.trimStart().toLowerCase().startsWith(verb) && sql.includes(PYRAMIDS)

// The ownership check of a tile flush or a sweep, whatever statement it is: the
// test stops right after it, and the claim must then wait, so a check that
// took no lock (or took it later) fails the wait.
const ownershipCheck = (sql: string) => sql.includes(PYRAMIDS)

// Runs `operation` without awaiting it, recording when it settles, so a test
// can tell an operation that waited for a lock from one that never needed to.
const start = <T>(operation: () => Promise<T>) => {
  const state = { settled: false }
  const outcome = operation().then(
    (value) => ({ value, error: undefined }),
    (error: unknown) => ({ value: undefined, error })
  )
  void outcome.finally(() => {
    state.settled = true
  })
  return {
    state,
    result: async () => {
      const { value, error } = await outcome
      if (error !== undefined) throw error
      return value as T
    }
  }
}

// Resolves once a backend of this database waits on a lock, and fails as soon
// as `waiter` settles instead, or after five seconds.
const waitForLockWait = async (waiter: { state: { settled: boolean } }) => {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    if (waiter.state.settled) {
      throw new Error('the operation finished without waiting for a row lock')
    }
    const { rows } = await testDb.knex.raw(
      "select count(*)::int as waiting from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'"
    )
    if (rows[0].waiting > 0) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('no backend ever waited for a row lock')
}

const STALE_MS = 120_000
const claimParams = (actorId: string) => ({
  actorId,
  requestedAt: Date.now(),
  staleBefore: Date.now() - STALE_MS
})

// Moves the build's last heartbeat back past the staleness window, so a claim
// reading it decides to take it over.
const goQuiet = (actorId: string) =>
  db()
    .updateTable('fitness_route_heatmap_pyramids')
    .set({ updatedAt: new Date(Date.now() - 10 * STALE_MS) })
    .where('actorId', '=', actorId)
    .execute()

// A build that was claimed and has since gone quiet.
const staleBuild = async (actorId: string) => {
  const claim = await database.claimFitnessRouteHeatmapPyramidBuild(
    claimParams(actorId)
  )
  expect(claim.claimed).toBe(true)
  await goQuiet(actorId)
  return claim.pyramid
}

const pyramidRow = (actorId: string) =>
  db()
    .selectFrom('fitness_route_heatmap_pyramids')
    .selectAll()
    .where('actorId', '=', actorId)
    .executeTakeFirst()

const tileKeys = async (actorId: string) =>
  (
    await db()
      .selectFrom('fitness_route_heatmap_tiles')
      .select('tileKey')
      .where('actorId', '=', actorId)
      .execute()
  )
    .map(({ tileKey }) => tileKey)
    .sort()

describe.runIf(testDb.backend === 'pg')(
  'route heatmap pyramid row locks',
  () => {
    beforeAll(async () => {
      await testDb.prepare()
      await database.migrate()
    })

    afterAll(async () => {
      await database.destroy()
    })

    // upsertFitnessRouteHeatmapTiles: "a concurrent claim's compare-and-swap
    // blocks here instead of landing between the ownership check and the tile
    // writes".
    it('makes a claim wait for a tile flush, which then heartbeats the build out of its reach', async () => {
      const actorId = await createActor(database)
      const build = await staleBuild(actorId)

      const claimRead = pauseAfterStatement(isStatement('select'))
      const claim = start(() =>
        database.claimFitnessRouteHeatmapPyramidBuild(claimParams(actorId))
      )
      await claimRead.reached

      const guard = pauseAfterStatement(ownershipCheck)
      const flush = start(() =>
        database.upsertFitnessRouteHeatmapTiles({
          actorId,
          ...fence(build),
          version: build.version,
          tiles: [tile('5:1:1'), tile('5:1:2')]
        })
      )
      await guard.reached

      claimRead.release()
      await waitForLockWait(claim)
      guard.release()

      expect(await flush.result()).toBe(true)
      expect(await claim.result()).toMatchObject({
        claimed: false,
        reason: 'build-in-progress'
      })
      expect(await pyramidRow(actorId)).toMatchObject({
        id: build.id,
        claimSeq: build.claimSeq,
        version: build.version
      })
      expect(await tileKeys(actorId)).toEqual(['5:1:1', '5:1:2'])
    })

    // deleteStaleFitnessRouteHeatmapTiles: "the row lock that serialises this
    // sweep against a concurrent claim or clear".
    it('makes a claim wait for the stale-tile sweep', async () => {
      const actorId = await createActor(database)
      const build = await staleBuild(actorId)
      await database.upsertFitnessRouteHeatmapTiles({
        actorId,
        ...fence(build),
        version: build.version - 1,
        tiles: [tile('5:2:1')]
      })
      await database.upsertFitnessRouteHeatmapTiles({
        actorId,
        ...fence(build),
        version: build.version,
        tiles: [tile('5:2:2')]
      })
      await goQuiet(actorId)

      const claimRead = pauseAfterStatement(isStatement('select'))
      const claim = start(() =>
        database.claimFitnessRouteHeatmapPyramidBuild(claimParams(actorId))
      )
      await claimRead.reached

      const guard = pauseAfterStatement(ownershipCheck)
      const sweep = start(() =>
        database.deleteStaleFitnessRouteHeatmapTiles({
          actorId,
          ...fence(build),
          beforeVersion: build.version
        })
      )
      await guard.reached

      claimRead.release()
      await waitForLockWait(claim)
      guard.release()

      expect(await sweep.result()).toBe(1)
      expect(await claim.result()).toMatchObject({
        claimed: false,
        reason: 'build-in-progress'
      })
      expect(await pyramidRow(actorId)).toMatchObject({
        claimSeq: build.claimSeq
      })
      expect(await tileKeys(actorId)).toEqual(['5:2:2'])
    })

    // deleteFitnessRouteHeatmapPyramidAndTilesForActor: "a concurrent claim's
    // own insert waits for this commit and starts cleanly afterwards".
    it.each([
      { name: 'an actor that never built', existing: false },
      { name: 'an actor with a build', existing: true }
    ])(
      'makes a claim for $name wait for the clear, then build on a new row',
      async ({ existing }) => {
        const actorId = await createActor(database)
        const previous = existing ? await staleBuild(actorId) : undefined
        if (previous) {
          await database.upsertFitnessRouteHeatmapTiles({
            actorId,
            ...fence(previous),
            version: previous.version,
            tiles: [tile('5:3:1')]
          })
        }

        const cleared = pauseAfterStatement(isStatement('delete'))
        const clear = start(() =>
          database.deleteFitnessRouteHeatmapPyramidAndTilesForActor({ actorId })
        )
        await cleared.reached

        const claim = start(() =>
          database.claimFitnessRouteHeatmapPyramidBuild(claimParams(actorId))
        )
        await waitForLockWait(claim)
        cleared.release()

        expect(await clear.result()).toBe(existing ? 1 : 0)
        const claimed = await claim.result()
        expect(claimed).toMatchObject({
          claimed: true,
          resumed: false,
          pyramid: { version: 1, claimSeq: 1 }
        })
        expect(claimed.pyramid.id).not.toBe(previous?.id)

        expect(
          await database.upsertFitnessRouteHeatmapTiles({
            actorId,
            ...fence(claimed.pyramid),
            version: claimed.pyramid.version,
            tiles: [tile('5:3:2')]
          })
        ).toBe(true)
        if (previous) {
          expect(
            await database.upsertFitnessRouteHeatmapTiles({
              actorId,
              ...fence(previous),
              version: previous.version,
              tiles: [tile('5:3:3')]
            })
          ).toBe(false)
        }
        expect(await pyramidRow(actorId)).toMatchObject({
          id: claimed.pyramid.id,
          status: 'generating',
          claimSeq: 1
        })
        expect(await tileKeys(actorId)).toEqual(['5:3:2'])
      }
    )

    // claimFitnessRouteHeatmapPyramidBuild: "A successful CAS holds the row's
    // write lock for the rest of the transaction, so the read above is this
    // pass's own write and the row it names cannot have been deleted or
    // replaced underneath it."
    it('makes a clear wait for a claim between its compare-and-swap and its read', async () => {
      const actorId = await createActor(database)
      const previous = await staleBuild(actorId)

      const swapped = pauseAfterStatement(isStatement('update'))
      const claim = start(() =>
        database.claimFitnessRouteHeatmapPyramidBuild(claimParams(actorId))
      )
      await swapped.reached

      const clear = start(() =>
        database.deleteFitnessRouteHeatmapPyramidAndTilesForActor({ actorId })
      )
      await waitForLockWait(clear)
      swapped.release()

      expect(await claim.result()).toMatchObject({
        claimed: true,
        resumed: false,
        pyramid: {
          id: previous.id,
          status: 'generating',
          version: previous.version + 1,
          claimSeq: previous.claimSeq + 1
        }
      })
      expect(await clear.result()).toBe(0)
      expect(await pyramidRow(actorId)).toBeUndefined()
    })

    // claimFitnessRouteHeatmapPyramidBuild: "two workers reclaiming the same
    // abandoned build" must not both be told they own it.
    it('gives two claims that both read an abandoned build one winner', async () => {
      const actorId = await createActor(database)
      const previous = await staleBuild(actorId)

      const loserRead = pauseAfterStatement(isStatement('select'))
      const loser = start(() =>
        database.claimFitnessRouteHeatmapPyramidBuild(claimParams(actorId))
      )
      await loserRead.reached

      const winnerSwap = pauseAfterStatement(isStatement('update'))
      const winner = start(() =>
        database.claimFitnessRouteHeatmapPyramidBuild(claimParams(actorId))
      )
      await winnerSwap.reached

      loserRead.release()
      await waitForLockWait(loser)
      winnerSwap.release()

      expect(await winner.result()).toMatchObject({
        claimed: true,
        pyramid: { claimSeq: previous.claimSeq + 1 }
      })
      expect(await loser.result()).toMatchObject({
        claimed: false,
        reason: 'build-in-progress',
        pyramid: { claimSeq: previous.claimSeq + 1 }
      })
      expect(await pyramidRow(actorId)).toMatchObject({
        claimSeq: previous.claimSeq + 1,
        version: previous.version + 1
      })
    })
  }
)
