import { getTestSQLDatabase } from '@/lib/database/testUtils'
import {
  GENERATE_FITNESS_HEATMAP_JOB_NAME,
  GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME
} from '@/lib/jobs/names'
import { getFitnessFile } from '@/lib/services/fitness-files'
import { parseFitnessFile } from '@/lib/services/fitness-files/parseFitnessFile'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { Actor } from '@/lib/types/domain/actor'

import { generateFitnessRouteHeatmapJob } from './generateFitnessRouteHeatmapJob'
import { JOBS } from './index'

jest.mock('@/lib/services/fitness-files', () => {
  const actual = jest.requireActual('../services/fitness-files')
  return {
    ...actual,
    getFitnessFile: jest.fn()
  }
})

jest.mock('@/lib/services/fitness-files/parseFitnessFile', () => ({
  parseFitnessFile: jest.fn(),
  isParseableFitnessFileType: jest.fn().mockReturnValue(true)
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
    jest.clearAllMocks()
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

    await database.deleteFitnessRouteHeatmapsForActor({ actorId: actor.id })
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
        region: 'netherlands'
      }
    })

    const heatmap = await database.getFitnessRouteHeatmapByKey({
      actorId: actor.id,
      activityType: 'running',
      periodType: 'monthly',
      periodKey: '2026-04',
      region: 'netherlands'
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

    await generateFitnessRouteHeatmapJob(database, {
      ...job,
      id: 'job-route-heatmap-revive-again'
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
})
