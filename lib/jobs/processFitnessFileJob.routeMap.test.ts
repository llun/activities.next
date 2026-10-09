import { getConfig } from '@/lib/config'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import {
  PROCESS_FITNESS_FILE_JOB_NAME,
  SEND_NOTE_JOB_NAME
} from '@/lib/jobs/names'
import { processFitnessFileJob } from '@/lib/jobs/processFitnessFileJob'
import { generateRouteAltText } from '@/lib/services/altText/openai'
import { ROUTE_MAP_ATTACHMENT_NAME } from '@/lib/services/fitness-files/mapAttachments'
import { isRetriableFitnessFile } from '@/lib/services/fitness-files/retryImports'
import { getQueue } from '@/lib/services/queue'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { Actor } from '@/lib/types/domain/actor'
import { StatusType } from '@/lib/types/domain/status'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'

import {
  createProcessFileHelpers,
  defaultActivityData,
  mockDeleteMediaFile,
  mockGenerateMapImage,
  mockGetFitnessFileBuffer,
  mockParseFitnessFile,
  mockSaveMedia,
  mockSaveMediaImageRendition,
  resetProcessMocks
} from './processFitnessFileJob.testUtils'

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

vi.mock('@/lib/services/altText/openai', () => ({
  generateRouteAltText: vi.fn()
}))

describe('processFitnessFileJob', () => {
  const database = getTestSQLDatabase()
  let actor: Actor

  const { createStatusWithFitnessFile, setPrivacyZone } =
    createProcessFileHelpers(database, () => actor)

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
    resetProcessMocks()
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
        description: 'Route map',
        blurhash: null
      }
    }

    // The route map is one of this instance's biggest media producers, and the
    // attachment row is what every reader serves — so the placeholder and
    // focal point `saveMedia` just computed have to land on it, not only on
    // the media row one join away.
    it('copies the stored map media snapshot onto the attachment', async () => {
      const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
        text: ''
      })
      const storedMap = await storeMapMedia('medias/route-map-snapshot.webp')
      mockGenerateMapImage.mockResolvedValue(Buffer.from('png-map-image'))
      mockSaveMedia.mockResolvedValue({
        ...storedMap,
        blurhash: 'LEHV6nWB2yk8pyo0adR*',
        preview_url: 'https://llun.test/api/v1/files/medias/map-thumbnail.webp',
        meta: {
          ...storedMap.meta,
          small: { width: 200, height: 150, size: '200x150', aspect: 1.33 },
          focus: { x: 0.25, y: -0.5 }
        }
      })

      await processFitnessFileJob(database, {
        id: 'job-map-attachment-snapshot',
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: { actorId: actor.id, statusId, fitnessFileId }
      })

      const attachments = await database.getAttachments({ statusId })
      const mapAttachment = attachments.find(
        (attachment) => attachment.name === ROUTE_MAP_ATTACHMENT_NAME
      )
      expect(mapAttachment).toMatchObject({
        blurhash: 'LEHV6nWB2yk8pyo0adR*',
        focus: { x: 0.25, y: -0.5 },
        thumbnailUrl: 'https://llun.test/api/v1/files/medias/map-thumbnail.webp'
      })
    })

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

  describe('route map description', () => {
    it('generates route map description using LLM when altText is configured and user enabled it', async () => {
      await setPrivacyZone({ generateRouteDescription: true })
      try {
        const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
          text: 'Morning run'
        })

        vi.mocked(generateRouteAltText).mockResolvedValueOnce(
          'A scenic 5km loop around the waterfront.'
        )

        const config = getConfig()
        vi.mocked(getConfig).mockReturnValue({
          ...config,
          altText: {
            endpoint: 'https://api.openai.com/v1',
            apiKey: 'test-key',
            model: 'gpt-4o-mini'
          }
        } as unknown as ReturnType<typeof getConfig>)

        try {
          await processFitnessFileJob(database, {
            id: 'job-route-alt-text-success',
            name: PROCESS_FITNESS_FILE_JOB_NAME,
            data: { actorId: actor.id, statusId, fitnessFileId }
          })
        } finally {
          vi.mocked(getConfig).mockReturnValue(config)
        }

        expect(generateRouteAltText).toHaveBeenCalledTimes(1)
        expect(generateRouteAltText).toHaveBeenCalledWith(
          expect.objectContaining({ model: 'gpt-4o-mini' }),
          expect.any(Buffer),
          'image/png'
        )

        expect(mockSaveMedia).toHaveBeenCalledWith(
          database,
          expect.objectContaining({ id: actor.id }),
          expect.objectContaining({
            description: 'A scenic 5km loop around the waterfront.'
          })
        )

        const attachments = await database.getAttachments({ statusId })
        expect(
          attachments.some(
            (attachment) => attachment.name === ROUTE_MAP_ATTACHMENT_NAME
          )
        ).toBe(true)
      } finally {
        await setPrivacyZone({ generateRouteDescription: false })
      }
    })

    it('stores route map without description when generateRouteDescription is disabled despite altText being configured', async () => {
      await setPrivacyZone({ generateRouteDescription: false })
      const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
        text: 'Morning run'
      })

      const config = getConfig()
      vi.mocked(getConfig).mockReturnValue({
        ...config,
        altText: {
          endpoint: 'https://api.openai.com/v1',
          apiKey: 'test-key',
          model: 'gpt-4o-mini'
        }
      } as unknown as ReturnType<typeof getConfig>)

      try {
        await processFitnessFileJob(database, {
          id: 'job-route-alt-text-user-disabled',
          name: PROCESS_FITNESS_FILE_JOB_NAME,
          data: { actorId: actor.id, statusId, fitnessFileId }
        })
      } finally {
        vi.mocked(getConfig).mockReturnValue(config)
      }

      expect(generateRouteAltText).not.toHaveBeenCalled()
      const saveMediaCall = mockSaveMedia.mock.calls.find(
        ([, , media]) => media.file.name === `${fitnessFileId}-route-map.png`
      )
      expect(saveMediaCall).toBeDefined()
      expect(saveMediaCall?.[2]?.description).toBeUndefined()
    })

    it('stores route map without description when altText is not configured', async () => {
      const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
        text: 'Morning run'
      })

      await processFitnessFileJob(database, {
        id: 'job-route-alt-text-no-config',
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: { actorId: actor.id, statusId, fitnessFileId }
      })

      expect(generateRouteAltText).not.toHaveBeenCalled()
      const saveMediaCall = mockSaveMedia.mock.calls.find(
        ([, , media]) => media.file.name === `${fitnessFileId}-route-map.png`
      )
      expect(saveMediaCall).toBeDefined()
      expect(saveMediaCall?.[2]?.description).toBeUndefined()
    })

    it('stores route map without description when route alt text generation returns null', async () => {
      await setPrivacyZone({ generateRouteDescription: true })
      try {
        const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
          text: 'Morning run'
        })

        vi.mocked(generateRouteAltText).mockResolvedValueOnce(null)

        const config = getConfig()
        vi.mocked(getConfig).mockReturnValue({
          ...config,
          altText: {
            endpoint: 'https://api.openai.com/v1',
            apiKey: 'test-key',
            model: 'gpt-4o-mini'
          }
        } as unknown as ReturnType<typeof getConfig>)

        try {
          await processFitnessFileJob(database, {
            id: 'job-route-alt-text-null',
            name: PROCESS_FITNESS_FILE_JOB_NAME,
            data: { actorId: actor.id, statusId, fitnessFileId }
          })
        } finally {
          vi.mocked(getConfig).mockReturnValue(config)
        }

        expect(generateRouteAltText).toHaveBeenCalledTimes(1)
        const saveMediaCall = mockSaveMedia.mock.calls.find(
          ([, , media]) => media.file.name === `${fitnessFileId}-route-map.png`
        )
        expect(saveMediaCall).toBeDefined()
        expect(saveMediaCall?.[2]?.description).toBeUndefined()
      } finally {
        await setPrivacyZone({ generateRouteDescription: false })
      }
    })
  })
})
