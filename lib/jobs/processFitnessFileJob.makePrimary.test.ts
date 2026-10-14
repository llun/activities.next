import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { PROCESS_FITNESS_FILE_JOB_NAME } from '@/lib/jobs/names'
import { processFitnessFileJob } from '@/lib/jobs/processFitnessFileJob'
import { ROUTE_MAP_ATTACHMENT_NAME } from '@/lib/services/fitness-files/mapAttachments'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { Actor } from '@/lib/types/domain/actor'

import {
  createProcessFileHelpers,
  defaultActivityData,
  mockDeleteMediaFile,
  mockGenerateMapImage,
  mockGetFitnessFileBuffer,
  mockParseFitnessFile,
  mockSaveMedia,
  resetProcessMocks
} from './processFitnessFileJob.testUtils'

vi.mock('@/lib/services/queue', async () => ({
  getQueue: vi.fn().mockReturnValue({
    publish: vi.fn().mockResolvedValue(undefined),
    runsInline: true
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

vi.mock('@/lib/services/notifications/sendNotificationAlerts', () => ({
  sendNotificationAlerts: vi.fn()
}))

vi.mock('@/lib/services/altText/openai', () => ({
  generateRouteAltText: vi.fn()
}))

// "Make primary" end to end at the data layer: the endpoint's swap
// (`makeFitnessFilePrimary`) followed by the processing job it queues for the
// new primary, with only the map renderer and media storage stubbed. Each half
// is covered alone elsewhere; what only this proves is that the pointer move
// and the job's map replacement agree, so the post ends up with ONE route map,
// drawn from the new primary, and nothing is left behind from the old one.
describe('processFitnessFileJob after makeFitnessFilePrimary', () => {
  const { database, prepare } = createTestDatabase()
  let actor: Actor

  const { createStatusWithFitnessFile } = createProcessFileHelpers(
    database,
    () => actor
  )

  // Two recordings of one ride that disagree about the route, so the map drawn
  // from each is told apart by the coordinates it was handed.
  const watchRoute = [
    { lat: 51.5007, lng: -0.1246 },
    { lat: 51.5033, lng: -0.1195 }
  ]
  const headUnitRoute = [
    { lat: 51.5008, lng: -0.1247 },
    { lat: 51.5041, lng: -0.1182 }
  ]

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

  const runJob = (statusId: string, fitnessFileId: string, id: string) =>
    processFitnessFileJob(database, {
      id,
      name: PROCESS_FITNESS_FILE_JOB_NAME,
      // What the endpoint queues.
      data: {
        actorId: actor.id,
        statusId,
        fitnessFileId,
        publishSendNote: false,
        notifyOnComplete: false,
        retryingMapFailure: true
      }
    })

  beforeAll(async () => {
    await prepare()
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
    mockGetFitnessFileBuffer.mockResolvedValue(Buffer.from('bytes'))
  })

  it('leaves exactly one route map, owned by the new primary, with the old one removed', async () => {
    const { statusId, fitnessFileId: watchId } =
      await createStatusWithFitnessFile({ text: 'Morning ride' })

    // The watch is the primary and the post's map is drawn from it.
    const watchMap = await storeMapMedia('medias/route-map-watch.webp')
    mockSaveMedia.mockResolvedValueOnce(watchMap)
    mockParseFitnessFile.mockResolvedValueOnce({
      ...defaultActivityData,
      coordinates: watchRoute,
      trackPoints: watchRoute
    })
    await runJob(statusId, watchId, 'job-make-primary-watch')

    // The bike computer of the same ride, imported as a secondary recording.
    const headUnit = await database.createFitnessFile({
      actorId: actor.id,
      statusId,
      path: 'fitness/make-primary-head-unit.fit',
      fileName: 'head-unit.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 4_096
    })
    await database.updateFitnessFileProcessingStatus(headUnit!.id, 'completed')
    await database.updateFitnessFilePrimary(headUnit!.id, false)
    expect((await database.getFitnessFile({ id: watchId }))?.mapImagePath).toBe(
      'medias/route-map-watch.webp'
    )

    const swap = await database.makeFitnessFilePrimary({
      fitnessFileId: headUnit!.id,
      actorId: actor.id
    })
    expect(swap.result).toBe('promoted')

    // The job the endpoint then queues, drawing the map from the head unit.
    const headUnitMap = await storeMapMedia('medias/route-map-head-unit.webp')
    mockSaveMedia.mockResolvedValueOnce(headUnitMap)
    mockParseFitnessFile.mockResolvedValueOnce({
      ...defaultActivityData,
      coordinates: headUnitRoute,
      trackPoints: headUnitRoute
    })
    mockGenerateMapImage.mockClear()
    mockDeleteMediaFile.mockClear()
    await runJob(statusId, headUnit!.id, 'job-make-primary-head-unit')

    // The map was drawn from the new primary's recording...
    expect(mockGenerateMapImage).toHaveBeenCalledTimes(1)
    expect(mockGenerateMapImage).toHaveBeenCalledWith(
      expect.objectContaining({ coordinates: headUnitRoute })
    )

    // ...and the post carries one route map, the new one.
    const attachments = (await database.getAttachments({ statusId })).filter(
      (attachment) => attachment.name === ROUTE_MAP_ATTACHMENT_NAME
    )
    expect(attachments).toHaveLength(1)
    expect(attachments[0].url).toContain('route-map-head-unit.webp')

    // The new primary owns it (the pointer the next reprocess replaces from),
    // and the old primary owns none, so its next reprocess cannot touch it.
    const newPrimary = await database.getFitnessFile({ id: headUnit!.id })
    expect(newPrimary).toMatchObject({
      isPrimary: true,
      processingStatus: 'completed',
      hasMapData: true,
      mapImagePath: 'medias/route-map-head-unit.webp'
    })
    expect(newPrimary?.mapError).toBeUndefined()
    const oldPrimary = await database.getFitnessFile({ id: watchId })
    expect(oldPrimary).toMatchObject({
      isPrimary: false,
      hasMapData: false
    })
    expect(oldPrimary?.mapImagePath).toBeUndefined()
    expect(oldPrimary?.mapError).toBeUndefined()

    // The old map's bytes and media row went with its attachment.
    expect(mockDeleteMediaFile).toHaveBeenCalledWith(
      database,
      'medias/route-map-watch.webp'
    )
    expect(
      await database.getMediaByIdForAccount({
        mediaId: watchMap.id,
        accountId: actor.account!.id
      })
    ).toBeNull()
  })
})
