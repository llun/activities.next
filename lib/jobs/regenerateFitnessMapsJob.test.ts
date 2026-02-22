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

jest.mock('@/lib/services/queue', () => ({
  getQueue: jest.fn().mockReturnValue({
    publish: jest.fn().mockResolvedValue(undefined)
  })
}))

jest.mock('@/lib/services/fitness-files', () => {
  const actual = jest.requireActual('../services/fitness-files')
  return {
    ...actual,
    getFitnessFile: jest.fn()
  }
})

jest.mock('@/lib/services/fitness-files/parseFitnessFile', () => ({
  parseFitnessFile: jest.fn()
}))

jest.mock('@/lib/services/fitness-files/generateMapImage', () => ({
  generateMapImage: jest.fn()
}))

jest.mock('@/lib/services/medias', () => ({
  saveMedia: jest.fn(),
  deleteMediaFile: jest.fn()
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

    await database.updateFitnessFileActivityData(fitnessFile!.id, {
      hasMapData: true,
      mapImagePath: oldMedia!.original.path
    })

    return {
      statusId,
      fitnessFileId: fitnessFile!.id,
      oldMediaId: String(oldMedia!.id)
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

      await database.updateFitnessFileActivityData(fitnessFile!.id, {
        hasMapData: true,
        mapImagePath: oldMedia!.original.path
      })

      entries.push({
        fitnessFileId: fitnessFile!.id,
        oldMediaId: String(oldMedia!.id)
      })
    }

    return { statusId, entries }
  }

  it('replaces old maps and publishes an update note job', async () => {
    const { statusId, fitnessFileId, oldMediaId } =
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

  it('keeps old map untouched when regeneration fails', async () => {
    const { statusId, fitnessFileId, oldMediaId } =
      await setupStatusWithOldMap()
    mockGenerateMapImage.mockRejectedValueOnce(new Error('map failed'))

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
    expect(refreshedFitnessFile?.processingStatus).toBe('failed')
    expect(refreshedFitnessFile?.mapImagePath).toBe('medias/old-route-map.webp')

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
