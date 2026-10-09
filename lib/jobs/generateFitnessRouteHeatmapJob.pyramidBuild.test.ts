import { GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME } from '@/lib/jobs/names'
import { TILE_LADDER_ZOOMS } from '@/lib/services/fitness-files/heatmapTiles/constants'
import { decodeTile } from '@/lib/services/fitness-files/heatmapTiles/tileCodec'
import { Actor } from '@/lib/types/domain/actor'

import { generateFitnessRouteHeatmapJob } from './generateFitnessRouteHeatmapJob'
import {
  createPyramidHelpers,
  mockGetFitnessFile,
  mockIsParseableFitnessFileType,
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
  const { database, instance, getActor, createCompletedFitnessFile } =
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

    it('builds a tile at every ladder zoom and completes the pyramid', async () => {
      // ~50km. One pixel at z4 is 9.8km, so the default 1.2km fixture
      // quantizes to a single pixel there and is correctly dropped — a route
      // has to actually be visible at the coarsest zoom to exercise it.
      mockParseFitnessFile.mockResolvedValue({
        coordinates: [
          { lat: 52.0, lng: 4.88 },
          { lat: 52.45, lng: 4.95 }
        ],
        trackPoints: [],
        totalDistanceMeters: 50_000,
        totalDurationSeconds: 7_200,
        elevationGainMeters: 42,
        activityType: 'running',
        startTime: new Date('2026-04-15T07:00:00.000Z')
      })

      const fitnessFileId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-15T07:00:00.000Z')
      )

      try {
        await runAllTime('job-pyramid-happy')

        const tiles = await readTiles()
        expect(new Set(tiles.map((tile) => tile.z))).toEqual(
          new Set(TILE_LADDER_ZOOMS)
        )
        expect(tiles.filter((tile) => tile.pointCount === 0)).toEqual([])

        const pyramid = await database.getFitnessRouteHeatmapPyramid({
          actorId: actor.id
        })
        expect(pyramid).toMatchObject({
          status: 'completed',
          activityCount: 1,
          totalCount: 1
        })
        expect(pyramid?.completedAt).toBeDefined()
        // Counted off the rows that are actually there, so the build's own
        // summary agrees with its tiles rather than staying at the zero the
        // row was inserted with.
        expect(pyramid?.tileCount).toBe(tiles.length)
        expect(pyramid?.pointCount).toBe(
          tiles.reduce((total, tile) => total + tile.pointCount, 0)
        )
      } finally {
        await database.deleteFitnessFile({ id: fitnessFileId })
      }
    })

    it('leaves the legacy blob exactly as it was before the pyramid existed', async () => {
      // The regression that matters: the map still renders from this blob, and
      // the pyramid must not have disturbed it.
      const fitnessFileId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-15T07:00:00.000Z')
      )

      try {
        await runAllTime('job-pyramid-blob-unchanged')

        const heatmap = await database.getFitnessRouteHeatmapByKey({
          actorId: actor.id,
          activityType: null,
          periodType: 'all_time',
          periodKey: 'all'
        })
        expect(heatmap?.status).toBe('completed')
        expect(heatmap?.segments).toEqual([
          {
            points: [
              { lat: 52.36, lng: 4.88 },
              { lat: 52.37, lng: 4.89 }
            ]
          }
        ])
        expect(heatmap?.bounds).toEqual({
          minLat: 52.36,
          maxLat: 52.37,
          minLng: 4.88,
          maxLng: 4.89
        })
      } finally {
        await database.deleteFitnessFile({ id: fitnessFileId })
      }
    })

    it('counts a street ridden twice as two visits', async () => {
      const first = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-15T07:00:00.000Z')
      )
      const second = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-16T07:00:00.000Z')
      )

      try {
        await runAllTime('job-pyramid-two-visits')

        const tiles = await readTiles()
        const counts = tiles.flatMap((tile) =>
          decodeTile(tile.segments).map((segment) => segment.count)
        )
        expect(counts.length).toBeGreaterThan(0)
        // Both activities are the same mocked route, so every edge is shared.
        expect(new Set(counts)).toEqual(new Set([2]))
      } finally {
        await database.deleteFitnessFile({ id: first })
        await database.deleteFitnessFile({ id: second })
      }
    })

    it('leaves the build alone when another pass already holds it', async () => {
      const fitnessFileId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-15T07:00:00.000Z')
      )

      try {
        // Someone else is mid-build and heartbeating.
        await database.claimFitnessRouteHeatmapPyramidBuild({
          actorId: actor.id,
          requestedAt: Date.now(),
          staleBefore: Date.now() - 120_000
        })

        await runAllTime('job-pyramid-in-progress')

        // No tiles written, and the incumbent's build is untouched.
        expect(await readTiles()).toEqual([])
        const pyramid = await database.getFitnessRouteHeatmapPyramid({
          actorId: actor.id
        })
        expect(pyramid?.status).toBe('generating')

        // The legacy blob still completed.
        const heatmap = await database.getFitnessRouteHeatmapByKey({
          actorId: actor.id,
          activityType: null,
          periodType: 'all_time',
          periodKey: 'all'
        })
        expect(heatmap?.status).toBe('completed')
      } finally {
        await database.deleteFitnessFile({ id: fitnessFileId })
      }
    })

    it('sweeps the tiles an earlier build left behind', async () => {
      // The sweep only shows up when a rebuild touches FEWER tiles than the
      // one before it — rebuilding the same route just overwrites the same
      // keys under a new version, which proves nothing. So the same activity
      // is re-parsed as a much shorter route the second time, standing in for
      // an activity that has gone away: the tiles only the long route reached
      // must not outlive it.
      const longRoute = {
        coordinates: [
          { lat: 52.0, lng: 4.88 },
          { lat: 52.45, lng: 4.95 }
        ],
        trackPoints: [],
        totalDistanceMeters: 50_000,
        totalDurationSeconds: 7_200,
        elevationGainMeters: 42,
        activityType: 'running',
        startTime: new Date('2026-04-15T07:00:00.000Z')
      }
      const shortRoute = {
        ...longRoute,
        coordinates: [
          { lat: 52.0, lng: 4.88 },
          { lat: 52.005, lng: 4.885 }
        ],
        totalDistanceMeters: 700
      }

      const fitnessFileId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-15T07:00:00.000Z')
      )

      try {
        mockParseFitnessFile.mockResolvedValue(longRoute)
        await runAllTime('job-pyramid-sweep-first')
        const firstKeys = new Set((await readTiles()).map((t) => t.tileKey))
        expect(firstKeys.size).toBeGreaterThan(10)

        // The route cache holds the long geometry, so clear it too — otherwise
        // the rebuild reads the cached long route straight back.
        await database.deleteFitnessFileRoute({ fitnessFileId })
        await database.deleteFitnessRouteHeatmapsForActor({ actorId: actor.id })

        mockParseFitnessFile.mockResolvedValue(shortRoute)
        // Strictly after BOTH clocks the second run is checked against, never
        // a bare `Date.now()`. Two job runs in one process land in the same
        // millisecond often enough to matter (a quarter of runs locally), and
        // the claim then answers `already-fresh` so the second build never
        // runs; but the region row was also just soft-deleted, and a run whose
        // `requestedAt` predates that deletion is dropped as stale before it
        // reaches the claim at all — which is the same failure a millisecond
        // later. Either way the assertion below fails on a code change that
        // never happened.
        const firstPyramid = await database.getFitnessRouteHeatmapPyramid({
          actorId: actor.id
        })
        await runAllTime(
          'job-pyramid-sweep-second',
          {},
          Math.max(Date.now(), firstPyramid!.completedAt! + 1)
        )

        const secondKeys = new Set((await readTiles()).map((t) => t.tileKey))
        expect(secondKeys.size).toBeGreaterThan(0)
        // Strictly fewer, and nothing left over from the longer build.
        expect(secondKeys.size).toBeLessThan(firstKeys.size)
        const swept = [...firstKeys].filter((key) => !secondKeys.has(key))
        expect(swept.length).toBeGreaterThan(0)
      } finally {
        await database.deleteFitnessFile({ id: fitnessFileId })
      }
    })

    it('keeps an edge at one visit across a checkpoint and a resume', async () => {
      // Tile counts ACCUMULATE, so a resume that re-folds an activity inflates
      // the heat permanently. The two routes are far apart and seeded straight
      // into the route cache, so which file each pass reads is not left to
      // paging order: after the resume the first pass's edges must still read
      // `count: 1`, and they must still EXIST — a resume that bumped the
      // version instead of keeping it would have them swept at completion.
      const firstId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-15T07:00:00.000Z')
      )
      const secondId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-16T07:00:00.000Z')
      )

      try {
        // Newest first is the page order, so the second file is scanned first.
        await seedRoute(secondId, SINGAPORE)
        await seedRoute(firstId, AMSTERDAM)

        const requestedAt = Date.now()
        const timeoutSpy = vi.spyOn(Date, 'now')
        timeoutSpy.mockReturnValueOnce(0).mockReturnValue(25_000)
        try {
          await runAllTime('job-pyramid-resume', {}, requestedAt)
        } finally {
          timeoutSpy.mockRestore()
        }

        const afterFirstPass = await readTiles()
        const firstPassKeys = new Set(
          afterFirstPass.map((tile) => tile.tileKey)
        )
        expect(firstPassKeys.size).toBeGreaterThan(0)
        const checkpointed = await database.getFitnessRouteHeatmapPyramid({
          actorId: actor.id
        })
        expect(checkpointed).toMatchObject({
          status: 'generating',
          scannedCount: 1
        })

        const continuation = await runPublishedContinuation(
          'job-pyramid-resume-continuation'
        )
        // The token is what makes the continuation the build's successor.
        expect(continuation.pyramidClaimSeq).toBe(checkpointed?.claimSeq)

        const pyramid = await database.getFitnessRouteHeatmapPyramid({
          actorId: actor.id
        })
        expect(pyramid).toMatchObject({ status: 'completed', activityCount: 2 })
        // Resumed, so the build kept its version rather than starting a new one.
        expect(pyramid?.version).toBe(checkpointed?.version)

        const tiles = await readTiles()
        // The first pass's tiles survived the second pass's completion sweep.
        const tileKeys = tiles.map((tile) => tile.tileKey)
        for (const key of firstPassKeys) {
          expect(tileKeys).toContain(key)
        }
        // Both routes are present, and no edge anywhere was counted twice.
        expect(tiles.length).toBeGreaterThan(firstPassKeys.size)
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

    it('carries the build past a file it could not read, and finishes it', async () => {
      // The wedge the token check opened, and the opposite failure from the
      // one it closed: a LEGITIMATE continuation refused. A file whose parse
      // throws is still a file the pass is finished with, so it has to move the
      // cursor — otherwise a first pass whose every readable file threw
      // checkpoints with no cursor at all, and the claim reports `resumed` only
      // for a build that HAS one. Its own continuation then presents a perfectly
      // valid token, is told it is not this build's successor, and — arriving at
      // a non-zero offset — releases the build it was sent to finish. Every
      // later pass carries a non-zero offset too, so nothing in the chain can
      // start a build either and the pyramid is never built at all.
      //
      // Storage being unavailable is also how the 20s budget gets consumed, so
      // the two halves of this arrive together rather than independently.
      const readableId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-15T07:00:00.000Z')
      )
      const unreadableId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-16T07:00:00.000Z')
      )

      try {
        // Newest first, so the unreadable one is scanned first and is the only
        // file this pass reaches before the checkpoint. No cached route for it,
        // so the job goes to storage — and storage is down.
        await seedRoute(readableId, AMSTERDAM)
        mockGetFitnessFile.mockRejectedValue(new Error('storage unavailable'))

        const requestedAt = Date.now()
        const timeoutSpy = vi.spyOn(Date, 'now')
        timeoutSpy.mockReturnValueOnce(0).mockReturnValue(25_000)
        try {
          await runAllTime('job-pyramid-unreadable', {}, requestedAt)
        } finally {
          timeoutSpy.mockRestore()
        }

        // Scanned and passed, though it folded nothing.
        const checkpointed = await database.getFitnessRouteHeatmapPyramid({
          actorId: actor.id
        })
        expect(checkpointed).toMatchObject({
          status: 'generating',
          scannedCount: 1,
          activityCount: 0
        })
        expect(checkpointed?.cursor).toEqual({
          createdAt: expect.any(Number),
          id: unreadableId
        })

        mockGetFitnessFile.mockResolvedValue({
          type: 'buffer',
          buffer: Buffer.from('fitness-file-bytes'),
          contentType: 'application/vnd.ant.fit'
        })
        const continuation = await runPublishedContinuation(
          'job-pyramid-unreadable-continuation'
        )
        expect(continuation.pyramidClaimSeq).toBe(checkpointed?.claimSeq)

        const pyramid = await database.getFitnessRouteHeatmapPyramid({
          actorId: actor.id
        })
        // Resumed rather than refused: same version, and the readable activity
        // it was sent to fold is in the build.
        expect(pyramid).toMatchObject({
          status: 'completed',
          activityCount: 1,
          scannedCount: 2
        })
        expect(pyramid?.version).toBe(checkpointed?.version)
        expect((await readTiles()).length).toBeGreaterThan(0)
      } finally {
        await database.deleteFitnessFile({ id: unreadableId })
        await database.deleteFitnessFile({ id: readableId })
      }
    })

    it('keeps a completed build completed when only the stale sweep fails', async () => {
      // The sweep runs after the guarded completion write has already stamped
      // the row `completed` with its final counters, and the release that a
      // completion failure triggers is fenced on a token the completion does
      // NOT move — so a sweep that threw rewrote a finished, correct pyramid to
      // `failed` over the very tiles it had just certified. What a failed sweep
      // actually costs is some tiles at an older version, which the next
      // build's own sweep removes.
      const fitnessFileId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-15T07:00:00.000Z')
      )
      const sweepSpy = vi
        .spyOn(database, 'deleteStaleFitnessRouteHeatmapTiles')
        .mockRejectedValue(new Error('sweep unavailable'))

      try {
        await seedRoute(fitnessFileId, AMSTERDAM)
        await runAllTime('job-pyramid-sweep-fails')

        expect(sweepSpy).toHaveBeenCalled()
        expect(
          await database.getFitnessRouteHeatmapPyramid({ actorId: actor.id })
        ).toMatchObject({
          status: 'completed',
          activityCount: 1,
          scannedCount: 1
        })
        expect((await readTiles()).length).toBeGreaterThan(0)
      } finally {
        sweepSpy.mockRestore()
        await database.deleteFitnessFile({ id: fitnessFileId })
      }
    })

    it('does not sweep on behalf of a build it no longer owns', async () => {
      // Completion is claimed FIRST because it is the guarded write: a pass
      // that has been superseded learns so there and must stop, rather than
      // deleting its successor's tiles. The sweep's own fence would refuse it
      // too, but that is the second line, not the argument.
      const fitnessFileId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-15T07:00:00.000Z')
      )
      const sweepSpy = vi.spyOn(database, 'deleteStaleFitnessRouteHeatmapTiles')
      const realUpdate =
        database.updateFitnessRouteHeatmapPyramid.bind(database)
      const updateSpy = vi
        .spyOn(database, 'updateFitnessRouteHeatmapPyramid')
        // Only the completion write is refused — as it would be for a pass that
        // had been taken over. Every other pyramid write in the run is real.
        .mockImplementation(async (params) =>
          params.status === 'completed' ? false : realUpdate(params)
        )

      try {
        await seedRoute(fitnessFileId, AMSTERDAM)
        await runAllTime('job-pyramid-superseded-completion')

        expect(
          updateSpy.mock.calls.some(([params]) => params.status === 'completed')
        ).toBe(true)
        expect(sweepSpy).not.toHaveBeenCalled()
      } finally {
        updateSpy.mockRestore()
        sweepSpy.mockRestore()
        await database.deleteFitnessFile({ id: fitnessFileId })
      }
    })

    it('does not rebuild for a sibling variant of the same request', async () => {
      // `recreateFitnessRouteHeatmapJobs` fans out one job per variant sharing a
      // single `requestedAt`, and region is deliberately not part of
      // `isPyramidVariant` — so an actor with N saved regions gets N+1 jobs that
      // are all pyramid variants. Handing the claim the REQUEST's time rather
      // than this pass's start time is the whole of what makes the siblings
      // cheap: the first completes the pyramid and the rest answer
      // `already-fresh`. With the run's own clock instead, each sibling claims,
      // bumps the version and rebuilds the entire pyramid from scratch.
      const fitnessFileId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-15T07:00:00.000Z')
      )

      try {
        await seedRoute(fitnessFileId, AMSTERDAM)
        // Not a time in the past: the previous test's cleanup soft-deletes the
        // region row, and a run whose `requestedAt` predates that deletion is
        // dropped as stale before it reaches the claim at all.
        const requestedAt = Date.now()

        await runAllTime('job-pyramid-fanout-first', {}, requestedAt)
        const first = await database.getFitnessRouteHeatmapPyramid({
          actorId: actor.id
        })
        expect(first).toMatchObject({ status: 'completed', version: 1 })

        const claimSpy = vi.spyOn(
          database,
          'claimFitnessRouteHeatmapPyramidBuild'
        )
        try {
          await runAllTime('job-pyramid-fanout-sibling', {}, requestedAt)

          // The claim is asked about the REQUEST, not about this pass. Asserted
          // on the argument as well as the outcome because the outcome alone is
          // decided by a `>=` on two timestamps that can land in the same
          // millisecond — which makes it agree with the wrong wiring roughly
          // whenever the two runs are fast enough.
          expect(claimSpy).toHaveBeenCalledWith(
            expect.objectContaining({ requestedAt })
          )
          expect(await claimSpy.mock.results[0].value).toMatchObject({
            claimed: false,
            reason: 'already-fresh'
          })
        } finally {
          claimSpy.mockRestore()
        }

        expect(
          await database.getFitnessRouteHeatmapPyramid({ actorId: actor.id })
        ).toMatchObject({
          status: 'completed',
          version: first!.version,
          completedAt: first!.completedAt
        })
      } finally {
        await database.deleteFitnessFile({ id: fitnessFileId })
      }
    })

    it('carries the build past a file whose type it cannot parse', async () => {
      // The GPS-less case has a second shape the suite could not reach: a file
      // type this job does not parse at all skips the whole block that folds
      // and advances inside it, and only the trailing advance covers it. The
      // module mock forces `isParseableFitnessFileType` true for every other
      // test, so without turning it off once this path is never executed.
      const unparseableId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-15T07:00:00.000Z')
      )
      const routedId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-16T07:00:00.000Z')
      )

      try {
        await seedRoute(routedId, AMSTERDAM)
        // Newest first, so the routed file is scanned first and the
        // unparseable one is what the cursor has to end on.
        mockIsParseableFitnessFileType.mockReturnValueOnce(true)
        mockIsParseableFitnessFileType.mockReturnValueOnce(false)

        await runAllTime('job-pyramid-unparseable-type')

        const pyramid = await database.getFitnessRouteHeatmapPyramid({
          actorId: actor.id
        })
        // Both files scanned, one folded, and the cursor ends past the file
        // that folded nothing. `error: undefined` is the load-bearing half: a
        // file type this job does not parse is legitimately unfoldable, NOT
        // unreadable, so the build covered the whole history and must not
        // report a loss.
        expect(pyramid).toMatchObject({
          status: 'completed',
          scannedCount: 2,
          activityCount: 1,
          error: undefined
        })
        expect(pyramid?.cursor?.id).toBe(unparseableId)
      } finally {
        mockIsParseableFitnessFileType.mockReturnValue(true)
        await database.deleteFitnessFile({ id: unparseableId })
        await database.deleteFitnessFile({ id: routedId })
      }
    })

    it('does not treat a job carrying a token but no resume flag as a continuation', async () => {
      // Only a continuation this job published for itself carries the token,
      // and it always sets `resume: true`. A payload with the ids but no flag
      // is not one — it scans from the beginning — so adopting the build would
      // keep a version and fold every activity it re-presents straight into
      // that build's own tiles, which is the doubling this design exists to
      // prevent. It has to take a fresh version instead.
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

        // A pass that checkpointed and then died, so the build is left
        // `generating` WITH a cursor — the only state where honouring the flag
        // makes any difference.
        const requestedAt = Date.now()
        const timeoutSpy = vi.spyOn(Date, 'now')
        timeoutSpy.mockReturnValueOnce(0).mockReturnValue(25_000)
        try {
          await runAllTime('job-pyramid-token-no-flag-first', {}, requestedAt)
        } finally {
          timeoutSpy.mockRestore()
        }

        const abandoned = await database.getFitnessRouteHeatmapPyramid({
          actorId: actor.id
        })
        expect(abandoned).toMatchObject({ status: 'generating', version: 1 })
        expect(abandoned?.cursor).toBeDefined()
        mockPublish.mockClear()

        // Long past the heartbeat window, so the build reads as abandoned and
        // the claim turns entirely on whether the token is honoured. Without
        // this the row still looks live and every tokenless claimant is refused
        // whatever the flag says.
        const later = Date.now() + 10_000_000
        const laterSpy = vi.spyOn(Date, 'now').mockReturnValue(later)
        try {
          // The build's own token, on a job that is not its continuation.
          await runAllTime(
            'job-pyramid-token-no-flag',
            {
              pyramidBuildId: abandoned!.id,
              pyramidClaimSeq: abandoned!.claimSeq
            },
            later
          )
        } finally {
          laterSpy.mockRestore()
        }

        const pyramid = await database.getFitnessRouteHeatmapPyramid({
          actorId: actor.id
        })
        // A fresh version, so its tiles replace the abandoned build's rather
        // than adding to them — and nothing anywhere reads 2.
        expect(pyramid).toMatchObject({
          status: 'completed',
          version: abandoned!.version + 1
        })
        const counts = (await readTiles()).flatMap((tile) =>
          decodeTile(tile.segments).map((segment) => segment.count)
        )
        expect(counts.length).toBeGreaterThan(0)
        expect(new Set(counts)).toEqual(new Set([1]))
      } finally {
        await database.deleteFitnessFile({ id: firstId })
        await database.deleteFitnessFile({ id: secondId })
      }
    })

    it('folds each activity once when a bulk import shares one createdAt', async () => {
      // A Strava archive import writes its rows in one go, so the scan's
      // `(createdAt, id)` order comes down entirely to the id tie-break — and
      // the gate compares those ids in JS while the page is ordered by SQL. If
      // the two disagreed, a chain would re-fold or skip an activity on every
      // hop, which is a permanently wrong number rather than a missing one.
      const ids: string[] = []
      const routes = [AMSTERDAM, SINGAPORE, TOKYO]

      try {
        for (const route of routes) {
          const id = await createCompletedFitnessFile(
            'running',
            new Date('2026-04-15T07:00:00.000Z')
          )
          ids.push(id)
          await seedRoute(id, route)
        }
        // Every row in the same millisecond, which is what the import produces
        // and what the fixture helper otherwise deliberately avoids.
        await instance('fitness_files')
          .whereIn('id', ids)
          .update({ createdAt: new Date(Date.UTC(2026, 5, 1, 12, 0, 0, 123)) })

        // A checkpoint after every file, so the tie-break is re-decided from a
        // stored cursor on each hop rather than once in memory.
        const requestedAt = Date.now()
        const timeoutSpy = vi.spyOn(Date, 'now')
        timeoutSpy.mockReturnValueOnce(0).mockReturnValue(25_000)
        try {
          await runAllTime('job-pyramid-tie-first', {}, requestedAt)
        } finally {
          timeoutSpy.mockRestore()
        }

        let passes = 1
        while (mockPublish.mock.calls.length > 0) {
          const continuation = mockPublish.mock.calls[0][0] as {
            data: Record<string, unknown>
          }
          mockPublish.mockClear()
          const spy = vi.spyOn(Date, 'now')
          spy.mockReturnValueOnce(0).mockReturnValue(25_000)
          try {
            await generateFitnessRouteHeatmapJob(database, {
              id: `job-pyramid-tie-${passes}`,
              name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
              data: continuation.data
            })
          } finally {
            spy.mockRestore()
          }
          passes += 1
          expect(passes).toBeLessThan(10)
        }
        // The point of the fixture is the CHAIN: the tie-break has to be
        // re-decided from a stored cursor on each hop, not once in memory.
        expect(passes).toBeGreaterThan(1)

        const pyramid = await database.getFitnessRouteHeatmapPyramid({
          actorId: actor.id
        })
        expect(pyramid).toMatchObject({
          status: 'completed',
          version: 1,
          scannedCount: 3,
          activityCount: 3,
          // Recounted at the decision, and it is that value the row records —
          // not the snapshot each pass took before its own scan.
          totalCount: 3
        })
        const counts = (await readTiles()).flatMap((tile) =>
          decodeTile(tile.segments).map((segment) => segment.count)
        )
        expect(counts.length).toBeGreaterThan(0)
        // Nothing folded twice, and all three continents present.
        expect(new Set(counts)).toEqual(new Set([1]))
      } finally {
        for (const id of ids) await database.deleteFitnessFile({ id })
      }
    }, 30_000)

    it('merges a second ride into a tile the same pass already has pending', async () => {
      // Two rides through the same city inside one pass meet in the in-memory
      // delta map rather than against a stored tile, and an edge only the
      // second one touches has to be ADDED to what is already pending. Dropping
      // that arm silently discards a whole ride's geometry from every tile the
      // two share — and no fixture reached it, because the routes are all far
      // enough apart to share nothing.
      const firstId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-15T07:00:00.000Z')
      )
      const secondId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-16T07:00:00.000Z')
      )

      try {
        // Two parallel lanes ~1.4km apart: the same tile from z12 down, but
        // distinct pixels, so they share tiles without sharing edges.
        await seedRoute(firstId, [
          { lat: 52.0, lng: 4.88 },
          { lat: 52.45, lng: 4.88 }
        ])
        await seedRoute(secondId, [
          { lat: 52.0, lng: 4.9 },
          { lat: 52.45, lng: 4.9 }
        ])

        await runAllTime('job-pyramid-shared-tile')

        const tiles = await readTiles()
        expect(tiles.length).toBeGreaterThan(0)
        // A tile the two lanes share while staying distinct pixels has to carry
        // BOTH of them — which is only true if the second ride's edges were
        // added to what the first had already left pending, rather than
        // replacing it. 1.4km apart at this latitude, that is the coarse half
        // of the ladder.
        const shared = tiles.filter(
          (tile) => decodeTile(tile.segments).length > 1
        )
        expect(shared.length).toBeGreaterThan(0)
        // Coarser zooms quantize the two lanes onto the same pixel, where a
        // count of 2 is the correct answer — two activities on one stretch of
        // road. Nothing anywhere reads more than that.
        const counts = tiles.flatMap((tile) =>
          decodeTile(tile.segments).map((segment) => segment.count)
        )
        expect(Math.max(...counts)).toBe(2)
        expect(
          await database.getFitnessRouteHeatmapPyramid({ actorId: actor.id })
        ).toMatchObject({ status: 'completed', activityCount: 2 })
      } finally {
        await database.deleteFitnessFile({ id: firstId })
        await database.deleteFitnessFile({ id: secondId })
      }
    })

    it('does not fail the run when the pyramid claim throws', async () => {
      // Tile work is a second, invisible output: losing it costs a rebuild,
      // failing the run costs the user the heatmap they can actually see. The
      // claim is the one tile-path failure with no build to record the reason
      // on, so it is logged and the legacy path finishes alone.
      const fitnessFileId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-15T07:00:00.000Z')
      )
      const claimSpy = vi
        .spyOn(database, 'claimFitnessRouteHeatmapPyramidBuild')
        .mockRejectedValue(new Error('claim unavailable'))

      try {
        await seedRoute(fitnessFileId, AMSTERDAM)

        await expect(
          runAllTime('job-pyramid-claim-throws')
        ).resolves.not.toThrow()

        expect(claimSpy).toHaveBeenCalled()
        expect(await readTiles()).toEqual([])
        // The heatmap the user can actually see is unaffected.
        const heatmap = await database.getFitnessRouteHeatmapByKey({
          actorId: actor.id,
          activityType: null,
          periodType: 'all_time',
          periodKey: 'all',
          region: ''
        })
        expect(heatmap).toMatchObject({ status: 'completed', activityCount: 1 })
      } finally {
        claimSpy.mockRestore()
        await database.deleteFitnessFile({ id: fitnessFileId })
      }
    })
  })
})
