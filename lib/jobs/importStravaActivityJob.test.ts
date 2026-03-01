import { Database } from '@/lib/database/types'
import { importFitnessFilesJob } from '@/lib/jobs/importFitnessFilesJob'
import { importStravaActivityJob } from '@/lib/jobs/importStravaActivityJob'
import {
  IMPORT_FITNESS_FILES_JOB_NAME,
  IMPORT_STRAVA_ACTIVITY_JOB_NAME
} from '@/lib/jobs/names'
import { saveFitnessFile } from '@/lib/services/fitness-files'
import {
  downloadStravaActivityFile,
  getStravaActivity,
  getStravaActivityPhotos,
  getValidStravaAccessToken
} from '@/lib/services/strava/activity'

jest.mock('@/lib/services/fitness-files', () => ({
  saveFitnessFile: jest.fn()
}))

jest.mock('@/lib/jobs/importFitnessFilesJob', () => ({
  importFitnessFilesJob: jest.fn()
}))

jest.mock('@/lib/services/strava/activity', () => {
  const actual = jest.requireActual('@/lib/services/strava/activity')
  return {
    ...actual,
    downloadStravaActivityFile: jest.fn(),
    getStravaActivity: jest.fn(),
    getStravaActivityPhotos: jest.fn(),
    getValidStravaAccessToken: jest.fn()
  }
})

const mockSaveFitnessFile = saveFitnessFile as jest.MockedFunction<
  typeof saveFitnessFile
>
const mockImportFitnessFilesJob = importFitnessFilesJob as jest.MockedFunction<
  typeof importFitnessFilesJob
>
const mockDownloadStravaActivityFile =
  downloadStravaActivityFile as jest.MockedFunction<
    typeof downloadStravaActivityFile
  >
const mockGetStravaActivity = getStravaActivity as jest.MockedFunction<
  typeof getStravaActivity
>
const mockGetStravaActivityPhotos =
  getStravaActivityPhotos as jest.MockedFunction<typeof getStravaActivityPhotos>
const mockGetValidStravaAccessToken =
  getValidStravaAccessToken as jest.MockedFunction<
    typeof getValidStravaAccessToken
  >

type MockDatabase = Pick<
  Database,
  | 'getActorFromId'
  | 'getFitnessSettings'
  | 'getFitnessFilesByBatchId'
  | 'getFitnessFile'
  | 'getFitnessFilesByActor'
  | 'getStatus'
  | 'updateNote'
  | 'getAttachments'
  | 'createAttachment'
  | 'updateFitnessSettings'
>

describe('importStravaActivityJob', () => {
  const database: jest.Mocked<MockDatabase> = {
    getActorFromId: jest.fn(),
    getFitnessSettings: jest.fn(),
    getFitnessFilesByBatchId: jest.fn(),
    getFitnessFile: jest.fn(),
    getFitnessFilesByActor: jest.fn(),
    getStatus: jest.fn(),
    updateNote: jest.fn(),
    getAttachments: jest.fn(),
    createAttachment: jest.fn(),
    updateFitnessSettings: jest.fn()
  }

  beforeEach(() => {
    jest.clearAllMocks()

    database.getActorFromId.mockResolvedValue({
      id: 'actor-1',
      domain: 'llun.test'
    } as never)
    database.getFitnessSettings.mockResolvedValue({
      id: 'fitness-settings-1',
      actorId: 'actor-1',
      serviceType: 'strava',
      accessToken: 'access-token',
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
    database.getStatus.mockResolvedValue({
      id: 'status-1',
      type: 'Note',
      text: ''
    } as never)
    database.updateNote.mockResolvedValue({} as never)
    database.getAttachments.mockResolvedValue([])
    database.createAttachment.mockResolvedValue({} as never)
    database.updateFitnessSettings.mockResolvedValue({} as never)

    mockGetValidStravaAccessToken.mockResolvedValue('access-token')
    mockGetStravaActivity.mockResolvedValue({
      id: 123,
      name: 'Morning Run',
      distance: 5_000,
      elapsed_time: 1_500,
      total_elevation_gain: 120,
      start_date: '2026-01-01T00:00:00.000Z',
      sport_type: 'Run',
      visibility: 'everyone'
    })
    mockDownloadStravaActivityFile.mockResolvedValue(
      new File([new Uint8Array([1, 2, 3])], 'strava-123.fit', {
        type: 'application/vnd.ant.fit'
      })
    )
    mockSaveFitnessFile.mockResolvedValue({
      id: 'new-file',
      type: 'fitness',
      file_type: 'fit',
      mime_type: 'application/vnd.ant.fit',
      url: 'http://llun.test/api/v1/fitness-files/new-file',
      fileName: 'strava-123.fit',
      size: 3
    })
    mockImportFitnessFilesJob.mockResolvedValue(undefined)
    mockGetStravaActivityPhotos.mockResolvedValue([])
  })

  it('imports Strava activity and forwards overlap context to fitness import', async () => {
    await importStravaActivityJob(database as unknown as Database, {
      id: 'job-1',
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: {
        actorId: 'actor-1',
        stravaActivityId: '123'
      }
    })

    expect(mockImportFitnessFilesJob).toHaveBeenCalledTimes(1)
    expect(mockImportFitnessFilesJob).toHaveBeenCalledWith(
      database,
      expect.objectContaining({
        name: IMPORT_FITNESS_FILES_JOB_NAME,
        data: expect.objectContaining({
          actorId: 'actor-1',
          fitnessFileIds: ['new-file'],
          overlapFitnessFileIds: ['overlap-file'],
          visibility: 'public'
        })
      })
    )
    expect(database.updateNote).toHaveBeenCalledWith(
      expect.objectContaining({
        statusId: 'status-1'
      })
    )
  })

  it('maps Strava only_me visibility to direct import visibility', async () => {
    mockGetStravaActivity.mockResolvedValueOnce({
      id: 124,
      name: 'Private Session',
      distance: 2_500,
      elapsed_time: 800,
      total_elevation_gain: 20,
      start_date: '2026-01-01T00:30:00.000Z',
      sport_type: 'Run',
      visibility: 'only_me'
    })

    await importStravaActivityJob(database as unknown as Database, {
      id: 'job-3',
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: {
        actorId: 'actor-1',
        stravaActivityId: '124'
      }
    })

    expect(mockImportFitnessFilesJob).toHaveBeenCalledWith(
      database,
      expect.objectContaining({
        name: IMPORT_FITNESS_FILES_JOB_NAME,
        data: expect.objectContaining({
          visibility: 'direct'
        })
      })
    )
  })

  it('skips gracefully when the Strava activity has no exportable file', async () => {
    mockDownloadStravaActivityFile.mockResolvedValueOnce(null as never)

    await importStravaActivityJob(database as unknown as Database, {
      id: 'job-no-file',
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: {
        actorId: 'actor-1',
        stravaActivityId: '125'
      }
    })

    expect(mockSaveFitnessFile).not.toHaveBeenCalled()
    expect(mockImportFitnessFilesJob).not.toHaveBeenCalled()
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
    expect(mockImportFitnessFilesJob).not.toHaveBeenCalled()
  })
})
