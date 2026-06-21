import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import {
  GENERATE_FITNESS_HEATMAP_JOB_NAME,
  GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME
} from '@/lib/jobs/names'
import { getFitnessFile } from '@/lib/services/fitness-files'
import { parseFitnessFile } from '@/lib/services/fitness-files/parseFitnessFile'
import { DEFAULT_ROUTE_HEATMAP_MAX_POINTS } from '@/lib/services/fitness-files/routeHeatmap'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { Actor } from '@/lib/types/domain/actor'
import { getHashFromString } from '@/lib/utils/getHashFromString'

import { generateFitnessRouteHeatmapJob } from './generateFitnessRouteHeatmapJob'
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
    expect(heatmap?.pointCount).toBeLessThanOrEqual(
      DEFAULT_ROUTE_HEATMAP_MAX_POINTS
    )

    await database.deleteFitnessRouteHeatmapsForActor({ actorId: actor.id })
    await database.deleteFitnessFile({ id: firstId })
    await database.deleteFitnessFile({ id: secondId })
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
    const buildCoordinates = (lngOffset: number) =>
      Array.from({ length: 60_000 }, (_value, index) => ({
        lat: 52 + index / 1_000_000,
        lng: 4 + lngOffset + index / 1_000_000
      }))
    const firstCoordinates = buildCoordinates(0)
    const secondCoordinates = buildCoordinates(1)
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
          points: firstCoordinates
        }
      ],
      activityCount: 1,
      pointCount: firstCoordinates.length,
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
      error: 'privacy settings failed'
    })
  })
})
