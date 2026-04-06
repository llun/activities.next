import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { GENERATE_FITNESS_HEATMAP_JOB_NAME } from '@/lib/jobs/names'
import { getFitnessFile } from '@/lib/services/fitness-files'
import { generateHeatmapImage } from '@/lib/services/fitness-files/generateHeatmapImage'
import { parseFitnessFile } from '@/lib/services/fitness-files/parseFitnessFile'
import { saveMedia } from '@/lib/services/medias'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { Actor } from '@/lib/types/domain/actor'

import { generateFitnessHeatmapJob } from './generateFitnessHeatmapJob'

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

jest.mock('@/lib/services/fitness-files/generateHeatmapImage', () => ({
  generateHeatmapImage: jest.fn()
}))

jest.mock('@/lib/services/medias', () => ({
  saveMedia: jest.fn(),
  deleteMediaFile: jest.fn().mockResolvedValue(true)
}))

const mockGetFitnessFile = getFitnessFile as jest.MockedFunction<
  typeof getFitnessFile
>
const mockParseFitnessFile = parseFitnessFile as jest.MockedFunction<
  typeof parseFitnessFile
>
const mockGenerateHeatmapImage = generateHeatmapImage as jest.MockedFunction<
  typeof generateHeatmapImage
>
const mockSaveMedia = saveMedia as jest.MockedFunction<typeof saveMedia>

describe('generateFitnessHeatmapJob', () => {
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
        { lat: 37.78, lng: -122.42 },
        { lat: 37.79, lng: -122.41 }
      ],
      trackPoints: [
        { lat: 37.78, lng: -122.42 },
        { lat: 37.79, lng: -122.41 }
      ],
      totalDistanceMeters: 1_250,
      totalDurationSeconds: 420,
      elevationGainMeters: 42,
      activityType: 'running',
      startTime: new Date('2025-06-15T07:00:00.000Z')
    })
    mockGenerateHeatmapImage.mockResolvedValue(Buffer.from('heatmap-image'))
    mockSaveMedia.mockResolvedValue({
      id: 'heatmap-media-id',
      type: 'image',
      mime_type: 'image/png',
      url: 'https://llun.test/api/v1/files/medias/heatmap.png',
      preview_url: null,
      text_url: null,
      remote_url: null,
      meta: {
        original: {
          width: 1200,
          height: 900,
          size: '1200x900',
          aspect: 1.3333333333
        }
      },
      description: 'Fitness heatmap'
    })
  })

  const createCompletedFitnessFile = async (
    activityType: string,
    activityStartTime: Date
  ) => {
    const postId = `heatmap-${Date.now()}-${Math.random().toString(16).slice(2)}`
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
      activityStartTime: activityStartTime.getTime(),
      hasMapData: true,
      mapImagePath: 'medias/test-map.webp'
    })

    return fitnessFile!.id
  }

  it('creates heatmap record and generates image successfully', async () => {
    const fitnessFileId = await createCompletedFitnessFile(
      'running',
      new Date('2025-06-15T07:00:00.000Z')
    )

    await generateFitnessHeatmapJob(database, {
      id: 'job-heatmap-success',
      name: GENERATE_FITNESS_HEATMAP_JOB_NAME,
      data: {
        actorId: actor.id,
        activityType: null,
        periodType: 'yearly',
        periodKey: '2025'
      }
    })

    const heatmap = await database.getFitnessHeatmapByKey({
      actorId: actor.id,
      activityType: null,
      periodType: 'yearly',
      periodKey: '2025'
    })

    expect(heatmap).toBeDefined()
    expect(heatmap?.status).toBe('completed')
    expect(heatmap?.imagePath).toBe('medias/heatmap.png')
    expect(heatmap?.activityCount).toBeGreaterThanOrEqual(1)
    expect(mockGenerateHeatmapImage).toHaveBeenCalled()
    expect(mockSaveMedia).toHaveBeenCalled()

    // Clean up for other tests
    await database.deleteFitnessHeatmapsForActor({ actorId: actor.id })
    await database.deleteFitnessFile({ id: fitnessFileId })
  })

  it('handles case with no matching fitness files', async () => {
    await generateFitnessHeatmapJob(database, {
      id: 'job-heatmap-no-files',
      name: GENERATE_FITNESS_HEATMAP_JOB_NAME,
      data: {
        actorId: actor.id,
        activityType: 'swimming',
        periodType: 'monthly',
        periodKey: '2099-01'
      }
    })

    const heatmap = await database.getFitnessHeatmapByKey({
      actorId: actor.id,
      activityType: 'swimming',
      periodType: 'monthly',
      periodKey: '2099-01'
    })

    expect(heatmap).toBeDefined()
    expect(heatmap?.status).toBe('completed')
    expect(heatmap?.activityCount).toBe(0)
    expect(heatmap?.imagePath).toBeUndefined()
    expect(mockGenerateHeatmapImage).not.toHaveBeenCalled()

    await database.deleteFitnessHeatmapsForActor({ actorId: actor.id })
  })

  it('handles generation failure and marks status as failed', async () => {
    const fitnessFileId = await createCompletedFitnessFile(
      'cycling',
      new Date('2025-03-10T08:00:00.000Z')
    )

    mockGenerateHeatmapImage.mockRejectedValueOnce(
      new Error('Image generation failed')
    )

    await generateFitnessHeatmapJob(database, {
      id: 'job-heatmap-fail',
      name: GENERATE_FITNESS_HEATMAP_JOB_NAME,
      data: {
        actorId: actor.id,
        activityType: null,
        periodType: 'monthly',
        periodKey: '2025-03'
      }
    })

    const heatmap = await database.getFitnessHeatmapByKey({
      actorId: actor.id,
      activityType: null,
      periodType: 'monthly',
      periodKey: '2025-03'
    })

    expect(heatmap).toBeDefined()
    expect(heatmap?.status).toBe('failed')
    expect(heatmap?.error).toBe('Image generation failed')

    await database.deleteFitnessHeatmapsForActor({ actorId: actor.id })
    await database.deleteFitnessFile({ id: fitnessFileId })
  })

  it('updates existing heatmap record on re-run', async () => {
    const fitnessFileId = await createCompletedFitnessFile(
      'running',
      new Date('2025-06-20T09:00:00.000Z')
    )

    // First run creates the heatmap
    await generateFitnessHeatmapJob(database, {
      id: 'job-heatmap-first',
      name: GENERATE_FITNESS_HEATMAP_JOB_NAME,
      data: {
        actorId: actor.id,
        activityType: null,
        periodType: 'all_time',
        periodKey: 'all'
      }
    })

    const firstHeatmap = await database.getFitnessHeatmapByKey({
      actorId: actor.id,
      activityType: null,
      periodType: 'all_time',
      periodKey: 'all'
    })
    expect(firstHeatmap).toBeDefined()
    expect(firstHeatmap?.status).toBe('completed')

    const firstId = firstHeatmap!.id

    // Second run reuses the same heatmap record
    await generateFitnessHeatmapJob(database, {
      id: 'job-heatmap-second',
      name: GENERATE_FITNESS_HEATMAP_JOB_NAME,
      data: {
        actorId: actor.id,
        activityType: null,
        periodType: 'all_time',
        periodKey: 'all'
      }
    })

    const secondHeatmap = await database.getFitnessHeatmapByKey({
      actorId: actor.id,
      activityType: null,
      periodType: 'all_time',
      periodKey: 'all'
    })
    expect(secondHeatmap).toBeDefined()
    expect(secondHeatmap?.id).toBe(firstId)
    expect(secondHeatmap?.status).toBe('completed')

    await database.deleteFitnessHeatmapsForActor({ actorId: actor.id })
    await database.deleteFitnessFile({ id: fitnessFileId })
  })

  it('filters by activity type when specified', async () => {
    const runningFileId = await createCompletedFitnessFile(
      'running',
      new Date('2025-06-15T07:00:00.000Z')
    )
    const cyclingFileId = await createCompletedFitnessFile(
      'cycling',
      new Date('2025-06-16T08:00:00.000Z')
    )

    await generateFitnessHeatmapJob(database, {
      id: 'job-heatmap-filtered',
      name: GENERATE_FITNESS_HEATMAP_JOB_NAME,
      data: {
        actorId: actor.id,
        activityType: 'running',
        periodType: 'yearly',
        periodKey: '2025'
      }
    })

    const heatmap = await database.getFitnessHeatmapByKey({
      actorId: actor.id,
      activityType: 'running',
      periodType: 'yearly',
      periodKey: '2025'
    })

    expect(heatmap).toBeDefined()
    expect(heatmap?.status).toBe('completed')
    expect(heatmap?.activityCount).toBe(1)
    // Only the running file should be counted, not cycling
    expect(mockGenerateHeatmapImage).toHaveBeenCalled()

    await database.deleteFitnessHeatmapsForActor({ actorId: actor.id })
    await database.deleteFitnessFile({ id: runningFileId })
    await database.deleteFitnessFile({ id: cyclingFileId })
  })
})
