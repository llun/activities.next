import { Actor } from '@/lib/types/domain/actor'

import { PYRAMID_HEARTBEAT_STALE_MS } from './generateFitnessRouteHeatmapJob'
import {
  createPyramidHelpers,
  mockGetFitnessFile,
  mockParseFitnessFile,
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

    it('records what it could not read rather than implying it read everything', async () => {
      // An unreadable activity is skipped by the legacy blob too, so the build
      // is still the best pyramid available and still completes — but it is not
      // the same artifact as one built from the whole history, and the row is
      // the only place that can say so.
      //
      // Withholding the sweep does NOT protect the missing geometry: tiles are
      // one row per `(actorId, tileKey)` and a merge replaces a tile whose
      // stored version is older, so a readable activity destroys the unreadable
      // one's contribution to every tile they share. The partial case below is
      // the one that shows it.
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
        await runAllTime('job-pyramid-outage-first')

        const healthy = await database.getFitnessRouteHeatmapPyramid({
          actorId: actor.id
        })
        expect(healthy).toMatchObject({
          status: 'completed',
          activityCount: 2,
          error: undefined
        })

        // The route cache goes cold and object storage is unavailable.
        await database.deleteFitnessFileRoute({ fitnessFileId: firstId })
        await database.deleteFitnessFileRoute({ fitnessFileId: secondId })
        mockGetFitnessFile.mockRejectedValue(new Error('storage unavailable'))

        await runAllTime(
          'job-pyramid-outage-second',
          {},
          Math.max(Date.now(), healthy!.completedAt! + 1)
        )

        const degraded = await database.getFitnessRouteHeatmapPyramid({
          actorId: actor.id
        })
        // Completed — the alternative is never completing for an actor with one
        // permanently unreadable file — but not silently.
        expect(degraded).toMatchObject({
          status: 'completed',
          activityCount: 0,
          error: 'Completed without 2 activities that could not be read'
        })
        // And the row's counters describe what is actually on disk.
        expect(degraded?.tileCount).toBe((await readTiles()).length)
      } finally {
        mockGetFitnessFile.mockResolvedValue({
          type: 'buffer',
          buffer: Buffer.from('fitness-file-bytes'),
          contentType: 'application/vnd.ant.fit'
        })
        await database.deleteFitnessFile({ id: firstId })
        await database.deleteFitnessFile({ id: secondId })
      }
    })

    it('records the loss when only some activities could not be read', async () => {
      // The case the sweep gate could not cover, and the one a fixture of two
      // far-apart routes hides: two rides in the same region SHARE tiles at
      // every coarse zoom, so folding the readable one rewrites those tiles at
      // the new version with only its own edges. No decision about the sweep
      // can bring the other ride's geometry back — only the record on the row
      // can say it is missing.
      const readableId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-15T07:00:00.000Z')
      )
      const unreadableId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-16T07:00:00.000Z')
      )

      try {
        await seedRoute(readableId, AMSTERDAM)
        await seedRoute(unreadableId, [
          { lat: 52.02, lng: 4.9 },
          { lat: 52.43, lng: 4.97 }
        ])
        await runAllTime('job-pyramid-partial-first')

        const healthy = await database.getFitnessRouteHeatmapPyramid({
          actorId: actor.id
        })
        expect(healthy).toMatchObject({ status: 'completed', activityCount: 2 })
        const healthyPoints = (await readTiles()).reduce(
          (sum, tile) => sum + tile.pointCount,
          0
        )

        // Only one of the two becomes unreadable.
        await database.deleteFitnessFileRoute({ fitnessFileId: unreadableId })
        mockGetFitnessFile.mockRejectedValue(new Error('storage unavailable'))

        await runAllTime(
          'job-pyramid-partial-second',
          {},
          Math.max(Date.now(), healthy!.completedAt! + 1)
        )

        const degraded = await database.getFitnessRouteHeatmapPyramid({
          actorId: actor.id
        })
        expect(degraded).toMatchObject({
          status: 'completed',
          activityCount: 1,
          error: 'Completed without 1 activity that could not be read'
        })
        // Geometry really was lost, and the readable ride really was kept —
        // `< healthy` alone would also hold if the build had lost everything,
        // which is a different failure with a different fix.
        const degradedPoints = (await readTiles()).reduce(
          (sum, tile) => sum + tile.pointCount,
          0
        )
        expect(degradedPoints).toBeGreaterThan(0)
        expect(degradedPoints).toBeLessThan(healthyPoints)
        // And the row still describes the tiles on disk.
        expect(degraded?.tileCount).toBe((await readTiles()).length)
      } finally {
        mockGetFitnessFile.mockResolvedValue({
          type: 'buffer',
          buffer: Buffer.from('fitness-file-bytes'),
          contentType: 'application/vnd.ant.fit'
        })
        await database.deleteFitnessFile({ id: readableId })
        await database.deleteFitnessFile({ id: unreadableId })
      }
    })

    it('records the count it was measured against, not the one it started with', async () => {
      // The coverage decision recounts, and the row has to record THAT number —
      // otherwise a completed build reports a history size it was never
      // compared against, and the two counters on the row disagree about
      // whether it covered anything. A deletion mid-pass is the case where the
      // two differ while the build still completes: the scan walked past both
      // files, so it covered everything that is left.
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
        // Deleted from inside the scan, i.e. after the start-of-pass count and
        // the page query have both already run.
        mockParseFitnessFile.mockImplementationOnce(async () => {
          await database.deleteFitnessFile({ id: firstId })
          return {
            coordinates: SINGAPORE,
            trackPoints: [],
            totalDistanceMeters: 50_000,
            totalDurationSeconds: 7_200,
            elevationGainMeters: 42,
            activityType: 'running',
            startTime: new Date('2026-04-16T07:00:00.000Z')
          }
        })

        await runAllTime('job-pyramid-recount-records')

        expect(
          await database.getFitnessRouteHeatmapPyramid({ actorId: actor.id })
        ).toMatchObject({
          status: 'completed',
          scannedCount: 2,
          // One left, and one is what the decision used.
          totalCount: 1
        })
      } finally {
        await database.deleteFitnessFile({ id: firstId })
        await database.deleteFitnessFile({ id: secondId })
      }
    })

    it('carries what it could not read across a continuation', async () => {
      // The record has to be about the BUILD, not the pass that happens to
      // finish it. A long history is exactly where an outage is likeliest and
      // exactly where the completing pass is not the one that hit it, so a
      // per-pass count reads `error: null` over a build that lost activities —
      // the silence the record exists to break.
      const readableId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-15T07:00:00.000Z')
      )
      const unreadableId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-16T07:00:00.000Z')
      )

      try {
        // Newest first, so the unreadable one is scanned first: the outage
        // lands on the FIRST pass and the pass that completes reads fine.
        await seedRoute(readableId, AMSTERDAM)
        // Keyed on the id rather than queued, so it cannot fire in whatever
        // test calls storage next.
        mockGetFitnessFile.mockImplementation(async (_database, id) =>
          id === unreadableId
            ? Promise.reject(new Error('storage unavailable'))
            : {
                type: 'buffer' as const,
                buffer: Buffer.from('fitness-file-bytes'),
                contentType: 'application/vnd.ant.fit'
              }
        )

        const requestedAt = Date.now()
        const timeoutSpy = vi.spyOn(Date, 'now')
        timeoutSpy.mockReturnValueOnce(0).mockReturnValue(25_000)
        try {
          await runAllTime('job-pyramid-carry-unreadable', {}, requestedAt)
        } finally {
          timeoutSpy.mockRestore()
        }

        const continuation = mockPublish.mock.calls[0][0] as {
          data: Record<string, unknown>
        }
        // The count travels with the token, so a redelivered continuation
        // recomputes the same total rather than adding to it.
        expect(continuation.data.pyramidUnreadableCount).toBe(1)

        await runPublishedContinuation('job-pyramid-carry-unreadable-cont')

        expect(
          await database.getFitnessRouteHeatmapPyramid({ actorId: actor.id })
        ).toMatchObject({
          status: 'completed',
          error: 'Completed without 1 activity that could not be read'
        })
      } finally {
        mockGetFitnessFile.mockReset()
        mockGetFitnessFile.mockResolvedValue({
          type: 'buffer',
          buffer: Buffer.from('fitness-file-bytes'),
          contentType: 'application/vnd.ant.fit'
        })
        await database.deleteFitnessFile({ id: unreadableId })
        await database.deleteFitnessFile({ id: readableId })
      }
    })

    it('does not report an activity it folded as one it could not read', async () => {
      // The per-file `try` covers the legacy accumulation too, which runs AFTER
      // the fold — so a throw down there would make a completed build claim it
      // lost geometry it is actually holding, which is worse than saying
      // nothing: the record is the only signal Phase 5 will have.
      const fitnessFileId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-15T07:00:00.000Z')
      )
      // The memory guard runs inside the same per-file `try`, after the fold —
      // one of the few seams on that side of it.
      const heapSpy = vi
        .spyOn(process, 'memoryUsage')
        .mockImplementationOnce(() => {
          throw new Error('memoryUsage exploded')
        })

      try {
        await seedRoute(fitnessFileId, AMSTERDAM)
        await runAllTime('job-pyramid-post-fold-throw')

        expect(heapSpy).toHaveBeenCalled()
        const pyramid = await database.getFitnessRouteHeatmapPyramid({
          actorId: actor.id
        })
        // The pyramid folded it — tiles are stored unclipped, before the region
        // filter that threw — so there is nothing to report as lost.
        expect(pyramid).toMatchObject({
          status: 'completed',
          activityCount: 1,
          error: undefined
        })
        expect((await readTiles()).length).toBeGreaterThan(0)
      } finally {
        heapSpy.mockRestore()
        await database.deleteFitnessFile({ id: fitnessFileId })
      }
    })

    it('tracks what it folded per file, not per page', async () => {
      // `foldedThisFile` decides whether a throw is recorded as lost geometry.
      // Declared once for the page rather than per file, one successful fold
      // would silence every later failure in the same page — and a degraded
      // build would complete claiming it read everything.
      const throwsId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-15T07:00:00.000Z')
      )
      const foldsId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-16T07:00:00.000Z')
      )

      try {
        // Both in one page, and the one that FOLDS is scanned first (newest
        // first, i.e. created last). A page-scoped flag would be left true by
        // it and would then silence the failure on its neighbour.
        await seedRoute(foldsId, SINGAPORE)
        mockGetFitnessFile.mockImplementation(async (_database, id) =>
          id === throwsId
            ? Promise.reject(new Error('storage unavailable'))
            : {
                type: 'buffer' as const,
                buffer: Buffer.from('fitness-file-bytes'),
                contentType: 'application/vnd.ant.fit'
              }
        )

        await runAllTime('job-pyramid-folded-per-file')

        expect(
          await database.getFitnessRouteHeatmapPyramid({ actorId: actor.id })
        ).toMatchObject({
          status: 'completed',
          activityCount: 1,
          error: 'Completed without 1 activity that could not be read'
        })
      } finally {
        mockGetFitnessFile.mockReset()
        mockGetFitnessFile.mockResolvedValue({
          type: 'buffer',
          buffer: Buffer.from('fitness-file-bytes'),
          contentType: 'application/vnd.ant.fit'
        })
        await database.deleteFitnessFile({ id: throwsId })
        await database.deleteFitnessFile({ id: foldsId })
      }
    })

    it('never reports an activity it holds as one it could not read', async () => {
      // The end-to-end property, whichever guard delivers it: a build must not
      // persist a loss for geometry it is sitting on, because that record is
      // the scoped, persisted degradation signal an operator reads.
      //
      // Here it is the COVERAGE guard that delivers it: re-presenting a file
      // requires an upload to have shifted the offsets, and that upload raises
      // the recount, so the build is handed back rather than completed. That
      // covers the ordinary case — but not the window where a deletion lands
      // after the final page read and cancels the shortfall, which is what the
      // `foldedThisFile` arm is for and what the sibling test drives.
      const amsterdamId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-15T07:00:00.000Z')
      )
      const singaporeId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-16T07:00:00.000Z')
      )
      let shifterId: string | undefined

      try {
        await seedRoute(amsterdamId, AMSTERDAM)
        await seedRoute(singaporeId, SINGAPORE)

        // Pass 1 folds Singapore and checkpoints.
        const requestedAt = Date.now()
        const timeoutSpy = vi.spyOn(Date, 'now')
        timeoutSpy.mockReturnValueOnce(0).mockReturnValue(25_000)
        try {
          await runAllTime('job-pyramid-refold-unreadable', {}, requestedAt)
        } finally {
          timeoutSpy.mockRestore()
        }

        // An upload shifts every offset down one, so the continuation is handed
        // Singapore a second time — and its route cache is now gone and storage
        // is unavailable, so reading it throws.
        shifterId = await createCompletedFitnessFile(
          'running',
          new Date('2026-04-17T07:00:00.000Z')
        )
        await seedRoute(shifterId, TOKYO)
        await database.deleteFitnessFileRoute({ fitnessFileId: singaporeId })
        mockGetFitnessFile.mockImplementation(async (_database, id) =>
          id === singaporeId
            ? Promise.reject(new Error('storage unavailable'))
            : {
                type: 'buffer' as const,
                buffer: Buffer.from('fitness-file-bytes'),
                contentType: 'application/vnd.ant.fit'
              }
        )

        await runPublishedContinuation('job-pyramid-refold-unreadable-cont')

        const pyramid = await database.getFitnessRouteHeatmapPyramid({
          actorId: actor.id
        })
        // Whatever else this pass decides, it must not claim to have lost the
        // activity whose tiles it is sitting on.
        expect(pyramid?.error).not.toMatch(/could not be read/)
        // And the state it actually reaches, so this cannot pass with the
        // staged shift removed: the upload raised the count the coverage guard
        // compares against, so the build is handed back rather than completed.
        expect(pyramid).toMatchObject({
          status: 'failed',
          error: 'Scan did not cover the whole history'
        })
      } finally {
        mockGetFitnessFile.mockReset()
        mockGetFitnessFile.mockResolvedValue({
          type: 'buffer',
          buffer: Buffer.from('fitness-file-bytes'),
          contentType: 'application/vnd.ant.fit'
        })
        await database.deleteFitnessFile({ id: amsterdamId })
        await database.deleteFitnessFile({ id: singaporeId })
        if (shifterId) await database.deleteFitnessFile({ id: shifterId })
      }
    })

    it('does not let a failing release or pyramid write break the run', async () => {
      // "Tile work never fails the run" has to hold for the writes that RECORD
      // a tile-path failure too. The release's own catch and the top-level
      // catch's pyramid write are the last two places a pyramid error could
      // escape into the legacy path — and the top-level one must not mask the
      // original error either, which is what the run is rethrowing.
      const fitnessFileId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-15T07:00:00.000Z')
      )
      const pyramidWriteSpy = vi
        .spyOn(database, 'updateFitnessRouteHeatmapPyramid')
        .mockRejectedValue(new Error('pyramid row unavailable'))
      const pageSpy = vi
        .spyOn(database, 'getFitnessFilesByActor')
        .mockRejectedValueOnce(new Error('page read failed'))

      try {
        await seedRoute(fitnessFileId, AMSTERDAM)

        // The original error, not the pyramid one.
        await expect(runAllTime('job-pyramid-release-throws')).rejects.toThrow(
          'page read failed'
        )
        expect(pyramidWriteSpy).toHaveBeenCalled()
      } finally {
        pageSpy.mockRestore()
        pyramidWriteSpy.mockRestore()
        await database.deleteFitnessFile({ id: fitnessFileId })
      }
    })

    it('does not report a re-presented activity as lost when the count catches up', async () => {
      // The window the "this arm is inert" argument missed, reproduced. The
      // coverage guard normally catches a re-presented file, because the upload
      // that shifted the offsets also raises the count — but that count is
      // taken AGAIN after the scan, so a deletion landing between the final page
      // read and the recount lowers it by exactly the shortfall, and the build
      // completes. Without the already-folded arm it then reports a loss for
      // tiles it is sitting on, in the one column an operator reads.
      const amsterdamId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-15T07:00:00.000Z')
      )
      const singaporeId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-16T07:00:00.000Z')
      )
      let shifterId: string | undefined

      try {
        await seedRoute(amsterdamId, AMSTERDAM)
        await seedRoute(singaporeId, SINGAPORE)

        const requestedAt = Date.now()
        const timeoutSpy = vi.spyOn(Date, 'now')
        timeoutSpy.mockReturnValueOnce(0).mockReturnValue(25_000)
        try {
          await runAllTime('job-pyramid-represent-recount', {}, requestedAt)
        } finally {
          timeoutSpy.mockRestore()
        }

        // The upload shifts the offsets so the continuation is handed Singapore
        // a second time, and it is unreadable when it is.
        shifterId = await createCompletedFitnessFile(
          'running',
          new Date('2026-04-17T07:00:00.000Z')
        )
        await seedRoute(shifterId, TOKYO)
        await database.deleteFitnessFileRoute({ fitnessFileId: singaporeId })
        mockGetFitnessFile.mockImplementation(async (_database, id) =>
          id === singaporeId
            ? Promise.reject(new Error('storage unavailable'))
            : {
                type: 'buffer' as const,
                buffer: Buffer.from('fitness-file-bytes'),
                contentType: 'application/vnd.ant.fit'
              }
        )

        // Deleted AFTER the continuation's page has been read, which is the
        // window: the recount at the decision no longer sees it.
        const realPage = database.getFitnessFilesByActor.bind(database)
        const pageSpy = vi
          .spyOn(database, 'getFitnessFilesByActor')
          .mockImplementationOnce(async (params) => {
            const page = await realPage(params)
            await database.deleteFitnessFile({ id: shifterId! })
            return page
          })

        try {
          await runPublishedContinuation('job-pyramid-represent-recount-cont')
        } finally {
          pageSpy.mockRestore()
        }

        // The window really opened: Singapore was handed back a second time,
        // which is the only reason storage was asked for it at all. Without
        // this the staged upload could be deleted and the test would still
        // pass, having driven nothing.
        expect(mockGetFitnessFile).toHaveBeenCalledWith(
          expect.anything(),
          singaporeId
        )

        const pyramid = await database.getFitnessRouteHeatmapPyramid({
          actorId: actor.id
        })
        // It completed — the recount caught up with the shortfall — and it
        // holds both rides, so it must not report a loss at all.
        expect(pyramid).toMatchObject({
          status: 'completed',
          error: undefined,
          scannedCount: 2,
          totalCount: 2
        })
        expect((await readTiles()).length).toBeGreaterThan(0)
      } finally {
        mockGetFitnessFile.mockReset()
        mockGetFitnessFile.mockResolvedValue({
          type: 'buffer',
          buffer: Buffer.from('fitness-file-bytes'),
          contentType: 'application/vnd.ant.fit'
        })
        await database.deleteFitnessFile({ id: amsterdamId })
        await database.deleteFitnessFile({ id: singaporeId })
        // The happy path deletes this from inside the page spy; deleting it
        // again here is what stops one failure before that from leaking a
        // third activity into every later test in the file.
        if (shifterId) await database.deleteFitnessFile({ id: shifterId })
      }
    })

    it('does not complete over an activity that arrived while it was running', async () => {
      // `totalCount` is counted before the scan, so an activity that finishes
      // processing after it is invisible to the count AND to the page query.
      // Trusting that snapshot at completion lets the build certify a history
      // it never saw — and `completedAt` then refuses the regenerate the upload
      // itself enqueued, so the hole is permanent rather than healed.
      const firstId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-15T07:00:00.000Z')
      )
      let secondId: string | undefined

      try {
        // Deliberately NOT route-cached: the upload has to be staged from
        // inside the parse, which a cache hit would skip — leaving the queued
        // implementation to fire in whatever test called parse next.
        mockParseFitnessFile.mockImplementationOnce(async () => {
          secondId = await createCompletedFitnessFile(
            'running',
            new Date('2026-04-16T07:00:00.000Z')
          )
          await seedRoute(secondId, SINGAPORE)
          return {
            coordinates: AMSTERDAM,
            trackPoints: [],
            totalDistanceMeters: 50_000,
            totalDurationSeconds: 7_200,
            elevationGainMeters: 42,
            activityType: 'running',
            startTime: new Date('2026-04-15T07:00:00.000Z')
          }
        })

        const requestedAt = Date.now()
        await runAllTime('job-pyramid-midpass-upload', {}, requestedAt)

        const pyramid = await database.getFitnessRouteHeatmapPyramid({
          actorId: actor.id
        })
        expect(pyramid).toMatchObject({
          status: 'failed',
          error: 'Scan did not cover the whole history'
        })
        expect(pyramid?.completedAt).toBeUndefined()
        // So the regenerate the upload enqueued is not refused.
        expect(
          await database.claimFitnessRouteHeatmapPyramidBuild({
            actorId: actor.id,
            requestedAt,
            staleBefore: Date.now() - PYRAMID_HEARTBEAT_STALE_MS
          })
        ).toMatchObject({ claimed: true, reason: 'claimed' })
      } finally {
        await database.deleteFitnessFile({ id: firstId })
        if (secondId) await database.deleteFitnessFile({ id: secondId })
      }
    })
  })
})
