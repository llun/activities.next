import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import {
  GENERATE_FITNESS_HEATMAP_JOB_NAME,
  GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME
} from '@/lib/jobs/names'
import { getFitnessFile } from '@/lib/services/fitness-files'
import {
  FITNESS_FILE_ROUTE_SOURCE_VERSION,
  buildFitnessFileRoutePoints
} from '@/lib/services/fitness-files/fileRouteCache'
import { TILE_LADDER_ZOOMS } from '@/lib/services/fitness-files/heatmapTiles/constants'
import { decodeTile } from '@/lib/services/fitness-files/heatmapTiles/tileCodec'
import { parseFitnessFile } from '@/lib/services/fitness-files/parseFitnessFile'
import { DEFAULT_ROUTE_HEATMAP_MAX_POINTS } from '@/lib/services/fitness-files/routeHeatmap'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { Actor } from '@/lib/types/domain/actor'
import { getHashFromString } from '@/lib/utils/getHashFromString'

import {
  ROUTE_CACHE_PREFETCH_SIZE,
  generateFitnessRouteHeatmapJob
} from './generateFitnessRouteHeatmapJob'
import { JOBS } from './index'

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

const mockGetFitnessFile = getFitnessFile as jest.MockedFunction<
  typeof getFitnessFile
>
const mockParseFitnessFile = parseFitnessFile as jest.MockedFunction<
  typeof parseFitnessFile
>

describe('generateFitnessRouteHeatmapJob', () => {
  const database = getTestSQLDatabase()
  let actor: Actor

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    actor = (await database.getActorFromUsername({
      username: seedActor1.username,
      domain: seedActor1.domain
    })) as Actor
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockPublish.mockResolvedValue(undefined)
    mockGetFitnessFile.mockResolvedValue({
      type: 'buffer',
      buffer: Buffer.from('fitness-file-bytes'),
      contentType: 'application/vnd.ant.fit'
    })
    mockParseFitnessFile.mockResolvedValue({
      coordinates: [
        { lat: 52.36, lng: 4.88 },
        { lat: 52.37, lng: 4.89 }
      ],
      trackPoints: [
        { lat: 52.36, lng: 4.88 },
        { lat: 52.37, lng: 4.89 }
      ],
      totalDistanceMeters: 1_250,
      totalDurationSeconds: 420,
      elevationGainMeters: 42,
      activityType: 'running',
      startTime: new Date('2026-04-15T07:00:00.000Z')
    })
  })

  const createCompletedFitnessFile = async (
    activityType: string,
    activityStartTime: Date
  ) => {
    const postId = `route-heatmap-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`
    const statusId = `${actor.id}/statuses/${postId}`

    await database.createNote({
      id: statusId,
      url: `https://${actor.domain}/${actor.username}/${postId}`,
      actorId: actor.id,
      text: 'Test activity',
      summary: null,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [`${actor.id}/followers`],
      reply: ''
    })

    const fitnessFile = await database.createFitnessFile({
      actorId: actor.id,
      statusId,
      path: `fitness/${postId}.fit`,
      fileName: `${postId}.fit`,
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 2_048
    })
    expect(fitnessFile).toBeDefined()

    await database.updateFitnessFileProcessingStatus(
      fitnessFile!.id,
      'completed'
    )
    await database.updateFitnessFilePrimary(fitnessFile!.id, true)
    await database.updateFitnessFileActivityData(fitnessFile!.id, {
      activityType,
      activityStartTime,
      hasMapData: true,
      mapImagePath: 'medias/test-map.webp'
    })

    return fitnessFile!.id
  }

  it('aliases the legacy job name to the route heatmap job', () => {
    expect(JOBS[GENERATE_FITNESS_HEATMAP_JOB_NAME]).toBe(
      JOBS[GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME]
    )
  })

  it('creates route cache data from matching completed fitness files', async () => {
    const fitnessFileId = await createCompletedFitnessFile(
      'running',
      new Date('2026-04-15T07:00:00.000Z')
    )

    await generateFitnessRouteHeatmapJob(database, {
      id: 'job-route-heatmap-success',
      name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
      data: {
        actorId: actor.id,
        activityType: null,
        periodType: 'yearly',
        periodKey: '2026'
      }
    })

    const heatmap = await database.getFitnessRouteHeatmapByKey({
      actorId: actor.id,
      activityType: null,
      periodType: 'yearly',
      periodKey: '2026'
    })

    expect(heatmap?.status).toBe('completed')
    expect(heatmap?.activityCount).toBeGreaterThanOrEqual(1)
    expect(heatmap?.pointCount).toBeGreaterThanOrEqual(2)
    // Progress denominator: the one matching completed file.
    expect(heatmap?.totalCount).toBe(1)
    expect(heatmap?.bounds).toEqual({
      minLat: 52.36,
      maxLat: 52.37,
      minLng: 4.88,
      maxLng: 4.89
    })
    expect(heatmap?.segments).toEqual([
      {
        points: [
          { lat: 52.36, lng: 4.88 },
          { lat: 52.37, lng: 4.89 }
        ]
      }
    ])

    await database.deleteFitnessRouteHeatmapsForActor({ actorId: actor.id })
    await database.deleteFitnessFile({ id: fitnessFileId })
  })

  it('stores an empty completed cache when there are no matching files', async () => {
    await generateFitnessRouteHeatmapJob(database, {
      id: 'job-route-heatmap-empty',
      name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
      data: {
        actorId: actor.id,
        activityType: 'swimming',
        periodType: 'monthly',
        periodKey: '2099-01'
      }
    })

    const heatmap = await database.getFitnessRouteHeatmapByKey({
      actorId: actor.id,
      activityType: 'swimming',
      periodType: 'monthly',
      periodKey: '2099-01'
    })

    expect(heatmap?.status).toBe('completed')
    expect(heatmap?.bounds).toBeUndefined()
    expect(heatmap?.segments).toEqual([])
    expect(heatmap?.activityCount).toBe(0)
    expect(heatmap?.pointCount).toBe(0)
    // No matching files -> total of 0.
    expect(heatmap?.totalCount).toBe(0)

    await database.deleteFitnessRouteHeatmapsForActor({ actorId: actor.id })
  })

  it('does not restore deleted route caches from stale queued jobs', async () => {
    await database.createFitnessRouteHeatmap({
      actorId: actor.id,
      activityType: 'stale-clear-test',
      periodType: 'monthly',
      periodKey: '2099-02'
    })
    await database.deleteFitnessRouteHeatmapsForActor({ actorId: actor.id })
    const deletedHeatmap = await database.getFitnessRouteHeatmapByKey({
      actorId: actor.id,
      activityType: 'stale-clear-test',
      periodType: 'monthly',
      periodKey: '2099-02',
      includeDeleted: true
    })

    await generateFitnessRouteHeatmapJob(database, {
      id: 'job-route-heatmap-stale-after-clear',
      name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
      data: {
        actorId: actor.id,
        activityType: 'stale-clear-test',
        periodType: 'monthly',
        periodKey: '2099-02',
        requestedAt: (deletedHeatmap?.deletedAt ?? Date.now()) - 1
      }
    })

    await expect(
      database.getFitnessRouteHeatmapByKey({
        actorId: actor.id,
        activityType: 'stale-clear-test',
        periodType: 'monthly',
        periodKey: '2099-02'
      })
    ).resolves.toBeNull()
    expect(mockGetFitnessFile).not.toHaveBeenCalled()
  })

  it('does not restore a route cache deleted after the job read it', async () => {
    await database.createFitnessRouteHeatmap({
      actorId: actor.id,
      activityType: 'delete-race-test',
      periodType: 'monthly',
      periodKey: '2099-03'
    })

    const requestedAt = Date.now() - 10_000
    const getByKey = database.getFitnessRouteHeatmapByKey.bind(database)
    const deleteAfterRead = vi
      .spyOn(database, 'getFitnessRouteHeatmapByKey')
      .mockImplementation(async (params) => {
        const heatmap = await getByKey(params)
        if (
          params.actorId === actor.id &&
          params.activityType === 'delete-race-test' &&
          params.periodType === 'monthly' &&
          params.periodKey === '2099-03'
        ) {
          await database.deleteFitnessRouteHeatmapsForActor({
            actorId: actor.id
          })
        }
        return heatmap
      })

    try {
      await generateFitnessRouteHeatmapJob(database, {
        id: 'job-route-heatmap-clear-race',
        name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
        data: {
          actorId: actor.id,
          activityType: 'delete-race-test',
          periodType: 'monthly',
          periodKey: '2099-03',
          requestedAt
        }
      })
    } finally {
      deleteAfterRead.mockRestore()
    }

    await expect(
      database.getFitnessRouteHeatmapByKey({
        actorId: actor.id,
        activityType: 'delete-race-test',
        periodType: 'monthly',
        periodKey: '2099-03'
      })
    ).resolves.toBeNull()
    expect(mockGetFitnessFile).not.toHaveBeenCalled()
  })

  it('skips failed file parses and completes from remaining route data', async () => {
    const firstId = await createCompletedFitnessFile(
      'running',
      new Date('2026-04-16T07:00:00.000Z')
    )
    const secondId = await createCompletedFitnessFile(
      'running',
      new Date('2026-04-17T07:00:00.000Z')
    )

    mockParseFitnessFile
      .mockRejectedValueOnce(new Error('corrupt fit file'))
      .mockResolvedValueOnce({
        coordinates: [
          { lat: 52.1, lng: 4.1 },
          { lat: 52.2, lng: 4.2 }
        ],
        trackPoints: [
          { lat: 52.1, lng: 4.1 },
          { lat: 52.2, lng: 4.2 }
        ],
        totalDistanceMeters: 1_250,
        totalDurationSeconds: 420,
        elevationGainMeters: 42,
        activityType: 'running',
        startTime: new Date('2026-04-17T07:00:00.000Z')
      })

    await generateFitnessRouteHeatmapJob(database, {
      id: 'job-route-heatmap-parse-failure',
      name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
      data: {
        actorId: actor.id,
        activityType: 'running',
        periodType: 'monthly',
        periodKey: '2026-04'
      }
    })

    const heatmap = await database.getFitnessRouteHeatmapByKey({
      actorId: actor.id,
      activityType: 'running',
      periodType: 'monthly',
      periodKey: '2026-04'
    })

    expect(heatmap?.status).toBe('completed')
    expect(heatmap?.activityCount).toBe(1)
    expect(heatmap?.segments).toHaveLength(1)

    await database.deleteFitnessRouteHeatmapsForActor({ actorId: actor.id })
    await database.deleteFitnessFile({ id: firstId })
    await database.deleteFitnessFile({ id: secondId })
  })

  it('splits selected regions instead of connecting excluded gaps', async () => {
    const fitnessFileId = await createCompletedFitnessFile(
      'running',
      new Date('2026-04-18T07:00:00.000Z')
    )

    mockParseFitnessFile.mockResolvedValueOnce({
      coordinates: [
        { lat: 52.36, lng: 4.88 },
        { lat: 52.37, lng: 4.89 },
        { lat: 1.3, lng: 103.8 },
        { lat: 52.38, lng: 4.9 },
        { lat: 52.39, lng: 4.91 }
      ],
      trackPoints: [
        { lat: 52.36, lng: 4.88 },
        { lat: 52.37, lng: 4.89 },
        { lat: 1.3, lng: 103.8 },
        { lat: 52.38, lng: 4.9 },
        { lat: 52.39, lng: 4.91 }
      ],
      totalDistanceMeters: 1_250,
      totalDurationSeconds: 420,
      elevationGainMeters: 42,
      activityType: 'running',
      startTime: new Date('2026-04-18T07:00:00.000Z')
    })

    await generateFitnessRouteHeatmapJob(database, {
      id: 'job-route-heatmap-region',
      name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
      data: {
        actorId: actor.id,
        activityType: 'running',
        periodType: 'monthly',
        periodKey: '2026-04',
        region: 'rect:53.00,4.00,52.00,5.00'
      }
    })

    const heatmap = await database.getFitnessRouteHeatmapByKey({
      actorId: actor.id,
      activityType: 'running',
      periodType: 'monthly',
      periodKey: '2026-04',
      region: 'rect:53.00,4.00,52.00,5.00'
    })

    expect(heatmap?.activityCount).toBe(1)
    expect(heatmap?.segments).toEqual([
      {
        points: [
          { lat: 52.36, lng: 4.88 },
          { lat: 52.37, lng: 4.89 }
        ]
      },
      {
        points: [
          { lat: 52.38, lng: 4.9 },
          { lat: 52.39, lng: 4.91 }
        ]
      }
    ])

    await database.deleteFitnessRouteHeatmapsForActor({ actorId: actor.id })
    await database.deleteFitnessFile({ id: fitnessFileId })
  })

  it('trims each activity separately when routes re-enter a privacy zone', async () => {
    const zoneCentre = { lat: 52.36, lng: 4.88 }

    // A route that starts on the zone centre, heads ~1.3km out, comes back
    // THROUGH the centre, then heads out again and finishes clear of the zone.
    const reentryRoute = (lngOffset: number) => [
      zoneCentre,
      { lat: 52.3604, lng: 4.8794 },
      { lat: 52.37, lng: 4.89 + lngOffset },
      zoneCentre,
      { lat: 52.365, lng: 4.895 + lngOffset },
      { lat: 52.375, lng: 4.885 + lngOffset }
    ]

    await database.createFitnessSettings({
      actorId: actor.id,
      serviceType: 'general',
      privacyHomeLatitude: zoneCentre.lat,
      privacyHomeLongitude: zoneCentre.lng,
      privacyHideRadiusMeters: 100
    })

    // Everything after the create runs inside the try: there can be only one
    // `general` settings row per actor and every test here shares one actor, so
    // a throw that leaked this row would fail the next test that wants its own
    // with "Fitness settings already exist" instead of its own assertion.
    let firstFileId: string
    let secondFileId: string
    let heatmap
    try {
      firstFileId = await createCompletedFitnessFile(
        'running',
        new Date('2025-02-10T07:00:00.000Z')
      )
      secondFileId = await createCompletedFitnessFile(
        'running',
        new Date('2025-02-11T07:00:00.000Z')
      )

      const activityData = (offset: number) => ({
        coordinates: reentryRoute(offset),
        trackPoints: reentryRoute(offset),
        totalDistanceMeters: 5_200,
        totalDurationSeconds: 1_500,
        elevationGainMeters: 40,
        activityType: 'running',
        startTime: new Date('2025-02-10T07:00:00.000Z')
      })
      mockParseFitnessFile
        .mockResolvedValueOnce(activityData(0))
        .mockResolvedValueOnce(activityData(0.001))

      await generateFitnessRouteHeatmapJob(database, {
        id: 'job-route-heatmap-privacy-reentry',
        name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
        data: {
          actorId: actor.id,
          activityType: 'running',
          periodType: 'monthly',
          periodKey: '2025-02'
        }
      })

      heatmap = await database.getFitnessRouteHeatmapByKey({
        actorId: actor.id,
        activityType: 'running',
        periodType: 'monthly',
        periodKey: '2025-02'
      })
    } finally {
      await database.deleteFitnessSettings({
        actorId: actor.id,
        serviceType: 'general'
      })
    }

    expect(heatmap?.activityCount).toBe(2)

    // BOTH activities are trimmed, not just the first and last of the pooled
    // point list — annotation happens per file, before cross-file accumulation.
    // A visible segment omits the flag entirely (see `routeHeatmap.ts`).
    expect(
      heatmap?.segments.map((segment) => Boolean(segment.isHiddenByPrivacy))
    ).toEqual([true, false, true, false])

    // Each visible run keeps the mid-route return to the centre rather than
    // splitting around it.
    const visibleSegments = (heatmap?.segments ?? []).filter(
      (segment) => !segment.isHiddenByPrivacy
    )
    expect(visibleSegments).toHaveLength(2)
    for (const segment of visibleSegments) {
      expect(segment.points).toContainEqual(zoneCentre)
    }

    await database.deleteFitnessRouteHeatmapsForActor({ actorId: actor.id })
    await database.deleteFitnessFile({ id: firstFileId })
    await database.deleteFitnessFile({ id: secondFileId })
  })

  it('revives a soft-deleted cache row for the same route cache key', async () => {
    const fitnessFileId = await createCompletedFitnessFile(
      'running',
      new Date('2026-05-15T07:00:00.000Z')
    )

    const job = {
      id: 'job-route-heatmap-revive',
      name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
      data: {
        actorId: actor.id,
        activityType: 'running',
        periodType: 'monthly',
        periodKey: '2026-05'
      }
    }

    await generateFitnessRouteHeatmapJob(database, job)

    const first = await database.getFitnessRouteHeatmapByKey({
      actorId: actor.id,
      activityType: 'running',
      periodType: 'monthly',
      periodKey: '2026-05'
    })
    expect(first?.status).toBe('completed')

    await database.deleteFitnessRouteHeatmapsForActor({ actorId: actor.id })
    const deleted = await database.getFitnessRouteHeatmapByKey({
      actorId: actor.id,
      activityType: 'running',
      periodType: 'monthly',
      periodKey: '2026-05',
      includeDeleted: true
    })

    await generateFitnessRouteHeatmapJob(database, {
      ...job,
      id: 'job-route-heatmap-revive-again',
      data: {
        ...job.data,
        requestedAt: (deleted?.deletedAt ?? Date.now()) + 1
      }
    })

    const revived = await database.getFitnessRouteHeatmapByKey({
      actorId: actor.id,
      activityType: 'running',
      periodType: 'monthly',
      periodKey: '2026-05'
    })

    expect(revived?.id).toBe(first?.id)
    expect(revived?.status).toBe('completed')
    expect(revived?.deletedAt).toBeUndefined()

    await database.deleteFitnessRouteHeatmapsForActor({ actorId: actor.id })
    await database.deleteFitnessFile({ id: fitnessFileId })
  })

  it('bounds accumulated route points while processing large route sets', async () => {
    const firstId = await createCompletedFitnessFile(
      'running',
      new Date('2026-06-15T07:00:00.000Z')
    )
    const secondId = await createCompletedFitnessFile(
      'running',
      new Date('2026-06-16T07:00:00.000Z')
    )
    // Straight synthetic routes: shape-preserving simplification collapses each
    // toward its endpoints (a straight line carries no road-following detail),
    // so this verifies the large-file pipeline completes with a bounded result.
    // The precise uniform cap is covered in routeHeatmap.test.ts.
    const buildCoordinates = (lngOffset: number) =>
      Array.from({ length: 45_000 }, (_value, index) => ({
        lat: 52 + index / 1_000_000,
        lng: 4 + lngOffset + index / 1_000_000
      }))
    const firstCoordinates = buildCoordinates(0)
    const secondCoordinates = buildCoordinates(1)

    mockParseFitnessFile
      .mockResolvedValueOnce({
        coordinates: firstCoordinates,
        trackPoints: firstCoordinates,
        totalDistanceMeters: 1_250,
        totalDurationSeconds: 420,
        elevationGainMeters: 42,
        activityType: 'running',
        startTime: new Date('2026-06-15T07:00:00.000Z')
      })
      .mockResolvedValueOnce({
        coordinates: secondCoordinates,
        trackPoints: secondCoordinates,
        totalDistanceMeters: 1_250,
        totalDurationSeconds: 420,
        elevationGainMeters: 42,
        activityType: 'running',
        startTime: new Date('2026-06-16T07:00:00.000Z')
      })

    await generateFitnessRouteHeatmapJob(database, {
      id: 'job-route-heatmap-large-route-set',
      name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
      data: {
        actorId: actor.id,
        activityType: 'running',
        periodType: 'monthly',
        periodKey: '2026-06'
      }
    })

    const heatmap = await database.getFitnessRouteHeatmapByKey({
      actorId: actor.id,
      activityType: 'running',
      periodType: 'monthly',
      periodKey: '2026-06'
    })

    expect(heatmap?.status).toBe('completed')
    expect(heatmap?.activityCount).toBe(2)
    // The two straight routes collapse toward their endpoints, so the stored
    // geometry is a handful of points — well under the cap.
    expect(heatmap?.pointCount).toBeGreaterThanOrEqual(2)
    expect(heatmap?.pointCount).toBeLessThan(100)
    expect(heatmap?.pointCount).toBeLessThanOrEqual(
      DEFAULT_ROUTE_HEATMAP_MAX_POINTS
    )

    await database.deleteFitnessRouteHeatmapsForActor({ actorId: actor.id })
    await database.deleteFitnessFile({ id: firstId })
    await database.deleteFitnessFile({ id: secondId })
  })

  it('stores shape-preserving geometry, dropping collinear runs but keeping corners', async () => {
    const fitnessFileId = await createCompletedFitnessFile(
      'running',
      new Date('2026-03-15T07:00:00.000Z')
    )
    // A long straight run (collinear points) into a sharp turn north. The
    // default 2 m simplification must collapse the run toward its endpoints
    // while keeping the corner, so the stored line still follows the road.
    const straightRun = Array.from({ length: 50 }, (_value, index) => ({
      lat: 52.36,
      lng: 4.88 + index * 0.0001
    }))
    const corner = { lat: 52.4, lng: straightRun[straightRun.length - 1].lng }
    const coordinates = [...straightRun, corner]

    mockParseFitnessFile.mockResolvedValueOnce({
      coordinates,
      trackPoints: coordinates,
      totalDistanceMeters: 1_250,
      totalDurationSeconds: 420,
      elevationGainMeters: 42,
      activityType: 'running',
      startTime: new Date('2026-03-15T07:00:00.000Z')
    })

    await generateFitnessRouteHeatmapJob(database, {
      id: 'job-route-heatmap-simplify',
      name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
      data: {
        actorId: actor.id,
        activityType: 'running',
        periodType: 'monthly',
        periodKey: '2026-03'
      }
    })

    const heatmap = await database.getFitnessRouteHeatmapByKey({
      actorId: actor.id,
      activityType: 'running',
      periodType: 'monthly',
      periodKey: '2026-03'
    })

    expect(heatmap?.status).toBe('completed')
    expect(heatmap?.segments).toHaveLength(1)
    const points = heatmap?.segments[0].points ?? []
    // The 51 input points collapse to a handful: the run's endpoints plus the
    // corner — far fewer than the input, but not down to a straight 2-point line.
    expect(points.length).toBeGreaterThanOrEqual(2)
    expect(points.length).toBeLessThan(10)
    // The corner latitude survives, so the rendered line keeps its turn.
    expect(points.some((point) => Math.abs(point.lat - 52.4) < 1e-6)).toBe(true)

    await database.deleteFitnessRouteHeatmapsForActor({ actorId: actor.id })
    await database.deleteFitnessFile({ id: fitnessFileId })
  })

  it('checkpoints route generation and queues a continuation before the QStash timeout', async () => {
    const firstId = await createCompletedFitnessFile(
      'running',
      new Date('2026-07-15T07:00:00.000Z')
    )
    const secondId = await createCompletedFitnessFile(
      'running',
      new Date('2026-07-16T07:00:00.000Z')
    )
    const nowSpy = vi.spyOn(Date, 'now')
    nowSpy.mockReturnValueOnce(0).mockReturnValue(25_000)

    try {
      await generateFitnessRouteHeatmapJob(database, {
        id: 'job-route-heatmap-checkpoint',
        name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
        data: {
          actorId: actor.id,
          activityType: 'running',
          periodType: 'monthly',
          periodKey: '2026-07'
        }
      })
    } finally {
      nowSpy.mockRestore()
    }

    const heatmap = await database.getFitnessRouteHeatmapByKey({
      actorId: actor.id,
      activityType: 'running',
      periodType: 'monthly',
      periodKey: '2026-07'
    })

    expect(heatmap?.status).toBe('generating')
    expect(heatmap?.activityCount).toBe(1)
    expect(heatmap?.cursorOffset).toBe(1)
    expect(heatmap?.pointCount).toBeGreaterThanOrEqual(2)
    // Total is computed up front and preserved across the checkpoint so the UI
    // can show "1 / 2 files" while the continuation finishes the rest.
    expect(heatmap?.totalCount).toBe(2)
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        id: getHashFromString(
          `job-route-heatmap-checkpoint:route-heatmap-continuation:${heatmap?.id}:1`
        ),
        name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
        data: expect.objectContaining({
          actorId: actor.id,
          activityType: 'running',
          periodType: 'monthly',
          periodKey: '2026-07',
          resume: true,
          cursorOffset: 1
        })
      })
    )

    await database.deleteFitnessRouteHeatmapsForActor({ actorId: actor.id })
    await database.deleteFitnessFile({ id: firstId })
    await database.deleteFitnessFile({ id: secondId })
  })

  it('keeps checkpointed route data at the accumulation cap instead of the final render cap', async () => {
    const firstId = await createCompletedFitnessFile(
      'running',
      new Date('2026-01-15T07:00:00.000Z')
    )
    const secondId = await createCompletedFitnessFile(
      'running',
      new Date('2026-01-16T07:00:00.000Z')
    )
    const thirdId = await createCompletedFitnessFile(
      'running',
      new Date('2026-01-17T07:00:00.000Z')
    )
    // Pre-seed a large block of already-accumulated points. Seeded checkpoint
    // data is loaded verbatim and is never re-simplified, so its size alone
    // places the checkpoint between the render cap and the accumulation cap —
    // which is exactly what the checkpoint must preserve. The shape is
    // irrelevant (it is not simplified), so a straight run keeps the fixture
    // cheap.
    const seededCoordinates = Array.from(
      { length: 100_000 },
      (_value, index) => ({
        lat: 52 + index / 1_000_000,
        lng: 4 + index / 1_000_000
      })
    )
    // The single file processed on resume is a small route; its exact size does
    // not matter (the seeded block dominates the checkpoint point count).
    const secondCoordinates = [
      { lat: 52.5, lng: 4.5 },
      { lat: 52.6, lng: 4.7 },
      { lat: 52.55, lng: 4.9 }
    ]
    const created = await database.createFitnessRouteHeatmap({
      actorId: actor.id,
      activityType: 'running',
      periodType: 'monthly',
      periodKey: '2026-01'
    })
    await database.updateFitnessRouteHeatmapStatus({
      id: created.id,
      status: 'generating',
      segments: [
        {
          points: seededCoordinates
        }
      ],
      activityCount: 1,
      pointCount: seededCoordinates.length,
      cursorOffset: 1
    })

    mockParseFitnessFile.mockResolvedValueOnce({
      coordinates: secondCoordinates,
      trackPoints: secondCoordinates,
      totalDistanceMeters: 1_250,
      totalDurationSeconds: 420,
      elevationGainMeters: 42,
      activityType: 'running',
      startTime: new Date('2026-01-16T07:00:00.000Z')
    })

    const nowSpy = vi.spyOn(Date, 'now')
    nowSpy.mockReturnValueOnce(0).mockReturnValue(25_000)

    try {
      await generateFitnessRouteHeatmapJob(database, {
        id: 'job-route-heatmap-large-checkpoint',
        name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
        data: {
          actorId: actor.id,
          activityType: 'running',
          periodType: 'monthly',
          periodKey: '2026-01',
          resume: true,
          cursorOffset: 1
        }
      })
    } finally {
      nowSpy.mockRestore()
    }

    const heatmap = await database.getFitnessRouteHeatmapByKey({
      actorId: actor.id,
      activityType: 'running',
      periodType: 'monthly',
      periodKey: '2026-01'
    })

    expect(heatmap?.status).toBe('generating')
    expect(heatmap?.activityCount).toBe(2)
    expect(heatmap?.cursorOffset).toBe(2)
    expect(heatmap?.pointCount).toBeGreaterThan(
      DEFAULT_ROUTE_HEATMAP_MAX_POINTS
    )
    expect(heatmap?.pointCount).toBeLessThanOrEqual(
      DEFAULT_ROUTE_HEATMAP_MAX_POINTS * 2
    )

    await database.deleteFitnessRouteHeatmapsForActor({ actorId: actor.id })
    await database.deleteFitnessFile({ id: firstId })
    await database.deleteFitnessFile({ id: secondId })
    await database.deleteFitnessFile({ id: thirdId })
  })

  it('retries continuation publish before failing a checkpointed job', async () => {
    const firstId = await createCompletedFitnessFile(
      'running',
      new Date('2026-09-15T07:00:00.000Z')
    )
    const secondId = await createCompletedFitnessFile(
      'running',
      new Date('2026-09-16T07:00:00.000Z')
    )
    mockPublish
      .mockRejectedValueOnce(new Error('temporary queue failure'))
      .mockRejectedValueOnce(new Error('temporary queue failure'))
      .mockResolvedValueOnce(undefined)
    const nowSpy = vi.spyOn(Date, 'now')
    nowSpy.mockReturnValueOnce(0).mockReturnValue(25_000)

    try {
      await generateFitnessRouteHeatmapJob(database, {
        id: 'job-route-heatmap-checkpoint-publish-retry',
        name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
        data: {
          actorId: actor.id,
          activityType: 'running',
          periodType: 'monthly',
          periodKey: '2026-09'
        }
      })
    } finally {
      nowSpy.mockRestore()
    }

    const heatmap = await database.getFitnessRouteHeatmapByKey({
      actorId: actor.id,
      activityType: 'running',
      periodType: 'monthly',
      periodKey: '2026-09'
    })

    expect(mockPublish).toHaveBeenCalledTimes(3)
    expect(heatmap?.status).toBe('generating')
    expect(heatmap?.cursorOffset).toBe(1)

    await database.deleteFitnessRouteHeatmapsForActor({ actorId: actor.id })
    await database.deleteFitnessFile({ id: firstId })
    await database.deleteFitnessFile({ id: secondId })
  })

  it('resumes from a checkpointed cursor and completes remaining route files', async () => {
    const firstId = await createCompletedFitnessFile(
      'running',
      new Date('2026-08-15T07:00:00.000Z')
    )
    const secondId = await createCompletedFitnessFile(
      'running',
      new Date('2026-08-16T07:00:00.000Z')
    )
    const timeoutSpy = vi.spyOn(Date, 'now')
    timeoutSpy.mockReturnValueOnce(0).mockReturnValue(25_000)

    try {
      await generateFitnessRouteHeatmapJob(database, {
        id: 'job-route-heatmap-resume',
        name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
        data: {
          actorId: actor.id,
          activityType: 'running',
          periodType: 'monthly',
          periodKey: '2026-08'
        }
      })
    } finally {
      timeoutSpy.mockRestore()
    }

    mockPublish.mockClear()
    const resumeSpy = vi.spyOn(Date, 'now').mockReturnValue(0)

    try {
      await generateFitnessRouteHeatmapJob(database, {
        id: 'job-route-heatmap-resume-continuation',
        name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
        data: {
          actorId: actor.id,
          activityType: 'running',
          periodType: 'monthly',
          periodKey: '2026-08',
          resume: true,
          cursorOffset: 1
        }
      })
    } finally {
      resumeSpy.mockRestore()
    }

    const heatmap = await database.getFitnessRouteHeatmapByKey({
      actorId: actor.id,
      activityType: 'running',
      periodType: 'monthly',
      periodKey: '2026-08'
    })

    expect(heatmap?.status).toBe('completed')
    expect(heatmap?.activityCount).toBe(2)
    expect(heatmap?.cursorOffset).toBe(0)
    expect(mockPublish).not.toHaveBeenCalled()

    await database.deleteFitnessRouteHeatmapsForActor({ actorId: actor.id })
    await database.deleteFitnessFile({ id: firstId })
    await database.deleteFitnessFile({ id: secondId })
  })

  it('skips stale continuations when the requested cursor no longer matches', async () => {
    const created = await database.createFitnessRouteHeatmap({
      actorId: actor.id,
      activityType: 'running',
      periodType: 'monthly',
      periodKey: '2026-10'
    })
    await database.updateFitnessRouteHeatmapStatus({
      id: created.id,
      status: 'generating',
      cursorOffset: 0,
      activityCount: 0,
      pointCount: 0
    })

    await generateFitnessRouteHeatmapJob(database, {
      id: 'job-route-heatmap-stale-continuation',
      name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
      data: {
        actorId: actor.id,
        activityType: 'running',
        periodType: 'monthly',
        periodKey: '2026-10',
        resume: true,
        cursorOffset: 1
      }
    })

    const heatmap = await database.getFitnessRouteHeatmapByKey({
      actorId: actor.id,
      activityType: 'running',
      periodType: 'monthly',
      periodKey: '2026-10'
    })

    expect(heatmap?.status).toBe('generating')
    expect(heatmap?.cursorOffset).toBe(0)
    expect(mockGetFitnessFile).not.toHaveBeenCalled()

    await database.deleteFitnessRouteHeatmapsForActor({ actorId: actor.id })
  })

  it('skips a resume continuation once the run has been cancelled', async () => {
    const created = await database.createFitnessRouteHeatmap({
      actorId: actor.id,
      activityType: 'running',
      periodType: 'monthly',
      periodKey: '2099-12'
    })
    // Cancelled, but with a cursor that still matches the continuation — proves
    // the non-resumable status (not just a cursor mismatch) stops it.
    await database.updateFitnessRouteHeatmapStatus({
      id: created.id,
      status: 'cancelled',
      cursorOffset: 1,
      activityCount: 0,
      pointCount: 0
    })

    await generateFitnessRouteHeatmapJob(database, {
      id: 'job-route-heatmap-cancelled-continuation',
      name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
      data: {
        actorId: actor.id,
        activityType: 'running',
        periodType: 'monthly',
        periodKey: '2099-12',
        resume: true,
        cursorOffset: 1
      }
    })

    const heatmap = await database.getFitnessRouteHeatmapByKey({
      actorId: actor.id,
      activityType: 'running',
      periodType: 'monthly',
      periodKey: '2099-12'
    })

    expect(heatmap?.status).toBe('cancelled')
    expect(mockGetFitnessFile).not.toHaveBeenCalled()
    expect(mockPublish).not.toHaveBeenCalled()

    await database.deleteFitnessRouteHeatmapsForActor({ actorId: actor.id })
  })

  it('does not resurrect a run cancelled while a pass is executing', async () => {
    const fileId = await createCompletedFitnessFile(
      'running',
      new Date('2099-06-15T07:00:00.000Z')
    )

    // Simulate a user cancelling mid-pass: cancel the row the first time a file
    // is parsed, i.e. before the job's completion write lands.
    mockParseFitnessFile.mockImplementationOnce(async () => {
      const row = await database.getFitnessRouteHeatmapByKey({
        actorId: actor.id,
        activityType: 'running',
        periodType: 'monthly',
        periodKey: '2099-06'
      })
      if (row) {
        await database.cancelFitnessRouteHeatmapGeneration({
          actorId: actor.id,
          id: row.id
        })
      }
      return {
        coordinates: [
          { lat: 52.36, lng: 4.88 },
          { lat: 52.37, lng: 4.89 }
        ],
        trackPoints: [
          { lat: 52.36, lng: 4.88 },
          { lat: 52.37, lng: 4.89 }
        ],
        totalDistanceMeters: 1_000,
        totalDurationSeconds: 300,
        elevationGainMeters: 10,
        activityType: 'running',
        startTime: new Date('2099-06-15T07:00:00.000Z')
      }
    })

    await generateFitnessRouteHeatmapJob(database, {
      id: 'job-route-heatmap-cancel-midrun',
      name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
      data: {
        actorId: actor.id,
        activityType: 'running',
        periodType: 'monthly',
        periodKey: '2099-06'
      }
    })

    const heatmap = await database.getFitnessRouteHeatmapByKey({
      actorId: actor.id,
      activityType: 'running',
      periodType: 'monthly',
      periodKey: '2099-06'
    })

    // The completion write is refused (abortIfCancelled), so the cancel sticks
    // instead of being overwritten with a completed/populated cache.
    expect(heatmap?.status).toBe('cancelled')
    expect(heatmap?.pointCount).toBe(0)
    expect(mockPublish).not.toHaveBeenCalled()

    await database.deleteFitnessRouteHeatmapsForActor({ actorId: actor.id })
    await database.deleteFitnessFile({ id: fileId })
  })

  it('skips a generation queued before a cancellation but runs a later regenerate', async () => {
    const created = await database.createFitnessRouteHeatmap({
      actorId: actor.id,
      activityType: 'running',
      periodType: 'monthly',
      periodKey: '2099-07'
    })
    await database.cancelFitnessRouteHeatmapGeneration({
      actorId: actor.id,
      id: created.id
    })
    const cancelled = await database.getFitnessRouteHeatmapByKey({
      actorId: actor.id,
      activityType: 'running',
      periodType: 'monthly',
      periodKey: '2099-07'
    })
    const cancelledAt = cancelled?.updatedAt ?? 0

    // A job requested BEFORE the cancellation is stale (e.g. an at-least-once
    // redelivery of the original job) and must not resurrect it.
    await generateFitnessRouteHeatmapJob(database, {
      id: 'job-route-heatmap-stale-precancel',
      name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
      data: {
        actorId: actor.id,
        activityType: 'running',
        periodType: 'monthly',
        periodKey: '2099-07',
        requestedAt: cancelledAt - 1_000
      }
    })
    await expect(
      database.getFitnessRouteHeatmapByKey({
        actorId: actor.id,
        activityType: 'running',
        periodType: 'monthly',
        periodKey: '2099-07'
      })
    ).resolves.toMatchObject({ status: 'cancelled' })
    expect(mockGetFitnessFile).not.toHaveBeenCalled()

    // An explicit regenerate requested AFTER the cancellation reclaims and runs.
    await generateFitnessRouteHeatmapJob(database, {
      id: 'job-route-heatmap-regen-postcancel',
      name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
      data: {
        actorId: actor.id,
        activityType: 'running',
        periodType: 'monthly',
        periodKey: '2099-07',
        requestedAt: cancelledAt + 1_000
      }
    })
    await expect(
      database.getFitnessRouteHeatmapByKey({
        actorId: actor.id,
        activityType: 'running',
        periodType: 'monthly',
        periodKey: '2099-07'
      })
    ).resolves.toMatchObject({ status: 'completed' })

    await database.deleteFitnessRouteHeatmapsForActor({ actorId: actor.id })
  })

  it('resumes failed rows that still have checkpointed progress', async () => {
    const created = await database.createFitnessRouteHeatmap({
      actorId: actor.id,
      activityType: 'running',
      periodType: 'monthly',
      periodKey: '2026-11'
    })
    await database.updateFitnessRouteHeatmapStatus({
      id: created.id,
      status: 'failed',
      segments: [
        {
          points: [
            { lat: 52.1, lng: 4.1 },
            { lat: 52.2, lng: 4.2 }
          ]
        }
      ],
      activityCount: 1,
      pointCount: 2,
      cursorOffset: 1,
      error: 'temporary queue failure'
    })

    await generateFitnessRouteHeatmapJob(database, {
      id: 'job-route-heatmap-failed-resume',
      name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
      data: {
        actorId: actor.id,
        activityType: 'running',
        periodType: 'monthly',
        periodKey: '2026-11',
        resume: true,
        cursorOffset: 1
      }
    })

    const heatmap = await database.getFitnessRouteHeatmapByKey({
      actorId: actor.id,
      activityType: 'running',
      periodType: 'monthly',
      periodKey: '2026-11'
    })

    expect(heatmap?.status).toBe('completed')
    expect(heatmap?.activityCount).toBe(1)
    expect(heatmap?.cursorOffset).toBe(0)
    expect(heatmap?.error).toBeUndefined()
    expect(heatmap?.segments).toHaveLength(1)

    await database.deleteFitnessRouteHeatmapsForActor({ actorId: actor.id })
  })

  it('resumes completed partial rows from their capped cursor', async () => {
    const firstId = await createCompletedFitnessFile(
      'running',
      new Date('2026-12-15T07:00:00.000Z')
    )
    const secondId = await createCompletedFitnessFile(
      'running',
      new Date('2026-12-16T07:00:00.000Z')
    )
    const created = await database.createFitnessRouteHeatmap({
      actorId: actor.id,
      activityType: 'running',
      periodType: 'monthly',
      periodKey: '2026-12'
    })
    await database.updateFitnessRouteHeatmapStatus({
      id: created.id,
      status: 'completed',
      segments: [
        {
          points: [
            { lat: 52.1, lng: 4.1 },
            { lat: 52.2, lng: 4.2 }
          ]
        }
      ],
      activityCount: 1,
      pointCount: 2,
      cursorOffset: 1,
      isPartial: true
    })

    await generateFitnessRouteHeatmapJob(database, {
      id: 'job-route-heatmap-partial-resume',
      name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
      data: {
        actorId: actor.id,
        activityType: 'running',
        periodType: 'monthly',
        periodKey: '2026-12',
        resume: true,
        cursorOffset: 1
      }
    })

    const heatmap = await database.getFitnessRouteHeatmapByKey({
      actorId: actor.id,
      activityType: 'running',
      periodType: 'monthly',
      periodKey: '2026-12'
    })

    expect(heatmap?.status).toBe('completed')
    expect(heatmap?.activityCount).toBe(2)
    expect(heatmap?.cursorOffset).toBe(0)
    expect(heatmap?.isPartial).toBe(false)
    expect(heatmap?.segments).toHaveLength(2)

    await database.deleteFitnessRouteHeatmapsForActor({ actorId: actor.id })
    await database.deleteFitnessFile({ id: firstId })
    await database.deleteFitnessFile({ id: secondId })
  })

  it('preserves the original failure when marking the cache as failed also fails', async () => {
    const updateFitnessRouteHeatmapStatus = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('status update failed'))
    const mockDatabase = {
      getActorFromId: vi.fn().mockResolvedValue(actor),
      getFitnessRouteHeatmapByKey: vi.fn().mockResolvedValue(null),
      countFitnessFilesByActor: vi.fn().mockResolvedValue(0),
      createFitnessRouteHeatmap: vi
        .fn()
        .mockResolvedValue({ id: 'heatmap-failed' }),
      updateFitnessRouteHeatmapStatus,
      getFitnessSettings: vi
        .fn()
        .mockRejectedValue(new Error('privacy settings failed'))
    } as unknown as Database

    await expect(
      generateFitnessRouteHeatmapJob(mockDatabase, {
        id: 'job-route-heatmap-preserve-error',
        name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
        data: {
          actorId: actor.id,
          activityType: null,
          periodType: 'yearly',
          periodKey: '2026'
        }
      })
    ).rejects.toThrow('privacy settings failed')

    expect(updateFitnessRouteHeatmapStatus).toHaveBeenLastCalledWith({
      id: 'heatmap-failed',
      status: 'failed',
      error: 'privacy settings failed',
      abortIfCancelled: true
    })
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
  describe('the tile pyramid', () => {
    // The pyramid and its tiles survive `deleteFitnessRouteHeatmapsForActor`,
    // which only soft-deletes the region rows — and every test in this file
    // shares one actor, so without this the next test inherits a completed
    // build and never claims one.
    const clearPyramid = () =>
      database.deleteFitnessRouteHeatmapPyramidAndTilesForActor({
        actorId: actor.id
      })

    // `requestedAt` is a parameter rather than a `Date.now()` in the body
    // because a test that scripts `Date.now` would otherwise have this call eat
    // the first scripted value — the one the job reads as its `startedAt`.
    const runAllTime = (
      id: string,
      extra: Record<string, unknown> = {},
      requestedAt = Date.now()
    ) =>
      generateFitnessRouteHeatmapJob(database, {
        id,
        name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
        data: {
          actorId: actor.id,
          activityType: null,
          periodType: 'all_time',
          periodKey: 'all',
          requestedAt,
          ...extra
        }
      })

    const readTiles = async () => {
      const rows = await Promise.all(
        TILE_LADDER_ZOOMS.map((z) =>
          database.getFitnessRouteHeatmapTilesInRange({
            actorId: actor.id,
            z,
            minX: 0,
            maxX: 2 ** z - 1,
            minY: 0,
            maxY: 2 ** z - 1
          })
        )
      )
      return rows.flat()
    }

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
        expect(tiles.every((tile) => tile.pointCount > 0)).toBe(true)

        const pyramid = await database.getFitnessRouteHeatmapPyramid({
          actorId: actor.id
        })
        expect(pyramid).toMatchObject({
          status: 'completed',
          activityCount: 1,
          totalCount: 1
        })
        expect(pyramid?.completedAt).toBeDefined()
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

    it('writes no tiles for a variant the pyramid does not cover', async () => {
      const fitnessFileId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-15T07:00:00.000Z')
      )

      try {
        await generateFitnessRouteHeatmapJob(database, {
          id: 'job-pyramid-wrong-variant',
          name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
          data: {
            actorId: actor.id,
            activityType: null,
            periodType: 'yearly',
            periodKey: '2026',
            requestedAt: Date.now()
          }
        })

        expect(await readTiles()).toEqual([])
        expect(
          await database.getFitnessRouteHeatmapPyramid({ actorId: actor.id })
        ).toBeNull()
      } finally {
        await database.deleteFitnessFile({ id: fitnessFileId })
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
        await runAllTime('job-pyramid-sweep-second')

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

    /**
     * Replays the continuation the job just published for itself, exactly as
     * the queue would deliver it. Hand-building the payload instead would skip
     * whatever the checkpoint chose to carry forward — including the tile
     * build's ownership token, without which the continuation reads its own
     * predecessor's fresh heartbeat as somebody else's live build.
     */
    const runPublishedContinuation = async (id: string) => {
      expect(mockPublish).toHaveBeenCalledTimes(1)
      const continuation = mockPublish.mock.calls[0][0] as {
        data: Record<string, unknown>
      }
      mockPublish.mockClear()
      await generateFitnessRouteHeatmapJob(database, {
        id,
        name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
        data: continuation.data
      })
      return continuation.data
    }

    it('keeps an edge at one visit across a checkpoint and a resume', async () => {
      // Tile counts ACCUMULATE, so a resume that re-folds an activity inflates
      // the heat permanently. The two routes are far apart and seeded straight
      // into the route cache, so which file each pass reads is not left to
      // paging order: after the resume the first pass's edges must still read
      // `count: 1`, and they must still EXIST — a resume that bumped the
      // version instead of keeping it would have them swept at completion.
      const amsterdam = [
        { lat: 52.0, lng: 4.88 },
        { lat: 52.45, lng: 4.95 }
      ]
      const singapore = [
        { lat: 1.28, lng: 103.8 },
        { lat: 1.36, lng: 103.9 }
      ]

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
        await database.upsertFitnessFileRoute({
          fitnessFileId: secondId,
          actorId: actor.id,
          points: buildFitnessFileRoutePoints(singapore),
          sourceVersion: FITNESS_FILE_ROUTE_SOURCE_VERSION
        })
        await database.upsertFitnessFileRoute({
          fitnessFileId: firstId,
          actorId: actor.id,
          points: buildFitnessFileRoutePoints(amsterdam),
          sourceVersion: FITNESS_FILE_ROUTE_SOURCE_VERSION
        })

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

    it('stops folding when the pyramid is out of step with the resumed cursor', async () => {
      // The crash window the flush ordering protects: tiles were written but
      // the pyramid's own `scannedCount` never caught up, so the resume cannot
      // place itself in that build. Rewinding `scannedCount` by hand stands in
      // for whichever way the update was lost. The resume must decline to add
      // to a build it cannot locate itself in rather than guess — the legacy
      // blob still completes, and the next full generate rebuilds under a
      // bumped version.
      const firstId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-15T07:00:00.000Z')
      )
      const secondId = await createCompletedFitnessFile(
        'running',
        new Date('2026-04-16T07:00:00.000Z')
      )

      try {
        const requestedAt = Date.now()
        const timeoutSpy = vi.spyOn(Date, 'now')
        timeoutSpy.mockReturnValueOnce(0).mockReturnValue(25_000)
        try {
          await runAllTime('job-pyramid-mismatch', {}, requestedAt)
        } finally {
          timeoutSpy.mockRestore()
        }

        const checkpointed = await database.getFitnessRouteHeatmapPyramid({
          actorId: actor.id
        })
        expect(checkpointed?.scannedCount).toBe(1)
        const tilesBefore = await readTiles()
        expect(tilesBefore.length).toBeGreaterThan(0)

        expect(
          await database.updateFitnessRouteHeatmapPyramid({
            actorId: actor.id,
            claimSeq: checkpointed!.claimSeq,
            scannedCount: 0
          })
        ).toBe(true)

        await runPublishedContinuation('job-pyramid-mismatch-continuation')

        // Tile work declined: nothing new written, nothing completed.
        const pyramid = await database.getFitnessRouteHeatmapPyramid({
          actorId: actor.id
        })
        expect(pyramid?.status).not.toBe('completed')
        expect(await readTiles()).toEqual(tilesBefore)

        // The legacy path finished regardless.
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
