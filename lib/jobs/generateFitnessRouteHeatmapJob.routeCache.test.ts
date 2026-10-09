import { GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME } from '@/lib/jobs/names'
import {
  FITNESS_FILE_ROUTE_SOURCE_VERSION,
  buildFitnessFileRoutePoints
} from '@/lib/services/fitness-files/fileRouteCache'
import { Actor } from '@/lib/types/domain/actor'

import {
  ROUTE_CACHE_PREFETCH_SIZE,
  generateFitnessRouteHeatmapJob
} from './generateFitnessRouteHeatmapJob'
import {
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

  describe('route cache', () => {
    it('caches every parsed route on a first run, so the next one has them', async () => {
      const fitnessFileId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-15T07:00:00.000Z')
      )

      try {
        await generateFitnessRouteHeatmapJob(database, {
          id: 'job-route-cache-write-through',
          name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
          data: {
            actorId: actor.id,
            activityType: null,
            periodType: 'yearly',
            periodKey: '2026',
            // Real callers always stamp this. Without it the soft-delete
            // cutoff is 0, so a row cleared by an earlier test in this file
            // can never be reclaimed and the run bails as stale.
            requestedAt: Date.now()
          }
        })

        expect(mockGetFitnessFile).toHaveBeenCalledTimes(1)

        const [route] = await database.getFitnessFileRoutes({
          fitnessFileIds: [fitnessFileId]
        })
        expect(route).toMatchObject({
          fitnessFileId,
          actorId: actor.id,
          points: [
            [52.36, 4.88],
            [52.37, 4.89]
          ],
          sourceVersion: FITNESS_FILE_ROUTE_SOURCE_VERSION
        })
      } finally {
        await database.deleteFitnessRouteHeatmapsForActor({ actorId: actor.id })
        await database.deleteFitnessFile({ id: fitnessFileId })
      }
    })

    it('reads cached routes instead of the source files, and builds the same heatmap', async () => {
      // This is the whole point of the cache: a regenerate must not touch
      // object storage at all when every activity already has a route row.
      const fitnessFileId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-15T07:00:00.000Z')
      )

      try {
        await generateFitnessRouteHeatmapJob(database, {
          id: 'job-route-cache-first-run',
          name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
          data: {
            actorId: actor.id,
            activityType: null,
            periodType: 'yearly',
            periodKey: '2026',
            requestedAt: Date.now()
          }
        })

        const firstRun = await database.getFitnessRouteHeatmapByKey({
          actorId: actor.id,
          activityType: null,
          periodType: 'yearly',
          periodKey: '2026'
        })

        await database.deleteFitnessRouteHeatmapsForActor({ actorId: actor.id })
        mockGetFitnessFile.mockClear()
        mockParseFitnessFile.mockClear()

        await generateFitnessRouteHeatmapJob(database, {
          id: 'job-route-cache-second-run',
          name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
          data: {
            actorId: actor.id,
            activityType: null,
            periodType: 'yearly',
            periodKey: '2026',
            requestedAt: Date.now()
          }
        })

        expect(mockGetFitnessFile).not.toHaveBeenCalled()
        expect(mockParseFitnessFile).not.toHaveBeenCalled()

        const secondRun = await database.getFitnessRouteHeatmapByKey({
          actorId: actor.id,
          activityType: null,
          periodType: 'yearly',
          periodKey: '2026'
        })

        expect(secondRun?.status).toBe('completed')
        expect(secondRun?.segments).toEqual(firstRun?.segments)
        expect(secondRun?.bounds).toEqual(firstRun?.bounds)
        expect(secondRun?.pointCount).toBe(firstRun?.pointCount)
        expect(secondRun?.activityCount).toBe(firstRun?.activityCount)
      } finally {
        await database.deleteFitnessRouteHeatmapsForActor({ actorId: actor.id })
        await database.deleteFitnessFile({ id: fitnessFileId })
      }
    })

    it('skips the download for a cached activity with no GPS', async () => {
      const fitnessFileId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-15T07:00:00.000Z')
      )

      try {
        await database.upsertFitnessFileRoute({
          fitnessFileId,
          actorId: actor.id,
          points: [],
          sourceVersion: FITNESS_FILE_ROUTE_SOURCE_VERSION
        })

        await generateFitnessRouteHeatmapJob(database, {
          id: 'job-route-cache-no-gps',
          name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
          data: {
            actorId: actor.id,
            activityType: null,
            periodType: 'yearly',
            periodKey: '2026',
            requestedAt: Date.now()
          }
        })

        expect(mockGetFitnessFile).not.toHaveBeenCalled()

        const heatmap = await database.getFitnessRouteHeatmapByKey({
          actorId: actor.id,
          activityType: null,
          periodType: 'yearly',
          periodKey: '2026'
        })
        expect(heatmap?.status).toBe('completed')
        expect(heatmap?.activityCount).toBe(0)
        expect(heatmap?.segments).toEqual([])
      } finally {
        await database.deleteFitnessRouteHeatmapsForActor({ actorId: actor.id })
        await database.deleteFitnessFile({ id: fitnessFileId })
      }
    })

    it('re-derives a route written at an older source version', async () => {
      const fitnessFileId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-15T07:00:00.000Z')
      )

      try {
        // Geometry that could not have come from the mocked parse, so the
        // assertions below can tell "re-derived" from "trusted the row".
        //
        // Deliberately a version AHEAD of the current one. `- 1` would be 0
        // today, which is falsy — so a check that merely asked "is there a
        // version?" would pass, and the day the constant is bumped every row
        // written under the old rules would be served as a hit. This pins the
        // comparison itself, and covers the rolling-deploy case where a newer
        // worker has already rewritten the row.
        await database.upsertFitnessFileRoute({
          fitnessFileId,
          actorId: actor.id,
          points: [
            [1.3, 103.8],
            [1.31, 103.81]
          ],
          sourceVersion: FITNESS_FILE_ROUTE_SOURCE_VERSION + 1
        })

        await generateFitnessRouteHeatmapJob(database, {
          id: 'job-route-cache-stale-version',
          name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
          data: {
            actorId: actor.id,
            activityType: null,
            periodType: 'yearly',
            periodKey: '2026',
            requestedAt: Date.now()
          }
        })

        expect(mockGetFitnessFile).toHaveBeenCalledTimes(1)

        const heatmap = await database.getFitnessRouteHeatmapByKey({
          actorId: actor.id,
          activityType: null,
          periodType: 'yearly',
          periodKey: '2026'
        })
        expect(heatmap?.bounds).toEqual({
          minLat: 52.36,
          maxLat: 52.37,
          minLng: 4.88,
          maxLng: 4.89
        })

        const [route] = await database.getFitnessFileRoutes({
          fitnessFileIds: [fitnessFileId]
        })
        expect(route).toMatchObject({
          points: [
            [52.36, 4.88],
            [52.37, 4.89]
          ],
          sourceVersion: FITNESS_FILE_ROUTE_SOURCE_VERSION
        })
      } finally {
        await database.deleteFitnessRouteHeatmapsForActor({ actorId: actor.id })
        await database.deleteFitnessFile({ id: fitnessFileId })
      }
    })

    it('caches a long route through the same pipeline a rebuild reads it with', async () => {
      // Every other test here mocks a two-point route, where the cap, the
      // simplification and the rounding are all the identity — so none of them
      // would notice the miss path skipping the pipeline entirely and storing
      // raw parsed coordinates. That would put the `filePointLimit` memory
      // guard back on the floor and make the cached row disagree with what a
      // hit produces.
      const coordinates = Array.from({ length: 900 }, (_value, index) => ({
        lat: 52.36 + index * 0.000123 + (index % 5) * 0.0000071,
        lng: 4.88 + index * 0.000091
      }))
      mockParseFitnessFile.mockResolvedValue({
        coordinates,
        trackPoints: coordinates,
        totalDistanceMeters: 1_250,
        totalDurationSeconds: 420,
        elevationGainMeters: 42,
        activityType: 'running',
        startTime: new Date('2026-04-15T07:00:00.000Z')
      })

      const fitnessFileId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-15T07:00:00.000Z')
      )

      try {
        await generateFitnessRouteHeatmapJob(database, {
          id: 'job-route-cache-long-route',
          name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
          data: {
            actorId: actor.id,
            activityType: null,
            periodType: 'yearly',
            periodKey: '2026',
            requestedAt: Date.now()
          }
        })

        const [route] = await database.getFitnessFileRoutes({
          fitnessFileIds: [fitnessFileId]
        })

        expect(route.points).toEqual(buildFitnessFileRoutePoints(coordinates))
        // The pipeline actually did something: raw would have been all 900.
        expect(route.points.length).toBeLessThan(coordinates.length)
        expect(route.points.length).toBeGreaterThan(1)
      } finally {
        await database.deleteFitnessRouteHeatmapsForActor({ actorId: actor.id })
        await database.deleteFitnessFile({ id: fitnessFileId })
      }
    })

    it('matches each cached route to its own activity, not to its position in the page', async () => {
      // A page where only SOME activities have a cached row. Every other test
      // here has exactly one file, so a lookup that paired the fetched rows
      // with the page positionally would pass them all — while in production
      // attributing one athlete's polyline to a different activity, since the
      // batch read has no ORDER BY and its row order is not the page's.
      const cachedFileId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-15T07:00:00.000Z')
      )
      const uncachedFileId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-16T07:00:00.000Z')
      )

      try {
        // Singapore, nowhere near the Amsterdam coordinates the parse mock
        // returns, so the two are trivially distinguishable in the output.
        await database.upsertFitnessFileRoute({
          fitnessFileId: cachedFileId,
          actorId: actor.id,
          points: [
            [1.3, 103.8],
            [1.31, 103.81]
          ],
          sourceVersion: FITNESS_FILE_ROUTE_SOURCE_VERSION
        })

        await generateFitnessRouteHeatmapJob(database, {
          id: 'job-route-cache-mixed-page',
          name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
          data: {
            actorId: actor.id,
            activityType: null,
            periodType: 'yearly',
            periodKey: '2026',
            requestedAt: Date.now()
          }
        })

        // Exactly the uncached one was downloaded.
        expect(mockGetFitnessFile).toHaveBeenCalledTimes(1)
        expect(mockGetFitnessFile).toHaveBeenCalledWith(
          expect.anything(),
          uncachedFileId
        )

        const heatmap = await database.getFitnessRouteHeatmapByKey({
          actorId: actor.id,
          activityType: null,
          periodType: 'yearly',
          periodKey: '2026'
        })

        // Both contributed, each its own geometry.
        expect(heatmap?.activityCount).toBe(2)
        expect(heatmap?.bounds).toEqual({
          minLat: 1.3,
          maxLat: 52.37,
          minLng: 4.88,
          maxLng: 103.81
        })
      } finally {
        await database.deleteFitnessRouteHeatmapsForActor({ actorId: actor.id })
        await database.deleteFitnessFile({ id: cachedFileId })
        await database.deleteFitnessFile({ id: uncachedFileId })
      }
    })

    it('re-derives a cached route whose stored points did not survive the round trip', async () => {
      // `pointCount` is the only thing separating an unreadable payload from a
      // legitimate GPS-less row: both read back with no points. Without that
      // check the corrupt row is a permanent hit and its activity disappears
      // from every heatmap until the file is reprocessed.
      const fitnessFileId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-15T07:00:00.000Z')
      )

      try {
        // Non-finite coordinates serialize as JSON `null`, which the row
        // parser rejects — so this row stores a two-point `pointCount` beside
        // a payload that reads back as no points at all: exactly the shape a
        // truncated or otherwise unreadable payload takes.
        await database.upsertFitnessFileRoute({
          fitnessFileId,
          actorId: actor.id,
          points: [
            [Number.NaN, Number.NaN],
            [Number.NaN, Number.NaN]
          ],
          sourceVersion: FITNESS_FILE_ROUTE_SOURCE_VERSION
        })
        const [corrupt] = await database.getFitnessFileRoutes({
          fitnessFileIds: [fitnessFileId]
        })
        expect(corrupt).toMatchObject({ points: [], pointCount: 2 })

        await generateFitnessRouteHeatmapJob(database, {
          id: 'job-route-cache-corrupt',
          name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
          data: {
            actorId: actor.id,
            activityType: null,
            periodType: 'yearly',
            periodKey: '2026',
            requestedAt: Date.now()
          }
        })

        expect(mockGetFitnessFile).toHaveBeenCalledTimes(1)

        const heatmap = await database.getFitnessRouteHeatmapByKey({
          actorId: actor.id,
          activityType: null,
          periodType: 'yearly',
          periodKey: '2026'
        })
        expect(heatmap?.activityCount).toBe(1)
        expect(heatmap?.bounds).toEqual({
          minLat: 52.36,
          maxLat: 52.37,
          minLng: 4.88,
          maxLng: 4.89
        })

        // Repaired on the way through, so the next run is a hit again.
        const [repaired] = await database.getFitnessFileRoutes({
          fitnessFileIds: [fitnessFileId]
        })
        expect(repaired.points).toEqual([
          [52.36, 4.88],
          [52.37, 4.89]
        ])
        expect(repaired.pointCount).toBe(2)
      } finally {
        await database.deleteFitnessRouteHeatmapsForActor({ actorId: actor.id })
        await database.deleteFitnessFile({ id: fitnessFileId })
      }
    })

    it('reads the route cache in bounded batches rather than a page at a time', async () => {
      // The memory bound, which is otherwise guarded only by a comment: a
      // whole-page prefetch holds up to 100 decoded polylines at once, and at
      // `filePointLimit` that is past the job's own reduce threshold — on
      // histories that completed fine before the cache existed. Asserted on
      // the batch sizes requested, because the outcome is identical either
      // way; only the peak differs.
      const fitnessFileIds: string[] = []
      for (let index = 0; index < ROUTE_CACHE_PREFETCH_SIZE + 2; index += 1) {
        fitnessFileIds.push(
          await createCompletedFitnessFile(
            'running',
            new Date('2026-04-15T07:00:00.000Z')
          )
        )
      }
      const routesSpy = vi.spyOn(database, 'getFitnessFileRoutes')

      try {
        await generateFitnessRouteHeatmapJob(database, {
          id: 'job-route-cache-batching',
          name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
          data: {
            actorId: actor.id,
            activityType: null,
            periodType: 'yearly',
            periodKey: '2026',
            requestedAt: Date.now()
          }
        })

        // Pinned as a VALUE. Asserting only `size <= ROUTE_CACHE_PREFETCH_SIZE`
        // would move with the constant, so widening it back to a whole page
        // would satisfy the test again — the batch is bounded by exactly the
        // number under test. Change this deliberately, with the memory
        // arithmetic in the constant's comment.
        expect(ROUTE_CACHE_PREFETCH_SIZE).toBe(10)

        const batchSizes = routesSpy.mock.calls.map(
          ([{ fitnessFileIds: ids }]) => ids.length
        )
        expect(batchSizes.length).toBeGreaterThan(1)
        for (const size of batchSizes) {
          expect(size).toBeLessThanOrEqual(ROUTE_CACHE_PREFETCH_SIZE)
        }
        // Every activity was still covered, none skipped by the batching.
        expect(batchSizes.reduce((sum, size) => sum + size, 0)).toBe(
          fitnessFileIds.length
        )
      } finally {
        routesSpy.mockRestore()
        await database.deleteFitnessRouteHeatmapsForActor({ actorId: actor.id })
        for (const id of fitnessFileIds) {
          await database.deleteFitnessFile({ id })
        }
      }
    })

    it('still counts the activity when its route cannot be cached', async () => {
      // The route is already parsed by the time the write runs, so a failed
      // write costs the next run a download — never this run its activity.
      const fitnessFileId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-15T07:00:00.000Z')
      )
      const upsertSpy = vi
        .spyOn(database, 'upsertFitnessFileRoute')
        .mockRejectedValue(new Error('route cache write failed'))

      try {
        await generateFitnessRouteHeatmapJob(database, {
          id: 'job-route-cache-write-failure',
          name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
          data: {
            actorId: actor.id,
            activityType: null,
            periodType: 'yearly',
            periodKey: '2026',
            requestedAt: Date.now()
          }
        })

        const heatmap = await database.getFitnessRouteHeatmapByKey({
          actorId: actor.id,
          activityType: null,
          periodType: 'yearly',
          periodKey: '2026'
        })
        expect(heatmap?.status).toBe('completed')
        expect(heatmap?.activityCount).toBe(1)
        expect(heatmap?.segments).toEqual([
          {
            points: [
              { lat: 52.36, lng: 4.88 },
              { lat: 52.37, lng: 4.89 }
            ]
          }
        ])
      } finally {
        upsertSpy.mockRestore()
        await database.deleteFitnessRouteHeatmapsForActor({ actorId: actor.id })
        await database.deleteFitnessFile({ id: fitnessFileId })
      }
    })
  })
})
