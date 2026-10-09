import { Database } from '@/lib/database/types'
import { importStravaActivityJob } from '@/lib/jobs/importStravaActivityJob'
import { IMPORT_STRAVA_ACTIVITY_JOB_NAME } from '@/lib/jobs/names'

import {
  createMockStravaDatabase,
  mockBuildGpxFromStravaStreams,
  mockGetStravaActivity,
  mockGetStravaActivityStreams,
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
})
