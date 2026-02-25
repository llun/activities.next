import { Database } from '@/lib/database/types'
import { importStravaArchiveJob } from '@/lib/jobs/importStravaArchiveJob'
import {
  IMPORT_FITNESS_FILES_JOB_NAME,
  IMPORT_STRAVA_ARCHIVE_JOB_NAME
} from '@/lib/jobs/names'
import {
  deleteFitnessFile,
  saveFitnessFile
} from '@/lib/services/fitness-files'
import { saveMedia } from '@/lib/services/medias/index'
import {
  StravaArchiveReader,
  toStravaArchiveFitnessFilePayload
} from '@/lib/services/strava/archiveReader'

const mockQueuePublish = jest.fn()

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn().mockReturnValue({
    fitnessStorage: {
      type: 'fs',
      path: '/tmp/fitness'
    }
  })
}))

jest.mock('@/lib/services/fitness-files', () => ({
  saveFitnessFile: jest.fn(),
  deleteFitnessFile: jest.fn()
}))

jest.mock('@/lib/services/queue', () => ({
  getQueue: jest.fn(() => ({
    publish: mockQueuePublish
  }))
}))

jest.mock('@/lib/services/medias/index', () => ({
  saveMedia: jest.fn()
}))

jest.mock('@/lib/services/strava/archiveReader', () => ({
  StravaArchiveReader: {
    open: jest.fn()
  },
  toStravaArchiveFitnessFilePayload: jest.fn(),
  getArchiveMediaMimeType: jest.fn().mockReturnValue('image/jpeg')
}))

const mockSaveFitnessFile = saveFitnessFile as jest.MockedFunction<
  typeof saveFitnessFile
>
const mockDeleteFitnessFile = deleteFitnessFile as jest.MockedFunction<
  typeof deleteFitnessFile
>
const mockSaveMedia = saveMedia as jest.MockedFunction<typeof saveMedia>

const mockArchiveReaderOpen = StravaArchiveReader.open as jest.MockedFunction<
  typeof StravaArchiveReader.open
>
const mockToFitnessPayload =
  toStravaArchiveFitnessFilePayload as jest.MockedFunction<
    typeof toStravaArchiveFitnessFilePayload
  >

type MockDatabase = Pick<
  Database,
  | 'getActorFromId'
  | 'getFitnessFile'
  | 'getFitnessFilesByIds'
  | 'getStravaArchiveImportById'
  | 'updateStravaArchiveImport'
  | 'getAttachments'
  | 'createAttachment'
  | 'updateFitnessFileProcessingStatus'
  | 'updateFitnessFileImportStatus'
>

describe('importStravaArchiveJob', () => {
  const database: jest.Mocked<MockDatabase> = {
    getActorFromId: jest.fn(),
    getFitnessFile: jest.fn(),
    getFitnessFilesByIds: jest.fn(),
    getStravaArchiveImportById: jest.fn(),
    updateStravaArchiveImport: jest.fn(),
    getAttachments: jest.fn(),
    createAttachment: jest.fn(),
    updateFitnessFileProcessingStatus: jest.fn(),
    updateFitnessFileImportStatus: jest.fn()
  }

  beforeEach(() => {
    jest.clearAllMocks()

    database.getActorFromId.mockResolvedValue({
      id: 'actor-1',
      domain: 'llun.test'
    } as never)
    database.getFitnessFile.mockImplementation(async ({ id }) => {
      if (id === 'archive-file-1') {
        return {
          id: 'archive-file-1',
          actorId: 'actor-1',
          path: 'archive/path.fit'
        } as never
      }

      if (id === 'activity-file-1') {
        return {
          id: 'activity-file-1',
          actorId: 'actor-1',
          statusId: 'status-1'
        } as never
      }

      return null
    })
    database.getFitnessFilesByIds.mockResolvedValue([
      {
        id: 'activity-file-1',
        actorId: 'actor-1',
        statusId: 'status-1',
        importStatus: 'completed'
      } as never
    ])
    database.getStravaArchiveImportById.mockResolvedValue({
      id: 'import-1',
      actorId: 'actor-1',
      archiveId: 'archive-1',
      archiveFitnessFileId: 'archive-file-1',
      batchId: 'strava-archive:archive-1',
      visibility: 'private',
      status: 'importing',
      nextActivityIndex: 0,
      pendingMediaActivities: [],
      mediaAttachmentRetry: 0,
      totalActivitiesCount: undefined,
      completedActivitiesCount: 0,
      failedActivitiesCount: 0,
      firstFailureMessage: undefined,
      lastError: undefined,
      resolvedAt: undefined,
      createdAt: Date.now(),
      updatedAt: Date.now()
    } as never)
    database.updateStravaArchiveImport.mockResolvedValue({
      id: 'import-1',
      actorId: 'actor-1',
      archiveId: 'archive-1',
      archiveFitnessFileId: 'archive-file-1',
      batchId: 'strava-archive:archive-1',
      visibility: 'private',
      status: 'importing',
      nextActivityIndex: 0,
      pendingMediaActivities: [],
      mediaAttachmentRetry: 0,
      totalActivitiesCount: undefined,
      completedActivitiesCount: 0,
      failedActivitiesCount: 0,
      firstFailureMessage: undefined,
      lastError: undefined,
      resolvedAt: undefined,
      createdAt: Date.now(),
      updatedAt: Date.now()
    } as never)
    database.getAttachments.mockResolvedValue([])
    database.createAttachment.mockResolvedValue({} as never)
    database.updateFitnessFileProcessingStatus.mockResolvedValue(true)
    database.updateFitnessFileImportStatus.mockResolvedValue(true)
    mockQueuePublish.mockResolvedValue(undefined)

    mockSaveFitnessFile.mockResolvedValue({
      id: 'activity-file-1',
      type: 'fitness',
      file_type: 'fit',
      mime_type: 'application/vnd.ant.fit',
      url: 'https://llun.test/api/v1/fitness-files/activity-file-1',
      fileName: 'activity.fit',
      size: 16
    })
    mockSaveMedia.mockResolvedValue({
      id: 'media-1',
      type: 'image',
      mime_type: 'image/jpeg',
      url: 'https://llun.test/api/v1/files/media-1.webp',
      preview_url: 'https://llun.test/api/v1/files/media-1-preview.webp',
      text_url: null,
      remote_url: null,
      meta: {
        original: {
          width: 100,
          height: 80,
          size: '100x80',
          aspect: 1.25
        }
      },
      description: 'Archive media'
    })
    mockDeleteFitnessFile.mockResolvedValue(true)
    mockToFitnessPayload.mockReturnValue({
      fileType: 'fit',
      fileName: 'activity.fit',
      mimeType: 'application/vnd.ant.fit',
      buffer: Buffer.from('fitness-file')
    })

    mockArchiveReaderOpen.mockResolvedValue({
      close: jest.fn(),
      hasEntry: jest.fn().mockReturnValue(true),
      getActivities: jest.fn().mockResolvedValue([
        {
          activityId: 'activity-1',
          activityName: 'Morning Ride',
          fitnessFilePath: 'activities/activity-1.fit',
          mediaPaths: ['media/photo-1.jpg']
        }
      ]),
      readEntryBuffer: jest
        .fn()
        .mockResolvedValueOnce(Buffer.from('fitness-file'))
        .mockResolvedValueOnce(Buffer.from('media-file'))
    } as never)
  })

  it('imports activities from archive and deletes archive source file', async () => {
    await importStravaArchiveJob(database as unknown as Database, {
      id: 'job-1',
      name: IMPORT_STRAVA_ARCHIVE_JOB_NAME,
      data: {
        importId: 'import-1',
        actorId: 'actor-1',
        archiveId: 'archive-1',
        archiveFitnessFileId: 'archive-file-1',
        batchId: 'strava-archive:archive-1',
        visibility: 'private'
      }
    })

    expect(mockSaveFitnessFile).toHaveBeenCalledTimes(1)
    expect(mockQueuePublish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: IMPORT_FITNESS_FILES_JOB_NAME,
        id: expect.any(String),
        data: expect.objectContaining({
          actorId: 'actor-1',
          batchId: 'strava-archive:archive-1',
          fitnessFileIds: ['activity-file-1'],
          overlapFitnessFileIds: [],
          visibility: 'private'
        })
      })
    )
    expect(mockSaveMedia).toHaveBeenCalledTimes(1)
    expect(database.createAttachment).toHaveBeenCalledTimes(1)
    expect(mockDeleteFitnessFile).toHaveBeenCalledWith(
      database,
      'archive-file-1',
      expect.objectContaining({
        id: 'archive-file-1'
      })
    )
  })

  it('splits import into continuation when runtime budget is reached', async () => {
    let nowCall = 0
    const dateNowSpy = jest.spyOn(Date, 'now').mockImplementation(() => {
      nowCall += 1
      if (nowCall <= 2) {
        return 0
      }
      return 300_000
    })

    mockArchiveReaderOpen.mockResolvedValueOnce({
      close: jest.fn(),
      hasEntry: jest.fn().mockReturnValue(true),
      getActivities: jest.fn().mockResolvedValue([
        {
          activityId: 'activity-1',
          activityName: 'Morning Ride',
          fitnessFilePath: 'activities/activity-1.fit',
          mediaPaths: ['media/photo-1.jpg']
        },
        {
          activityId: 'activity-2',
          activityName: 'Evening Ride',
          fitnessFilePath: 'activities/activity-2.fit',
          mediaPaths: ['media/photo-2.jpg']
        }
      ]),
      readEntryBuffer: jest.fn().mockResolvedValue(Buffer.from('fitness-file'))
    } as never)

    mockSaveFitnessFile.mockResolvedValueOnce({
      id: 'activity-file-1',
      type: 'fitness',
      file_type: 'fit',
      mime_type: 'application/vnd.ant.fit',
      url: 'https://llun.test/api/v1/fitness-files/activity-file-1',
      fileName: 'activity.fit',
      size: 16
    })

    await importStravaArchiveJob(database as unknown as Database, {
      id: 'job-continue-import',
      name: IMPORT_STRAVA_ARCHIVE_JOB_NAME,
      data: {
        importId: 'import-1',
        actorId: 'actor-1',
        archiveId: 'archive-1',
        archiveFitnessFileId: 'archive-file-1',
        batchId: 'strava-archive:archive-1',
        visibility: 'private'
      }
    })

    dateNowSpy.mockRestore()

    expect(mockQueuePublish).toHaveBeenCalledTimes(2)
    expect(mockQueuePublish).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        name: IMPORT_FITNESS_FILES_JOB_NAME,
        data: expect.objectContaining({
          fitnessFileIds: ['activity-file-1']
        })
      })
    )
    expect(mockQueuePublish).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        name: IMPORT_STRAVA_ARCHIVE_JOB_NAME,
        data: expect.objectContaining({
          nextActivityIndex: 1,
          mediaAttachmentRetry: 0,
          pendingMediaActivities: [
            expect.objectContaining({
              activityId: 'activity-1',
              fitnessFileId: 'activity-file-1'
            })
          ]
        })
      })
    )
    expect(database.updateFitnessFileImportStatus).toHaveBeenCalledWith(
      'archive-file-1',
      'pending',
      'Continuing Strava archive import from activity 2/2'
    )
    expect(mockDeleteFitnessFile).not.toHaveBeenCalled()
  })

  it('keeps archive source file when import fails', async () => {
    mockArchiveReaderOpen.mockRejectedValueOnce(new Error('broken zip'))

    await importStravaArchiveJob(database as unknown as Database, {
      id: 'job-2',
      name: IMPORT_STRAVA_ARCHIVE_JOB_NAME,
      data: {
        importId: 'import-1',
        actorId: 'actor-1',
        archiveId: 'archive-1',
        archiveFitnessFileId: 'archive-file-1',
        batchId: 'strava-archive:archive-1',
        visibility: 'private'
      }
    })

    expect(mockDeleteFitnessFile).not.toHaveBeenCalled()
    expect(database.updateStravaArchiveImport).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'import-1',
        status: 'failed',
        lastError: 'broken zip'
      })
    )
  })

  it('cleans up archive source file when actor no longer exists', async () => {
    database.getActorFromId.mockResolvedValueOnce(null as never)

    await importStravaArchiveJob(database as unknown as Database, {
      id: 'job-3',
      name: IMPORT_STRAVA_ARCHIVE_JOB_NAME,
      data: {
        importId: 'import-1',
        actorId: 'actor-1',
        archiveId: 'archive-1',
        archiveFitnessFileId: 'archive-file-1',
        batchId: 'strava-archive:archive-1',
        visibility: 'private'
      }
    })

    expect(mockDeleteFitnessFile).toHaveBeenCalledWith(
      database,
      'archive-file-1',
      expect.objectContaining({
        id: 'archive-file-1'
      })
    )
  })

  it('requeues media attachment pass when imported statuses are still pending', async () => {
    database.getFitnessFilesByIds.mockResolvedValueOnce([
      {
        id: 'activity-file-1',
        actorId: 'actor-1',
        statusId: null,
        importStatus: 'pending'
      } as never
    ])

    await importStravaArchiveJob(database as unknown as Database, {
      id: 'job-4',
      name: IMPORT_STRAVA_ARCHIVE_JOB_NAME,
      data: {
        importId: 'import-1',
        actorId: 'actor-1',
        archiveId: 'archive-1',
        archiveFitnessFileId: 'archive-file-1',
        batchId: 'strava-archive:archive-1',
        visibility: 'private'
      }
    })

    expect(mockQueuePublish).toHaveBeenCalledTimes(2)
    expect(mockQueuePublish).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        name: IMPORT_STRAVA_ARCHIVE_JOB_NAME,
        data: expect.objectContaining({
          actorId: 'actor-1',
          archiveId: 'archive-1',
          archiveFitnessFileId: 'archive-file-1',
          mediaAttachmentRetry: 1,
          pendingMediaActivities: [
            expect.objectContaining({
              fitnessFileId: 'activity-file-1',
              activityId: 'activity-1',
              mediaPaths: ['media/photo-1.jpg']
            })
          ]
        })
      })
    )
    expect(database.updateFitnessFileImportStatus).toHaveBeenCalledWith(
      'archive-file-1',
      'pending',
      expect.stringContaining('Waiting for imported statuses')
    )
    expect(mockDeleteFitnessFile).not.toHaveBeenCalled()
    expect(mockSaveMedia).not.toHaveBeenCalled()
  })

  it('keeps archive source file when media retry enqueue fails', async () => {
    database.getFitnessFilesByIds.mockResolvedValueOnce([
      {
        id: 'activity-file-1',
        actorId: 'actor-1',
        statusId: null,
        importStatus: 'pending'
      } as never
    ])
    mockQueuePublish
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('queue unavailable'))

    await importStravaArchiveJob(database as unknown as Database, {
      id: 'job-5',
      name: IMPORT_STRAVA_ARCHIVE_JOB_NAME,
      data: {
        importId: 'import-1',
        actorId: 'actor-1',
        archiveId: 'archive-1',
        archiveFitnessFileId: 'archive-file-1',
        batchId: 'strava-archive:archive-1',
        visibility: 'private'
      }
    })

    expect(database.updateFitnessFileImportStatus).toHaveBeenCalledWith(
      'archive-file-1',
      'failed',
      'queue unavailable'
    )
    expect(mockDeleteFitnessFile).not.toHaveBeenCalled()
    expect(database.updateStravaArchiveImport).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'import-1',
        status: 'failed',
        lastError: 'queue unavailable'
      })
    )
  })

  it('fails and keeps archive when media retries are exhausted', async () => {
    database.getFitnessFilesByIds.mockResolvedValueOnce([
      {
        id: 'activity-file-1',
        actorId: 'actor-1',
        statusId: null,
        importStatus: 'pending'
      } as never
    ])

    await importStravaArchiveJob(database as unknown as Database, {
      id: 'job-6',
      name: IMPORT_STRAVA_ARCHIVE_JOB_NAME,
      data: {
        importId: 'import-1',
        actorId: 'actor-1',
        archiveId: 'archive-1',
        archiveFitnessFileId: 'archive-file-1',
        batchId: 'strava-archive:archive-1',
        visibility: 'private',
        mediaAttachmentRetry: 12,
        pendingMediaActivities: [
          {
            fitnessFileId: 'activity-file-1',
            activityId: 'activity-1',
            mediaPaths: ['media/photo-1.jpg']
          }
        ]
      }
    })

    expect(mockQueuePublish).toHaveBeenCalledTimes(0)
    expect(database.updateFitnessFileImportStatus).toHaveBeenCalledWith(
      'archive-file-1',
      'failed',
      expect.stringContaining(
        'Timed out waiting for imported statuses to attach archive media'
      )
    )
    expect(mockDeleteFitnessFile).not.toHaveBeenCalled()
    expect(database.updateStravaArchiveImport).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'import-1',
        status: 'failed',
        lastError:
          'Timed out waiting for imported statuses to attach archive media'
      })
    )
  })
})
