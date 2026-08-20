import { getFitnessRouteHeatmapConfig } from '@/lib/config/fitnessRouteHeatmap'
import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
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
import * as tilerModule from '@/lib/services/fitness-files/heatmapTiles/tiler'
import {
  isParseableFitnessFileType,
  parseFitnessFile
} from '@/lib/services/fitness-files/parseFitnessFile'
import { DEFAULT_ROUTE_HEATMAP_MAX_POINTS } from '@/lib/services/fitness-files/routeHeatmap'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { Actor } from '@/lib/types/domain/actor'
import { getHashFromString } from '@/lib/utils/getHashFromString'

import {
  PYRAMID_HEARTBEAT_STALE_MS,
  ROUTE_CACHE_PREFETCH_SIZE,
  ROUTE_HEATMAP_JOB_TIME_BUDGET_MS,
  TILE_FLUSH_PENDING_LIMIT,
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
const mockIsParseableFitnessFileType =
  isParseableFitnessFileType as jest.MockedFunction<
    typeof isParseableFitnessFileType
  >

describe('generateFitnessRouteHeatmapJob', () => {
  // Not `getTestSQLDatabase`: that one is SQLite-only and ignores
  // `TEST_DATABASE_TYPE`, so this suite reported a clean run under the pg
  // environment variables for three review rounds without ever opening a
  // PostgreSQL connection. Everything here drives real SQL — the claim's
  // compare-and-swap, the tiles-and-progress transaction, the fenced sweep —
  // and all of it has to agree on both backends.
  const {
    database,
    instance,
    prepare: prepareDatabase
  } = getTestDatabaseWithInstance()

  // The scan pages `ORDER BY createdAt DESC, id DESC`, and several tests here
  // depend on which fixture is scanned first. Two `createCompletedFitnessFile`
  // calls routinely land in the same millisecond on an in-memory database, and
  // the tie then breaks on a random UUID — a coin flip that was failing runs.
  // Stamping a distinct `createdAt` per fixture makes the order the tests
  // assume an actual property of the rows rather than a race they usually win.
  const FIXTURE_CREATED_AT_BASE = Date.UTC(2026, 0, 1)
  let fixtureSequence = 0
  let actor: Actor

  beforeAll(async () => {
    await prepareDatabase()
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
    mockIsParseableFitnessFileType.mockReturnValue(true)
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

    fixtureSequence += 1
    await instance('fitness_files')
      .where('id', fitnessFile!.id)
      .update({
        createdAt: new Date(FIXTURE_CREATED_AT_BASE + fixtureSequence * 1_000)
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

    // Three routes far enough apart that no two share a tile at any ladder
    // zoom, so a visit count above 1 anywhere can only mean something was
    // folded twice. Long enough to survive quantization at z4, where one pixel
    // is 9.8km.
    const AMSTERDAM = [
      { lat: 52.0, lng: 4.88 },
      { lat: 52.45, lng: 4.95 }
    ]
    const SINGAPORE = [
      { lat: 1.1, lng: 103.6 },
      { lat: 1.55, lng: 104.05 }
    ]
    const TOKYO = [
      { lat: 35.5, lng: 139.6 },
      { lat: 35.9, lng: 139.8 }
    ]

    // Seeding the route cache rather than mocking the parse keeps which file
    // gets which route independent of paging order.
    const seedRoute = (
      fitnessFileId: string,
      coordinates: Array<{ lat: number; lng: number }>
    ) =>
      database.upsertFitnessFileRoute({
        fitnessFileId,
        actorId: actor.id,
        points: buildFitnessFileRoutePoints(coordinates),
        sourceVersion: FITNESS_FILE_ROUTE_SOURCE_VERSION
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
      // Here it is the COVERAGE guard that delivers it, not the unreadable
      // counter: re-presenting a file requires an upload to have shifted the
      // offsets, and that upload raises the recount, so the build is handed
      // back rather than completed. That is why the "an earlier pass folded it"
      // arm of `foldedThisFile` was removed as inert — this test is what
      // demonstrates the outcome survives without it.
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

        const pyramid = await database.getFitnessRouteHeatmapPyramid({
          actorId: actor.id
        })
        // It completed — the recount caught up — and it holds both rides, so it
        // must not report a loss at all.
        expect(pyramid).toMatchObject({
          status: 'completed',
          error: undefined
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
