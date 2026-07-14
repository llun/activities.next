import { getTestSQLDatabase } from '@/lib/database/testUtils'
import {
  GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
  PROCESS_FITNESS_FILE_JOB_NAME,
  SEND_NOTE_JOB_NAME
} from '@/lib/jobs/names'
import { processFitnessFileJob } from '@/lib/jobs/processFitnessFileJob'
import { getFitnessFileBuffer } from '@/lib/services/fitness-files'
import { generateMapImage } from '@/lib/services/fitness-files/generateMapImage'
import type { FitnessActivityData } from '@/lib/services/fitness-files/parseFitnessFile'
import { parseFitnessFile } from '@/lib/services/fitness-files/parseFitnessFile'
import { saveMedia } from '@/lib/services/medias'
import { getQueue } from '@/lib/services/queue'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { Actor } from '@/lib/types/domain/actor'
import { StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getHashFromString } from '@/lib/utils/getHashFromString'

vi.mock('@/lib/services/queue', async () => ({
  getQueue: vi.fn().mockReturnValue({
    publish: vi.fn().mockResolvedValue(undefined)
  })
}))

vi.mock('@/lib/services/fitness-files', async () => {
  const actual = await vi.importActual('@/lib/services/fitness-files')
  return {
    ...actual,
    getFitnessFileBuffer: vi.fn()
  }
})

vi.mock('@/lib/services/fitness-files/parseFitnessFile', async () => ({
  parseFitnessFile: vi.fn(),
  isParseableFitnessFileType: vi.fn().mockReturnValue(true)
}))

vi.mock('@/lib/services/fitness-files/generateMapImage', async () => ({
  generateMapImage: vi.fn()
}))

vi.mock('@/lib/services/medias', async () => ({
  saveMedia: vi.fn()
}))

const mockGetFitnessFileBuffer = getFitnessFileBuffer as jest.MockedFunction<
  typeof getFitnessFileBuffer
>
const mockParseFitnessFile = parseFitnessFile as jest.MockedFunction<
  typeof parseFitnessFile
>
const mockGenerateMapImage = generateMapImage as jest.MockedFunction<
  typeof generateMapImage
>
const mockSaveMedia = saveMedia as jest.MockedFunction<typeof saveMedia>

describe('processFitnessFileJob', () => {
  const database = getTestSQLDatabase()
  let actor: Actor

  const defaultActivityData: FitnessActivityData = {
    coordinates: [
      { lat: 37.78, lng: -122.42 },
      { lat: 37.79, lng: -122.41 }
    ],
    trackPoints: [
      { lat: 37.78, lng: -122.42 },
      { lat: 37.79, lng: -122.41 }
    ],
    totalDistanceMeters: 5_200,
    totalDurationSeconds: 1_695,
    elevationGainMeters: 130,
    activityType: 'running',
    startTime: new Date('2026-01-05T06:00:00.000Z')
  }

  const createStatusWithFitnessFile = async ({
    text,
    fileType = 'fit'
  }: {
    text: string
    fileType?: 'fit' | 'gpx' | 'tcx'
  }) => {
    const postId = `process-${Date.now()}-${Math.random().toString(16).slice(2)}`
    const statusId = `${actor.id}/statuses/${postId}`

    await database.createNote({
      id: statusId,
      url: `https://${actor.domain}/${actor.username}/${postId}`,
      actorId: actor.id,
      text,
      summary: null,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [`${actor.id}/followers`],
      reply: ''
    })

    const fitnessFile = await database.createFitnessFile({
      actorId: actor.id,
      statusId,
      path: `fitness/${postId}.${fileType}`,
      fileName: `workout.${fileType}`,
      fileType,
      mimeType:
        fileType === 'fit'
          ? 'application/vnd.ant.fit'
          : fileType === 'gpx'
            ? 'application/gpx+xml'
            : 'application/vnd.garmin.tcx+xml',
      bytes: 4_096
    })

    expect(fitnessFile).toBeDefined()

    return { statusId, fitnessFileId: fitnessFile!.id }
  }

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

    mockGetFitnessFileBuffer.mockResolvedValue(
      Buffer.from('fitness-file-bytes')
    )

    mockParseFitnessFile.mockResolvedValue(defaultActivityData)
    mockGenerateMapImage.mockResolvedValue(Buffer.from('png-map-image'))

    mockSaveMedia.mockResolvedValue({
      id: 'generated-map-media-id',
      type: 'image',
      mime_type: 'image/webp',
      url: 'https://llun.test/api/v1/files/medias/route-map.webp',
      preview_url: null,
      text_url: null,
      remote_url: null,
      meta: {
        original: {
          width: 800,
          height: 600,
          size: '800x600',
          aspect: 1.3333333333
        }
      },
      description: 'Route map'
    })
  })

  it('processes fitness file, generates map, updates note text, and queues send job', async () => {
    const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
      text: ''
    })

    await database.createAttachment({
      actorId: actor.id,
      statusId,
      mediaType: 'image/png',
      url: 'https://llun.test/api/v1/files/medias/original-photo.png',
      width: 1024,
      height: 768,
      name: 'Original photo'
    })

    await processFitnessFileJob(database, {
      id: 'job-id-1',
      name: PROCESS_FITNESS_FILE_JOB_NAME,
      data: { actorId: actor.id, statusId, fitnessFileId }
    })

    const updatedFitnessFile = await database.getFitnessFile({
      id: fitnessFileId
    })
    expect(updatedFitnessFile).toMatchObject({
      processingStatus: 'completed',
      totalDistanceMeters: 5_200,
      totalDurationSeconds: 1_695,
      elevationGainMeters: 130,
      activityType: 'running',
      hasMapData: true,
      mapImagePath: 'medias/route-map.webp'
    })

    const status = await database.getStatus({ statusId, withReplies: false })
    expect(status?.type).toBe(StatusType.enum.Note)
    if (status?.type !== StatusType.enum.Note) {
      fail('Expected a note status')
    }

    expect(status.text).toContain('Running')
    expect(status.text).toContain('5.2')
    expect(status.attachments).toHaveLength(2)
    expect(status.attachments[0]).toMatchObject({
      name: 'Activity route map',
      url: 'https://llun.test/api/v1/files/medias/route-map.webp'
    })

    expect(getQueue().publish).toHaveBeenCalledWith({
      id: getHashFromString(`${statusId}:send-note`),
      name: SEND_NOTE_JOB_NAME,
      data: {
        actorId: actor.id,
        statusId
      }
    })

    const publishCalls = (getQueue().publish as jest.Mock).mock.calls
    const heatmapCalls = publishCalls.filter(
      ([msg]: [{ name: string }]) =>
        msg.name === GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME
    )
    // Import must not trigger heatmap regeneration — that is decoupled to the
    // explicit generate route so the memory-heavy aggregation never runs on the
    // import / Strava-webhook path.
    expect(heatmapCalls).toHaveLength(0)
  })

  it('completes without map generation when there are no GPS coordinates', async () => {
    const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
      text: 'Indoor workout summary'
    })

    mockParseFitnessFile.mockResolvedValue({
      coordinates: [],
      trackPoints: [],
      totalDistanceMeters: 0,
      totalDurationSeconds: 2_400,
      activityType: 'strength'
    })

    await processFitnessFileJob(database, {
      id: 'job-id-2',
      name: PROCESS_FITNESS_FILE_JOB_NAME,
      data: { actorId: actor.id, statusId, fitnessFileId }
    })

    const updatedFitnessFile = await database.getFitnessFile({
      id: fitnessFileId
    })
    expect(updatedFitnessFile).toMatchObject({
      processingStatus: 'completed',
      totalDistanceMeters: 0,
      totalDurationSeconds: 2_400,
      hasMapData: false
    })

    expect(mockGenerateMapImage).not.toHaveBeenCalled()
    expect(mockSaveMedia).not.toHaveBeenCalled()
    expect(getQueue().publish).toHaveBeenCalledTimes(1)
  })

  it('continues federation when map generation fails', async () => {
    const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
      text: 'Map can fail'
    })

    mockGenerateMapImage.mockRejectedValue(new Error('map rendering failed'))

    await processFitnessFileJob(database, {
      id: 'job-id-3',
      name: PROCESS_FITNESS_FILE_JOB_NAME,
      data: { actorId: actor.id, statusId, fitnessFileId }
    })

    const updatedFitnessFile = await database.getFitnessFile({
      id: fitnessFileId
    })
    expect(updatedFitnessFile).toMatchObject({
      processingStatus: 'completed',
      hasMapData: false
    })
    expect(updatedFitnessFile?.mapImagePath).toBeUndefined()

    expect(mockSaveMedia).not.toHaveBeenCalled()
    expect(getQueue().publish).toHaveBeenCalledTimes(1)
    expect(getQueue().publish).toHaveBeenCalledWith({
      id: getHashFromString(`${statusId}:send-note`),
      name: SEND_NOTE_JOB_NAME,
      data: {
        actorId: actor.id,
        statusId
      }
    })
  })

  it('filters out home-radius points before generating route map images', async () => {
    const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
      text: 'Privacy filtered route'
    })

    await database.createFitnessSettings({
      actorId: actor.id,
      serviceType: 'general',
      privacyHomeLatitude: 37.78,
      privacyHomeLongitude: -122.42,
      privacyHideRadiusMeters: 50
    })

    mockParseFitnessFile.mockResolvedValue({
      coordinates: [
        { lat: 37.78, lng: -122.42 },
        { lat: 37.7802, lng: -122.4202 },
        { lat: 37.79, lng: -122.41 },
        { lat: 37.7902, lng: -122.4098 }
      ],
      trackPoints: [
        { lat: 37.78, lng: -122.42 },
        { lat: 37.7802, lng: -122.4202 },
        { lat: 37.79, lng: -122.41 },
        { lat: 37.7902, lng: -122.4098 }
      ],
      totalDistanceMeters: 5_200,
      totalDurationSeconds: 1_695,
      elevationGainMeters: 130,
      activityType: 'running'
    })

    await processFitnessFileJob(database, {
      id: 'job-id-privacy-filter',
      name: PROCESS_FITNESS_FILE_JOB_NAME,
      data: { actorId: actor.id, statusId, fitnessFileId }
    })

    expect(mockGenerateMapImage).toHaveBeenCalledWith({
      coordinates: [
        { lat: 37.79, lng: -122.41 },
        { lat: 37.7902, lng: -122.4098 }
      ],
      routeSegments: [
        [
          { lat: 37.79, lng: -122.41 },
          { lat: 37.7902, lng: -122.4098 }
        ]
      ]
    })
  })

  it('marks processing as failed and skips federation when parsing fails', async () => {
    const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
      text: 'Will fail'
    })

    mockParseFitnessFile.mockRejectedValue(new Error('parse failure'))

    await processFitnessFileJob(database, {
      id: 'job-id-4',
      name: PROCESS_FITNESS_FILE_JOB_NAME,
      data: { actorId: actor.id, statusId, fitnessFileId }
    })

    const updatedFitnessFile = await database.getFitnessFile({
      id: fitnessFileId
    })
    expect(updatedFitnessFile?.processingStatus).toBe('failed')
    expect(getQueue().publish).not.toHaveBeenCalled()
  })

  it('records the failure reason on the fitness file when processing fails', async () => {
    const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
      text: 'Will fail'
    })

    mockParseFitnessFile.mockRejectedValue(
      new Error('Invalid TCX file structure')
    )

    await processFitnessFileJob(database, {
      id: 'job-id-failure-reason',
      name: PROCESS_FITNESS_FILE_JOB_NAME,
      data: { actorId: actor.id, statusId, fitnessFileId }
    })

    const failedFitnessFile = await database.getFitnessFile({
      id: fitnessFileId
    })
    expect(failedFitnessFile?.importError).toBe('Invalid TCX file structure')
  })

  it('clears a previous failure reason when processing succeeds on retry', async () => {
    const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
      text: 'Will fail then succeed'
    })

    mockParseFitnessFile.mockRejectedValue(new Error('transient storage error'))
    await processFitnessFileJob(database, {
      id: 'job-id-retry-failure',
      name: PROCESS_FITNESS_FILE_JOB_NAME,
      data: { actorId: actor.id, statusId, fitnessFileId }
    })
    expect(
      (await database.getFitnessFile({ id: fitnessFileId }))?.importError
    ).toBe('transient storage error')

    mockParseFitnessFile.mockResolvedValue(defaultActivityData)
    await processFitnessFileJob(database, {
      id: 'job-id-retry-success',
      name: PROCESS_FITNESS_FILE_JOB_NAME,
      data: { actorId: actor.id, statusId, fitnessFileId }
    })

    const retriedFitnessFile = await database.getFitnessFile({
      id: fitnessFileId
    })
    expect(retriedFitnessFile?.processingStatus).toBe('completed')
    expect(retriedFitnessFile?.importError).toBeUndefined()
  })

  it('skips federation publish when publishSendNote is false', async () => {
    const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
      text: ''
    })

    await processFitnessFileJob(database, {
      id: 'job-id-5',
      name: PROCESS_FITNESS_FILE_JOB_NAME,
      data: {
        actorId: actor.id,
        statusId,
        fitnessFileId,
        publishSendNote: false
      }
    })

    const updatedFitnessFile = await database.getFitnessFile({
      id: fitnessFileId
    })
    expect(updatedFitnessFile?.processingStatus).toBe('completed')

    const publishCalls = (getQueue().publish as jest.Mock).mock.calls
    const sendNoteCalls = publishCalls.filter(
      ([msg]: [{ name: string }]) => msg.name === SEND_NOTE_JOB_NAME
    )
    expect(sendNoteCalls).toHaveLength(0)

    const heatmapCalls = publishCalls.filter(
      ([msg]: [{ name: string }]) =>
        msg.name === GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME
    )
    expect(heatmapCalls).toHaveLength(0)
  })
})
