import { lookup } from 'node:dns/promises'

import { Database } from '@/lib/database/types'
import { importFitnessFilesJob } from '@/lib/jobs/importFitnessFilesJob'
import { importStravaActivityJob } from '@/lib/jobs/importStravaActivityJob'
import {
  IMPORT_FITNESS_FILES_JOB_NAME,
  IMPORT_STRAVA_ACTIVITY_JOB_NAME,
  SEND_NOTE_JOB_NAME
} from '@/lib/jobs/names'
import { saveFitnessFile } from '@/lib/services/fitness-files'
import { saveMedia } from '@/lib/services/medias/index'
import { getQueue } from '@/lib/services/queue'
import {
  buildGpxFromStravaStreams,
  downloadStravaActivityFile,
  getStravaActivity,
  getStravaActivityPhotos,
  getStravaActivityStreams,
  getStravaUpload,
  getValidStravaAccessToken
} from '@/lib/services/strava/activity'
import { addStatusToTimelines } from '@/lib/services/timelines'
import { getHashFromString } from '@/lib/utils/getHashFromString'

jest.mock('node:dns/promises', () => ({
  lookup: jest.fn()
}))

jest.mock('@/lib/services/fitness-files', () => ({
  saveFitnessFile: jest.fn()
}))

jest.mock('@/lib/services/medias/index', () => ({
  saveMedia: jest.fn()
}))

jest.mock('@/lib/jobs/importFitnessFilesJob', () => ({
  importFitnessFilesJob: jest.fn()
}))

jest.mock('@/lib/services/strava/activity', () => {
  const actual = jest.requireActual('@/lib/services/strava/activity')
  return {
    ...actual,
    buildGpxFromStravaStreams: jest.fn(),
    downloadStravaActivityFile: jest.fn(),
    getStravaActivity: jest.fn(),
    getStravaActivityPhotos: jest.fn(),
    getStravaActivityStreams: jest.fn(),
    getStravaUpload: jest.fn(),
    getValidStravaAccessToken: jest.fn()
  }
})

jest.mock('@/lib/services/queue', () => ({
  getQueue: jest.fn().mockReturnValue({
    publish: jest.fn().mockResolvedValue(undefined)
  })
}))

jest.mock('@/lib/services/timelines', () => ({
  addStatusToTimelines: jest.fn().mockResolvedValue(undefined)
}))

const mockSaveFitnessFile = saveFitnessFile as jest.MockedFunction<
  typeof saveFitnessFile
>
const mockSaveMedia = saveMedia as jest.MockedFunction<typeof saveMedia>
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
const mockGetStravaUpload = getStravaUpload as jest.MockedFunction<
  typeof getStravaUpload
>
const mockGetStravaActivityStreams =
  getStravaActivityStreams as jest.MockedFunction<
    typeof getStravaActivityStreams
  >
const mockBuildGpxFromStravaStreams =
  buildGpxFromStravaStreams as jest.MockedFunction<
    typeof buildGpxFromStravaStreams
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
  | 'getStatus'
  | 'updateNote'
  | 'getAttachments'
  | 'createAttachment'
  | 'updateFitnessSettings'
  | 'createNote'
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
    updateFitnessSettings: jest.fn(),
    createNote: jest.fn()
  }

  beforeEach(() => {
    jest.clearAllMocks()

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

    mockGetValidStravaAccessToken.mockResolvedValue('access-token')
    // Default activity includes upload_id — was uploaded with a file
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
    // Default upload is ready
    mockGetStravaUpload.mockResolvedValue({
      id: 67890,
      activity_id: 123,
      error: null,
      status: 'Your activity is ready.'
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
    mockGetQueue.mockReturnValue({
      publish: jest.fn().mockResolvedValue(undefined)
    } as never)
    // Default: no streams available (upload_id path is used by default)
    mockGetStravaActivityStreams.mockResolvedValue(null)
    mockBuildGpxFromStravaStreams.mockReturnValue(null)
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

    expect(mockGetStravaUpload).toHaveBeenCalledWith(
      expect.objectContaining({ uploadId: 67890 })
    )
    expect(mockDownloadStravaActivityFile).toHaveBeenCalledTimes(1)
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
      upload_id: 67891,
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

  it('tries streams API when activity has no upload_id and falls back to a note when no GPS data', async () => {
    mockGetStravaActivity.mockResolvedValueOnce({
      id: 125,
      // No upload_id — manually created activity with no GPS
      name: 'Morning Run',
      distance: 5_000,
      elapsed_time: 1_500,
      total_elevation_gain: 120,
      start_date: '2026-01-01T00:00:00.000Z',
      sport_type: 'Run',
      visibility: 'everyone'
    })
    // Streams exist but have no latlng data
    mockGetStravaActivityStreams.mockResolvedValueOnce({
      time: { type: 'time', data: [0, 10, 20] }
    })
    mockBuildGpxFromStravaStreams.mockReturnValueOnce(null)

    await importStravaActivityJob(database as unknown as Database, {
      id: 'job-no-upload',
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: {
        actorId: 'actor-1',
        stravaActivityId: '125'
      }
    })

    expect(mockGetStravaUpload).not.toHaveBeenCalled()
    expect(mockDownloadStravaActivityFile).not.toHaveBeenCalled()
    expect(mockGetStravaActivityStreams).toHaveBeenCalledWith(
      expect.objectContaining({ activityId: '125' })
    )
    expect(mockSaveFitnessFile).not.toHaveBeenCalled()
    expect(mockImportFitnessFilesJob).not.toHaveBeenCalled()
    expect(database.createNote).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'actor-1',
        text: expect.stringContaining('Morning Run'),
        reply: ''
      })
    )
    expect(mockAddStatusToTimelines).toHaveBeenCalledTimes(1)
    expect(mockGetQueue().publish).toHaveBeenCalledWith(
      expect.objectContaining({ name: SEND_NOTE_JOB_NAME })
    )
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
        stravaActivityId: '125'
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
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: {
          'content-type': 'image/jpeg'
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

  it('imports via fitness pipeline using streams GPX when no upload_id but streams have GPS data', async () => {
    mockGetStravaActivity.mockResolvedValueOnce({
      id: 125,
      // No upload_id — but activity has GPS data in streams
      name: 'Outdoor Strength',
      distance: 0,
      elapsed_time: 3_600,
      start_date: '2026-01-01T00:00:00.000Z',
      sport_type: 'WeightTraining',
      visibility: 'everyone'
    })
    mockGetStravaActivityStreams.mockResolvedValueOnce({
      latlng: {
        type: 'latlng',
        data: [
          [37.7749, -122.4194],
          [37.775, -122.4195]
        ]
      },
      time: { type: 'time', data: [0, 10] }
    })
    mockBuildGpxFromStravaStreams.mockReturnValueOnce(
      '<?xml version="1.0"?><gpx>...</gpx>'
    )

    await importStravaActivityJob(database as unknown as Database, {
      id: 'job-streams-gps',
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: {
        actorId: 'actor-1',
        stravaActivityId: '125'
      }
    })

    expect(mockGetStravaUpload).not.toHaveBeenCalled()
    expect(mockDownloadStravaActivityFile).not.toHaveBeenCalled()
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
    expect(mockImportFitnessFilesJob).toHaveBeenCalledTimes(1)
    expect(database.createNote).not.toHaveBeenCalled()
  })

  it('creates a note without attempting file download when upload has an error', async () => {
    mockGetStravaUpload.mockResolvedValueOnce({
      id: 67890,
      activity_id: null,
      error: 'There was an error processing your activity.',
      status: 'There was an error processing your activity.'
    })

    await importStravaActivityJob(database as unknown as Database, {
      id: 'job-upload-error',
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: {
        actorId: 'actor-1',
        stravaActivityId: '123'
      }
    })

    expect(mockDownloadStravaActivityFile).not.toHaveBeenCalled()
    expect(mockImportFitnessFilesJob).not.toHaveBeenCalled()
    expect(database.createNote).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'actor-1' })
    )
  })

  it('throws a retryable error when upload is still being processed', async () => {
    mockGetStravaUpload.mockResolvedValueOnce({
      id: 67890,
      activity_id: null,
      error: null,
      status: 'Your activity is still being processed.'
    })

    await expect(
      importStravaActivityJob(database as unknown as Database, {
        id: 'job-upload-processing',
        name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
        data: {
          actorId: 'actor-1',
          stravaActivityId: '123'
        }
      })
    ).rejects.toThrow()

    expect(mockDownloadStravaActivityFile).not.toHaveBeenCalled()
    expect(mockImportFitnessFilesJob).not.toHaveBeenCalled()
    expect(database.createNote).not.toHaveBeenCalled()
  })

  it('falls back to file download when getStravaUpload returns null for activity with upload_id', async () => {
    mockGetStravaUpload.mockResolvedValueOnce(null)

    await importStravaActivityJob(database as unknown as Database, {
      id: 'job-upload-null',
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: {
        actorId: 'actor-1',
        stravaActivityId: '123'
      }
    })

    expect(mockDownloadStravaActivityFile).toHaveBeenCalledTimes(1)
    expect(mockImportFitnessFilesJob).toHaveBeenCalledTimes(1)
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
