import { getConfig } from '@/lib/config'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import {
  PROCESS_FITNESS_FILE_JOB_NAME,
  SEND_NOTE_JOB_NAME
} from '@/lib/jobs/names'
import { processFitnessFileJob } from '@/lib/jobs/processFitnessFileJob'
import { ROUTE_MAP_ATTACHMENT_NAME } from '@/lib/services/fitness-files/mapAttachments'
import { getQueue } from '@/lib/services/queue'
import type { Queue } from '@/lib/services/queue/type'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { Actor } from '@/lib/types/domain/actor'
import { StatusType } from '@/lib/types/domain/status'

import {
  createProcessFileHelpers,
  defaultActivityData,
  mockDeleteMediaFile,
  mockGenerateMapImage,
  mockParseFitnessFile,
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

  const { createStatusWithFitnessFile } = createProcessFileHelpers(
    database,
    () => actor
  )

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

    it('redirects stale primary jobs and suppresses duplicate silent processing', async () => {
      const { statusId, fitnessFileId: oldPrimaryId } =
        await createStatusWithFitnessFile({ text: 'Morning run' })
      const newPrimary = await database.createFitnessFile({
        actorId: actor.id,
        statusId,
        path: 'fitness/wahoo-promoted-primary.fit',
        fileName: 'wahoo-promoted-primary.fit',
        fileType: 'fit',
        mimeType: 'application/vnd.ant.fit',
        bytes: 4_096
      })
      expect(newPrimary).toBeDefined()
      await database.assignFitnessFilesToImportedStatus({
        fitnessFileIds: [oldPrimaryId, newPrimary!.id],
        primaryFitnessFileId: newPrimary!.id,
        statusId
      })
      arrangeRouteWithMap()

      // The old primary's job was already queued with these first-import
      // effects when the Wahoo FIT revision promoted itself. Run it alongside
      // the silent job enqueued for the new primary to cover a delivery race.
      await Promise.all([
        processFitnessFileJob(database, {
          id: 'job-stale-old-primary',
          name: PROCESS_FITNESS_FILE_JOB_NAME,
          data: {
            actorId: actor.id,
            statusId,
            fitnessFileId: oldPrimaryId,
            publishSendNote: true,
            notifyOnComplete: true
          }
        }),
        processFitnessFileJob(database, {
          id: 'job-silent-new-primary',
          name: PROCESS_FITNESS_FILE_JOB_NAME,
          data: {
            actorId: actor.id,
            statusId,
            fitnessFileId: newPrimary!.id,
            publishSendNote: false,
            notifyOnComplete: false
          }
        })
      ])

      const currentPrimary = await database.getFitnessFile({
        id: newPrimary!.id
      })
      expect(currentPrimary).toMatchObject({
        isPrimary: true,
        processingStatus: 'completed',
        hasMapData: true
      })
      expect(mockGenerateMapImage).toHaveBeenCalled()
      expect(mockSendNotificationAlerts).toHaveBeenCalledTimes(1)
      const status = await database.getStatus({ statusId, withReplies: false })
      if (status?.type !== StatusType.enum.Note) {
        fail('Expected a note status')
      }
      expect(
        status.attachments.filter(
          (attachment) => attachment.name === ROUTE_MAP_ATTACHMENT_NAME
        )
      ).toHaveLength(1)
      const sendNoteCalls = (
        getQueue().publish as jest.MockedFunction<Queue['publish']>
      ).mock.calls.filter(([message]) => message.name === SEND_NOTE_JOB_NAME)
      expect(sendNoteCalls).toHaveLength(1)
      expect(sendNoteCalls[0]?.[0].data).toEqual({
        actorId: actor.id,
        statusId
      })
    })

    it('delivers initial side effects from a stale job when the new primary already completed', async () => {
      const { statusId, fitnessFileId: oldPrimaryId } =
        await createStatusWithFitnessFile({ text: 'Morning run' })
      const newPrimary = await database.createFitnessFile({
        actorId: actor.id,
        statusId,
        path: 'fitness/wahoo-already-processed-primary.fit',
        fileName: 'wahoo-already-processed-primary.fit',
        fileType: 'fit',
        mimeType: 'application/vnd.ant.fit',
        bytes: 4_096
      })
      expect(newPrimary).toBeDefined()
      await database.assignFitnessFilesToImportedStatus({
        fitnessFileIds: [oldPrimaryId, newPrimary!.id],
        primaryFitnessFileId: newPrimary!.id,
        statusId
      })
      arrangeRouteWithMap()

      await processFitnessFileJob(database, {
        id: 'job-new-primary-completes-first',
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: {
          actorId: actor.id,
          statusId,
          fitnessFileId: newPrimary!.id,
          publishSendNote: false,
          notifyOnComplete: false
        }
      })
      await processFitnessFileJob(database, {
        id: 'job-stale-primary-delivers-first-side-effects',
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: {
          actorId: actor.id,
          statusId,
          fitnessFileId: oldPrimaryId,
          publishSendNote: true,
          notifyOnComplete: true
        }
      })

      expect(mockGenerateMapImage).toHaveBeenCalledTimes(1)
      expect(mockSendNotificationAlerts).toHaveBeenCalledTimes(1)
      const status = await database.getStatus({ statusId, withReplies: false })
      if (status?.type !== StatusType.enum.Note) {
        fail('Expected a note status')
      }
      expect(
        status.attachments.filter(
          (attachment) => attachment.name === ROUTE_MAP_ATTACHMENT_NAME
        )
      ).toHaveLength(1)
      const sendNoteCalls = (
        getQueue().publish as jest.MockedFunction<Queue['publish']>
      ).mock.calls.filter(([message]) => message.name === SEND_NOTE_JOB_NAME)
      expect(sendNoteCalls).toHaveLength(1)
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
