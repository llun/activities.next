import { getFitnessRouteHeatmapConfig } from '@/lib/config/fitnessRouteHeatmap'
import { GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME } from '@/lib/jobs/names'
import { FITNESS_FILE_ROUTE_SOURCE_VERSION } from '@/lib/services/fitness-files/fileRouteCache'
import { decodeTile } from '@/lib/services/fitness-files/heatmapTiles/tileCodec'
import * as tilerModule from '@/lib/services/fitness-files/heatmapTiles/tiler'
import { Actor } from '@/lib/types/domain/actor'

import {
  PYRAMID_HEARTBEAT_STALE_MS,
  ROUTE_HEATMAP_JOB_TIME_BUDGET_MS,
  TILE_FLUSH_PENDING_LIMIT,
  generateFitnessRouteHeatmapJob
} from './generateFitnessRouteHeatmapJob'
import {
  createPyramidHelpers,
  useHeatmapJobFixtures
} from './generateFitnessRouteHeatmapJob.testUtils'

vi.mock('@/lib/services/fitness-files', async () => {
  const actual = await vi.importActual('@/lib/services/fitness-files')
  return {
    ...actual,
    getFitnessFile: vi.fn()
  }
})

vi.mock('@/lib/services/fitness-files/parseFitnessFile', async () => ({
  parseFitnessFile: vi.fn(),
  isParseableFitnessFileType: vi.fn().mockReturnValue(true)
}))

const mockPublish = vi.fn()
vi.mock('@/lib/services/queue', async () => ({
  getQueue: () => ({ publish: mockPublish })
}))

describe('generateFitnessRouteHeatmapJob', () => {
  const { database, getActor, createCompletedFitnessFile } =
    useHeatmapJobFixtures({ mockPublish })
  let actor: Actor

  beforeAll(() => {
    actor = getActor()
  })

  describe('the tile pyramid', () => {
    const {
      clearPyramid,
      runAllTime,
      seedRoute,
      readTiles,
      runPublishedContinuation,
      AMSTERDAM,
      SINGAPORE,
      TOKYO
    } = createPyramidHelpers({
      database,
      getActor,
      mockPublish
    })

    beforeEach(async () => {
      await clearPyramid()
    })

    afterEach(async () => {
      await clearPyramid()
      await database.deleteFitnessRouteHeatmapsForActor({ actorId: actor.id })
    })

    it('keeps the heartbeat window clear of a working pass but inside a retry', async () => {
      // Straddled rather than asserted as a literal, because what matters is
      // the RELATIONSHIP: a pass that is simply working heartbeats on every
      // flush, at worst once per time budget, so anything at or below that is
      // reclaiming live builds; and a window far above it leaves a dead
      // worker's pyramid untouchable long after the user has hit Generate
      // again.
      const budgets =
        PYRAMID_HEARTBEAT_STALE_MS / ROUTE_HEATMAP_JOB_TIME_BUDGET_MS
      expect(budgets).toBeGreaterThanOrEqual(4)
      expect(budgets).toBeLessThanOrEqual(10)
    })

    it('bounds the unflushed delta map well under the memory budget', async () => {
      // Measured, not assumed: an edge costs ~150 bytes retained, and a tile in
      // a sparse fixture carries ~3.4 of them while one in a repeatedly-ridden
      // city carries ~235. The constant bounds TILES, so the sparse end is a
      // few MB and the dense end is what has to stay clear of the 512MB budget
      // the whole run shares with the accumulated segments and one parsed
      // route. Too low and a dense city pays a read-merge-write round trip
      // every few activities; the floor is what keeps that from becoming the
      // cost.
      //
      // The ceiling is expressed in the units the rationale is measured in —
      // bytes per DENSE tile — rather than in a nominal per-tile figure. Stated
      // the old way (1080 bytes a tile, against a quarter of the budget) it
      // admitted 124,275, fifteen times the constant, because the two halves of
      // that comparison used different densities. In these units it admits
      // 15,230, so the guard fails before the map can hold more than the run's
      // whole budget at real urban density.
      const bytesPerDenseTile = 150 * 235
      expect(TILE_FLUSH_PENDING_LIMIT * bytesPerDenseTile).toBeLessThan(
        getFitnessRouteHeatmapConfig().memoryBudgetBytes
      )
      expect(TILE_FLUSH_PENDING_LIMIT).toBeGreaterThanOrEqual(1_000)
    })

    it('flushes mid-page once the delta map reaches its tile bound', async () => {
      // The bound on delta-map growth between checkpoints, and the reason the
      // constant exists at all: a build sweeping a dense city touches tiles far
      // faster than the 20s checkpoint arrives, and the map costs ~150 bytes
      // per edge against a 512MB budget the whole run shares. Asserting
      // arithmetic on the number does not execute the branch that reads it —
      // the guard could be deleted outright and nothing would notice.
      const firstId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-15T07:00:00.000Z')
      )
      const secondId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-16T07:00:00.000Z')
      )
      const upsertSpy = vi.spyOn(database, 'upsertFitnessRouteHeatmapTiles')
      // One activity that lands on exactly the bound, so the flush is owed
      // straight after it and before anything else can trigger one.
      const tilerSpy = vi
        .spyOn(tilerModule, 'buildTileDeltasForActivity')
        .mockReturnValueOnce(
          new Map(
            Array.from({ length: TILE_FLUSH_PENDING_LIMIT }, (_, index) => [
              `16:${index}:0`,
              // A whole `TileDelta`, not just its edges: the flush reads `z`,
              // `x` and `y` off it, and a cast that let them be omitted would
              // have hidden the difference between this fixture and what the
              // tiler really returns.
              {
                z: 16,
                x: index,
                y: 0,
                edges: new Map([
                  [
                    'e',
                    {
                      a: 0,
                      b: 257,
                      count: 1,
                      hidden: false,
                      points: [0, 0, 1, 1]
                    }
                  ]
                ])
              }
            ])
          )
        )

      try {
        await seedRoute(firstId, AMSTERDAM)
        await seedRoute(secondId, SINGAPORE)

        await runAllTime('job-pyramid-midpage-flush')

        // The first flush carries the whole bound's worth of tiles and happens
        // while the scan is still mid-page — before the run's final flush,
        // which would otherwise be the only one.
        expect(upsertSpy.mock.calls.length).toBeGreaterThan(1)
        expect(upsertSpy.mock.calls[0][0].tiles).toHaveLength(
          TILE_FLUSH_PENDING_LIMIT
        )
        // And it commits a cursor that COVERS those tiles. This is the second
        // of the two flush sites that fire inside a single activity, and the
        // one the suite did not reach: a cursor still naming the previous file
        // would let a resume fold this activity again, which is a permanently
        // wrong count rather than a missing one.
        expect(upsertSpy.mock.calls[0][0].progress?.cursor).toEqual({
          createdAt: expect.any(Number),
          id: secondId
        })
        expect(upsertSpy.mock.calls[0][0].progress?.scannedCount).toBe(1)
        expect(
          await database.getFitnessRouteHeatmapPyramid({ actorId: actor.id })
        ).toMatchObject({ status: 'completed' })
      } finally {
        tilerSpy.mockRestore()
        upsertSpy.mockRestore()
        await database.deleteFitnessFile({ id: firstId })
        await database.deleteFitnessFile({ id: secondId })
      }
    }, 30_000)

    it('does not write the build again when a pass scanned nothing new', async () => {
      // A flush with nothing folded and nothing scanned since the last one has
      // no progress to record and is owed no heartbeat, so it must not write.
      // The watermark is what knows that, and it only earns its keep once a
      // flush has already fired: with the heap guard tripping on every file —
      // it trips on a plain point counter, so every large build hits it — the
      // last file is flushed inside the loop, and the flush at the end of the
      // loop would otherwise rewrite exactly the same progress.
      const firstId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-15T07:00:00.000Z')
      )
      const secondId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-16T07:00:00.000Z')
      )
      const upsertSpy = vi.spyOn(database, 'upsertFitnessRouteHeatmapTiles')

      try {
        await seedRoute(firstId, AMSTERDAM)
        await seedRoute(secondId, SINGAPORE)
        const heapSpy = vi.spyOn(process, 'memoryUsage').mockReturnValue({
          rss: 0,
          heapTotal: 0,
          heapUsed: Number.MAX_SAFE_INTEGER,
          external: 0,
          arrayBuffers: 0
        })
        try {
          await runAllTime('job-pyramid-watermark')
        } finally {
          heapSpy.mockRestore()
        }

        // One per file, and no redundant third at the end of the loop.
        expect(upsertSpy).toHaveBeenCalledTimes(2)
        expect(
          await database.getFitnessRouteHeatmapPyramid({ actorId: actor.id })
        ).toMatchObject({
          status: 'completed',
          scannedCount: 2,
          activityCount: 2
        })
      } finally {
        upsertSpy.mockRestore()
        await database.deleteFitnessFile({ id: firstId })
        await database.deleteFitnessFile({ id: secondId })
      }
    })

    it('starts a new version instead of adding to an abandoned build', async () => {
      // The inflation this design exists to prevent, and the one that hides:
      // a pass dies mid-build leaving the pyramid `generating` with a cursor,
      // and the owner later hits Generate again. That run scans from the
      // beginning, so if it inherited the dead build's version every activity
      // it re-folded would be counted a second time INTO ITS OWN TILES — and
      // because the version never moved, completion's sweep could not clear
      // them. Two activities in two different countries: nothing may read 2.
      const firstId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-15T07:00:00.000Z')
      )
      const secondId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-16T07:00:00.000Z')
      )

      try {
        await seedRoute(firstId, AMSTERDAM)
        await seedRoute(secondId, SINGAPORE)

        const requestedAt = Date.now()
        const timeoutSpy = vi.spyOn(Date, 'now')
        timeoutSpy.mockReturnValueOnce(0).mockReturnValue(25_000)
        try {
          await runAllTime('job-pyramid-abandoned', {}, requestedAt)
        } finally {
          timeoutSpy.mockRestore()
        }

        const abandoned = await database.getFitnessRouteHeatmapPyramid({
          actorId: actor.id
        })
        expect(abandoned).toMatchObject({ status: 'generating' })
        expect(abandoned?.cursor).toBeDefined()

        // The continuation never runs. Long past the heartbeat window, a plain
        // Generate arrives — no `resume`, scanning from the beginning.
        mockPublish.mockClear()
        await database.deleteFitnessRouteHeatmapsForActor({ actorId: actor.id })
        const later = Date.now() + 10_000_000
        const laterSpy = vi.spyOn(Date, 'now').mockReturnValue(later)
        try {
          await runAllTime('job-pyramid-abandoned-regenerate', {}, later)
        } finally {
          laterSpy.mockRestore()
        }

        const rebuilt = await database.getFitnessRouteHeatmapPyramid({
          actorId: actor.id
        })
        expect(rebuilt).toMatchObject({ status: 'completed', activityCount: 2 })
        // A new tile generation, so the abandoned build's tiles were replaced
        // and then swept rather than added to.
        expect(rebuilt!.version).toBeGreaterThan(abandoned!.version)

        const tiles = await readTiles()
        expect(tiles.length).toBeGreaterThan(0)
        expect(tiles.every((tile) => tile.version === rebuilt!.version)).toBe(
          true
        )
        const counts = tiles.flatMap((tile) =>
          decodeTile(tile.segments).map((segment) => segment.count)
        )
        expect(counts.length).toBeGreaterThan(0)
        expect(new Set(counts)).toEqual(new Set([1]))
      } finally {
        await database.deleteFitnessFile({ id: firstId })
        await database.deleteFitnessFile({ id: secondId })
      }
    })

    it('ignores an activity the build has already folded', async () => {
      // Paging is by OFFSET, so an upload landing between two passes shifts
      // every activity down one and hands the continuation a file the previous
      // pass already folded. Counting scanned files cannot tell that apart from
      // honest progress; asking where the file sits against the build's own
      // cursor can, and the re-presented activity is skipped instead of counted
      // twice.
      const amsterdamId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-15T07:00:00.000Z')
      )
      const singaporeId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-16T07:00:00.000Z')
      )
      let tokyoId: string | null = null

      try {
        await seedRoute(amsterdamId, AMSTERDAM)
        await seedRoute(singaporeId, SINGAPORE)

        const requestedAt = Date.now()
        const timeoutSpy = vi.spyOn(Date, 'now')
        timeoutSpy.mockReturnValueOnce(0).mockReturnValue(25_000)
        try {
          await runAllTime('job-pyramid-shift', {}, requestedAt)
        } finally {
          timeoutSpy.mockRestore()
        }

        // Newest first, so pass 1 folded Singapore and checkpointed at offset 1.
        // Tokyo now becomes the newest, which makes offset 1 Singapore again.
        tokyoId = await createCompletedFitnessFile(
          'running',
          new Date('2026-04-17T07:00:00.000Z')
        )
        await seedRoute(tokyoId, TOKYO)

        await runPublishedContinuation('job-pyramid-shift-continuation')

        const tiles = await readTiles()
        const counts = tiles.flatMap((tile) =>
          decodeTile(tile.segments).map((segment) => segment.count)
        )
        expect(counts.length).toBeGreaterThan(0)
        // Singapore was handed back and skipped, not folded a second time.
        expect(new Set(counts)).toEqual(new Set([1]))
        // The COUNTER half of the same invariant, which the tiles cannot show:
        // the re-presented activity must not be counted either. Counting it
        // would make `activityCount` equal `totalCount` — a build claiming to
        // have covered the whole history precisely when it did not.
        //
        // And because it did not, it must NOT certify itself complete. Tokyo
        // was uploaded between the two passes, so it sorts first and sits at an
        // offset the resumed scan never reaches: the build is handed back to be
        // rebuilt instead. Stamping `completed` here would be worse than the
        // missing tiles, because `completedAt` is what makes the next claim
        // answer `already-fresh` — the regenerate that would pick Tokyo up
        // would be refused, and the hole would be permanent.
        const pyramid = await database.getFitnessRouteHeatmapPyramid({
          actorId: actor.id
        })
        expect(pyramid).toMatchObject({
          status: 'failed',
          error: 'Scan did not cover the whole history',
          activityCount: 2,
          scannedCount: 2
        })
        expect(pyramid?.completedAt).toBeUndefined()
        // So the rebuild is available immediately, rather than refused.
        expect(
          await database.claimFitnessRouteHeatmapPyramidBuild({
            actorId: actor.id,
            requestedAt: Date.now(),
            staleBefore: Date.now() - PYRAMID_HEARTBEAT_STALE_MS
          })
        ).toMatchObject({ claimed: true, reason: 'claimed' })
      } finally {
        await database.deleteFitnessFile({ id: amsterdamId })
        await database.deleteFitnessFile({ id: singaporeId })
        if (tokyoId) await database.deleteFitnessFile({ id: tokyoId })
      }
    })

    it('records progress across a checkpoint that folded no tiles', async () => {
      // A treadmill session folds nothing. If the pyramid only wrote its
      // progress when it had tiles to write, its cursor would stay put while
      // the region row moved on, and the continuation would be a pass that
      // cannot place itself in the build — one indoor activity at the front of
      // the history would cost the actor their whole pyramid.
      // Paging orders by `createdAt` descending, which here is creation order,
      // so the GPS-less activity has to be created LAST to be scanned first.
      const outdoorId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-15T07:00:00.000Z')
      )
      const indoorId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-16T07:00:00.000Z')
      )

      try {
        await database.upsertFitnessFileRoute({
          fitnessFileId: indoorId,
          actorId: actor.id,
          points: [],
          sourceVersion: FITNESS_FILE_ROUTE_SOURCE_VERSION
        })
        await seedRoute(outdoorId, AMSTERDAM)

        const requestedAt = Date.now()
        const timeoutSpy = vi.spyOn(Date, 'now')
        timeoutSpy.mockReturnValueOnce(0).mockReturnValue(25_000)
        try {
          await runAllTime('job-pyramid-indoor', {}, requestedAt)
        } finally {
          timeoutSpy.mockRestore()
        }

        const checkpointed = await database.getFitnessRouteHeatmapPyramid({
          actorId: actor.id
        })
        // No tiles yet, but the build knows it has scanned one file.
        expect(await readTiles()).toEqual([])
        expect(checkpointed).toMatchObject({
          status: 'generating',
          scannedCount: 1
        })
        expect(checkpointed?.cursor).toBeDefined()

        await runPublishedContinuation('job-pyramid-indoor-continuation')

        expect(
          await database.getFitnessRouteHeatmapPyramid({ actorId: actor.id })
        ).toMatchObject({ status: 'completed', activityCount: 1 })
        expect((await readTiles()).length).toBeGreaterThan(0)
      } finally {
        await database.deleteFitnessFile({ id: indoorId })
        await database.deleteFitnessFile({ id: outdoorId })
      }
    })

    it('hands the build back when this pass cannot cover it', async () => {
      // Retrying a failed row resumes the LEGACY cursor at a non-zero offset,
      // but the claim it gets is a fresh build that has seen nothing. Folding
      // from there would leave the pyramid silently missing everything before
      // that offset, so the run declines — and, having already stamped the row
      // `generating` with a fresh heartbeat, must hand it back rather than sit
      // on it and refuse every other claimant for the staleness window.
      const fitnessFileId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-15T07:00:00.000Z')
      )
      const secondId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-16T07:00:00.000Z')
      )

      try {
        await seedRoute(fitnessFileId, AMSTERDAM)
        await seedRoute(secondId, SINGAPORE)

        // A real pass checkpoints the region row at offset 1...
        const requestedAt = Date.now()
        const timeoutSpy = vi.spyOn(Date, 'now')
        timeoutSpy.mockReturnValueOnce(0).mockReturnValue(25_000)
        try {
          await runAllTime('job-pyramid-uncoverable', {}, requestedAt)
        } finally {
          timeoutSpy.mockRestore()
        }

        // ...and the pyramid it was building is then cleared out from under
        // it, so the continuation's claim is a brand-new build that has seen
        // nothing while the scan it is resuming starts at offset 1.
        await clearPyramid()
        await runPublishedContinuation('job-pyramid-uncoverable-continuation')

        expect(await readTiles()).toEqual([])
        const pyramid = await database.getFitnessRouteHeatmapPyramid({
          actorId: actor.id
        })
        // Released, not left `generating` with a live heartbeat and no writer.
        expect(pyramid?.status).toBe('failed')
        expect(pyramid?.error).toBeTruthy()

        // And the legacy blob finished regardless.
        const heatmap = await database.getFitnessRouteHeatmapByKey({
          actorId: actor.id,
          activityType: null,
          periodType: 'all_time',
          periodKey: 'all'
        })
        expect(heatmap?.status).toBe('completed')
      } finally {
        await database.deleteFitnessFile({ id: fitnessFileId })
        await database.deleteFitnessFile({ id: secondId })
      }
    })

    it('counts what it folded, not what the region row kept', async () => {
      // Tiles are stored unclipped, so the actor-wide build must not be stamped
      // with a total that depends on which region row happened to win the
      // claim — the same tiles would otherwise report a different activity
      // count from one generate to the next.
      const amsterdamId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-15T07:00:00.000Z')
      )
      const singaporeId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-16T07:00:00.000Z')
      )

      try {
        await seedRoute(amsterdamId, AMSTERDAM)
        await seedRoute(singaporeId, SINGAPORE)

        // A rect around the Netherlands only.
        await runAllTime('job-pyramid-region-count', {
          region: 'rect:53.50,3.00,51.00,7.50'
        })

        const heatmap = await database.getFitnessRouteHeatmapByKey({
          actorId: actor.id,
          activityType: null,
          periodType: 'all_time',
          periodKey: 'all',
          region: 'rect:53.50,3.00,51.00,7.50'
        })
        // The region row legitimately sees one activity...
        expect(heatmap?.status).toBe('completed')
        expect(heatmap?.activityCount).toBe(1)

        // ...while the pyramid folded both, and says so.
        expect(
          await database.getFitnessRouteHeatmapPyramid({ actorId: actor.id })
        ).toMatchObject({ status: 'completed', activityCount: 2 })

        // And the Singapore tiles really are there, unclipped.
        const tiles = await readTiles()
        expect(tiles.some((tile) => tile.z === 16 && tile.x > 2 ** 15)).toBe(
          true
        )
      } finally {
        await database.deleteFitnessFile({ id: amsterdamId })
        await database.deleteFitnessFile({ id: singaporeId })
      }
    })

    it.each([
      {
        description: 'a period other than all-time',
        activityType: null,
        periodType: 'yearly',
        periodKey: '2026'
      },
      {
        description: 'a single activity type',
        activityType: 'running',
        periodType: 'all_time',
        periodKey: 'all'
      }
    ])('writes no tiles for $description', async (variant) => {
      // Both halves matter, and the activity-type half is the one that bites:
      // `recreateFitnessRouteHeatmapJobs` enqueues an all-time variant per
      // distinct activity type, so a running-only run that claimed the actor's
      // one pyramid would fold only rides into it, sweep every other tile away
      // and then mark it completed.
      const fitnessFileId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-15T07:00:00.000Z')
      )

      try {
        await generateFitnessRouteHeatmapJob(database, {
          id: `job-pyramid-variant-${variant.periodType}-${variant.activityType}`,
          name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
          data: {
            actorId: actor.id,
            activityType: variant.activityType,
            periodType: variant.periodType,
            periodKey: variant.periodKey,
            requestedAt: Date.now()
          }
        })

        expect(await readTiles()).toEqual([])
        expect(
          await database.getFitnessRouteHeatmapPyramid({ actorId: actor.id })
        ).toBeNull()
      } finally {
        await database.deleteFitnessRouteHeatmapsForActor({ actorId: actor.id })
        await database.deleteFitnessFile({ id: fitnessFileId })
      }
    })

    it('adds to a tile it already wrote in an earlier flush', async () => {
      // The accumulation path itself: two rides over the same ground, split
      // across a checkpoint so the second is merged into tiles this build
      // already committed. Nothing else here exercises that — every other
      // fixture keeps its routes far enough apart to share no tile, which is
      // what makes a stray count of 2 meaningful there and useless here.
      const firstId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-15T07:00:00.000Z')
      )
      const secondId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-16T07:00:00.000Z')
      )

      try {
        await seedRoute(firstId, AMSTERDAM)
        await seedRoute(secondId, AMSTERDAM)

        const requestedAt = Date.now()
        const timeoutSpy = vi.spyOn(Date, 'now')
        timeoutSpy.mockReturnValueOnce(0).mockReturnValue(25_000)
        try {
          await runAllTime('job-pyramid-accumulate', {}, requestedAt)
        } finally {
          timeoutSpy.mockRestore()
        }

        const afterFirst = new Map(
          (await readTiles()).map((tile) => [tile.tileKey, tile])
        )
        expect(afterFirst.size).toBeGreaterThan(0)
        expect(
          [...afterFirst.values()].flatMap((tile) =>
            decodeTile(tile.segments).map((segment) => segment.count)
          )
        ).toEqual(expect.arrayContaining([1]))

        await runPublishedContinuation('job-pyramid-accumulate-continuation')

        const afterSecond = await readTiles()
        // Every tile the first flush wrote is still there, and none of them
        // lost geometry — a merge that replaced instead of adding would leave
        // the same keys with the same shape but a count of 1.
        for (const [tileKey, before] of afterFirst) {
          const after = afterSecond.find((tile) => tile.tileKey === tileKey)
          expect(after).toBeDefined()
          expect(after!.pointCount).toBeGreaterThanOrEqual(before.pointCount)
        }
        const counts = afterSecond.flatMap((tile) =>
          decodeTile(tile.segments).map((segment) => segment.count)
        )
        expect(counts.length).toBeGreaterThan(0)
        // The same ground twice, so every shared edge is now a second visit.
        expect(new Set(counts)).toEqual(new Set([2]))
      } finally {
        await database.deleteFitnessFile({ id: firstId })
        await database.deleteFitnessFile({ id: secondId })
      }
    })

    it('flushes more than once within a single pass', async () => {
      // Two flushes in one pass is the case where the delta map is reused, and
      // it is the only way to catch a flush that forgets to clear what it just
      // wrote. The heap guard is the cheap lever: it fires on accumulated
      // points, and it hands the tile edges back at the same time.
      const fitnessFileId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-15T07:00:00.000Z')
      )
      const secondId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-16T07:00:00.000Z')
      )
      const upsertSpy = vi.spyOn(database, 'upsertFitnessRouteHeatmapTiles')

      try {
        await seedRoute(fitnessFileId, AMSTERDAM)
        await seedRoute(secondId, SINGAPORE)
        // Force the accumulation guard on every activity.
        const heapSpy = vi.spyOn(process, 'memoryUsage').mockReturnValue({
          rss: 0,
          heapTotal: 0,
          heapUsed: Number.MAX_SAFE_INTEGER,
          external: 0,
          arrayBuffers: 0
        })

        try {
          await runAllTime('job-pyramid-multi-flush')
        } finally {
          heapSpy.mockRestore()
        }

        // Once per activity from the guard, so more than the single
        // end-of-run flush every other test sees.
        expect(upsertSpy.mock.calls.length).toBeGreaterThan(1)

        const tiles = await readTiles()
        expect(tiles.length).toBeGreaterThan(0)
        const counts = tiles.flatMap((tile) =>
          decodeTile(tile.segments).map((segment) => segment.count)
        )
        // A flush that left its edges in the map would re-merge them into the
        // next one and every count would climb.
        expect(new Set(counts)).toEqual(new Set([1]))
        expect(
          await database.getFitnessRouteHeatmapPyramid({ actorId: actor.id })
        ).toMatchObject({ status: 'completed', activityCount: 2 })
      } finally {
        upsertSpy.mockRestore()
        await database.deleteFitnessFile({ id: fitnessFileId })
        await database.deleteFitnessFile({ id: secondId })
      }
    })

    it('writes the tiles before the region row at a checkpoint', async () => {
      // The ordering is the correctness argument, not a preference: the pyramid
      // must land at or ahead of the region cursor so that anything the region
      // row hands back a second time is recognised by the build's own cursor.
      // Behind it, and a resume would re-fold — which inflates counts silently.
      const firstId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-15T07:00:00.000Z')
      )
      const secondId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-16T07:00:00.000Z')
      )
      // Only the CHECKPOINT write fails. The claim earlier in the run uses the
      // same method, and rejecting that one would end the run before any tile
      // work happened at all.
      const realUpdate = database.updateFitnessRouteHeatmapStatus.bind(database)
      const statusSpy = vi
        .spyOn(database, 'updateFitnessRouteHeatmapStatus')
        .mockImplementation(async (params) => {
          if (params.cursorOffset) {
            throw new Error('region row write failed')
          }
          return realUpdate(params)
        })

      try {
        await seedRoute(firstId, AMSTERDAM)
        await seedRoute(secondId, SINGAPORE)

        const requestedAt = Date.now()
        const timeoutSpy = vi.spyOn(Date, 'now')
        timeoutSpy.mockReturnValueOnce(0).mockReturnValue(25_000)
        try {
          await expect(
            runAllTime('job-pyramid-order', {}, requestedAt)
          ).rejects.toThrow('region row write failed')
        } finally {
          timeoutSpy.mockRestore()
        }

        // The region row never got its checkpoint, but the pyramid did.
        const pyramid = await database.getFitnessRouteHeatmapPyramid({
          actorId: actor.id
        })
        expect(pyramid?.scannedCount).toBe(1)
        expect(pyramid?.cursor).toBeDefined()
        expect((await readTiles()).length).toBeGreaterThan(0)
      } finally {
        statusSpy.mockRestore()
        await database.deleteFitnessFile({ id: firstId })
        await database.deleteFitnessFile({ id: secondId })
      }
    })

    it('hands the build back when the run stops at the file limit', async () => {
      // A run that has not seen the whole history has not built a whole
      // pyramid. Completing it anyway would sweep the previous version's tiles
      // out from under a partial one, so the map loses everything the capped
      // run did not reach — but it publishes no continuation either, so no
      // later pass can ever hold this build's token. Keeping the build would
      // leave a `generating` row with a fresh heartbeat and nobody writing to
      // it, refusing every claimant for the whole staleness window and still
      // never being finished.
      //
      // The limit is only reached on a FULL page, so the fixture needs one.
      // Ninety-nine of them are GPS-less, which costs a negative-cache row
      // each and no parsing.
      const ids: string[] = []
      try {
        const routed = await createCompletedFitnessFile(
          'running',
          new Date('2026-04-15T07:00:00.000Z')
        )
        ids.push(routed)
        await seedRoute(routed, AMSTERDAM)

        for (let index = 0; index < 99; index += 1) {
          const id = await createCompletedFitnessFile(
            'running',
            new Date('2026-04-16T07:00:00.000Z')
          )
          ids.push(id)
          await database.upsertFitnessFileRoute({
            fitnessFileId: id,
            actorId: actor.id,
            points: [],
            sourceVersion: FITNESS_FILE_ROUTE_SOURCE_VERSION
          })
        }

        await runAllTime('job-pyramid-page-limit', { maxCursorOffset: 100 })

        expect(
          await database.getFitnessRouteHeatmapPyramid({ actorId: actor.id })
        ).toMatchObject({
          status: 'failed',
          error: 'Run stopped at the fitness file page limit'
        })
        // Released, not completed: the tiles it did manage are kept and
        // nothing has been swept on their behalf, so the next generation
        // rebuilds under a fresh version rather than finishing a partial one.
        expect((await readTiles()).length).toBeGreaterThan(0)
        // And the row is claimable again immediately, rather than after the
        // 120s staleness window.
        expect(
          await database.claimFitnessRouteHeatmapPyramidBuild({
            actorId: actor.id,
            requestedAt: Date.now(),
            staleBefore: Date.now() - PYRAMID_HEARTBEAT_STALE_MS
          })
        ).toMatchObject({ claimed: true, reason: 'claimed' })
      } finally {
        for (const id of ids) await database.deleteFitnessFile({ id })
      }
    }, 30_000)

    it('hands the build back when the run is cancelled mid-build', async () => {
      // A cancelled run publishes no continuation, so nothing is coming to
      // finish this build. Returning while still holding it would leave a
      // `generating` row with a fresh heartbeat and no writer, refusing every
      // other claimant until the staleness window lapsed.
      const firstId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-15T07:00:00.000Z')
      )
      const secondId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-16T07:00:00.000Z')
      )
      // `abortIfCancelled` answers false for a row the user cancelled while
      // this pass was running; the claim earlier in the run uses the same
      // method, so only the checkpoint is diverted.
      const realUpdate = database.updateFitnessRouteHeatmapStatus.bind(database)
      const statusSpy = vi
        .spyOn(database, 'updateFitnessRouteHeatmapStatus')
        .mockImplementation(async (params) =>
          params.cursorOffset ? false : realUpdate(params)
        )

      try {
        await seedRoute(firstId, AMSTERDAM)
        await seedRoute(secondId, SINGAPORE)

        const requestedAt = Date.now()
        const timeoutSpy = vi.spyOn(Date, 'now')
        timeoutSpy.mockReturnValueOnce(0).mockReturnValue(25_000)
        try {
          await runAllTime('job-pyramid-cancelled', {}, requestedAt)
        } finally {
          timeoutSpy.mockRestore()
        }

        expect(mockPublish).not.toHaveBeenCalled()
        const pyramid = await database.getFitnessRouteHeatmapPyramid({
          actorId: actor.id
        })
        // `cancelled`, not `failed`: nothing went wrong with the build or the
        // data, the user stopped it. The row is claimable either way, but only
        // one of the two tells an operator that.
        expect(pyramid?.status).toBe('cancelled')
        expect(pyramid?.error).toBeTruthy()
        // And it is handed back, not sat on.
        expect(
          await database.claimFitnessRouteHeatmapPyramidBuild({
            actorId: actor.id,
            requestedAt: Date.now(),
            staleBefore: Date.now() - PYRAMID_HEARTBEAT_STALE_MS
          })
        ).toMatchObject({ claimed: true, reason: 'claimed' })
      } finally {
        statusSpy.mockRestore()
        await database.deleteFitnessFile({ id: firstId })
        await database.deleteFitnessFile({ id: secondId })
      }
    })
  })
})
