import { Database } from '@/lib/database/types'
import { importStravaActivityJob } from '@/lib/jobs/importStravaActivityJob'
import {
  IMPORT_STRAVA_ACTIVITY_JOB_NAME,
  PROCESS_FITNESS_FILE_JOB_NAME,
  RECHECK_STRAVA_ACTIVITY_PHOTOS_JOB_NAME,
  SEND_UPDATE_NOTE_JOB_NAME
} from '@/lib/jobs/names'
import { recheckStravaActivityPhotosJob } from '@/lib/jobs/recheckStravaActivityPhotosJob'
import { JobMessage } from '@/lib/services/queue/type'

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
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

const photo = (id: string) => ({
  id,
  url: `https://images.example.com/${id}.jpg`
})

const publishedMessages = (name: string): JobMessage[] =>
  (mockGetQueue().publish as jest.Mock).mock.calls
    .map(([message]) => message as JobMessage)
    .filter((message) => message.name === name)

describe('Strava photo re-check', () => {
  const database = createMockStravaDatabase()
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    resetStravaImportMocks(database)
    database.getStatus.mockResolvedValue({
      id: 'status-1',
      actorId: 'actor-1',
      type: 'Note',
      text: 'Ride'
    } as never)
    fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response(Buffer.from('jpg'), {
          headers: { 'content-type': 'image/jpeg', 'content-length': '3' }
        })
      )
    )
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  describe('importStravaActivityJob', () => {
    const runImport = (data: Record<string, unknown>) =>
      importStravaActivityJob(database as unknown as Database, {
        id: 'import-job',
        name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
        data: { actorId: 'actor-1', stravaActivityId: '123', ...data }
      })

    it('queues a delayed re-check after a fresh webhook import', async () => {
      mockGetStravaActivityPhotos.mockResolvedValueOnce([photo('p1')] as never)

      await runImport({ publishSendNote: true })

      const rechecks = publishedMessages(
        RECHECK_STRAVA_ACTIVITY_PHOTOS_JOB_NAME
      )
      expect(rechecks).toHaveLength(1)
      expect(rechecks[0].delaySeconds).toBe(600)
      expect(rechecks[0].data).toEqual({
        actorId: 'actor-1',
        statusId: 'status-1',
        stravaActivityId: '123',
        seenPhotoIds: ['p1'],
        publishSendNote: true,
        attempt: 0
      })
    })

    it('does not re-check imports the webhook did not start', async () => {
      await runImport({})

      expect(
        publishedMessages(RECHECK_STRAVA_ACTIVITY_PHOTOS_JOB_NAME)
      ).toHaveLength(0)
    })

    it('withholds the Update from the re-check when the process job failed to queue', async () => {
      mockImportFitnessFiles.mockResolvedValue([
        {
          statusId: 'status-1',
          statusCreated: true,
          primaryFitnessFileId: 'new-file',
          processJob: {
            id: 'process-job',
            name: PROCESS_FITNESS_FILE_JOB_NAME,
            data: {}
          }
        }
      ] as never)
      const publish = mockGetQueue().publish as jest.Mock
      publish.mockImplementation(async (message: JobMessage) => {
        if (message.name === PROCESS_FITNESS_FILE_JOB_NAME) {
          throw new Error('queue down')
        }
      })

      await runImport({ publishSendNote: true })

      const rechecks = publishedMessages(
        RECHECK_STRAVA_ACTIVITY_PHOTOS_JOB_NAME
      )
      expect(rechecks).toHaveLength(1)
      expect(rechecks[0].data).toMatchObject({ publishSendNote: false })
    })
  })

  describe('recheckStravaActivityPhotosJob', () => {
    const runRecheck = (data: Record<string, unknown> = {}) =>
      recheckStravaActivityPhotosJob(database as unknown as Database, {
        id: 'recheck-job',
        name: RECHECK_STRAVA_ACTIVITY_PHOTOS_JOB_NAME,
        data: {
          actorId: 'actor-1',
          statusId: 'status-1',
          stravaActivityId: '123',
          seenPhotoIds: [],
          publishSendNote: true,
          attempt: 0,
          ...data
        }
      })

    it('attaches late photos, sends an Update and queues the next check', async () => {
      mockGetStravaActivityPhotos.mockResolvedValueOnce([
        photo('p1'),
        photo('p2')
      ] as never)

      await runRecheck({ seenPhotoIds: ['p1'] })

      // p1 was on the status once and is gone now: the owner removed it.
      expect(database.createAttachment).toHaveBeenCalledTimes(1)
      expect(database.createAttachment).toHaveBeenCalledWith(
        expect.objectContaining({
          statusId: 'status-1',
          name: 'Strava photo p2'
        })
      )
      expect(publishedMessages(SEND_UPDATE_NOTE_JOB_NAME)).toEqual([
        expect.objectContaining({
          data: { actorId: 'actor-1', statusId: 'status-1' }
        })
      ])
      const next = publishedMessages(RECHECK_STRAVA_ACTIVITY_PHOTOS_JOB_NAME)
      expect(next).toHaveLength(1)
      expect(next[0].delaySeconds).toBe(3000)
      expect(next[0].data).toMatchObject({
        attempt: 1,
        seenPhotoIds: ['p1', 'p2']
      })
    })

    it('sends no Update when nothing was attached or the import withheld it', async () => {
      mockGetStravaActivityPhotos.mockResolvedValueOnce([])
      await runRecheck()

      mockGetStravaActivityPhotos.mockResolvedValueOnce([photo('p2')] as never)
      await runRecheck({ publishSendNote: false })

      expect(database.createAttachment).toHaveBeenCalledTimes(1)
      expect(publishedMessages(SEND_UPDATE_NOTE_JOB_NAME)).toHaveLength(0)
    })

    it('stops after the last scheduled check', async () => {
      mockGetStravaActivityPhotos.mockResolvedValueOnce([])

      await runRecheck({ attempt: 1 })

      expect(
        publishedMessages(RECHECK_STRAVA_ACTIVITY_PHOTOS_JOB_NAME)
      ).toHaveLength(0)
    })

    it('still queues the next check when Strava fails', async () => {
      mockGetStravaActivity.mockRejectedValueOnce(new Error('Strava 500'))

      await runRecheck()

      expect(database.createAttachment).not.toHaveBeenCalled()
      expect(
        publishedMessages(RECHECK_STRAVA_ACTIVITY_PHOTOS_JOB_NAME)
      ).toHaveLength(1)
    })

    it.each([
      {
        description: 'the status was deleted',
        setup: () => database.getStatus.mockResolvedValue(null)
      },
      {
        description: 'Strava was disconnected',
        setup: () => database.getFitnessSettings.mockResolvedValue(null)
      }
    ])('skips quietly when $description', async ({ setup }) => {
      setup()

      await runRecheck()

      expect(mockGetStravaActivity).not.toHaveBeenCalled()
      expect(mockGetQueue().publish).not.toHaveBeenCalled()
    })
  })
})
