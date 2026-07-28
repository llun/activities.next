import { getTestSQLDatabase } from '@/lib/database/testUtils'
import {
  REGENERATE_FITNESS_MAPS_JOB_NAME,
  SEND_UPDATE_NOTE_JOB_NAME
} from '@/lib/jobs/names'
import { regenerateFitnessMapsJob } from '@/lib/jobs/regenerateFitnessMapsJob'
import { getFitnessFile } from '@/lib/services/fitness-files'
import { generateMapImage } from '@/lib/services/fitness-files/generateMapImage'
import { parseFitnessFile } from '@/lib/services/fitness-files/parseFitnessFile'
import { deleteMediaFile, saveMedia } from '@/lib/services/medias'
import { getQueue } from '@/lib/services/queue'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { Actor } from '@/lib/types/domain/actor'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
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
    getFitnessFile: vi.fn()
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
  deleteMediaFile: vi.fn()
}))

const mockGetFitnessFile = getFitnessFile as jest.MockedFunction<
  typeof getFitnessFile
>
const mockParseFitnessFile = parseFitnessFile as jest.MockedFunction<
  typeof parseFitnessFile
>
const mockGenerateMapImage = generateMapImage as jest.MockedFunction<
  typeof generateMapImage
>
const mockSaveMedia = saveMedia as jest.MockedFunction<typeof saveMedia>
const mockDeleteMediaFile = deleteMediaFile as jest.MockedFunction<
  typeof deleteMediaFile
>

describe('regenerateFitnessMapsJob', () => {
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
      startTime: new Date('2026-01-06T07:00:00.000Z')
    })
    mockGenerateMapImage.mockResolvedValue(Buffer.from('new-map-image'))
    mockDeleteMediaFile.mockResolvedValue(true)
    mockSaveMedia.mockResolvedValue({
      id: 'new-map-media-id',
      type: 'image',
      mime_type: 'image/webp',
      url: 'https://llun.test/api/v1/files/medias/new-route-map.webp',
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

  const setupStatusWithOldMap = async () => {
    const postId = `regenerate-${Date.now()}-${Math.random().toString(16).slice(2)}`
    const statusId = `${actor.id}/statuses/${postId}`

    await database.createNote({
      id: statusId,
      url: `https://${actor.domain}/${actor.username}/${postId}`,
      actorId: actor.id,
      text: 'Old route map',
      summary: null,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [`${actor.id}/followers`],
      reply: ''
    })

    const oldMedia = await database.createMedia({
      actorId: actor.id,
      original: {
        path: 'medias/old-route-map.webp',
        bytes: 1400,
        mimeType: 'image/webp',
        metaData: { width: 800, height: 600 }
      }
    })
    expect(oldMedia).toBeDefined()

    await database.createAttachment({
      actorId: actor.id,
      statusId,
      mediaType: 'image/webp',
      url: `https://llun.test/api/v1/files/${oldMedia!.original.path}`,
      width: 800,
      height: 600,
      name: 'Activity route map',
      mediaId: oldMedia!.id
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

    const oldEmailMapPath = `medias/old-route-map-${postId}.jpg`
    await database.updateFitnessFileActivityData(fitnessFile!.id, {
      hasMapData: true,
      mapImagePath: oldMedia!.original.path,
      mapImageEmailPath: oldEmailMapPath
    })

    return {
      statusId,
      fitnessFileId: fitnessFile!.id,
      oldMediaId: String(oldMedia!.id),
      oldEmailMapPath
    }
  }

  const setupStatusWithMultipleOldMaps = async () => {
    const postId = `multi-${Date.now()}-${Math.random().toString(16).slice(2)}`
    const statusId = `${actor.id}/statuses/${postId}`

    await database.createNote({
      id: statusId,
      url: `https://${actor.domain}/${actor.username}/${postId}`,
      actorId: actor.id,
      text: 'Old route maps',
      summary: null,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [`${actor.id}/followers`],
      reply: ''
    })

    const entries: Array<{
      fitnessFileId: string
      oldMediaId: string
      oldEmailMapPath: string
    }> = []

    for (const index of [1, 2]) {
      const oldMedia = await database.createMedia({
        actorId: actor.id,
        original: {
          path: `medias/old-route-map-${postId}-${index}.webp`,
          bytes: 1400,
          mimeType: 'image/webp',
          metaData: { width: 800, height: 600 }
        }
      })
      expect(oldMedia).toBeDefined()

      await database.createAttachment({
        actorId: actor.id,
        statusId,
        mediaType: 'image/webp',
        url: `https://llun.test/api/v1/files/${oldMedia!.original.path}`,
        width: 800,
        height: 600,
        name: 'Activity route map',
        mediaId: oldMedia!.id
      })

      const fitnessFile = await database.createFitnessFile({
        actorId: actor.id,
        statusId,
        path: `fitness/${postId}-${index}.fit`,
        fileName: `${postId}-${index}.fit`,
        fileType: 'fit',
        mimeType: 'application/vnd.ant.fit',
        bytes: 2_048
      })
      expect(fitnessFile).toBeDefined()

      const oldEmailMapPath = `medias/old-route-map-${postId}-${index}.jpg`
      await database.updateFitnessFileActivityData(fitnessFile!.id, {
        hasMapData: true,
        mapImagePath: oldMedia!.original.path,
        mapImageEmailPath: oldEmailMapPath
      })

      entries.push({
        fitnessFileId: fitnessFile!.id,
        oldMediaId: String(oldMedia!.id),
        oldEmailMapPath
      })
    }

    return { statusId, entries }
  }

  it('replaces old maps and publishes an update note job', async () => {
    const { statusId, fitnessFileId, oldMediaId, oldEmailMapPath } =
      await setupStatusWithOldMap()

    await regenerateFitnessMapsJob(database, {
      id: 'job-regenerate-success',
      name: REGENERATE_FITNESS_MAPS_JOB_NAME,
      data: {
        actorId: actor.id,
        fitnessFileIds: [fitnessFileId]
      }
    })

    const refreshedFitnessFile = await database.getFitnessFile({
      id: fitnessFileId
    })
    expect(refreshedFitnessFile?.processingStatus).toBe('completed')
    expect(refreshedFitnessFile?.hasMapData).toBe(true)
    expect(refreshedFitnessFile?.mapImagePath).toBe('medias/new-route-map.webp')

    // The JPEG copy of the replaced map belonged to an email that was sent when
    // the activity first arrived. Regeneration has nothing to replace it with,
    // and after a privacy change it may show a route the owner has since
    // hidden, so it is dropped rather than left fetchable at its old URL.
    expect(refreshedFitnessFile?.mapImageEmailPath).toBeUndefined()
    expect(mockDeleteMediaFile).toHaveBeenCalledWith(database, oldEmailMapPath)

    const refreshedStatus = await database.getStatus({
      statusId,
      withReplies: false
    })
    const mapAttachments = refreshedStatus?.attachments.filter((attachment) => {
      return attachment.name === 'Activity route map'
    })
    expect(mapAttachments).toHaveLength(1)
    expect(mapAttachments?.[0]?.url).toContain('new-route-map.webp')

    const oldMedia = await database.getMediaByIdForAccount({
      mediaId: oldMediaId,
      accountId: actor.account!.id
    })
    expect(oldMedia).toBeNull()

    expect(getQueue().publish).toHaveBeenCalledWith({
      id: expect.any(String),
      name: SEND_UPDATE_NOTE_JOB_NAME,
      data: {
        actorId: actor.id,
        statusId
      }
    })
  })

  // Every branch records the reason in `mapError` and leaves the file
  // `completed` — the same policy processFitnessFileJob applies on the import
  // path. `failed` would hide an activity this job never even touched behind
  // every surface gated on `completed`.
  it.each([
    {
      description: 'keeps old map untouched when map rendering throws',
      arrange: () =>
        mockGenerateMapImage.mockRejectedValue(new Error('map failed')),
      expectedError: 'map failed'
    },
    {
      description:
        'keeps old map untouched when the renderer produces no image',
      arrange: () => mockGenerateMapImage.mockResolvedValue(null),
      expectedError: 'Generated map image buffer is empty'
    },
    {
      description: 'keeps old map untouched when storing the new map fails',
      arrange: () => mockSaveMedia.mockResolvedValue(null),
      expectedError: 'Failed to store generated route map image'
    }
  ])('$description', async ({ arrange, expectedError }) => {
    const { statusId, fitnessFileId, oldMediaId, oldEmailMapPath } =
      await setupStatusWithOldMap()
    const loggerError = vi.spyOn(logger, 'error')
    arrange()

    await regenerateFitnessMapsJob(database, {
      id: 'job-regenerate-failed',
      name: REGENERATE_FITNESS_MAPS_JOB_NAME,
      data: {
        actorId: actor.id,
        fitnessFileIds: [fitnessFileId]
      }
    })

    const refreshedFitnessFile = await database.getFitnessFile({
      id: fitnessFileId
    })
    expect(refreshedFitnessFile?.processingStatus).toBe('completed')
    expect(refreshedFitnessFile?.mapError).toBe(expectedError)
    // A map failure is not an import failure.
    expect(refreshedFitnessFile?.importError).toBeUndefined()
    expect(refreshedFitnessFile?.mapImagePath).toBe('medias/old-route-map.webp')
    // The reference must survive a failed regeneration, or the copy is orphaned.
    expect(refreshedFitnessFile?.mapImageEmailPath).toBe(oldEmailMapPath)
    expect(mockDeleteMediaFile).not.toHaveBeenCalledWith(
      database,
      oldEmailMapPath
    )

    const oldMedia = await database.getMediaByIdForAccount({
      mediaId: oldMediaId,
      accountId: actor.account!.id
    })
    expect(oldMedia).toBeTruthy()

    const refreshedStatus = await database.getStatus({
      statusId,
      withReplies: false
    })
    const mapAttachments = refreshedStatus?.attachments.filter((attachment) => {
      return attachment.name === 'Activity route map'
    })
    expect(mapAttachments).toHaveLength(1)
    expect(mapAttachments?.[0]?.url).toContain('old-route-map.webp')

    expect(getQueue().publish).not.toHaveBeenCalledWith(
      expect.objectContaining({
        name: SEND_UPDATE_NOTE_JOB_NAME
      })
    )

    // Reported at error level with the error object itself, so the stack
    // reaches error reporting instead of a bare message string.
    expect(loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Failed to regenerate route map for fitness activity',
        fitnessFileId,
        error: expectedError,
        err: expect.any(Error)
      })
    )
  })

  it('clears a recorded map failure once regeneration succeeds', async () => {
    const { fitnessFileId } = await setupStatusWithOldMap()
    mockGenerateMapImage.mockRejectedValue(new Error('tile server down'))

    await regenerateFitnessMapsJob(database, {
      id: 'job-regenerate-clears-first',
      name: REGENERATE_FITNESS_MAPS_JOB_NAME,
      data: { actorId: actor.id, fitnessFileIds: [fitnessFileId] }
    })
    expect(
      (await database.getFitnessFile({ id: fitnessFileId }))?.mapError
    ).toBe('tile server down')

    mockGenerateMapImage.mockResolvedValue(Buffer.from('new-map-image'))
    await regenerateFitnessMapsJob(database, {
      id: 'job-regenerate-clears-second',
      name: REGENERATE_FITNESS_MAPS_JOB_NAME,
      data: { actorId: actor.id, fitnessFileIds: [fitnessFileId] }
    })

    const refreshed = await database.getFitnessFile({ id: fitnessFileId })
    expect(refreshed?.mapError).toBeUndefined()
    expect(refreshed?.mapImagePath).toBe('medias/new-route-map.webp')
  })

  it('keeps the regenerated map when the previous one cannot be removed', async () => {
    const { statusId, fitnessFileId } = await setupStatusWithOldMap()
    vi.spyOn(database, 'deleteAttachmentsByIds').mockRejectedValueOnce(
      new Error('attachment delete failed')
    )

    await regenerateFitnessMapsJob(database, {
      id: 'job-regenerate-cleanup-failure',
      name: REGENERATE_FITNESS_MAPS_JOB_NAME,
      data: { actorId: actor.id, fitnessFileIds: [fitnessFileId] }
    })

    // The regenerated map is stored and attached by now, so a cleanup failure
    // must not undo it: the activity stays `completed` with its new map, and
    // the leftover attachment is logged rather than reported as a map failure
    // the owner cannot act on.
    const refreshed = await database.getFitnessFile({ id: fitnessFileId })
    expect(refreshed).toMatchObject({
      processingStatus: 'completed',
      mapImagePath: 'medias/new-route-map.webp'
    })
    expect(refreshed?.mapError).toBeUndefined()

    const status = await database.getStatus({ statusId, withReplies: false })
    const mapAttachments = status?.attachments.filter(
      (attachment) => attachment.name === 'Activity route map'
    )
    expect(mapAttachments).toHaveLength(2)
  })

  it('clears a stale map reason when the whole file fails', async () => {
    const { fitnessFileId } = await setupStatusWithOldMap()
    await database.updateFitnessFileActivityData(fitnessFileId, {
      mapError: 'tile server down'
    })
    mockParseFitnessFile.mockRejectedValue(new Error('Invalid TCX structure'))

    await regenerateFitnessMapsJob(database, {
      id: 'job-regenerate-hard-failure',
      name: REGENERATE_FITNESS_MAPS_JOB_NAME,
      data: { actorId: actor.id, fitnessFileIds: [fitnessFileId] }
    })

    // The file's own status now carries the diagnostic; leaving the map reason
    // set too makes the fitness files page report a missing map instead.
    const refreshed = await database.getFitnessFile({ id: fitnessFileId })
    expect(refreshed?.processingStatus).toBe('failed')
    expect(refreshed?.importError).toBe('Invalid TCX structure')
    expect(refreshed?.mapError).toBeUndefined()
  })

  it('removes the map and its email copy when no visible coordinates remain', async () => {
    const { statusId, fitnessFileId, oldMediaId, oldEmailMapPath } =
      await setupStatusWithOldMap()

    // A reason left over from an earlier failed regeneration. There is now no
    // map to produce at all, so it must not survive — a stale reason keeps the
    // post offering its owner a retry forever.
    await database.updateFitnessFileActivityData(fitnessFileId, {
      mapError: 'tile server down'
    })

    // Nothing left to draw — the same end state a privacy location that
    // swallows the whole route produces — so the map is removed, not
    // regenerated. Stubbed at the parse boundary rather than through settings so
    // the branch is reached directly.
    mockParseFitnessFile.mockResolvedValueOnce({
      coordinates: [],
      trackPoints: [],
      totalDistanceMeters: 0,
      totalDurationSeconds: 600,
      activityType: 'running'
    })

    await regenerateFitnessMapsJob(database, {
      id: 'job-regenerate-no-coordinates',
      name: REGENERATE_FITNESS_MAPS_JOB_NAME,
      data: {
        actorId: actor.id,
        fitnessFileIds: [fitnessFileId]
      }
    })

    expect(mockGenerateMapImage).not.toHaveBeenCalled()

    const refreshedFitnessFile = await database.getFitnessFile({
      id: fitnessFileId
    })
    expect(refreshedFitnessFile?.processingStatus).toBe('completed')
    expect(refreshedFitnessFile?.hasMapData).toBe(false)
    expect(refreshedFitnessFile?.mapImagePath).toBeUndefined()
    expect(refreshedFitnessFile?.mapError).toBeUndefined()
    // The copy must not outlive the map: it shows the route the owner just hid.
    expect(refreshedFitnessFile?.mapImageEmailPath).toBeUndefined()
    expect(mockDeleteMediaFile).toHaveBeenCalledWith(database, oldEmailMapPath)

    const oldMedia = await database.getMediaByIdForAccount({
      mediaId: oldMediaId,
      accountId: actor.account!.id
    })
    expect(oldMedia).toBeNull()

    const refreshedStatus = await database.getStatus({
      statusId,
      withReplies: false
    })
    const mapAttachments = refreshedStatus?.attachments.filter(
      (attachment) => attachment.name === 'Activity route map'
    )
    expect(mapAttachments).toHaveLength(0)
  })

  it('heals a non-primary file by removing its stray map instead of regenerating', async () => {
    const { statusId, entries } = await setupStatusWithMultipleOldMaps()
    const primaryEntry = entries[0]
    const nonPrimaryEntry = entries[1]

    // A status carries at most one route map, owned by its primary file. The
    // second device of a merged same-ride post is non-primary and must not
    // keep its own map, otherwise the post renders duplicate images.
    await database.updateFitnessFilePrimary(
      nonPrimaryEntry.fitnessFileId,
      false
    )
    // This file is not supposed to own a map, so a reason recorded when it
    // tried is not a pending problem — left behind it makes the status look
    // permanently retriable.
    await database.updateFitnessFileActivityData(
      nonPrimaryEntry.fitnessFileId,
      { mapError: 'tile server down' }
    )

    await regenerateFitnessMapsJob(database, {
      id: 'job-regenerate-non-primary',
      name: REGENERATE_FITNESS_MAPS_JOB_NAME,
      data: {
        actorId: actor.id,
        fitnessFileIds: [nonPrimaryEntry.fitnessFileId]
      }
    })

    // The non-primary file is never regenerated.
    expect(mockGenerateMapImage).not.toHaveBeenCalled()

    const refreshedNonPrimary = await database.getFitnessFile({
      id: nonPrimaryEntry.fitnessFileId
    })
    expect(refreshedNonPrimary?.hasMapData).toBe(false)
    expect(refreshedNonPrimary?.mapImagePath).toBeUndefined()
    expect(refreshedNonPrimary?.processingStatus).toBe('completed')
    expect(refreshedNonPrimary?.mapError).toBeUndefined()

    // The stray map's email copy goes with it: it has no `medias` row, so the
    // fitness file was its only reference.
    expect(refreshedNonPrimary?.mapImageEmailPath).toBeUndefined()
    expect(mockDeleteMediaFile).toHaveBeenCalledWith(
      database,
      nonPrimaryEntry.oldEmailMapPath
    )

    // Its stray map media is deleted, while the primary file's map is left
    // untouched.
    const removedMedia = await database.getMediaByIdForAccount({
      mediaId: nonPrimaryEntry.oldMediaId,
      accountId: actor.account!.id
    })
    expect(removedMedia).toBeNull()
    const primaryMedia = await database.getMediaByIdForAccount({
      mediaId: primaryEntry.oldMediaId,
      accountId: actor.account!.id
    })
    expect(primaryMedia).toBeTruthy()

    const refreshedStatus = await database.getStatus({
      statusId,
      withReplies: false
    })
    const mapAttachments = refreshedStatus?.attachments.filter((attachment) => {
      return attachment.name === 'Activity route map'
    })
    expect(mapAttachments).toHaveLength(1)
    expect(mapAttachments?.[0]?.url).toContain(
      `old-route-map-${statusId.split('/').pop()}-1.webp`
    )
  })

  it('keeps regenerated maps for other fitness files on the same status', async () => {
    const { statusId, entries } = await setupStatusWithMultipleOldMaps()

    mockSaveMedia
      .mockResolvedValueOnce({
        id: 'new-map-media-id-1',
        type: 'image',
        mime_type: 'image/webp',
        url: 'https://llun.test/api/v1/files/medias/new-route-map-1.webp',
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
        description: 'Route map 1'
      })
      .mockResolvedValueOnce({
        id: 'new-map-media-id-2',
        type: 'image',
        mime_type: 'image/webp',
        url: 'https://llun.test/api/v1/files/medias/new-route-map-2.webp',
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
        description: 'Route map 2'
      })

    await regenerateFitnessMapsJob(database, {
      id: 'job-regenerate-multi-status',
      name: REGENERATE_FITNESS_MAPS_JOB_NAME,
      data: {
        actorId: actor.id,
        fitnessFileIds: entries.map((entry) => entry.fitnessFileId)
      }
    })

    const refreshedStatus = await database.getStatus({
      statusId,
      withReplies: false
    })
    const mapAttachments = refreshedStatus?.attachments.filter((attachment) => {
      return attachment.name === 'Activity route map'
    })

    expect(mapAttachments).toHaveLength(2)
    expect(mapAttachments?.map((item) => item.url)).toEqual(
      expect.arrayContaining([
        'https://llun.test/api/v1/files/medias/new-route-map-1.webp',
        'https://llun.test/api/v1/files/medias/new-route-map-2.webp'
      ])
    )

    await Promise.all(
      entries.map(async (entry) => {
        const oldMedia = await database.getMediaByIdForAccount({
          mediaId: entry.oldMediaId,
          accountId: actor.account!.id
        })
        expect(oldMedia).toBeNull()
      })
    )
  })
})
