import { Database } from '@/lib/database/types'
import {
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
  mockGetValidStravaAccessToken,
  resetStravaImportMocks
} from './importStravaActivityJob.testUtils'

vi.mock('node:dns/promises', async () => ({
  lookup: vi.fn()
}))

// resetStravaImportMocks seeds these, so they are mocked here too.
vi.mock('@/lib/services/fitness-files', async () => ({
  saveFitnessFile: vi.fn()
}))

vi.mock('@/lib/jobs/importFitnessFilesJob', async () => ({
  importFitnessFiles: vi.fn()
}))

vi.mock('@/lib/services/timelines', async () => ({
  addStatusToTimelines: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@/lib/services/medias/index', async () => ({
  saveMedia: vi.fn()
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

describe('recheckStravaActivityPhotosJob', () => {
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
    database.getFitnessFilesByStatus.mockResolvedValue([
      { id: 'new-file', isPrimary: true, processingStatus: 'completed' }
    ] as never)
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

  it('keeps the Strava photos on a post to four, counting removed ones', async () => {
    mockGetStravaActivityPhotos.mockResolvedValueOnce(
      ['p4', 'p5', 'p6'].map(photo) as never
    )

    await runRecheck({ seenPhotoIds: ['p1', 'p2', 'p3'] })

    expect(database.createAttachment).toHaveBeenCalledTimes(1)
    expect(database.createAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Strava photo p4' })
    )
    // The cap is spent, so there is nothing left to look for.
    expect(
      publishedMessages(RECHECK_STRAVA_ACTIVITY_PHOTOS_JOB_NAME)
    ).toHaveLength(0)
  })

  it('skips photos Strava gives no id', async () => {
    mockGetStravaActivityPhotos.mockResolvedValueOnce([
      { id: undefined, url: 'https://images.example.com/anonymous.jpg' }
    ] as never)

    await runRecheck()

    expect(database.createAttachment).not.toHaveBeenCalled()
  })

  it.each([
    {
      description: 'nothing was attached',
      photos: [],
      data: {},
      setup: (): void => {}
    },
    {
      description: 'the import withheld it',
      photos: [photo('p2')],
      data: { publishSendNote: false },
      setup: (): void => {}
    },
    {
      description: 'the account moved since the import',
      photos: [photo('p2')],
      data: {},
      setup: (): void => {
        database.getActorFromId.mockResolvedValue({
          id: 'actor-1',
          username: 'testuser',
          domain: 'llun.test',
          movedTo: 'https://other.test/users/testuser'
        } as never)
      }
    },
    {
      description: 'the primary file has not finished processing',
      photos: [photo('p2')],
      data: {},
      setup: (): void => {
        database.getFitnessFilesByStatus.mockResolvedValue([
          { id: 'new-file', isPrimary: true, processingStatus: 'failed' },
          { id: 'other-file', isPrimary: false, processingStatus: 'completed' }
        ] as never)
      }
    }
  ])('sends no Update when $description', async ({ photos, data, setup }) => {
    setup()
    mockGetStravaActivityPhotos.mockResolvedValueOnce(photos as never)

    await runRecheck(data)

    expect(database.createAttachment).toHaveBeenCalledTimes(photos.length)
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
      setup: (): void => {
        database.getStatus.mockResolvedValue(null)
      }
    },
    {
      description: 'the status belongs to another actor',
      setup: (): void => {
        database.getStatus.mockResolvedValue({
          id: 'status-1',
          actorId: 'actor-2',
          type: 'Note',
          text: ''
        } as never)
      }
    },
    {
      description: 'Strava was disconnected',
      setup: (): void => {
        database.getFitnessSettings.mockResolvedValue(null)
      }
    },
    {
      description: 'the Strava token is gone',
      setup: (): void => {
        mockGetValidStravaAccessToken.mockResolvedValue(null)
      }
    }
  ])('skips quietly when $description', async ({ setup }) => {
    setup()

    await runRecheck()

    expect(mockGetStravaActivity).not.toHaveBeenCalled()
    expect(database.createAttachment).not.toHaveBeenCalled()
    expect(mockGetQueue().publish).not.toHaveBeenCalled()
  })
})
