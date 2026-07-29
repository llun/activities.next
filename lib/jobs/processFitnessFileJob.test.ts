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
import { isRetriableFitnessFile } from '@/lib/services/fitness-files/retryImports'
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
import { logger } from '@/lib/utils/logger'

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

  describe('route map failures', () => {
    // A route entirely clear of any privacy radius. Later tests in this file
    // leave general fitness settings on the shared actor that hide 50m around
    // the default route's first point, which would trim it to a single visible
    // point and skip map generation altogether — every assertion here would
    // then pass vacuously, whatever the source did. Not order-dependent.
    const visibleRouteCoordinates = [
      { lat: 51.5007, lng: -0.1246 },
      { lat: 51.5033, lng: -0.1195 }
    ]

    beforeEach(() => {
      mockParseFitnessFile.mockResolvedValue({
        ...defaultActivityData,
        coordinates: visibleRouteCoordinates,
        trackPoints: visibleRouteCoordinates
      })
    })

    // Real media rows with distinct paths, as production produces: `saveMedia`
    // is mocked, so its stub id resolves to nothing and the cleanup's media
    // lookup would find nothing to delete.
    const storeMapMedia = async (path: string) => {
      const media = await database.createMedia({
        actorId: actor.id,
        original: {
          path,
          bytes: 1_400,
          mimeType: 'image/webp',
          metaData: { width: 800, height: 600 }
        }
      })
      return {
        id: String(media!.id),
        type: 'image' as const,
        mime_type: 'image/webp',
        url: `https://llun.test/api/v1/files/${path}`,
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
      }
    }

    // A map failure is a degraded success, not a dead import: the activity
    // arrived, so the file stays `completed` — anything else hides a good
    // activity behind every `completed` gate — and the post keeps its summary
    // text, its stats and its federation. What must never happen is the failure
    // passing silently, so the reason lands in `mapError`.
    it.each([
      {
        description: 'records the reason when map rendering throws',
        arrange: () =>
          mockGenerateMapImage.mockRejectedValue(
            new Error('map rendering failed')
          ),
        expectedError: 'map rendering failed',
        expectMediaStored: false
      },
      {
        description: 'records the reason when the renderer produces no image',
        arrange: () => mockGenerateMapImage.mockResolvedValue(null),
        expectedError: 'Generated map image buffer is empty',
        expectMediaStored: false
      },
      {
        description: 'records the reason when storing the map image fails',
        arrange: () => mockSaveMedia.mockResolvedValue(null),
        expectedError: 'Failed to store generated route map image',
        expectMediaStored: true
      },
      {
        description: 'records the reason when attaching the map fails',
        arrange: () =>
          vi
            .spyOn(database, 'createAttachment')
            .mockRejectedValueOnce(new Error('attachment write failed')),
        expectedError: 'attachment write failed',
        expectMediaStored: true
      }
    ])(
      '$description',
      async ({ arrange, expectedError, expectMediaStored }) => {
        const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
          text: ''
        })
        arrange()

        await processFitnessFileJob(database, {
          id: `job-map-failure-${expectedError}`,
          name: PROCESS_FITNESS_FILE_JOB_NAME,
          data: { actorId: actor.id, statusId, fitnessFileId }
        })

        const updatedFitnessFile = await database.getFitnessFile({
          id: fitnessFileId
        })
        expect(updatedFitnessFile).toMatchObject({
          // `completed`, NOT `failed`: that flag gates the detail dashboard,
          // the post's stat grid, the fitness overview, the profile's Fitness
          // tab and every stats/heatmap rollup, and this activity is fine.
          processingStatus: 'completed',
          mapError: expectedError,
          hasMapData: false,
          // The parsed activity survives the map failure.
          totalDistanceMeters: 5_200,
          activityType: 'running'
        })
        expect(updatedFitnessFile?.mapImagePath).toBeUndefined()
        // The reason is a map reason — the import itself did not fail.
        expect(updatedFitnessFile?.importError).toBeUndefined()
        // Nothing here is the whole-file failure the batch retry re-imports.
        expect(isRetriableFitnessFile(updatedFitnessFile!)).toBe(false)

        // Proves the map path actually ran rather than being skipped.
        expect(mockGenerateMapImage).toHaveBeenCalledTimes(1)
        expect(mockSaveMedia).toHaveBeenCalledTimes(expectMediaStored ? 1 : 0)

        const status = await database.getStatus({
          statusId,
          withReplies: false
        })
        if (status?.type !== StatusType.enum.Note)
          fail('Expected a note status')
        expect(status.text).toContain('Running')
        expect(status.attachments).toHaveLength(0)

        // Exactly one publish: the note still federates, and the import must
        // not queue heatmap regeneration on the failure path either.
        expect(getQueue().publish).toHaveBeenCalledTimes(1)
        expect(getQueue().publish).toHaveBeenCalledWith({
          id: getHashFromString(`${statusId}:send-note`),
          name: SEND_NOTE_JOB_NAME,
          data: {
            actorId: actor.id,
            statusId
          }
        })
      }
    )

    it('reports the failure with a real error object for error reporting', async () => {
      const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
        text: ''
      })
      const loggerError = vi.spyOn(logger, 'error')
      // A thrown non-Error still has to arrive as an Error, or the logger's
      // formatter has no `err.stack` to emit as `stack_trace`.
      mockGenerateMapImage.mockRejectedValue('socket hang up')

      await processFitnessFileJob(database, {
        id: 'job-map-failure-logging',
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: { actorId: actor.id, statusId, fitnessFileId }
      })

      expect(loggerError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Failed to generate route map for fitness activity',
          fitnessFileId,
          error: 'socket hang up',
          err: expect.any(Error)
        })
      )
      expect(
        (await database.getFitnessFile({ id: fitnessFileId }))?.mapError
      ).toBe('socket hang up')
    })

    it('still tells the actor the activity arrived, without a map image', async () => {
      const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
        text: 'Morning run'
      })

      mockGenerateMapImage.mockRejectedValue(new Error('map rendering failed'))

      await processFitnessFileJob(database, {
        id: 'job-map-failure-notify',
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: {
          actorId: actor.id,
          statusId,
          fitnessFileId,
          notifyOnComplete: true
        }
      })

      // Guards against the map block being skipped, which would make every
      // assertion below vacuous.
      expect(
        (await database.getFitnessFile({ id: fitnessFileId }))?.mapError
      ).toBe('map rendering failed')

      // The activity DID arrive — only its map is missing — so the import
      // notification still fires, unlike a processing failure that leaves no
      // post worth announcing.
      expect(mockSendNotificationAlerts).toHaveBeenCalledTimes(1)
      const { html } =
        mockSendNotificationAlerts.mock.calls[0][0].events[0].emailContent
      expect(html).not.toContain('route-map')
      // No map means nothing to make a JPEG copy of.
      expect(mockSaveMediaImageRendition).not.toHaveBeenCalled()
    })

    it('clears the map failure when a retry succeeds', async () => {
      const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
        text: 'Morning run'
      })

      mockGenerateMapImage.mockRejectedValue(new Error('tile server down'))
      await processFitnessFileJob(database, {
        id: 'job-map-failure-first',
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: { actorId: actor.id, statusId, fitnessFileId }
      })
      expect(
        (await database.getFitnessFile({ id: fitnessFileId }))?.mapError
      ).toBe('tile server down')

      mockGenerateMapImage.mockResolvedValue(Buffer.from('png-map-image'))
      await processFitnessFileJob(database, {
        id: 'job-map-failure-retry',
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: { actorId: actor.id, statusId, fitnessFileId }
      })

      const retriedFitnessFile = await database.getFitnessFile({
        id: fitnessFileId
      })
      expect(retriedFitnessFile).toMatchObject({
        processingStatus: 'completed',
        hasMapData: true,
        mapImagePath: 'medias/route-map.webp'
      })
      expect(retriedFitnessFile?.mapError).toBeUndefined()
    })

    it('keeps the map it already had when the reprocess fails to make a new one', async () => {
      const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
        text: 'Morning run'
      })

      await processFitnessFileJob(database, {
        id: 'job-map-keep-first',
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: { actorId: actor.id, statusId, fitnessFileId }
      })

      mockDeleteMediaFile.mockClear()
      mockGenerateMapImage.mockRejectedValue(new Error('tile server down'))
      await processFitnessFileJob(database, {
        id: 'job-map-keep-retry',
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: { actorId: actor.id, statusId, fitnessFileId }
      })

      // Removing the old map before producing a replacement would turn a failed
      // retry into data loss — during an outage the owner would end up with no
      // map at all, having started with one.
      const refreshed = await database.getFitnessFile({ id: fitnessFileId })
      expect(refreshed).toMatchObject({
        processingStatus: 'completed',
        hasMapData: true,
        mapImagePath: 'medias/route-map.webp',
        mapError: 'tile server down'
      })
      expect(mockDeleteMediaFile).not.toHaveBeenCalled()

      const status = await database.getStatus({ statusId, withReplies: false })
      if (status?.type !== StatusType.enum.Note) fail('Expected a note status')
      expect(status.attachments).toHaveLength(1)
    })

    it('replaces the previous map instead of attaching a second one', async () => {
      const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
        text: 'Morning run'
      })

      const firstMap = await storeMapMedia('medias/route-map-first.webp')
      const secondMap = await storeMapMedia('medias/route-map-second.webp')
      mockSaveMedia
        .mockResolvedValueOnce(firstMap)
        .mockResolvedValueOnce(secondMap)

      await processFitnessFileJob(database, {
        id: 'job-map-replace-first',
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: { actorId: actor.id, statusId, fitnessFileId }
      })

      mockDeleteMediaFile.mockClear()
      await processFitnessFileJob(database, {
        id: 'job-map-replace-second',
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: { actorId: actor.id, statusId, fitnessFileId }
      })

      // Without cleanup the reprocess appends a second attachment and the post
      // renders the same route twice — the stale one from an image no column
      // points at any more (and, after a privacy change, an unfiltered route).
      const status = await database.getStatus({ statusId, withReplies: false })
      if (status?.type !== StatusType.enum.Note) fail('Expected a note status')
      expect(status.attachments).toHaveLength(1)
      expect(status.attachments[0].url).toContain('route-map-second.webp')

      // The bytes and the media row go too, or every reprocess leaks a file
      // that no cleanup pass can attribute to anything.
      expect(mockDeleteMediaFile).toHaveBeenCalledWith(
        database,
        'medias/route-map-first.webp'
      )
      expect(
        await database.getMediaByIdForAccount({
          mediaId: firstMap.id,
          accountId: actor.account!.id
        })
      ).toBeNull()
    })

    it('keeps a live activity completed when a map retry fails again', async () => {
      const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
        text: 'Morning run'
      })

      await processFitnessFileJob(database, {
        id: 'job-retry-preserve-first',
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: { actorId: actor.id, statusId, fitnessFileId }
      })

      // The retry endpoint's shape: the activity is live, only its map failed,
      // and this run dies before it ever reaches the map — a storage blip.
      mockGetFitnessFileBuffer.mockRejectedValue(new Error('storage timeout'))
      await processFitnessFileJob(database, {
        id: 'job-retry-preserve-second',
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: {
          actorId: actor.id,
          statusId,
          fitnessFileId,
          publishSendNote: false,
          retryingMapFailure: true
        }
      })

      // `failed` would hide a fully imported, federated activity behind every
      // surface gated on `completed` — over a transient storage error.
      const refreshed = await database.getFitnessFile({ id: fitnessFileId })
      expect(refreshed).toMatchObject({
        processingStatus: 'completed',
        mapError: 'storage timeout'
      })
      expect(refreshed?.importError).toBeUndefined()
    })

    it('keeps the map pointer when a privacy-hidden route cannot be removed', async () => {
      const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
        text: 'Morning run'
      })
      mockSaveMedia.mockResolvedValueOnce(
        await storeMapMedia('medias/privacy-1.webp')
      )

      await processFitnessFileJob(database, {
        id: 'job-privacy-pointer-first',
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: { actorId: actor.id, statusId, fitnessFileId }
      })

      // The whole route is now hidden, so the existing map has to go — and it
      // is the one showing the route the owner just hid.
      mockParseFitnessFile.mockResolvedValue({
        ...defaultActivityData,
        coordinates: [],
        trackPoints: []
      })
      vi.spyOn(database, 'deleteAttachmentsByIds').mockRejectedValueOnce(
        new Error('attachment delete failed')
      )
      await processFitnessFileJob(database, {
        id: 'job-privacy-pointer-second',
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: { actorId: actor.id, statusId, fitnessFileId }
      })

      // Nulling the pointer while the attachment survives would leave that
      // route on a public post with nothing able to find it again — and unlike
      // a failed replacement, a retry here re-attempts exactly this removal, so
      // the owner is offered one.
      const refreshed = await database.getFitnessFile({ id: fitnessFileId })
      expect(refreshed).toMatchObject({
        processingStatus: 'completed',
        mapImagePath: 'medias/privacy-1.webp',
        mapError: 'Failed to remove the route map'
      })

      // And the next run does remove it.
      await processFitnessFileJob(database, {
        id: 'job-privacy-pointer-third',
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: { actorId: actor.id, statusId, fitnessFileId }
      })
      const status = await database.getStatus({ statusId, withReplies: false })
      if (status?.type !== StatusType.enum.Note) fail('Expected a note status')
      expect(status.attachments).toHaveLength(0)
      expect(
        (await database.getFitnessFile({ id: fitnessFileId }))?.mapImagePath
      ).toBeUndefined()
    })

    it('keeps the activity intact when the previous map cannot be removed', async () => {
      const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
        text: 'Morning run'
      })
      mockSaveMedia
        .mockResolvedValueOnce(await storeMapMedia('medias/cleanup-1.webp'))
        .mockResolvedValueOnce(await storeMapMedia('medias/cleanup-2.webp'))

      await processFitnessFileJob(database, {
        id: 'job-map-cleanup-first',
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: { actorId: actor.id, statusId, fitnessFileId }
      })

      vi.spyOn(database, 'deleteAttachmentsByIds').mockRejectedValueOnce(
        new Error('attachment delete failed')
      )
      await processFitnessFileJob(database, {
        id: 'job-map-cleanup-second',
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: { actorId: actor.id, statusId, fitnessFileId }
      })

      // The replacement is stored and attached by the time the cleanup runs, so
      // a failure there costs a stale attachment and nothing else: it must not
      // read as a map failure (the map exists) nor as an activity failure.
      const refreshed = await database.getFitnessFile({ id: fitnessFileId })
      expect(refreshed).toMatchObject({
        processingStatus: 'completed',
        hasMapData: true,
        mapImagePath: 'medias/cleanup-2.webp'
      })
      expect(refreshed?.mapError).toBeUndefined()
    })

    it('leaves another fitness file’s map on the same status alone', async () => {
      const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
        text: 'Merged same-ride post'
      })

      // A merged same-ride post: the other device has its own fitness file, and
      // that file claims its own map on the same status. Reprocessing this file
      // must not touch it.
      const otherMedia = await database.createMedia({
        actorId: actor.id,
        original: {
          path: 'medias/other-device-route-map.webp',
          bytes: 1_400,
          mimeType: 'image/webp',
          metaData: { width: 800, height: 600 }
        }
      })
      await database.createAttachment({
        actorId: actor.id,
        statusId,
        mediaType: 'image/webp',
        url: `https://llun.test/api/v1/files/${otherMedia!.original.path}`,
        width: 800,
        height: 600,
        name: 'Activity route map',
        mediaId: otherMedia!.id
      })
      const otherFitnessFile = await database.createFitnessFile({
        actorId: actor.id,
        statusId,
        path: 'fitness/other-device.fit',
        fileName: 'other-device.fit',
        fileType: 'fit',
        mimeType: 'application/vnd.ant.fit',
        bytes: 4_096
      })
      await database.updateFitnessFileActivityData(otherFitnessFile!.id, {
        hasMapData: true,
        mapImagePath: otherMedia!.original.path
      })

      mockSaveMedia
        .mockResolvedValueOnce(await storeMapMedia('medias/merged-1.webp'))
        .mockResolvedValueOnce(await storeMapMedia('medias/merged-2.webp'))

      await processFitnessFileJob(database, {
        id: 'job-map-other-file-first',
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: { actorId: actor.id, statusId, fitnessFileId }
      })
      await processFitnessFileJob(database, {
        id: 'job-map-other-file-second',
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: { actorId: actor.id, statusId, fitnessFileId }
      })

      // Matching on this file's own recorded path is what keeps the other
      // file's map out of the cleanup, even though both are named the same.
      const status = await database.getStatus({ statusId, withReplies: false })
      if (status?.type !== StatusType.enum.Note) fail('Expected a note status')
      expect(
        status.attachments.some((attachment) =>
          attachment.url.includes('other-device-route-map.webp')
        )
      ).toBe(true)
      expect(
        await database.getMediaByIdForAccount({
          mediaId: String(otherMedia!.id),
          accountId: actor.account!.id
        })
      ).toBeTruthy()
      expect(status.attachments[0]).toMatchObject({
        name: 'Activity route map'
      })
    })
  })

  it('filters out home-radius points before generating route map images', async () => {
    const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
      text: 'Privacy filtered route'
    })

    const settings = await database.createFitnessSettings({
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

    try {
      await processFitnessFileJob(database, {
        id: 'job-id-privacy-filter',
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: { actorId: actor.id, statusId, fitnessFileId }
      })
    } finally {
      // These settings live on the actor every test in this file shares, and
      // the radius sits on the default route's first point — leaving them
      // behind trims that route to one visible point, so any later test's map
      // block is skipped and its assertions pass vacuously. It made the file
      // order-dependent (visible under --sequence.shuffle.tests).
      await database.updateFitnessSettings({
        id: settings.id,
        privacyHomeLatitude: null,
        privacyHomeLongitude: null,
        privacyHideRadiusMeters: null
      })
    }

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

    it('stores no jpeg copy when the owner turned import emails off', async () => {
      const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
        text: 'Morning run'
      })
      arrangeRouteWithMap()

      await database.updateActor({
        actorId: actor.id,
        emailNotifications: { activity_import: false }
      })

      try {
        await processFitnessFileJob(database, {
          id: 'job-notify-email-off',
          name: PROCESS_FITNESS_FILE_JOB_NAME,
          data: {
            actorId: actor.id,
            statusId,
            fitnessFileId,
            notifyOnComplete: true
          }
        })
      } finally {
        await database.updateActor({
          actorId: actor.id,
          emailNotifications: { activity_import: true }
        })
      }

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
