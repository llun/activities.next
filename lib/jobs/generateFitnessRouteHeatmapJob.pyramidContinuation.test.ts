import { GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME } from '@/lib/jobs/names'
import * as tilerModule from '@/lib/services/fitness-files/heatmapTiles/tiler'
import { Actor } from '@/lib/types/domain/actor'

import {
  PYRAMID_HEARTBEAT_STALE_MS,
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
      AMSTERDAM,
      SINGAPORE
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

    it('hands the build back when its continuation is dropped as stale', async () => {
      // A continuation holds the only copy of its build's token, so a guard
      // that drops it walks away with the build still `generating` and a fresh
      // heartbeat — and nothing coming to write to it. That blocks every
      // claimant for the whole staleness window, including the Generate that
      // displaced this continuation in the first place, which is refused
      // `build-in-progress` and does no tile work at all.
      const firstId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-16T07:00:00.000Z')
      )
      const secondId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-15T07:00:00.000Z')
      )

      try {
        await seedRoute(firstId, SINGAPORE)
        await seedRoute(secondId, AMSTERDAM)

        const requestedAt = Date.now()
        const timeoutSpy = vi.spyOn(Date, 'now')
        timeoutSpy.mockReturnValueOnce(0).mockReturnValue(25_000)
        try {
          await runAllTime('job-pyramid-dropped', {}, requestedAt)
        } finally {
          timeoutSpy.mockRestore()
        }

        const checkpointed = await database.getFitnessRouteHeatmapPyramid({
          actorId: actor.id
        })
        expect(checkpointed).toMatchObject({ status: 'generating' })

        // The region row moves on under the queued continuation — which is
        // exactly what a second Generate does, by resetting its offset to 0.
        const continuationJob = mockPublish.mock.calls[0][0] as {
          data: Record<string, unknown>
        }
        mockPublish.mockClear()
        const regionRow = await database.getFitnessRouteHeatmapByKey({
          actorId: actor.id,
          activityType: null,
          periodType: 'all_time',
          periodKey: 'all',
          region: ''
        })
        await database.updateFitnessRouteHeatmapStatus({
          id: regionRow!.id,
          status: 'generating',
          cursorOffset: 0
        })

        await generateFitnessRouteHeatmapJob(database, {
          id: 'job-pyramid-dropped-continuation',
          name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
          data: continuationJob.data
        })

        // Dropped, and the build handed back rather than stranded.
        expect(mockPublish).not.toHaveBeenCalled()
        expect(
          await database.getFitnessRouteHeatmapPyramid({ actorId: actor.id })
        ).toMatchObject({
          status: 'failed',
          error: 'Continuation dropped; its region row had moved on'
        })
        // So the next claimant gets it immediately, not in two minutes.
        expect(
          await database.claimFitnessRouteHeatmapPyramidBuild({
            actorId: actor.id,
            requestedAt: Date.now(),
            staleBefore: Date.now() - PYRAMID_HEARTBEAT_STALE_MS
          })
        ).toMatchObject({ claimed: true, reason: 'claimed' })
      } finally {
        await database.deleteFitnessFile({ id: firstId })
        await database.deleteFitnessFile({ id: secondId })
      }
    })

    describe('when a continuation is dropped before it can claim', () => {
      // Every one of these guards drops a continuation that holds the ONLY copy
      // of its build's token. Walking away leaves the build `generating` with a
      // fresh heartbeat and nobody coming back for it, so every claimant — the
      // Generate that displaced this job included — is refused for the whole
      // staleness window. The release is unconditional in the handler's
      // `finally` rather than at each guard, because a per-guard release was
      // missed on one of the four twice; these cases are what prove each guard
      // actually reaches it.
      const startAChainAndCaptureItsContinuation = async (id: string) => {
        const firstId = await createCompletedFitnessFile(
          'running',
          new Date('2026-04-15T07:00:00.000Z')
        )
        const secondId = await createCompletedFitnessFile(
          'running',
          new Date('2026-04-16T07:00:00.000Z')
        )
        await seedRoute(firstId, AMSTERDAM)
        await seedRoute(secondId, SINGAPORE)

        // Read the clock BEFORE scripting it: `runAllTime`'s third argument is
        // evaluated inside the spy's window, so `Date.now()` here would eat the
        // scripted `startedAt` the checkpoint depends on.
        const requestedAt = Date.now()
        const timeoutSpy = vi.spyOn(Date, 'now')
        timeoutSpy.mockReturnValueOnce(0).mockReturnValue(25_000)
        try {
          await runAllTime(id, {}, requestedAt)
        } finally {
          timeoutSpy.mockRestore()
        }

        const held = await database.getFitnessRouteHeatmapPyramid({
          actorId: actor.id
        })
        expect(held).toMatchObject({ status: 'generating' })

        const continuation = mockPublish.mock.calls[0][0] as {
          data: Record<string, unknown>
        }
        expect(continuation.data.pyramidBuildId).toBe(held?.id)
        mockPublish.mockClear()

        return {
          fileIds: [firstId, secondId],
          runContinuation: () =>
            generateFitnessRouteHeatmapJob(database, {
              id: `${id}-continuation`,
              name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
              data: continuation.data
            })
        }
      }

      const expectBuildHandedBack = async (expected: {
        status: 'failed' | 'cancelled'
        error: RegExp
      }) => {
        expect(mockPublish).not.toHaveBeenCalled()
        const pyramid = await database.getFitnessRouteHeatmapPyramid({
          actorId: actor.id
        })
        // The VALUE, not `not.toBe('generating')`: the column has three legal
        // values here and a cancellation recorded as a failure tells an
        // operator something went wrong with the actor's data when nothing did.
        expect(pyramid?.status).toBe(expected.status)
        expect(pyramid?.error).toMatch(expected.error)
        // Claimable straight away, rather than after the staleness window.
        expect(
          await database.claimFitnessRouteHeatmapPyramidBuild({
            actorId: actor.id,
            requestedAt: Date.now(),
            staleBefore: Date.now() - PYRAMID_HEARTBEAT_STALE_MS
          })
        ).toMatchObject({ claimed: true, reason: 'claimed' })
      }

      it('hands the build back when its region row was deleted', async () => {
        const { fileIds, runContinuation } =
          await startAChainAndCaptureItsContinuation('job-pyramid-drop-deleted')
        try {
          await database.deleteFitnessRouteHeatmapsForActor({
            actorId: actor.id
          })
          await runContinuation()
          await expectBuildHandedBack({
            status: 'cancelled',
            error: /region row was deleted/
          })
        } finally {
          for (const id of fileIds) await database.deleteFitnessFile({ id })
        }
      })

      it('hands the build back when generation was cancelled', async () => {
        const { fileIds, runContinuation } =
          await startAChainAndCaptureItsContinuation(
            'job-pyramid-drop-cancelled'
          )
        try {
          const regionRow = await database.getFitnessRouteHeatmapByKey({
            actorId: actor.id,
            activityType: null,
            periodType: 'all_time',
            periodKey: 'all',
            region: ''
          })
          await database.updateFitnessRouteHeatmapStatus({
            id: regionRow!.id,
            status: 'cancelled'
          })
          await runContinuation()
          await expectBuildHandedBack({
            status: 'cancelled',
            error: /generation was cancelled/
          })
        } finally {
          for (const id of fileIds) await database.deleteFitnessFile({ id })
        }
      })

      it('hands the build back when its region row was cleared under it', async () => {
        // The fourth guard, and the one a per-guard release missed: the region
        // row is still readable when the guards above decide, and the guarded
        // `updateFitnessRouteHeatmapStatus` is what refuses — the clear landed
        // in between.
        const { fileIds, runContinuation } =
          await startAChainAndCaptureItsContinuation('job-pyramid-drop-cleared')
        const statusSpy = vi
          .spyOn(database, 'updateFitnessRouteHeatmapStatus')
          .mockResolvedValueOnce(false)
        try {
          await runContinuation()
          // A cache clear is not a user cancellation.
          await expectBuildHandedBack({
            status: 'failed',
            error: /region row was cleared/
          })
        } finally {
          statusSpy.mockRestore()
          for (const id of fileIds) await database.deleteFitnessFile({ id })
        }
      })

      it('survives its own release failing', async () => {
        // The release is how a dropped continuation hands its build back, and
        // it is the last write on a path that has already decided not to fail
        // the run. Without its own catch that rejection escapes the handler —
        // and on the top-level path it would replace the error the run is
        // rethrowing. Round 10's test for this reached only the top-level
        // catch, because it threw on a FRESH run that never called the release
        // at all.
        const { fileIds, runContinuation } =
          await startAChainAndCaptureItsContinuation(
            'job-pyramid-release-fails'
          )
        const releaseSpy = vi
          .spyOn(database, 'updateFitnessRouteHeatmapPyramid')
          .mockRejectedValue(new Error('pyramid row unavailable'))

        try {
          await database.deleteFitnessRouteHeatmapsForActor({
            actorId: actor.id
          })

          // The continuation is dropped, the release is attempted, and it
          // fails — and the run still returns rather than rejecting.
          await expect(runContinuation()).resolves.not.toThrow()
          expect(releaseSpy).toHaveBeenCalled()
        } finally {
          releaseSpy.mockRestore()
          for (const id of fileIds) await database.deleteFitnessFile({ id })
        }
      })

      it('hands the build back when the pass throws before it can claim', async () => {
        // No guard at all — the release has to survive an exception thrown
        // anywhere between the token being read and the claim being made, which
        // is why it lives in the handler's `finally` rather than at a return.
        const { fileIds, runContinuation } =
          await startAChainAndCaptureItsContinuation('job-pyramid-drop-threw')
        const countSpy = vi
          .spyOn(database, 'countFitnessFilesByActor')
          .mockRejectedValueOnce(new Error('count failed'))
        try {
          await expect(runContinuation()).rejects.toThrow('count failed')
          // The real cause, not the generic "ended without taking over".
          await expectBuildHandedBack({
            status: 'failed',
            error: /count failed/
          })
        } finally {
          countSpy.mockRestore()
          for (const id of fileIds) await database.deleteFitnessFile({ id })
        }
      })
    })

    it('refuses to adopt an abandoned build for a retry that carries no token', async () => {
      // The hole that a counter-based premise used to close and the first
      // rewrite reopened. `resume: true` does NOT mean "I am this build's
      // continuation" — the heatmap API sets it for any retry of a failed or
      // partial region row, carrying that row's offset and no pyramid token at
      // all. Such a pass covers neither the whole history nor the build's
      // cursor, so adopting the build would skip everything before its offset
      // and then mark the pyramid completed over the hole, with the version
      // unmoved so the sweep could never clear it.
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

        // A pass checkpoints and then dies without its continuation running.
        const requestedAt = Date.now()
        const timeoutSpy = vi.spyOn(Date, 'now')
        timeoutSpy.mockReturnValueOnce(0).mockReturnValue(25_000)
        try {
          await runAllTime('job-pyramid-tokenless', {}, requestedAt)
        } finally {
          timeoutSpy.mockRestore()
        }

        const abandoned = await database.getFitnessRouteHeatmapPyramid({
          actorId: actor.id
        })
        expect(abandoned).toMatchObject({ status: 'generating' })
        expect(abandoned?.cursor).toBeDefined()

        // Long past the heartbeat window, the API retries the region row: a
        // resume at its offset, with no pyramid token.
        mockPublish.mockClear()
        const later = Date.now() + 10_000_000
        const laterSpy = vi.spyOn(Date, 'now').mockReturnValue(later)
        try {
          await runAllTime(
            'job-pyramid-tokenless-retry',
            { resume: true, cursorOffset: 1 },
            later
          )
        } finally {
          laterSpy.mockRestore()
        }

        const pyramid = await database.getFitnessRouteHeatmapPyramid({
          actorId: actor.id
        })
        // Never completed over the activity it would have skipped.
        expect(pyramid?.status).not.toBe('completed')
        // And the row is not touched at all. Such a pass can never legitimately
        // own a build, which is knowable from its job data before the claim, so
        // it does not claim: the claim's compare-and-swap is destructive — it
        // bumps `version`, stamps `generating`, and clears the counters, the
        // cursor and `completedAt` — and deciding afterwards that the pass
        // cannot use what it took would demote a perfectly good pyramid to a
        // failed, empty one over tiles it no longer describes, rebuilding
        // nothing.
        expect(pyramid).toMatchObject({
          status: abandoned!.status,
          version: abandoned!.version,
          claimSeq: abandoned!.claimSeq
        })
        expect(pyramid?.cursor).toEqual(abandoned?.cursor)
        // And the tiles the abandoned build left are untouched, so a later
        // full generate still rebuilds from a clean slate under a new version.
        const tiles = await readTiles()
        expect(tiles.length).toBeGreaterThan(0)
        expect(tiles.every((tile) => tile.version === abandoned!.version)).toBe(
          true
        )

        // The legacy heatmap this retry was actually for still completed.
        const heatmap = await database.getFitnessRouteHeatmapByKey({
          actorId: actor.id,
          activityType: null,
          periodType: 'all_time',
          periodKey: 'all'
        })
        expect(heatmap?.status).toBe('completed')
      } finally {
        await database.deleteFitnessFile({ id: firstId })
        await database.deleteFitnessFile({ id: secondId })
      }
    })

    it('writes a cursor that covers the tiles a mid-activity flush commits', async () => {
      // A flush can fire in the middle of an activity — the heap guard trips on
      // a plain point counter, so every large build hits it — and it writes the
      // tiles and the cursor describing them in ONE statement. If the cursor
      // still named the previous file, a crash there would leave that
      // activity's tiles on disk with the build claiming not to have reached
      // it, and the resume would fold it a second time.
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
          await runAllTime('job-pyramid-midflush-cursor')
        } finally {
          heapSpy.mockRestore()
        }

        const midFlushes = upsertSpy.mock.calls
          .map((call) => call[0])
          .filter((params) => params.tiles.length > 0)
        expect(midFlushes.length).toBeGreaterThan(1)

        // Newest first, so the first flush carries the second file's tiles.
        const [firstFlush] = midFlushes
        expect(firstFlush.progress?.cursor).toEqual({
          createdAt: expect.any(Number),
          id: secondId
        })
        expect(firstFlush.progress?.scannedCount).toBe(1)
      } finally {
        upsertSpy.mockRestore()
        await database.deleteFitnessFile({ id: firstId })
        await database.deleteFitnessFile({ id: secondId })
      }
    })

    it('abandons the build without failing the run when the tiler throws', async () => {
      // The fold is pure, but it runs inside the per-file try that the legacy
      // accumulation shares, so an exception out of the tiler would otherwise
      // drop the activity from the heatmap the user can actually see.
      const fitnessFileId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-15T07:00:00.000Z')
      )
      const tilerSpy = vi
        .spyOn(tilerModule, 'buildTileDeltasForActivity')
        .mockImplementation(() => {
          throw new Error('tiler exploded')
        })

      try {
        await seedRoute(fitnessFileId, AMSTERDAM)
        await runAllTime('job-pyramid-tiler-throws')

        expect(await readTiles()).toEqual([])
        expect(
          await database.getFitnessRouteHeatmapPyramid({ actorId: actor.id })
        ).toMatchObject({ status: 'failed' })

        const heatmap = await database.getFitnessRouteHeatmapByKey({
          actorId: actor.id,
          activityType: null,
          periodType: 'all_time',
          periodKey: 'all'
        })
        expect(heatmap?.status).toBe('completed')
        // The activity still reached the legacy blob.
        expect(heatmap?.activityCount).toBe(1)
      } finally {
        tilerSpy.mockRestore()
        await database.deleteFitnessFile({ id: fitnessFileId })
      }
    })

    it('hands the build back when completing it fails', async () => {
      const fitnessFileId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-15T07:00:00.000Z')
      )
      const totalsSpy = vi
        .spyOn(database, 'getFitnessRouteHeatmapTileTotals')
        .mockRejectedValue(new Error('totals unavailable'))

      try {
        await seedRoute(fitnessFileId, AMSTERDAM)
        await runAllTime('job-pyramid-completion-fails')

        expect(totalsSpy).toHaveBeenCalled()
        expect(
          await database.getFitnessRouteHeatmapPyramid({ actorId: actor.id })
        ).toMatchObject({ status: 'failed' })

        const heatmap = await database.getFitnessRouteHeatmapByKey({
          actorId: actor.id,
          activityType: null,
          periodType: 'all_time',
          periodKey: 'all'
        })
        expect(heatmap?.status).toBe('completed')
      } finally {
        totalsSpy.mockRestore()
        await database.deleteFitnessFile({ id: fitnessFileId })
      }
    })

    it('keeps the legacy heatmap when the tile store fails', async () => {
      // The pyramid is a second, invisible output of this run. Nothing reads it
      // yet, and losing it costs a rebuild; failing the run costs the user the
      // heatmap they can actually see.
      const fitnessFileId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-15T07:00:00.000Z')
      )
      const upsertSpy = vi
        .spyOn(database, 'upsertFitnessRouteHeatmapTiles')
        .mockRejectedValue(new Error('tile store unavailable'))

      try {
        await runAllTime('job-pyramid-tile-store-down')

        expect(upsertSpy).toHaveBeenCalled()
        const heatmap = await database.getFitnessRouteHeatmapByKey({
          actorId: actor.id,
          activityType: null,
          periodType: 'all_time',
          periodKey: 'all'
        })
        expect(heatmap?.status).toBe('completed')
        expect(heatmap?.error).toBeFalsy()

        const pyramid = await database.getFitnessRouteHeatmapPyramid({
          actorId: actor.id
        })
        expect(pyramid?.status).toBe('failed')
      } finally {
        upsertSpy.mockRestore()
        await database.deleteFitnessFile({ id: fitnessFileId })
      }
    })

    it('drops tile work without failing the run when the build is taken over mid-flush', async () => {
      const fitnessFileId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-15T07:00:00.000Z')
      )
      // The upsert is the heartbeat as well as the write, so `false` is how a
      // pass learns another one has claimed the build out from under it.
      const upsertSpy = vi
        .spyOn(database, 'upsertFitnessRouteHeatmapTiles')
        .mockResolvedValue(false)

      try {
        await runAllTime('job-pyramid-lost-claim')

        expect(upsertSpy).toHaveBeenCalled()
        expect(await readTiles()).toEqual([])
        // Neither completed nor failed — the build belongs to someone else now.
        const pyramid = await database.getFitnessRouteHeatmapPyramid({
          actorId: actor.id
        })
        expect(pyramid?.status).toBe('generating')
        expect(pyramid?.completedAt).toBeUndefined()

        // The legacy blob is unaffected by any of it.
        const heatmap = await database.getFitnessRouteHeatmapByKey({
          actorId: actor.id,
          activityType: null,
          periodType: 'all_time',
          periodKey: 'all'
        })
        expect(heatmap?.status).toBe('completed')
      } finally {
        upsertSpy.mockRestore()
        await database.deleteFitnessFile({ id: fitnessFileId })
      }
    })

    it('marks the pyramid failed without swallowing the original error', async () => {
      const fitnessFileId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-15T07:00:00.000Z')
      )
      // Thrown from inside the page loop, which is after the claim — a failure
      // before it has no build to release, and the pyramid row would not yet
      // exist.
      const failure = new Error('page read failed')
      const pageSpy = vi
        .spyOn(database, 'getFitnessFilesByActor')
        .mockRejectedValue(failure)

      try {
        await expect(runAllTime('job-pyramid-failure')).rejects.toThrow(
          'page read failed'
        )

        const pyramid = await database.getFitnessRouteHeatmapPyramid({
          actorId: actor.id
        })
        expect(pyramid).toMatchObject({
          status: 'failed',
          error: 'page read failed'
        })
      } finally {
        pageSpy.mockRestore()
        await database.deleteFitnessFile({ id: fitnessFileId })
      }
    })
  })
})
