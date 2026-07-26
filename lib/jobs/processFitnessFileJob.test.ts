import { getConfig } from '@/lib/config'
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
import {
  deleteMediaFile,
  saveMedia,
  saveMediaImageRendition
} from '@/lib/services/medias'
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
  saveMedia: vi.fn(),
  saveMediaImageRendition: vi.fn(),
  deleteMediaFile: vi.fn()
}))

const mockSendNotificationAlerts = vi.fn()
vi.mock('@/lib/services/notifications/sendNotificationAlerts', () => ({
  sendNotificationAlerts: (...args: unknown[]) =>
    mockSendNotificationAlerts(...args)
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
const mockSaveMediaImageRendition =
  saveMediaImageRendition as jest.MockedFunction<typeof saveMediaImageRendition>
const mockDeleteMediaFile = deleteMediaFile as jest.MockedFunction<
  typeof deleteMediaFile
>

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

    mockDeleteMediaFile.mockResolvedValue(true)

    mockSaveMediaImageRendition.mockResolvedValue({
      path: 'medias/route-map.jpg',
      url: 'https://llun.test/api/v1/files/medias/route-map.jpg',
      bytes: 51_895,
      mimeType: 'image/jpeg',
      metaData: { width: 800, height: 600 }
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

  it('records a reason even when the thrown value is not an Error', async () => {
    const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
      text: 'Will reject with a non-Error'
    })

    // A thrown string/SDK object has no `.message`; without a guard the reason
    // is written as undefined, leaving the row `failed` with no explanation (or
    // a stale one from an earlier failure).
    mockParseFitnessFile.mockRejectedValue('socket hang up')

    await processFitnessFileJob(database, {
      id: 'job-id-non-error',
      name: PROCESS_FITNESS_FILE_JOB_NAME,
      data: { actorId: actor.id, statusId, fitnessFileId }
    })

    const failedFitnessFile = await database.getFitnessFile({
      id: fitnessFileId
    })
    expect(failedFitnessFile?.processingStatus).toBe('failed')
    expect(failedFitnessFile?.importError).toBe('socket hang up')
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

  describe('import notification', () => {
    // An earlier test in this file leaves general fitness privacy settings on
    // the actor that hide a 50m radius around the default route's first point.
    // That trims the default route to a single visible point, so it produces no
    // map at all — use a route well clear of the hidden radius wherever the map
    // matters.
    const visibleRouteCoordinates = [
      { lat: 51.5007, lng: -0.1246 },
      { lat: 51.5033, lng: -0.1195 }
    ]

    const arrangeRouteWithMap = () =>
      mockParseFitnessFile.mockResolvedValue({
        ...defaultActivityData,
        coordinates: visibleRouteCoordinates,
        trackPoints: visibleRouteCoordinates
      })

    it('tells the actor when a first import completes', async () => {
      const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
        text: 'Morning run'
      })

      await processFitnessFileJob(database, {
        id: 'job-notify',
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: {
          actorId: actor.id,
          statusId,
          fitnessFileId,
          notifyOnComplete: true
        }
      })

      expect(mockSendNotificationAlerts).toHaveBeenCalledTimes(1)
      const call = mockSendNotificationAlerts.mock.calls[0][0]
      expect(call.actorId).toBe(actor.id)
      expect(call.events[0].type).toBe('activity_import')

      // The whole point of this PR: the email actually goes out, and it goes
      // out from here — after the map and the parsed stats exist — rather than
      // where the import was enqueued.
      const emailContent = call.events[0].emailContent
      expect(emailContent.recipientEmail).toBe(actor.account?.email)
      expect(emailContent.subject).toContain(
        'Your fitness activity was imported'
      )
      expect(emailContent.html).toContain('>View status</a>')
      expect(emailContent.html.toLowerCase()).not.toContain('strava')
    })

    it('points the email at a jpeg copy of the map, not the stored webp', async () => {
      const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
        text: 'Morning run'
      })
      arrangeRouteWithMap()

      await processFitnessFileJob(database, {
        id: 'job-notify-jpeg',
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: {
          actorId: actor.id,
          statusId,
          fitnessFileId,
          notifyOnComplete: true
        }
      })

      // The copy is made from the same map buffer, as a JPEG.
      expect(mockSaveMediaImageRendition).toHaveBeenCalledTimes(1)
      const [, , renditionFile, renditionFormat] =
        mockSaveMediaImageRendition.mock.calls[0]
      expect(renditionFormat).toBe('jpeg')
      expect(await renditionFile.text()).toBe('png-map-image')

      const updatedFitnessFile = await database.getFitnessFile({
        id: fitnessFileId
      })
      expect(updatedFitnessFile).toMatchObject({
        mapImagePath: 'medias/route-map.webp',
        mapImageEmailPath: 'medias/route-map.jpg'
      })

      // Outlook desktop and Windows Mail have no WebP decoder, so the email
      // must reference the JPEG even though the post keeps the WebP.
      const { html, text } =
        mockSendNotificationAlerts.mock.calls[0][0].events[0].emailContent
      expect(html).toContain(
        '<img src="https://llun.test/api/v1/files/medias/route-map.jpg"'
      )
      expect(html).not.toContain('route-map.webp')
      expect(text).not.toContain('route-map.webp')

      // The status itself is unchanged: the JPEG is not attached and does not
      // federate.
      const status = await database.getStatus({ statusId, withReplies: false })
      expect(status?.type).toBe(StatusType.enum.Note)
      if (status?.type !== StatusType.enum.Note) fail('Expected a note status')
      expect(status.attachments).toHaveLength(1)
      expect(status.attachments[0]).toMatchObject({
        name: 'Activity route map',
        url: 'https://llun.test/api/v1/files/medias/route-map.webp'
      })
    })

    it.each([
      {
        description: 'falls back to the webp when no jpeg copy is stored',
        arrange: () => mockSaveMediaImageRendition.mockResolvedValue(null)
      },
      {
        description: 'falls back to the webp when storing the copy throws',
        arrange: () =>
          mockSaveMediaImageRendition.mockRejectedValue(
            new Error('storage unavailable')
          )
      }
    ])('$description', async ({ arrange }) => {
      const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
        text: 'Morning run'
      })
      arrangeRouteWithMap()
      arrange()

      await processFitnessFileJob(database, {
        id: 'job-notify-fallback',
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: {
          actorId: actor.id,
          statusId,
          fitnessFileId,
          notifyOnComplete: true
        }
      })

      const updatedFitnessFile = await database.getFitnessFile({
        id: fitnessFileId
      })
      // The import still completes with its map — only the email degrades.
      expect(updatedFitnessFile).toMatchObject({
        processingStatus: 'completed',
        hasMapData: true,
        mapImagePath: 'medias/route-map.webp'
      })
      expect(updatedFitnessFile?.mapImageEmailPath).toBeUndefined()

      const { html } =
        mockSendNotificationAlerts.mock.calls[0][0].events[0].emailContent
      expect(html).toContain(
        '<img src="https://llun.test/api/v1/files/medias/route-map.webp"'
      )
    })

    it('deletes a stale jpeg copy when the activity is reprocessed', async () => {
      const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
        text: 'Morning run'
      })
      arrangeRouteWithMap()

      // First run: an unattended import that emails the owner and stores a copy.
      await processFitnessFileJob(database, {
        id: 'job-reprocess-first',
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: {
          actorId: actor.id,
          statusId,
          fitnessFileId,
          notifyOnComplete: true
        }
      })
      expect(
        (await database.getFitnessFile({ id: fitnessFileId }))
          ?.mapImageEmailPath
      ).toBe('medias/route-map.jpg')

      mockDeleteMediaFile.mockClear()
      arrangeRouteWithMap()

      // A retry or a recovery script reprocesses with notifyOnComplete false, so
      // nothing rewrites the column. Without deleting the file it is orphaned —
      // and if the owner added a privacy location first, the old UNFILTERED
      // route would stay fetchable at its unchanged URL.
      await processFitnessFileJob(database, {
        id: 'job-reprocess-retry',
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: { actorId: actor.id, statusId, fitnessFileId }
      })

      expect(mockDeleteMediaFile).toHaveBeenCalledWith(
        database,
        'medias/route-map.jpg'
      )
      const reprocessed = await database.getFitnessFile({ id: fitnessFileId })
      expect(reprocessed?.mapImageEmailPath).toBeUndefined()
    })

    it('stores no jpeg copy when the instance sends no email', async () => {
      const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
        text: 'Morning run'
      })
      arrangeRouteWithMap()

      const config = getConfig()
      vi.mocked(getConfig).mockReturnValue({
        ...config,
        email: undefined
      } as unknown as ReturnType<typeof getConfig>)

      try {
        await processFitnessFileJob(database, {
          id: 'job-notify-no-email-config',
          name: PROCESS_FITNESS_FILE_JOB_NAME,
          data: {
            actorId: actor.id,
            statusId,
            fitnessFileId,
            notifyOnComplete: true
          }
        })
      } finally {
        vi.mocked(getConfig).mockReturnValue(config)
      }

      // Nothing would ever fetch it, so it must not be written.
      expect(mockSaveMediaImageRendition).not.toHaveBeenCalled()
      const updatedFitnessFile = await database.getFitnessFile({
        id: fitnessFileId
      })
      expect(updatedFitnessFile?.mapImagePath).toBe('medias/route-map.webp')
      expect(updatedFitnessFile?.mapImageEmailPath).toBeUndefined()
    })

    it('stores no jpeg copy when no email is going out', async () => {
      const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
        text: 'Morning run'
      })
      arrangeRouteWithMap()

      await processFitnessFileJob(database, {
        id: 'job-no-notify-no-copy',
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: { actorId: actor.id, statusId, fitnessFileId }
      })

      // A direct upload notifies nobody, so a JPEG copy would be storage spent
      // on an image no one would ever fetch.
      expect(mockSaveMediaImageRendition).not.toHaveBeenCalled()
      const updatedFitnessFile = await database.getFitnessFile({
        id: fitnessFileId
      })
      expect(updatedFitnessFile?.mapImagePath).toBe('medias/route-map.webp')
      expect(updatedFitnessFile?.mapImageEmailPath).toBeUndefined()
    })

    it('stays silent when the run is a reprocess rather than a first import', async () => {
      const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
        text: 'Morning run'
      })

      // notifyOnComplete defaults to false, which is what a retry, a backfill
      // script and a direct upload all get.
      await processFitnessFileJob(database, {
        id: 'job-no-notify',
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: { actorId: actor.id, statusId, fitnessFileId }
      })

      expect(mockSendNotificationAlerts).not.toHaveBeenCalled()
    })
  })
})
