import { lookup } from 'node:dns/promises'

import { Database } from '@/lib/database/types'
import { importFitnessFiles } from '@/lib/jobs/importFitnessFilesJob'
import { importStravaActivityJob } from '@/lib/jobs/importStravaActivityJob'
import {
  IMPORT_STRAVA_ACTIVITY_JOB_NAME,
  PROCESS_FITNESS_FILE_JOB_NAME,
  REGENERATE_FITNESS_MAPS_JOB_NAME,
  SEND_NOTE_JOB_NAME,
  SEND_UPDATE_NOTE_JOB_NAME
} from '@/lib/jobs/names'
import { saveFitnessFile } from '@/lib/services/fitness-files'
import { saveMedia } from '@/lib/services/medias/index'
import { getQueue } from '@/lib/services/queue'
import {
  buildGpxFromStravaStreams,
  buildTcxFromStravaStreams,
  getStravaActivity,
  getStravaActivityPhotos,
  getStravaActivityStreams,
  getValidStravaAccessToken
} from '@/lib/services/strava/activity'
import { addStatusToTimelines } from '@/lib/services/timelines'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'

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

const mockSaveFitnessFile = saveFitnessFile as jest.MockedFunction<
  typeof saveFitnessFile
>
const mockSaveMedia = saveMedia as jest.MockedFunction<typeof saveMedia>
const mockSendNotificationAlerts = vi.fn()
vi.mock('@/lib/services/notifications/sendNotificationAlerts', () => ({
  sendNotificationAlerts: (...args: unknown[]) =>
    mockSendNotificationAlerts(...args)
}))

const mockImportFitnessFiles = importFitnessFiles as jest.MockedFunction<
  typeof importFitnessFiles
>
const mockGetStravaActivity = getStravaActivity as jest.MockedFunction<
  typeof getStravaActivity
>
const mockGetStravaActivityPhotos =
  getStravaActivityPhotos as jest.MockedFunction<typeof getStravaActivityPhotos>
const mockGetStravaActivityStreams =
  getStravaActivityStreams as jest.MockedFunction<
    typeof getStravaActivityStreams
  >
const mockBuildGpxFromStravaStreams =
  buildGpxFromStravaStreams as jest.MockedFunction<
    typeof buildGpxFromStravaStreams
  >
const mockBuildTcxFromStravaStreams =
  buildTcxFromStravaStreams as jest.MockedFunction<
    typeof buildTcxFromStravaStreams
  >
const mockGetValidStravaAccessToken =
  getValidStravaAccessToken as jest.MockedFunction<
    typeof getValidStravaAccessToken
  >
const mockGetQueue = getQueue as jest.MockedFunction<typeof getQueue>
const mockAddStatusToTimelines = addStatusToTimelines as jest.MockedFunction<
  typeof addStatusToTimelines
>
const mockLookup = lookup as jest.MockedFunction<typeof lookup>

type MockDatabase = Pick<
  Database,
  | 'getActorFromId'
  | 'getFitnessSettings'
  | 'getFitnessFilesByBatchId'
  | 'getFitnessFile'
  | 'getFitnessFilesByActor'
  | 'updateFitnessFileActivityData'
  | 'getStatus'
  | 'updateNote'
  | 'getAttachments'
  | 'createAttachment'
  | 'updateFitnessSettings'
  | 'createNote'
  | 'createNotification'
  | 'getActorMutedConversationRootIds'
  | 'acquireImportLock'
  | 'releaseImportLock'
  | 'createFitnessGear'
  | 'assignFitnessFileGearIfUnset'
  | 'findFitnessGearByDeviceKey'
  | 'updateFitnessFileImportStatus'
  | 'updateFitnessFileProcessingStatus'
>

describe('importStravaActivityJob', () => {
  const database: jest.Mocked<MockDatabase> = {
    getActorFromId: vi.fn(),
    getFitnessSettings: vi.fn(),
    getFitnessFilesByBatchId: vi.fn(),
    getFitnessFile: vi.fn(),
    getFitnessFilesByActor: vi.fn(),
    updateFitnessFileActivityData: vi.fn(),
    getStatus: vi.fn(),
    updateNote: vi.fn(),
    getAttachments: vi.fn(),
    createAttachment: vi.fn(),
    updateFitnessSettings: vi.fn(),
    createNote: vi.fn(),
    createNotification: vi.fn(),
    // createNotificationWithPolicy checks the recipient's conversation-mute
    // list before persisting; the importer's recipients have none.
    getActorMutedConversationRootIds: vi.fn().mockResolvedValue([]),
    // The per-actor import lock serializes concurrent same-ride imports; in
    // tests it is always immediately granted so the critical section runs.
    acquireImportLock: vi.fn().mockResolvedValue({ token: 'lock-token' }),
    releaseImportLock: vi.fn().mockResolvedValue(true),
    createFitnessGear: vi.fn(),
    assignFitnessFileGearIfUnset: vi.fn(),
    findFitnessGearByDeviceKey: vi.fn(),
    updateFitnessFileImportStatus: vi.fn(),
    updateFitnessFileProcessingStatus: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()

    database.getActorFromId.mockResolvedValue({
      id: 'actor-1',
      username: 'testuser',
      domain: 'llun.test',
      followersUrl: 'https://llun.test/@testuser/followers'
    } as never)
    database.getFitnessSettings.mockResolvedValue({
      id: 'fitness-settings-1',
      actorId: 'actor-1',
      serviceType: 'strava',
      accessToken: 'access-token',
      defaultVisibility: 'public',
      createdAt: Date.now(),
      updatedAt: Date.now()
    })
    database.getFitnessFilesByBatchId.mockResolvedValue([])
    database.getFitnessFilesByActor.mockResolvedValue([
      {
        id: 'overlap-file',
        actorId: 'actor-1',
        statusId: 'status-overlap',
        activityStartTime: new Date('2026-01-01T00:10:00.000Z').getTime(),
        totalDurationSeconds: 1_200
      }
    ] as never)
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
    database.getStatus.mockImplementation(async ({ statusId }) => {
      if (statusId === 'status-1') {
        return {
          id: 'status-1',
          type: 'Note',
          text: ''
        } as never
      }

      return null
    })
    database.updateNote.mockResolvedValue({} as never)
    database.getAttachments.mockResolvedValue([])
    database.createAttachment.mockResolvedValue({} as never)
    database.updateFitnessSettings.mockResolvedValue({} as never)
    database.createNote.mockResolvedValue({
      id: 'status-new',
      type: 'Note',
      text: ''
    } as never)
    database.createNotification.mockResolvedValue({
      id: 'notification-1',
      actorId: 'actor-1',
      type: 'activity_import',
      sourceActorId: 'actor-1',
      isRead: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    } as never)
    mockSaveMedia.mockResolvedValue({
      id: 'media-1',
      mime_type: 'image/jpeg',
      url: 'https://llun.test/media-1.jpg',
      meta: {
        original: {
          width: 640,
          height: 480
        }
      }
    } as never)
    mockLookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }] as never)

    database.createFitnessGear.mockResolvedValue({ id: 'gear-new' } as never)
    database.assignFitnessFileGearIfUnset.mockResolvedValue(true)

    mockGetValidStravaAccessToken.mockResolvedValue('access-token')
    mockBuildTcxFromStravaStreams.mockReturnValue(null)
    mockGetStravaActivity.mockResolvedValue({
      id: 123,
      upload_id: 67890,
      name: 'Morning Run',
      distance: 5_000,
      elapsed_time: 1_500,
      total_elevation_gain: 120,
      start_date: '2026-01-01T00:00:00.000Z',
      sport_type: 'Run',
      visibility: 'everyone'
    })
    // Default: streams with GPS data
    mockGetStravaActivityStreams.mockResolvedValue({
      latlng: {
        type: 'latlng',
        data: [
          [37.7749, -122.4194],
          [37.775, -122.4195]
        ]
      },
      time: { type: 'time', data: [0, 10] }
    })
    mockBuildGpxFromStravaStreams.mockReturnValue(
      '<?xml version="1.0"?><gpx>...</gpx>'
    )
    mockSaveFitnessFile.mockResolvedValue({
      id: 'new-file',
      type: 'fitness',
      file_type: 'gpx',
      mime_type: 'application/gpx+xml',
      url: 'http://llun.test/api/v1/fitness-files/new-file',
      fileName: 'strava-123.gpx',
      size: 42
    })
    mockImportFitnessFiles.mockResolvedValue([])
    mockGetStravaActivityPhotos.mockResolvedValue([])
    mockGetQueue.mockReturnValue({
      publish: vi.fn().mockResolvedValue(undefined)
    } as never)
  })

  it('imports Strava activity via streams and forwards overlap context to fitness import', async () => {
    await importStravaActivityJob(database as unknown as Database, {
      id: 'job-1',
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: {
        actorId: 'actor-1',
        stravaActivityId: '123'
      }
    })

    expect(mockGetStravaActivityStreams).toHaveBeenCalledWith(
      expect.objectContaining({ activityId: '123' })
    )
    expect(mockSaveFitnessFile).toHaveBeenCalledWith(
      database,
      expect.anything(),
      expect.objectContaining({
        file: expect.objectContaining({ name: 'strava-123.gpx' }),
        sourceUrl: 'https://www.strava.com/activities/123'
      })
    )
    expect(mockImportFitnessFiles).toHaveBeenCalledTimes(1)
    expect(mockImportFitnessFiles).toHaveBeenCalledWith(
      database,
      expect.objectContaining({
        actorId: 'actor-1',
        fitnessFileIds: ['new-file'],
        overlapFitnessFileIds: ['overlap-file'],
        visibility: 'public'
      }),
      { deferProcessJobPublishes: true }
    )
    expect(database.updateNote).toHaveBeenCalledWith(
      expect.objectContaining({
        statusId: 'status-1'
      })
    )
  })

  it('serializes the import critical section behind a per-actor lock', async () => {
    await importStravaActivityJob(database as unknown as Database, {
      id: 'job-lock',
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: {
        actorId: 'actor-1',
        stravaActivityId: '123'
      }
    })

    expect(database.acquireImportLock).toHaveBeenCalledWith(
      expect.objectContaining({ lockKey: 'strava-import:actor-1' })
    )
    expect(database.releaseImportLock).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'lock-token' })
    )
    // The merge-deciding work runs inside the lock.
    expect(mockImportFitnessFiles).toHaveBeenCalledTimes(1)
  })

  it('does not acquire the import lock when the activity already has a status', async () => {
    database.getFitnessFilesByBatchId.mockResolvedValueOnce([
      {
        id: 'existing-file',
        actorId: 'actor-1',
        statusId: 'status-existing'
      }
    ] as never)
    database.getFitnessFile.mockReset()
    database.getFitnessFile.mockResolvedValue({
      id: 'existing-file',
      actorId: 'actor-1',
      statusId: 'status-existing',
      hasMapData: true
    } as never)
    database.getStatus.mockResolvedValueOnce({
      id: 'status-existing',
      type: 'Note',
      text: 'Already imported'
    } as never)

    await importStravaActivityJob(database as unknown as Database, {
      id: 'job-lock-skip',
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: {
        actorId: 'actor-1',
        stravaActivityId: '123'
      }
    })

    expect(database.acquireImportLock).not.toHaveBeenCalled()
    expect(mockImportFitnessFiles).not.toHaveBeenCalled()
  })

  it('seeds activity start time and duration at import so later same-ride imports can merge before processing', async () => {
    await importStravaActivityJob(database as unknown as Database, {
      id: 'job-seed',
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: {
        actorId: 'actor-1',
        stravaActivityId: '123'
      }
    })

    expect(database.updateFitnessFileActivityData).toHaveBeenCalledWith(
      'new-file',
      expect.objectContaining({
        activityStartTime: new Date('2026-01-01T00:00:00.000Z'),
        totalDurationSeconds: 1_500
      })
    )
  })

  it('seeds duration but omits activityStartTime when the activity has no start_date', async () => {
    mockGetStravaActivity.mockResolvedValue({
      id: 123,
      upload_id: 67890,
      name: 'Morning Run',
      distance: 5_000,
      elapsed_time: 1_500,
      total_elevation_gain: 120,
      sport_type: 'Run',
      visibility: 'everyone'
    })

    await importStravaActivityJob(database as unknown as Database, {
      id: 'job-no-start',
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: { actorId: 'actor-1', stravaActivityId: '123' }
    })

    const seedCall = database.updateFitnessFileActivityData.mock.calls.find(
      (call) => call[0] === 'new-file'
    )
    expect(seedCall).toBeDefined()
    expect(seedCall![1]).toMatchObject({ totalDurationSeconds: 1_500 })
    expect(seedCall![1]).not.toHaveProperty('activityStartTime')
  })

  it('does not seed activity data at import when start_date, duration, and device are all absent', async () => {
    mockGetStravaActivity.mockResolvedValue({
      id: 123,
      upload_id: 67890,
      name: 'Morning Run',
      distance: 5_000,
      elapsed_time: 0,
      moving_time: 0,
      total_elevation_gain: 120,
      sport_type: 'Run',
      visibility: 'everyone'
    })

    await importStravaActivityJob(database as unknown as Database, {
      id: 'job-empty-seed',
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: { actorId: 'actor-1', stravaActivityId: '123' }
    })

    const seedCall = database.updateFitnessFileActivityData.mock.calls.find(
      (call) => call[0] === 'new-file'
    )
    expect(seedCall).toBeUndefined()
  })

  it('uses CLI-provided Strava auth without loading fitness settings', async () => {
    mockGetValidStravaAccessToken.mockImplementationOnce(
      async ({ fitnessSettings }) => fitnessSettings.accessToken ?? null
    )

    await importStravaActivityJob(database as unknown as Database, {
      id: 'job-cli-auth',
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: {
        actorId: 'actor-1',
        stravaActivityId: '123',
        stravaAuth: {
          appId: 'strava-app-id',
          appSecret: 'strava-app-secret',
          accessToken: 'override-access-token'
        }
      }
    })

    expect(database.getFitnessSettings).not.toHaveBeenCalled()
    expect(mockGetValidStravaAccessToken).toHaveBeenCalledWith({
      database,
      fitnessSettings: expect.objectContaining({
        actorId: 'actor-1',
        serviceType: 'strava',
        clientId: 'strava-app-id',
        clientSecret: 'strava-app-secret',
        accessToken: 'override-access-token'
      })
    })
    expect(mockGetStravaActivity).toHaveBeenCalledWith({
      activityId: '123',
      accessToken: 'override-access-token'
    })
  })

  it('uses defaultVisibility from fitness settings when visibility is not queued', async () => {
    database.getFitnessSettings.mockResolvedValueOnce({
      id: 'fitness-settings-1',
      actorId: 'actor-1',
      serviceType: 'strava',
      accessToken: 'access-token',
      defaultVisibility: 'unlisted',
      createdAt: Date.now(),
      updatedAt: Date.now()
    })

    await importStravaActivityJob(database as unknown as Database, {
      id: 'job-3',
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: {
        actorId: 'actor-1',
        stravaActivityId: '124'
      }
    })

    expect(mockImportFitnessFiles).toHaveBeenCalledWith(
      database,
      expect.objectContaining({
        visibility: 'unlisted'
      }),
      { deferProcessJobPublishes: true }
    )
  })

  it('prefers queued visibility over fitness settings defaultVisibility', async () => {
    database.getFitnessSettings.mockResolvedValueOnce({
      id: 'fitness-settings-1',
      actorId: 'actor-1',
      serviceType: 'strava',
      accessToken: 'access-token',
      defaultVisibility: 'unlisted',
      createdAt: Date.now(),
      updatedAt: Date.now()
    })

    await importStravaActivityJob(database as unknown as Database, {
      id: 'job-queued-visibility',
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: {
        actorId: 'actor-1',
        stravaActivityId: '124',
        visibility: 'public'
      }
    })

    expect(mockImportFitnessFiles).toHaveBeenCalledWith(
      database,
      expect.objectContaining({
        visibility: 'public'
      }),
      { deferProcessJobPublishes: true }
    )
  })

  it('imports via fitness pipeline using TCX format as the preferred format', async () => {
    mockGetStravaActivity.mockResolvedValueOnce({
      id: 125,
      name: 'Indoor Ride',
      distance: 20_000,
      elapsed_time: 3_600,
      total_elevation_gain: 0,
      start_date: '2026-01-01T00:00:00.000Z',
      sport_type: 'VirtualRide',
      visibility: 'everyone'
    })
    mockGetStravaActivityStreams.mockResolvedValueOnce({
      time: { type: 'time', data: [0, 10, 20] }
    })
    mockBuildTcxFromStravaStreams.mockReturnValueOnce(
      '<?xml version="1.0"?><TrainingCenterDatabase>...</TrainingCenterDatabase>'
    )

    await importStravaActivityJob(database as unknown as Database, {
      id: 'job-no-gps-tcx',
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: {
        actorId: 'actor-1',
        stravaActivityId: '125'
      }
    })

    expect(mockGetStravaActivityStreams).toHaveBeenCalledWith(
      expect.objectContaining({ activityId: '125' })
    )
    expect(mockBuildTcxFromStravaStreams).toHaveBeenCalledWith(
      expect.objectContaining({ id: 125 }),
      expect.objectContaining({ time: expect.anything() })
    )
    expect(mockSaveFitnessFile).toHaveBeenCalledWith(
      database,
      expect.anything(),
      expect.objectContaining({
        file: expect.objectContaining({ name: 'strava-125.tcx' })
      })
    )
    expect(mockImportFitnessFiles).toHaveBeenCalledTimes(1)
    expect(database.createNote).not.toHaveBeenCalled()
  })

  it('falls back to a note when streams have no GPS data and no original file exists', async () => {
    mockGetStravaActivity.mockResolvedValueOnce({
      id: 125,
      name: 'Morning Run',
      distance: 5_000,
      elapsed_time: 1_500,
      total_elevation_gain: 120,
      start_date: '2026-01-01T00:00:00.000Z',
      sport_type: 'Run',
      visibility: 'everyone'
    })
    // Streams exist but have no GPS data
    mockGetStravaActivityStreams.mockResolvedValueOnce({
      time: { type: 'time', data: [0, 10, 20] }
    })
    mockBuildGpxFromStravaStreams.mockReturnValueOnce(null)

    await importStravaActivityJob(database as unknown as Database, {
      id: 'job-no-gps',
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: {
        actorId: 'actor-1',
        stravaActivityId: '125',
        publishSendNote: true
      }
    })

    expect(mockGetStravaActivityStreams).toHaveBeenCalledWith(
      expect.objectContaining({ activityId: '125' })
    )
    expect(mockBuildTcxFromStravaStreams).toHaveBeenCalledWith(
      expect.objectContaining({ id: 125 }),
      expect.objectContaining({ time: expect.anything() })
    )
    expect(mockSaveFitnessFile).not.toHaveBeenCalled()
    expect(mockImportFitnessFiles).not.toHaveBeenCalled()
    expect(database.createNote).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'actor-1',
        text: expect.stringContaining('Morning Run'),
        reply: '',
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        cc: ['https://llun.test/@testuser/followers']
      })
    )
    expect(mockAddStatusToTimelines).toHaveBeenCalledTimes(1)
    // Gated on the same opt-in as the file-backed path: this test drives the
    // webhook shape, so the fallback note federates.
    expect(mockGetQueue().publish).toHaveBeenCalledWith(
      expect.objectContaining({ name: SEND_NOTE_JOB_NAME })
    )
  })

  it('does not federate a fallback note for a caller that did not opt in', async () => {
    // A retry-all sweep or a scripts/fitness recovery run drives this same
    // branch over every streamless activity an actor has.
    mockGetStravaActivity.mockResolvedValueOnce({
      id: 125,
      name: 'Morning Run',
      distance: 5_000,
      elapsed_time: 1_500,
      total_elevation_gain: 120,
      start_date: '2026-01-01T00:00:00.000Z',
      sport_type: 'Run',
      visibility: 'everyone'
    } as never)
    mockGetStravaActivityStreams.mockResolvedValueOnce(null)

    await importStravaActivityJob(database as unknown as Database, {
      id: 'job-no-upload-no-optin',
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: {
        actorId: 'actor-1',
        stravaActivityId: '125'
      }
    })

    expect(database.createNote).toHaveBeenCalled()
    expect(mockGetQueue().publish).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: SEND_NOTE_JOB_NAME })
    )
  })

  it('uses queued visibility for fallback notes when streams have no GPS data', async () => {
    mockGetStravaActivity.mockResolvedValueOnce({
      id: 126,
      name: 'Private Morning Run',
      distance: 5_000,
      elapsed_time: 1_500,
      total_elevation_gain: 120,
      start_date: '2026-01-01T00:00:00.000Z',
      sport_type: 'Run',
      visibility: 'everyone'
    })
    mockGetStravaActivityStreams.mockResolvedValueOnce({
      time: { type: 'time', data: [0, 10, 20] }
    })
    mockBuildGpxFromStravaStreams.mockReturnValueOnce(null)

    await importStravaActivityJob(database as unknown as Database, {
      id: 'job-no-gps-private',
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: {
        actorId: 'actor-1',
        stravaActivityId: '126',
        visibility: 'private'
      }
    })

    expect(database.createNote).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'actor-1',
        text: expect.stringContaining('Private Morning Run'),
        to: ['https://llun.test/@testuser/followers'],
        cc: [],
        reply: ''
      })
    )

    // Deliberate exception (Task 1.5): the fallback note keeps its
    // deterministic sha256 URI tail for get-or-create idempotency, so unlike
    // the other status-minting sites it never passes an explicit `publicId` -
    // the row still gets a real v7 `publicId` column value, just minted by
    // the DB layer (covered by lib/database/sql/status.test.ts) rather than
    // pinned to the URI tail.
    expect(database.createNote).toHaveBeenCalledWith(
      expect.objectContaining({
        id: `actor-1/statuses/${getHashFromString('actor-1:strava-note:126')}`
      })
    )
    const [fallbackCallArgs] = database.createNote.mock.calls[0]
    expect(fallbackCallArgs).not.toHaveProperty('publicId')
  })

  it('reuses the existing fallback note when a no-export activity is replayed', async () => {
    const fallbackStatusId = `actor-1/statuses/${getHashFromString(
      'actor-1:strava-note:125'
    )}`

    mockGetStravaActivity.mockResolvedValueOnce({
      id: 125,
      name: 'Morning Run',
      distance: 5_000,
      elapsed_time: 1_500,
      total_elevation_gain: 120,
      start_date: '2026-01-01T00:00:00.000Z',
      sport_type: 'Run',
      visibility: 'everyone'
    })
    mockGetStravaActivityStreams.mockResolvedValueOnce(null)
    database.getStatus.mockImplementationOnce(async () => {
      return {
        id: fallbackStatusId,
        actorId: 'actor-1',
        type: 'Note',
        text: 'Existing fallback note',
        to: [],
        cc: []
      } as never
    })

    await importStravaActivityJob(database as unknown as Database, {
      id: 'job-no-upload-replay',
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: {
        actorId: 'actor-1',
        stravaActivityId: '125',
        publishSendNote: true
      }
    })

    expect(database.createNote).not.toHaveBeenCalled()
    expect(mockAddStatusToTimelines).toHaveBeenCalledWith(
      database,
      expect.objectContaining({
        id: fallbackStatusId
      })
    )
    expect(mockGetQueue().publish).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          actorId: 'actor-1',
          statusId: fallbackStatusId
        }
      })
    )
  })

  it('dedupes fallback note photo attachments and skips unsafe photo URLs', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: {
          'content-type': 'image/jpeg',
          'content-length': '3'
        }
      })
    )

    mockGetStravaActivity.mockResolvedValueOnce({
      id: 125,
      name: 'Morning Run',
      distance: 5_000,
      elapsed_time: 1_500,
      total_elevation_gain: 120,
      start_date: '2026-01-01T00:00:00.000Z',
      sport_type: 'Run',
      visibility: 'everyone'
    })
    mockGetStravaActivityStreams.mockResolvedValueOnce(null)
    mockGetStravaActivityPhotos.mockResolvedValueOnce([
      {
        id: 'photo-1',
        url: 'https://images.example.com/photo-1.jpg'
      },
      {
        id: 'photo-1',
        url: 'https://images.example.com/photo-1-duplicate.jpg'
      },
      {
        id: 'photo-2',
        url: 'https://127.0.0.1/private.jpg'
      }
    ])

    try {
      await importStravaActivityJob(database as unknown as Database, {
        id: 'job-no-upload-photos',
        name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
        data: {
          actorId: 'actor-1',
          stravaActivityId: '125'
        }
      })

      expect(fetchSpy).toHaveBeenCalledTimes(1)
      expect(mockSaveMedia).toHaveBeenCalledTimes(1)
      expect(database.createAttachment).toHaveBeenCalledTimes(1)
      expect(database.createAttachment).toHaveBeenCalledWith(
        expect.objectContaining({
          statusId: 'status-new',
          name: 'Strava photo photo-1'
        })
      )
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('skips oversized Strava photos without buffering or storing them', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([1]), {
        status: 200,
        headers: {
          'content-type': 'image/jpeg',
          'content-length': String(10 * 1024 * 1024 + 1)
        }
      })
    )

    mockGetStravaActivity.mockResolvedValueOnce({
      id: 126,
      name: 'Morning Run With Large Photo',
      distance: 5_000,
      elapsed_time: 1_500,
      total_elevation_gain: 120,
      start_date: '2026-01-01T00:00:00.000Z',
      sport_type: 'Run',
      visibility: 'everyone'
    })
    mockGetStravaActivityStreams.mockResolvedValueOnce(null)
    mockGetStravaActivityPhotos.mockResolvedValueOnce([
      {
        id: 'large-photo',
        url: 'https://images.example.com/large-photo.jpg'
      }
    ])

    try {
      await importStravaActivityJob(database as unknown as Database, {
        id: 'job-no-upload-oversized-photo',
        name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
        data: {
          actorId: 'actor-1',
          stravaActivityId: '126'
        }
      })

      expect(fetchSpy).toHaveBeenCalledTimes(1)
      expect(mockSaveMedia).not.toHaveBeenCalled()
      expect(database.createAttachment).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('imports via fitness pipeline using GPX as fallback when TCX is unavailable', async () => {
    mockGetStravaActivity.mockResolvedValueOnce({
      id: 125,
      name: 'Outdoor Strength',
      distance: 0,
      elapsed_time: 3_600,
      start_date: '2026-01-01T00:00:00.000Z',
      sport_type: 'WeightTraining',
      visibility: 'everyone'
    })

    await importStravaActivityJob(database as unknown as Database, {
      id: 'job-streams-gps',
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: {
        actorId: 'actor-1',
        stravaActivityId: '125'
      }
    })

    expect(mockGetStravaActivityStreams).toHaveBeenCalledWith(
      expect.objectContaining({ activityId: '125' })
    )
    expect(mockSaveFitnessFile).toHaveBeenCalledWith(
      database,
      expect.anything(),
      expect.objectContaining({
        file: expect.objectContaining({ name: 'strava-125.gpx' })
      })
    )
    expect(mockImportFitnessFiles).toHaveBeenCalledTimes(1)
    expect(database.createNote).not.toHaveBeenCalled()
  })

  it('skips re-import when a Strava batch file already has a status', async () => {
    database.getFitnessFilesByBatchId.mockResolvedValueOnce([
      {
        id: 'existing-file',
        actorId: 'actor-1',
        statusId: 'status-existing'
      }
    ] as never)
    database.getFitnessFile.mockResolvedValueOnce({
      id: 'existing-file',
      actorId: 'actor-1',
      statusId: 'status-existing'
    } as never)
    database.getStatus.mockResolvedValueOnce({
      id: 'status-existing',
      type: 'Note',
      text: 'Already imported'
    } as never)

    await importStravaActivityJob(database as unknown as Database, {
      id: 'job-2',
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: {
        actorId: 'actor-1',
        stravaActivityId: '123'
      }
    })

    expect(mockSaveFitnessFile).not.toHaveBeenCalled()
    expect(mockImportFitnessFiles).not.toHaveBeenCalled()
  })

  it('queues map regeneration when existing activity has no map', async () => {
    database.getFitnessFilesByBatchId.mockResolvedValueOnce([
      {
        id: 'existing-file',
        actorId: 'actor-1',
        statusId: 'status-existing'
      }
    ] as never)
    database.getFitnessFile.mockResolvedValueOnce({
      id: 'existing-file',
      actorId: 'actor-1',
      statusId: 'status-existing',
      hasMapData: false
    } as never)
    database.getStatus.mockResolvedValueOnce({
      id: 'status-existing',
      type: 'Note',
      text: 'Already imported'
    } as never)

    await importStravaActivityJob(database as unknown as Database, {
      id: 'job-regen-map',
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: {
        actorId: 'actor-1',
        stravaActivityId: '123'
      }
    })

    expect(mockGetQueue().publish).toHaveBeenCalledWith(
      expect.objectContaining({ name: REGENERATE_FITNESS_MAPS_JOB_NAME })
    )
  })

  it('does not queue map regeneration on a fresh import (processing handles the primary map)', async () => {
    // On a brand-new import the primary file is handed to processFitnessFileJob
    // (inside importFitnessFilesJob), which generates the single route map.
    // Publishing a regenerate-map job here too would race that job and, for a
    // file merged in as non-primary, attach a second map — the duplicate-image
    // bug. The fallback must stay quiet on fresh imports.
    const publishMock = vi.fn().mockResolvedValue(undefined)
    mockGetQueue.mockReturnValue({ publish: publishMock } as never)

    await importStravaActivityJob(database as unknown as Database, {
      id: 'job-fresh-no-regen',
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: {
        actorId: 'actor-1',
        stravaActivityId: '123'
      }
    })

    expect(publishMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: REGENERATE_FITNESS_MAPS_JOB_NAME })
    )
  })

  it('does not queue map regeneration for a merged non-primary file on re-import', async () => {
    // A re-import whose file ended up non-primary (merged into a sibling's
    // post) must not regenerate its own map.
    database.getFitnessFilesByBatchId.mockResolvedValueOnce([
      {
        id: 'existing-file',
        actorId: 'actor-1',
        statusId: 'status-existing'
      }
    ] as never)
    database.getFitnessFile.mockReset()
    database.getFitnessFile.mockResolvedValue({
      id: 'existing-file',
      actorId: 'actor-1',
      statusId: 'status-existing',
      isPrimary: false,
      hasMapData: false
    } as never)
    database.getStatus.mockResolvedValueOnce({
      id: 'status-existing',
      type: 'Note',
      text: 'Already imported'
    } as never)

    const publishMock = vi.fn().mockResolvedValue(undefined)
    mockGetQueue.mockReturnValue({ publish: publishMock } as never)

    await importStravaActivityJob(database as unknown as Database, {
      id: 'job-reimport-non-primary',
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: {
        actorId: 'actor-1',
        stravaActivityId: '123'
      }
    })

    expect(publishMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: REGENERATE_FITNESS_MAPS_JOB_NAME })
    )
  })

  it('does not opt into the import email unless its caller asked for it', async () => {
    // Retry-all and the scripts/fitness recovery tools drive this same job in
    // bulk over every failed batch for an actor, and a re-import there DOES
    // create a brand-new status. Hardcoding the opt-in inside this job would
    // mail once per recovered activity.
    await importStravaActivityJob(database as unknown as Database, {
      id: 'job-no-notify-default',
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: { actorId: 'actor-1', stravaActivityId: '123' }
    })

    expect(mockImportFitnessFiles).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ notifyOnComplete: false }),
      expect.anything()
    )
  })

  it('forwards the import email opt-in from the webhook', async () => {
    // Without this the whole feature can be switched off by deleting one
    // literal, with every test still green.
    await importStravaActivityJob(database as unknown as Database, {
      id: 'job-notify-optin',
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: {
        actorId: 'actor-1',
        stravaActivityId: '123',
        notifyOnComplete: true
      }
    })

    expect(mockImportFitnessFiles).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ notifyOnComplete: true }),
      expect.anything()
    )
  })

  it.each([
    {
      description:
        'backdates the imported post unless its caller asked otherwise',
      requested: {},
      expected: false
    },
    {
      description: 'forwards the post-at-import-time opt-in from the webhook',
      requested: { postAtImportTime: true },
      expected: true
    }
  ])('$description', async ({ requested, expected }) => {
    // Same split as notifyOnComplete and publishSendNote: the webhook carries a
    // ride that just finished, while retry-all and the scripts/fitness recovery
    // tools replay
    // activities that are already old — stamping those `now` would reorder an
    // actor's whole history around whenever the sweep happened to run.
    await importStravaActivityJob(database as unknown as Database, {
      id: 'job-post-time-forward',
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: {
        actorId: 'actor-1',
        stravaActivityId: '123',
        ...requested
      }
    })

    expect(mockImportFitnessFiles).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ postAtImportTime: expected }),
      expect.anything()
    )
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
            visibility: 'public',
            publishSendNote: true
          }
        })

        expect(mockImportFitnessFiles).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            publishSendNote: true,
            visibility: 'public'
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
    })

    it('sends no photo update for an import that did not opt into federation', async () => {
      // sendUpdateNoteJob consults no opt-in of its own, and Mastodon
      // synthesises a Create for an unseen object younger than about a day —
      // so an ungated Update publishes a status that deliberately stayed
      // local, an only_me activity included, just because it had a photo.
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

  it('defers the activity_import notification on the normal path', async () => {
    await importStravaActivityJob(database as unknown as Database, {
      id: 'job-notify-normal',
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: {
        actorId: 'actor-1',
        stravaActivityId: '123'
      }
    })

    // The notification now fires at the end of processFitnessFileJob, once the
    // route map and the parsed stats exist. Creating it here would be premature
    // under QStash, where that job is only enqueued at this point — the email
    // would arrive with an empty card in production while looking correct in
    // local dev, where NoQueue runs the job inline.
    expect(database.createNotification).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'activity_import' })
    )
  })

  it('creates activity_import notification on fallback path with activity date in group key', async () => {
    mockGetStravaActivity.mockResolvedValueOnce({
      id: 125,
      name: 'Morning Run',
      distance: 5_000,
      elapsed_time: 1_500,
      total_elevation_gain: 120,
      start_date: '2026-01-01T00:00:00.000Z',
      sport_type: 'Run',
      visibility: 'everyone'
    })
    mockGetStravaActivityStreams.mockResolvedValueOnce({
      time: { type: 'time', data: [0, 10, 20] }
    })
    mockBuildGpxFromStravaStreams.mockReturnValueOnce(null)

    await importStravaActivityJob(database as unknown as Database, {
      id: 'job-notify-fallback',
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: {
        actorId: 'actor-1',
        stravaActivityId: '125',
        notifyOnComplete: true
      }
    })

    expect(database.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'actor-1',
        type: 'activity_import',
        sourceActorId: 'actor-1',
        statusId: 'status-new',
        groupKey: 'activity_import:actor-1:2026-01-01'
      })
    )
  })

  // The positive case is covered by the group-key test above, which opts in
  // and asserts the notification is created. This is the regression guard: it
  // fails the moment the notifyOnComplete gate is removed from that branch.
  it('stays entirely silent on the fallback path without the opt-in', async () => {
    mockGetStravaActivity.mockResolvedValueOnce({
      id: 127,
      name: 'Treadmill session',
      distance: 5_000,
      elapsed_time: 1_500,
      start_date: '2026-01-01T00:00:00.000Z',
      sport_type: 'Run',
      visibility: 'everyone'
    })
    mockGetStravaActivityStreams.mockResolvedValueOnce({
      time: { type: 'time', data: [0, 10, 20] }
    })
    mockBuildGpxFromStravaStreams.mockReturnValueOnce(null)

    await importStravaActivityJob(database as unknown as Database, {
      id: 'job-fallback-silent',
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: { actorId: 'actor-1', stravaActivityId: '127' }
    })

    // Every channel, not just email. `main` produced no push from this branch,
    // so leaving push ungated would be a new one-per-activity regression for a
    // bulk recovery run.
    expect(mockSendNotificationAlerts).not.toHaveBeenCalled()
    expect(database.createNotification).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'activity_import' })
    )
  })

  it('does not create duplicate notification on re-import (normal path)', async () => {
    // Simulate re-import: statusId already exists on the fitness file
    database.getFitnessFilesByBatchId.mockResolvedValueOnce([
      {
        id: 'existing-file',
        actorId: 'actor-1',
        statusId: 'status-existing'
      }
    ] as never)
    database.getFitnessFile.mockReset()
    database.getFitnessFile.mockResolvedValue({
      id: 'existing-file',
      actorId: 'actor-1',
      statusId: 'status-existing',
      hasMapData: true
    } as never)
    database.getStatus.mockResolvedValueOnce({
      id: 'status-existing',
      type: 'Note',
      text: 'Already imported'
    } as never)

    await importStravaActivityJob(database as unknown as Database, {
      id: 'job-reimport-normal',
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: {
        actorId: 'actor-1',
        stravaActivityId: '123'
      }
    })

    expect(database.createNotification).not.toHaveBeenCalled()
    // The source link is backfilled onto the existing fitness file rather than
    // injected into the status text.
    expect(database.updateFitnessFileActivityData).toHaveBeenCalledWith(
      'existing-file',
      expect.objectContaining({
        sourceUrl: 'https://www.strava.com/activities/123'
      })
    )
  })

  it('does not create duplicate notification on re-import (fallback path)', async () => {
    mockGetStravaActivity.mockResolvedValueOnce({
      id: 126,
      name: 'Evening Walk',
      distance: 2_000,
      elapsed_time: 900,
      total_elevation_gain: 10,
      start_date: '2026-01-02T00:00:00.000Z',
      sport_type: 'Walk',
      visibility: 'everyone'
    })
    mockGetStravaActivityStreams.mockResolvedValueOnce({
      time: { type: 'time', data: [0, 10, 20] }
    })
    mockBuildGpxFromStravaStreams.mockReturnValueOnce(null)

    // The fallback note already exists
    database.getStatus.mockImplementation(async ({ statusId }) => {
      // Return existing status for the fallback post ID
      return {
        id: statusId,
        type: 'Note',
        text: 'Already created fallback'
      } as never
    })

    await importStravaActivityJob(database as unknown as Database, {
      id: 'job-reimport-fallback',
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: {
        actorId: 'actor-1',
        stravaActivityId: '126'
      }
    })

    expect(database.createNotification).not.toHaveBeenCalled()
  })

  it('skips map regeneration when existing activity already has a map', async () => {
    database.getFitnessFilesByBatchId.mockResolvedValueOnce([
      {
        id: 'existing-file',
        actorId: 'actor-1',
        statusId: 'status-existing'
      }
    ] as never)
    database.getFitnessFile.mockReset()
    database.getFitnessFile.mockResolvedValue({
      id: 'existing-file',
      actorId: 'actor-1',
      statusId: 'status-existing',
      hasMapData: true
    } as never)
    database.getStatus.mockResolvedValueOnce({
      id: 'status-existing',
      type: 'Note',
      text: 'Already imported'
    } as never)

    const publishMock = vi.fn().mockResolvedValue(undefined)
    mockGetQueue.mockReturnValueOnce({ publish: publishMock } as never)

    await importStravaActivityJob(database as unknown as Database, {
      id: 'job-skip-regen-map',
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: {
        actorId: 'actor-1',
        stravaActivityId: '123'
      }
    })

    expect(publishMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: REGENERATE_FITNESS_MAPS_JOB_NAME })
    )
  })
  describe('gear attribution', () => {
    // Strava's own `gear_id` is deliberately not read. Attribution comes from
    // the athlete's shed instead, applied by `processFitnessFileJob` from the
    // gear whose `defaultSports` claims the parsed sport — the mapping the
    // Strava settings page edits. Importing Strava's value used to create a
    // local gear row per Strava id, with a `kind` guessed from an undocumented
    // id prefix and immutable once wrong.
    const rideWithGear = {
      id: 123,
      name: 'Morning Ride',
      start_date: '2026-01-01T00:00:00.000Z',
      sport_type: 'Ride',
      visibility: 'everyone',
      gear_id: 'b1234567'
    }

    it('never creates gear from the activity gear id', async () => {
      mockGetStravaActivity.mockResolvedValue(rideWithGear as never)

      await importStravaActivityJob(database as unknown as Database, {
        id: 'job-gear-new',
        name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
        data: { actorId: 'actor-1', stravaActivityId: '123' }
      })

      expect(database.createFitnessGear).not.toHaveBeenCalled()
      expect(database.assignFitnessFileGearIfUnset).not.toHaveBeenCalled()
      // The ride itself still imported.
      expect(mockSaveFitnessFile).toHaveBeenCalled()
    })

    it('never attributes a re-imported file from the activity gear id', async () => {
      mockGetStravaActivity.mockResolvedValue(rideWithGear as never)
      database.getFitnessFilesByBatchId.mockResolvedValueOnce([
        {
          id: 'existing-file',
          actorId: 'actor-1',
          statusId: 'status-existing'
        }
      ] as never)
      database.getFitnessFile.mockReset()
      database.getFitnessFile.mockResolvedValue({
        id: 'existing-file',
        actorId: 'actor-1',
        statusId: 'status-existing'
      } as never)
      database.getStatus.mockResolvedValueOnce({
        id: 'status-existing',
        type: 'Note',
        text: 'Already imported'
      } as never)

      await importStravaActivityJob(database as unknown as Database, {
        id: 'job-gear-backfill',
        name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
        data: { actorId: 'actor-1', stravaActivityId: '123' }
      })

      expect(database.createFitnessGear).not.toHaveBeenCalled()
      expect(database.assignFitnessFileGearIfUnset).not.toHaveBeenCalled()
    })
  })

  describe('recording device', () => {
    // The device is NOT Strava's gear: it is the head unit the activity was
    // recorded on, which Strava reports as `device_name` and which the
    // importer already stores. What is new is that it now resolves to a gear
    // row of its own.
    const rideWithDevice = {
      id: 321,
      name: 'Morning Ride',
      start_date: '2026-01-01T00:00:00.000Z',
      sport_type: 'Ride',
      visibility: 'everyone',
      device_name: 'Wahoo ELEMNT BOLT'
    }

    it('creates the device row and stamps it on a first import', async () => {
      mockGetStravaActivity.mockResolvedValue(rideWithDevice as never)
      database.findFitnessGearByDeviceKey.mockResolvedValue(null)
      database.createFitnessGear.mockResolvedValue({
        id: 'device-1',
        actorId: 'actor-1',
        kind: 'device',
        name: 'Wahoo ELEMNT BOLT',
        defaultSports: [],
        createdAt: 1000,
        updatedAt: 1000
      })

      await importStravaActivityJob(database as unknown as Database, {
        id: 'job-device-new',
        name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
        data: { actorId: 'actor-1', stravaActivityId: '321' }
      })

      expect(database.createFitnessGear).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'device',
          deviceKey: 'name:wahoo elemnt bolt'
        })
      )
      expect(database.updateFitnessFileActivityData).toHaveBeenCalledWith(
        'new-file',
        { deviceGearId: 'device-1' }
      )
    })

    it('links a re-imported file from the device fields it already carries', async () => {
      // The re-import path backfills nothing when the device columns are
      // already stored, so the link has to be driven from the merged row —
      // otherwise a file imported before devices had rows never gets one.
      mockGetStravaActivity.mockResolvedValue(rideWithDevice as never)
      database.getFitnessFilesByBatchId.mockResolvedValueOnce([
        {
          id: 'existing-file',
          actorId: 'actor-1',
          statusId: 'status-existing'
        }
      ] as never)
      database.getFitnessFile.mockReset()
      database.getFitnessFile.mockResolvedValue({
        id: 'existing-file',
        actorId: 'actor-1',
        statusId: 'status-existing',
        deviceName: 'Wahoo ELEMNT BOLT',
        deviceManufacturer: 'wahoo_fitness',
        sourceUrl: 'https://www.strava.com/activities/321'
      } as never)
      database.getStatus.mockResolvedValueOnce({
        id: 'status-existing',
        type: 'Note',
        text: 'Already imported'
      } as never)
      database.findFitnessGearByDeviceKey.mockResolvedValue({
        id: 'device-1',
        actorId: 'actor-1',
        kind: 'device',
        name: 'the Bolt',
        defaultSports: [],
        createdAt: 1000,
        updatedAt: 1000
      })

      await importStravaActivityJob(database as unknown as Database, {
        id: 'job-device-reimport',
        name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
        data: { actorId: 'actor-1', stravaActivityId: '321' }
      })

      // Found, not recreated — and the owner's rename survives.
      expect(database.createFitnessGear).not.toHaveBeenCalled()
      expect(database.updateFitnessFileActivityData).toHaveBeenCalledWith(
        'existing-file',
        { deviceGearId: 'device-1' }
      )
    })

    it('imports the ride anyway when the device lookup fails', async () => {
      mockGetStravaActivity.mockResolvedValue(rideWithDevice as never)
      database.findFitnessGearByDeviceKey.mockRejectedValue(
        new Error('connection reset')
      )

      await importStravaActivityJob(database as unknown as Database, {
        id: 'job-device-failure',
        name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
        data: { actorId: 'actor-1', stravaActivityId: '321' }
      })

      expect(mockSaveFitnessFile).toHaveBeenCalled()
      expect(mockImportFitnessFiles).toHaveBeenCalled()
    })
  })
})
