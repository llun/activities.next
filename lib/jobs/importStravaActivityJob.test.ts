import { Database } from '@/lib/database/types'
import { importStravaActivityJob } from '@/lib/jobs/importStravaActivityJob'
import {
  IMPORT_STRAVA_ACTIVITY_JOB_NAME,
  SEND_NOTE_JOB_NAME
} from '@/lib/jobs/names'
import { Visibility } from '@/lib/types/mastodon/visibility'
import { getHashFromString } from '@/lib/utils/getHashFromString'

import {
  createMockStravaDatabase,
  mockAddStatusToTimelines,
  mockBuildGpxFromStravaStreams,
  mockBuildTcxFromStravaStreams,
  mockGetQueue,
  mockGetStravaActivity,
  mockGetStravaActivityPhotos,
  mockGetStravaActivityStreams,
  mockGetValidStravaAccessToken,
  mockImportFitnessFiles,
  mockSaveFitnessFile,
  mockSaveMedia,
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
        visibility: Visibility.enum.public
      }),
      { deferProcessJobPublishes: true }
    )
    expect(database.updateNote).toHaveBeenCalledWith(
      expect.objectContaining({
        statusId: 'status-1'
      })
    )
  })

  it('passes an existing Wahoo activity as overlap context when Strava arrives second', async () => {
    database.getFitnessFilesByActor.mockResolvedValue([
      {
        id: 'wahoo-file',
        actorId: 'actor-1',
        statusId: 'wahoo-status',
        activityStartTime: Date.parse('2026-01-01T00:10:00.000Z'),
        totalDurationSeconds: 1_200
      }
    ] as never)

    await importStravaActivityJob(database as unknown as Database, {
      id: 'job-wahoo-overlap',
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: {
        actorId: 'actor-1',
        stravaActivityId: '123'
      }
    })

    expect(mockImportFitnessFiles).toHaveBeenCalledWith(
      database,
      expect.objectContaining({
        fitnessFileIds: ['new-file'],
        overlapFitnessFileIds: ['wahoo-file']
      }),
      { deferProcessJobPublishes: true }
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
      expect.objectContaining({ lockKey: 'fitness-import:actor-1' })
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
      defaultVisibility: Visibility.enum.unlisted,
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
        visibility: Visibility.enum.unlisted
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
      defaultVisibility: Visibility.enum.unlisted,
      createdAt: Date.now(),
      updatedAt: Date.now()
    })

    await importStravaActivityJob(database as unknown as Database, {
      id: 'job-queued-visibility',
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: {
        actorId: 'actor-1',
        stravaActivityId: '124',
        visibility: Visibility.enum.public
      }
    })

    expect(mockImportFitnessFiles).toHaveBeenCalledWith(
      database,
      expect.objectContaining({
        visibility: Visibility.enum.public
      }),
      { deferProcessJobPublishes: true }
    )
  })

  // `fitness_settings.defaultVisibility` is a plain varchar whose row mapper
  // asserts rather than parses, so a value the write path would have rejected
  // can still be read back. This arm — no queued visibility — is the one every
  // retry and repair path takes.
  it('falls back to private when the stored defaultVisibility is not a visibility', async () => {
    database.getFitnessSettings.mockResolvedValueOnce({
      id: 'fitness-settings-1',
      actorId: 'actor-1',
      serviceType: 'strava',
      accessToken: 'access-token',
      defaultVisibility: 'followers-only' as never,
      createdAt: Date.now(),
      updatedAt: Date.now()
    })

    await importStravaActivityJob(database as unknown as Database, {
      id: 'job-invalid-visibility',
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: {
        actorId: 'actor-1',
        stravaActivityId: '124'
      }
    })

    expect(mockImportFitnessFiles).toHaveBeenCalledWith(
      database,
      expect.objectContaining({
        visibility: Visibility.enum.private
      }),
      { deferProcessJobPublishes: true }
    )
  })

  it('falls back to private when no defaultVisibility is stored at all', async () => {
    database.getFitnessSettings.mockResolvedValueOnce({
      id: 'fitness-settings-1',
      actorId: 'actor-1',
      serviceType: 'strava',
      accessToken: 'access-token',
      createdAt: Date.now(),
      updatedAt: Date.now()
    })

    await importStravaActivityJob(database as unknown as Database, {
      id: 'job-unset-visibility',
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: {
        actorId: 'actor-1',
        stravaActivityId: '124'
      }
    })

    expect(mockImportFitnessFiles).toHaveBeenCalledWith(
      database,
      expect.objectContaining({
        visibility: Visibility.enum.private
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
      expect.objectContaining({
        name: SEND_NOTE_JOB_NAME,
        id: getHashFromString('actor-1:strava-note:125')
      })
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
    // the DB layer (covered by lib/database/sql/statusLookup.test.ts) rather than
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
})
