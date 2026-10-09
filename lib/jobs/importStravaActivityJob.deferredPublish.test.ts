import { Database } from '@/lib/database/types'
import { importStravaActivityJob } from '@/lib/jobs/importStravaActivityJob'
import {
  IMPORT_STRAVA_ACTIVITY_JOB_NAME,
  PROCESS_FITNESS_FILE_JOB_NAME,
  SEND_UPDATE_NOTE_JOB_NAME
} from '@/lib/jobs/names'
import { Visibility } from '@/lib/types/mastodon/visibility'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'

import {
  createMockStravaDatabase,
  mockGetQueue,
  mockGetStravaActivity,
  mockGetStravaActivityPhotos,
  mockImportFitnessFiles,
  resetStravaImportMocks
} from './importStravaActivityJob.testUtils'

vi.mock('node:dns/promises', async () => ({
  lookup: vi.fn()
}))

vi.mock('@/lib/services/fitness-files', async () => ({
  saveFitnessFile: vi.fn()
}))

vi.mock('@/lib/services/medias/index', async () => ({
  saveMedia: vi.fn()
}))

vi.mock('@/lib/jobs/importFitnessFilesJob', async () => ({
  importFitnessFiles: vi.fn()
}))

vi.mock('@/lib/services/strava/activity', async () => {
  const actual = await vi.importActual('@/lib/services/strava/activity')
  return {
    ...actual,
    buildGpxFromStravaStreams: vi.fn(),
    buildTcxFromStravaStreams: vi.fn(),
    getStravaActivity: vi.fn(),
    getStravaActivityPhotos: vi.fn(),
    getStravaActivityStreams: vi.fn(),
    getValidStravaAccessToken: vi.fn()
  }
})

vi.mock('@/lib/services/queue', async () => ({
  getQueue: vi.fn().mockReturnValue({
    publish: vi.fn().mockResolvedValue(undefined)
  })
}))

vi.mock('@/lib/services/timelines', async () => ({
  addStatusToTimelines: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

const mockSendNotificationAlerts = vi.fn()
vi.mock('@/lib/services/notifications/sendNotificationAlerts', () => ({
  sendNotificationAlerts: (...args: unknown[]) =>
    mockSendNotificationAlerts(...args)
}))

describe('importStravaActivityJob', () => {
  const database = createMockStravaDatabase()

  beforeEach(() => {
    resetStravaImportMocks(database)
  })

  describe('federation opt-in', () => {
    const PROCESS_JOB = {
      id: 'process-job-id',
      name: PROCESS_FITNESS_FILE_JOB_NAME,
      data: {
        actorId: 'actor-1',
        statusId: 'status-1',
        fitnessFileId: 'new-file',
        publishSendNote: true,
        notifyOnComplete: false
      }
    }

    const deferOneProcessJob = () => {
      mockImportFitnessFiles.mockResolvedValue([
        {
          statusId: 'status-1',
          statusCreated: true,
          primaryFitnessFileId: 'new-file',
          processJob: PROCESS_JOB
        }
      ])
    }

    const getProcessPublishes = () =>
      (mockGetQueue().publish as jest.Mock).mock.calls
        .map(([message]) => message)
        .filter((message) => message.name === PROCESS_FITNESS_FILE_JOB_NAME)

    // Derived from the process job rather than invocationCallOrder[0], which is
    // whichever job happened to be published first.
    const getProcessPublishOrder = () => {
      const publish = mockGetQueue().publish as jest.Mock
      const index = publish.mock.calls.findIndex(
        ([message]) => message.name === PROCESS_FITNESS_FILE_JOB_NAME
      )
      return publish.mock.invocationCallOrder[index]
    }

    it.each([
      { description: 'withholds by default', requested: {} },
      {
        description: 'forwards the webhook opt-in',
        requested: { publishSendNote: true }
      }
    ])('$description', async ({ requested }) => {
      await importStravaActivityJob(database as unknown as Database, {
        id: 'job-federation-forward',
        name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
        data: {
          actorId: 'actor-1',
          stravaActivityId: '123',
          ...requested
        }
      })

      expect(mockImportFitnessFiles).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          publishSendNote: 'publishSendNote' in requested
        }),
        { deferProcessJobPublishes: true }
      )
    })

    it('publishes the deferred process job only after the caption is on the status', async () => {
      // Under NoQueue publishing the process job runs it inline, and it is what
      // federates the Create. Published before the caption write it would
      // deliver an empty note that nothing ever re-sends.
      deferOneProcessJob()

      await importStravaActivityJob(database as unknown as Database, {
        id: 'job-federation-order',
        name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
        data: {
          actorId: 'actor-1',
          stravaActivityId: '123',
          publishSendNote: true
        }
      })

      const publishes = getProcessPublishes()
      expect(publishes).toHaveLength(1)
      expect(publishes[0]).toEqual(PROCESS_JOB)

      expect(database.updateNote.mock.invocationCallOrder.at(-1)).toBeLessThan(
        getProcessPublishOrder()
      )
    })

    it('publishes the deferred process job before downloading the Strava photos', async () => {
      // The photo downloads are four HTTP fetches plus transcodes against a 30s
      // job cap with no retries, and by this point the file sits at import
      // 'completed' / processing 'pending' — a state no retry predicate
      // matches. A worker killed mid-download after the publish only loses the
      // photos; before it, the ride is stranded unprocessed forever.
      deferOneProcessJob()

      await importStravaActivityJob(database as unknown as Database, {
        id: 'job-federation-publish-before-photos',
        name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
        data: {
          actorId: 'actor-1',
          stravaActivityId: '123',
          publishSendNote: true
        }
      })

      expect(getProcessPublishOrder()).toBeLessThan(
        mockGetStravaActivityPhotos.mock.invocationCallOrder[0]
      )
    })

    it('still writes the caption when the Strava photos fail', async () => {
      // Separate containment: one failure must not swallow the other's work.
      deferOneProcessJob()
      mockGetStravaActivityPhotos.mockRejectedValueOnce(
        new Error('strava photos unavailable')
      )

      await importStravaActivityJob(database as unknown as Database, {
        id: 'job-federation-photo-failure',
        name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
        data: {
          actorId: 'actor-1',
          stravaActivityId: '123',
          publishSendNote: true
        }
      })

      expect(getProcessPublishes()).toHaveLength(1)
      expect(database.updateNote).toHaveBeenCalledWith(
        expect.objectContaining({ statusId: 'status-1' })
      )
    })

    it('publishes the process job even when the caption write fails', async () => {
      // processFitnessFileJob backfills the generated summary for an empty
      // note, so a lost caption degrades the post; a lost process job loses
      // the map, the stats and the Create with no way back.
      deferOneProcessJob()
      database.updateNote.mockRejectedValueOnce(new Error('write conflict'))

      await importStravaActivityJob(database as unknown as Database, {
        id: 'job-federation-caption-failure',
        name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
        data: {
          actorId: 'actor-1',
          stravaActivityId: '123',
          publishSendNote: true
        }
      })

      expect(getProcessPublishes()).toHaveLength(1)
      expect(mockGetStravaActivityPhotos).toHaveBeenCalled()
    })

    it('marks the file failed when the deferred process job cannot be published', async () => {
      // Without this the import is stranded: the status exists and the file
      // sits at processing 'pending', which no retry predicate matches, so
      // nothing would ever offer to finish the activity.
      deferOneProcessJob()
      ;(mockGetQueue().publish as jest.Mock).mockRejectedValueOnce(
        'queue exploded'
      )

      await importStravaActivityJob(database as unknown as Database, {
        id: 'job-federation-publish-failure',
        name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
        data: {
          actorId: 'actor-1',
          stravaActivityId: '123',
          publishSendNote: true
        }
      })

      // A non-Error rejection on purpose: toImportErrorMessage exists so the
      // reason can never land as NULL and wipe the explanation.
      expect(database.updateFitnessFileProcessingStatus).toHaveBeenCalledWith(
        'new-file',
        'failed',
        'queue exploded'
      )
      // The IMPORT column stays completed. retryFitnessImportBatch resets a
      // failed import to 'pending', but re-running this job then short-circuits
      // past the importer because a statusId already exists, and nothing writes
      // importStatus back — the file would show as pending forever and stop
      // being retriable at all.
      expect(database.updateFitnessFileImportStatus).not.toHaveBeenCalled()
    })

    it.each([
      { stravaVisibility: 'everyone' },
      { stravaVisibility: 'followers_only' },
      { stravaVisibility: 'only_me' },
      { stravaVisibility: undefined },
      { stravaVisibility: 'custom_future_visibility' }
    ])(
      'federates at configured visibility when Strava visibility is $stravaVisibility',
      async ({ stravaVisibility }) => {
        mockGetStravaActivity.mockReset()
        mockGetStravaActivity.mockResolvedValue({
          id: 123,
          name: 'Morning Ride',
          distance: 5_000,
          elapsed_time: 1_500,
          total_elevation_gain: 20,
          start_date: '2026-01-01T00:00:00.000Z',
          sport_type: 'Ride',
          ...(stravaVisibility !== undefined
            ? { visibility: stravaVisibility }
            : {})
        } as never)

        await importStravaActivityJob(database as unknown as Database, {
          id: 'job-federation-various-visibilities',
          name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
          data: {
            actorId: 'actor-1',
            stravaActivityId: '123',
            visibility: Visibility.enum.public,
            publishSendNote: true
          }
        })

        expect(mockImportFitnessFiles).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            publishSendNote: true,
            visibility: Visibility.enum.public
          }),
          expect.anything()
        )
      }
    )

    it('sends an update when Strava photos land after the create', async () => {
      // The process job is published before the photos, so under NoQueue the
      // Create has already gone out by now; without this the remote copy keeps
      // the photoless version forever. A merged sibling brings its own photos
      // to an already-federated post for the same reason.
      deferOneProcessJob()
      database.getAttachments.mockResolvedValue([])
      database.createAttachment.mockResolvedValue({} as never)
      mockGetStravaActivityPhotos.mockResolvedValueOnce([
        { id: 'photo-1', url: 'https://images.example.com/photo-1.jpg' }
      ] as never)
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response(Buffer.from('jpg'), {
          headers: { 'content-type': 'image/jpeg', 'content-length': '3' }
        })
      )

      try {
        await importStravaActivityJob(database as unknown as Database, {
          id: 'job-federation-photo-update',
          name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
          data: {
            actorId: 'actor-1',
            stravaActivityId: '123',
            publishSendNote: true
          }
        })
      } finally {
        fetchSpy.mockRestore()
      }

      expect(database.createAttachment).toHaveBeenCalledTimes(1)
      const updates = (mockGetQueue().publish as jest.Mock).mock.calls
        .map(([message]) => message)
        .filter((message) => message.name === SEND_UPDATE_NOTE_JOB_NAME)
      expect(updates).toHaveLength(1)
      expect(updates[0].data).toEqual({
        actorId: 'actor-1',
        statusId: 'status-1'
      })
      expect(updates[0].id).toBe(
        getHashFromString(
          'status-1:123:job-federation-photo-update:strava-photos:send-update-note'
        )
      )
    })

    it('derives photo update child ID from parent message.id (identical on redelivery, distinct across generations)', async () => {
      database.getAttachments.mockResolvedValue([])
      database.createAttachment.mockResolvedValue({} as never)
      mockGetStravaActivityPhotos.mockResolvedValue([
        { id: 'photo-1', url: 'https://images.example.com/photo-1.jpg' }
      ] as never)
      const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(() =>
        Promise.resolve(
          new Response(Buffer.from('jpg'), {
            headers: { 'content-type': 'image/jpeg', 'content-length': '3' }
          })
        )
      )

      const setupFreshImport = () => {
        database.getFitnessFile
          .mockResolvedValueOnce({
            id: 'new-file',
            actorId: 'actor-1',
            statusId: undefined
          } as never)
          .mockResolvedValueOnce({
            id: 'new-file',
            actorId: 'actor-1',
            statusId: 'status-1'
          } as never)
      }

      try {
        // Generation 1 execution
        setupFreshImport()
        await importStravaActivityJob(database as unknown as Database, {
          id: 'job-photo-gen1',
          name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
          data: {
            actorId: 'actor-1',
            stravaActivityId: '123',
            publishSendNote: true
          }
        })

        const gen1Updates = (mockGetQueue().publish as jest.Mock).mock.calls
          .map(([message]) => message)
          .filter((message) => message.name === SEND_UPDATE_NOTE_JOB_NAME)
        const gen1Update = gen1Updates[gen1Updates.length - 1]
        const expectedGen1Id = getHashFromString(
          'status-1:123:job-photo-gen1:strava-photos:send-update-note'
        )
        expect(gen1Update.id).toBe(expectedGen1Id)

        // Parent redelivery of Generation 1: identical parent message.id produces identical child ID
        setupFreshImport()
        await importStravaActivityJob(database as unknown as Database, {
          id: 'job-photo-gen1',
          name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
          data: {
            actorId: 'actor-1',
            stravaActivityId: '123',
            publishSendNote: true
          }
        })

        const redeliveryUpdates = (
          mockGetQueue().publish as jest.Mock
        ).mock.calls
          .map(([message]) => message)
          .filter((message) => message.name === SEND_UPDATE_NOTE_JOB_NAME)
        const redeliveryUpdate = redeliveryUpdates[redeliveryUpdates.length - 1]
        expect(redeliveryUpdate.id).toBe(expectedGen1Id)

        // Generation 2 execution: different parent message.id produces different child ID
        setupFreshImport()
        await importStravaActivityJob(database as unknown as Database, {
          id: 'job-photo-gen2',
          name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
          data: {
            actorId: 'actor-1',
            stravaActivityId: '123',
            publishSendNote: true
          }
        })

        const gen2Updates = (mockGetQueue().publish as jest.Mock).mock.calls
          .map(([message]) => message)
          .filter((message) => message.name === SEND_UPDATE_NOTE_JOB_NAME)
        const gen2Update = gen2Updates[gen2Updates.length - 1]
        const expectedGen2Id = getHashFromString(
          'status-1:123:job-photo-gen2:strava-photos:send-update-note'
        )
        expect(gen2Update.id).toBe(expectedGen2Id)
        expect(gen2Update.id).not.toBe(expectedGen1Id)
      } finally {
        fetchSpy.mockRestore()
      }
    })

    it('sends no photo update for an import that did not opt into federation', async () => {
      // sendUpdateNoteJob consults no opt-in of its own, and Mastodon
      // synthesises a Create for an unseen object younger than about a day —
      // so an ungated Update publishes a status that deliberately stayed
      // local (such as a recovery sweep) just because it had a photo.
      database.getAttachments.mockResolvedValue([])
      database.createAttachment.mockResolvedValue({} as never)
      mockGetStravaActivityPhotos.mockResolvedValueOnce([
        { id: 'photo-1', url: 'https://images.example.com/photo-1.jpg' }
      ] as never)
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response(Buffer.from('jpg'), {
          headers: { 'content-type': 'image/jpeg', 'content-length': '3' }
        })
      )

      try {
        await importStravaActivityJob(database as unknown as Database, {
          id: 'job-federation-photo-update-no-optin',
          name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
          data: {
            actorId: 'actor-1',
            stravaActivityId: '123'
          }
        })
      } finally {
        fetchSpy.mockRestore()
      }

      expect(database.createAttachment).toHaveBeenCalledTimes(1)
      expect(mockGetQueue().publish).not.toHaveBeenCalledWith(
        expect.objectContaining({ name: SEND_UPDATE_NOTE_JOB_NAME })
      )
    })

    it('sends no photo update when the process job could not be published', async () => {
      // That job is what sends the Create, so an Update would be the only
      // thing reaching the network — federating a ride just marked failed,
      // whose retry path never sends a Create of its own.
      deferOneProcessJob()
      database.getAttachments.mockResolvedValue([])
      database.createAttachment.mockResolvedValue({} as never)
      mockGetStravaActivityPhotos.mockResolvedValueOnce([
        { id: 'photo-1', url: 'https://images.example.com/photo-1.jpg' }
      ] as never)
      ;(mockGetQueue().publish as jest.Mock).mockRejectedValueOnce(
        'queue exploded'
      )
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response(Buffer.from('jpg'), {
          headers: { 'content-type': 'image/jpeg', 'content-length': '3' }
        })
      )

      try {
        await importStravaActivityJob(database as unknown as Database, {
          id: 'job-federation-photo-update-after-publish-failure',
          name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
          data: {
            actorId: 'actor-1',
            stravaActivityId: '123',
            publishSendNote: true
          }
        })
      } finally {
        fetchSpy.mockRestore()
      }

      expect(database.createAttachment).toHaveBeenCalledTimes(1)
      expect(mockGetQueue().publish).not.toHaveBeenCalledWith(
        expect.objectContaining({ name: SEND_UPDATE_NOTE_JOB_NAME })
      )
    })

    it('still reports photos as attached when the update cannot be queued', async () => {
      // The photos are on the status either way; what was lost is the Update,
      // so it must not be logged as a photo failure.
      deferOneProcessJob()
      database.getAttachments.mockResolvedValue([])
      database.createAttachment.mockResolvedValue({} as never)
      mockGetStravaActivityPhotos.mockResolvedValueOnce([
        { id: 'photo-1', url: 'https://images.example.com/photo-1.jpg' }
      ] as never)
      const publishMock = mockGetQueue().publish as jest.Mock
      publishMock.mockImplementation(async (message: { name: string }) => {
        if (message.name === SEND_UPDATE_NOTE_JOB_NAME) {
          throw new Error('queue exploded')
        }
      })
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response(Buffer.from('jpg'), {
          headers: { 'content-type': 'image/jpeg', 'content-length': '3' }
        })
      )

      try {
        await expect(
          importStravaActivityJob(database as unknown as Database, {
            id: 'job-federation-update-publish-failure',
            name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
            data: {
              actorId: 'actor-1',
              stravaActivityId: '123',
              publishSendNote: true
            }
          })
        ).resolves.toBeUndefined()
      } finally {
        fetchSpy.mockRestore()
        publishMock.mockReset()
        publishMock.mockResolvedValue(undefined)
      }

      expect(database.createAttachment).toHaveBeenCalledTimes(1)
      // The import is not demoted over a lost Update.
      expect(database.updateFitnessFileProcessingStatus).not.toHaveBeenCalled()
      // What distinguishes this from the Update publish living inside the photo
      // try/catch, which also neither threw nor demoted: there the failure was
      // reported as a photo failure, and the photos are on the status.
      expect(logger.warn).not.toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Failed to attach Strava photos to imported status'
        })
      )
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Failed to queue the update for late Strava photos'
        })
      )
    })

    it('sends an update for a merged sibling that brings its own photos', async () => {
      // The case the Update mainly exists for: the second device's webhook adds
      // its photos to a post whose Create went out with the primary's, so it
      // owns no process job of its own and the Update is the only thing that
      // can carry them across.
      mockImportFitnessFiles.mockResolvedValue([
        {
          statusId: 'status-1',
          statusCreated: false,
          primaryFitnessFileId: 'sibling-file',
          processJob: null
        }
      ])
      database.getAttachments.mockResolvedValue([])
      database.createAttachment.mockResolvedValue({} as never)
      mockGetStravaActivityPhotos.mockResolvedValueOnce([
        { id: 'photo-2', url: 'https://images.example.com/photo-2.jpg' }
      ] as never)
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response(Buffer.from('jpg'), {
          headers: { 'content-type': 'image/jpeg', 'content-length': '3' }
        })
      )

      try {
        await importStravaActivityJob(database as unknown as Database, {
          id: 'job-federation-merged-photos',
          name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
          data: {
            actorId: 'actor-1',
            stravaActivityId: '123',
            publishSendNote: true
          }
        })
      } finally {
        fetchSpy.mockRestore()
      }

      expect(getProcessPublishes()).toHaveLength(0)
      expect(
        (mockGetQueue().publish as jest.Mock).mock.calls
          .map(([message]) => message)
          .filter((message) => message.name === SEND_UPDATE_NOTE_JOB_NAME)
      ).toHaveLength(1)
    })

    it('sends no update when the activity had no photos to attach', async () => {
      deferOneProcessJob()

      await importStravaActivityJob(database as unknown as Database, {
        id: 'job-federation-no-photo-update',
        name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
        data: {
          actorId: 'actor-1',
          stravaActivityId: '123',
          publishSendNote: true
        }
      })

      expect(
        (mockGetQueue().publish as jest.Mock).mock.calls
          .map(([message]) => message)
          .filter((message) => message.name === SEND_UPDATE_NOTE_JOB_NAME)
      ).toHaveLength(0)
    })

    it('publishes no process job when the import merged the file into an existing post', async () => {
      // The sibling of a two-device ride: its files join the primary's status,
      // which already owns the single process job and the single Create.
      mockImportFitnessFiles.mockResolvedValue([
        {
          statusId: 'status-1',
          statusCreated: false,
          primaryFitnessFileId: 'sibling-file',
          processJob: null
        }
      ])

      await importStravaActivityJob(database as unknown as Database, {
        id: 'job-federation-merged',
        name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
        data: {
          actorId: 'actor-1',
          stravaActivityId: '123',
          publishSendNote: true
        }
      })

      expect(getProcessPublishes()).toHaveLength(0)
    })
  })
})
