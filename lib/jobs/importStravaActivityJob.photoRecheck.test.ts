import { Database } from '@/lib/database/types'
import { importStravaActivityJob } from '@/lib/jobs/importStravaActivityJob'
import {
  IMPORT_STRAVA_ACTIVITY_JOB_NAME,
  PROCESS_FITNESS_FILE_JOB_NAME,
  RECHECK_STRAVA_ACTIVITY_PHOTOS_JOB_NAME
} from '@/lib/jobs/names'
import { JobMessage } from '@/lib/services/queue/type'

import {
  createMockStravaDatabase,
  mockGetQueue,
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

describe('importStravaActivityJob photo re-check', () => {
  const database = createMockStravaDatabase()
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    resetStravaImportMocks(database)
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

  const runImport = (data: Record<string, unknown>) =>
    importStravaActivityJob(database as unknown as Database, {
      id: 'import-job',
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: { actorId: 'actor-1', stravaActivityId: '123', ...data }
    })

  it('queues a delayed re-check after a fresh webhook import', async () => {
    mockGetStravaActivityPhotos.mockResolvedValueOnce([photo('p1')] as never)

    await runImport({ publishSendNote: true })

    const rechecks = publishedMessages(RECHECK_STRAVA_ACTIVITY_PHOTOS_JOB_NAME)
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

  it('still attaches photos Strava gives no id on the first import', async () => {
    mockGetStravaActivityPhotos.mockResolvedValueOnce([
      { id: undefined, url: 'https://images.example.com/anonymous.jpg' }
    ] as never)

    await runImport({ publishSendNote: true })

    expect(database.createAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Strava photo 1' })
    )
  })

  it('keeps an id-less photo on a re-import once its id-named neighbour is seen', async () => {
    // Named by its place in Strava's list on the first import.
    database.getAttachments.mockResolvedValue([
      { name: 'Strava photo p1' },
      { name: 'Strava photo 2' }
    ] as never)
    mockGetStravaActivityPhotos.mockResolvedValueOnce([
      photo('p1'),
      { id: undefined, url: 'https://images.example.com/anonymous.jpg' }
    ] as never)

    await runImport({ publishSendNote: true })

    expect(database.createAttachment).not.toHaveBeenCalled()
  })

  it('does not re-check imports the webhook did not start', async () => {
    await runImport({})

    expect(
      publishedMessages(RECHECK_STRAVA_ACTIVITY_PHOTOS_JOB_NAME)
    ).toHaveLength(0)
  })

  it('does not re-check a re-import of a post that already exists', async () => {
    database.getFitnessFilesByBatchId.mockResolvedValue([
      { id: 'new-file', actorId: 'actor-1', statusId: 'status-1' }
    ] as never)
    database.getFitnessFile.mockReset().mockResolvedValue({
      id: 'new-file',
      actorId: 'actor-1',
      statusId: 'status-1',
      hasMapData: true
    } as never)

    await runImport({ publishSendNote: true })

    expect(
      publishedMessages(RECHECK_STRAVA_ACTIVITY_PHOTOS_JOB_NAME)
    ).toHaveLength(0)
  })

  it('does not re-check once four Strava photos are on the post', async () => {
    mockGetStravaActivityPhotos.mockResolvedValueOnce(
      ['p1', 'p2', 'p3', 'p4'].map(photo) as never
    )

    await runImport({ publishSendNote: true })

    expect(database.createAttachment).toHaveBeenCalledTimes(4)
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

    const rechecks = publishedMessages(RECHECK_STRAVA_ACTIVITY_PHOTOS_JOB_NAME)
    expect(rechecks).toHaveLength(1)
    expect(rechecks[0].data).toMatchObject({ publishSendNote: false })
  })
})
