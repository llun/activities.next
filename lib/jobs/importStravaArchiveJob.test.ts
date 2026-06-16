import { S3Client } from '@aws-sdk/client-s3'
import fs from 'fs/promises'
import { Readable } from 'stream'

import { getConfig } from '@/lib/config'
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
import { MAX_ATTACHMENTS } from '@/lib/services/medias/constants'
import { saveMedia } from '@/lib/services/medias/index'
import {
  StravaArchiveLimitError,
  StravaArchiveReader,
  toStravaArchiveFitnessFilePayload
} from '@/lib/services/strava/archiveReader'

const mockQueuePublish = vi.fn()
const mockS3Send = vi.fn()

vi.mock('@aws-sdk/client-s3', async () => ({
  GetObjectCommand: vi.fn().mockImplementation((input) => ({ input })),
  S3Client: vi.fn().mockImplementation(() => ({
    send: mockS3Send
  }))
}))

vi.mock('@/lib/config', async () => ({
  getConfig: vi.fn()
}))

vi.mock('@/lib/services/fitness-files', async () => ({
  ...(await vi.importActual('@/lib/services/fitness-files')),
  saveFitnessFile: vi.fn(),
  deleteFitnessFile: vi.fn()
}))

vi.mock('@/lib/services/queue', async () => ({
  getQueue: vi.fn(() => ({
    publish: mockQueuePublish
  }))
}))

vi.mock('@/lib/services/medias/index', async () => ({
  saveMedia: vi.fn()
}))

vi.mock('@/lib/services/strava/archiveReader', async () => ({
  StravaArchiveLimitError: (
    await vi.importActual<typeof import('@/lib/services/strava/archiveReader')>(
      '@/lib/services/strava/archiveReader'
    )
  ).StravaArchiveLimitError,
  StravaArchiveReader: {
    open: vi.fn()
  },
  toStravaArchiveFitnessFilePayload: vi.fn(),
  getArchiveMediaMimeType: vi.fn().mockReturnValue('image/jpeg')
}))

const mockSaveFitnessFile = saveFitnessFile as jest.MockedFunction<
  typeof saveFitnessFile
>
const mockDeleteFitnessFile = deleteFitnessFile as jest.MockedFunction<
  typeof deleteFitnessFile
>
const mockSaveMedia = saveMedia as jest.MockedFunction<typeof saveMedia>
const mockGetConfig = getConfig as jest.MockedFunction<typeof getConfig>

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
  | 'getFitnessFilesByBatchId'
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
    getActorFromId: vi.fn(),
    getFitnessFile: vi.fn(),
    getFitnessFilesByBatchId: vi.fn(),
    getFitnessFilesByIds: vi.fn(),
    getStravaArchiveImportById: vi.fn(),
    updateStravaArchiveImport: vi.fn(),
    getAttachments: vi.fn(),
    createAttachment: vi.fn(),
    updateFitnessFileProcessingStatus: vi.fn(),
    updateFitnessFileImportStatus: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetConfig.mockReturnValue({
      fitnessStorage: {
        type: 'fs',
        path: '/tmp/fitness'
      }
    } as never)

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
    database.getFitnessFilesByBatchId.mockResolvedValue([])
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
      close: vi.fn(),
      hasEntry: vi.fn().mockReturnValue(true),
      getActivities: vi.fn().mockResolvedValue([
        {
          activityId: 'activity-1',
          activityName: 'Morning Ride',
          fitnessFilePath: 'activities/activity-1.fit',
          mediaPaths: ['media/photo-1.jpg']
        }
      ]),
      readEntryBuffer: vi
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
    // activity-1 is a non-numeric (filename-style) id, so no Strava URL is built.
    expect(mockSaveFitnessFile).toHaveBeenCalledWith(
      database,
      expect.anything(),
      expect.objectContaining({ sourceUrl: undefined })
    )
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

  it('saves the Strava activity URL as sourceUrl for a numeric activity id', async () => {
    mockArchiveReaderOpen.mockResolvedValueOnce({
      close: vi.fn(),
      hasEntry: vi.fn().mockReturnValue(true),
      getActivities: vi.fn().mockResolvedValue([
        {
          activityId: '987654321',
          activityName: 'Morning Ride',
          fitnessFilePath: 'activities/987654321.fit',
          mediaPaths: []
        }
      ]),
      readEntryBuffer: vi
        .fn()
        .mockResolvedValueOnce(Buffer.from('fitness-file'))
    } as never)

    await importStravaArchiveJob(database as unknown as Database, {
      id: 'job-numeric',
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

    expect(mockSaveFitnessFile).toHaveBeenCalledWith(
      database,
      expect.anything(),
      expect.objectContaining({
        sourceUrl: 'https://www.strava.com/activities/987654321'
      })
    )
  })

  it('opens archive entries with the configured fitness file size limit', async () => {
    mockGetConfig.mockReturnValue({
      fitnessStorage: {
        type: 'fs',
        path: '/tmp/fitness',
        maxFileSize: 123_456_789
      }
    } as never)

    await importStravaArchiveJob(database as unknown as Database, {
      id: 'job-configured-reader-limit',
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

    expect(mockArchiveReaderOpen).toHaveBeenCalledWith(
      '/tmp/fitness/archive/path.fit',
      {
        limits: {
          maxEntryCompressedBytes: 123_456_789,
          maxEntryUncompressedBytes: 123_456_789,
          maxGzipOutputBytes: 123_456_789
        }
      }
    )
    expect(mockToFitnessPayload).toHaveBeenCalledWith(
      {
        fitnessFilePath: 'activities/activity-1.fit',
        buffer: Buffer.from('fitness-file')
      },
      {
        maxGzipOutputBytes: 123_456_789
      }
    )
  })

  it('uses the configured fitness storage endpoint when reading object-storage archives', async () => {
    mockGetConfig.mockReturnValue({
      fitnessStorage: {
        type: 'object',
        bucket: 'fitness-bucket',
        region: 'auto',
        endpoint: 'https://storage.example.com',
        prefix: ''
      }
    } as never)
    mockS3Send.mockResolvedValueOnce({
      Body: Readable.from([Buffer.from('zip-file')]),
      ContentLength: 8
    })

    await importStravaArchiveJob(database as unknown as Database, {
      id: 'job-object-endpoint',
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

    expect(S3Client).toHaveBeenCalledWith({
      region: 'auto',
      endpoint: 'https://storage.example.com',
      forcePathStyle: true
    })
  })

  it('splits import into continuation when runtime budget is reached', async () => {
    let nowCall = 0
    const dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
      nowCall += 1
      if (nowCall <= 2) {
        return 0
      }
      return 300_000
    })

    mockArchiveReaderOpen.mockResolvedValueOnce({
      close: vi.fn(),
      hasEntry: vi.fn().mockReturnValue(true),
      getActivities: vi.fn().mockResolvedValue([
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
      readEntryBuffer: vi.fn().mockResolvedValue(Buffer.from('fitness-file'))
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

  it('attaches valid media paths even when earlier paths are missing', async () => {
    database.getAttachments.mockResolvedValueOnce(
      Array.from({ length: MAX_ATTACHMENTS - 1 }, (_, index) => ({
        id: `attachment-${index}`,
        statusId: 'status-1',
        actorId: 'actor-1'
      })) as never
    )

    mockArchiveReaderOpen.mockResolvedValueOnce({
      close: vi.fn(),
      hasEntry: vi
        .fn()
        .mockImplementation(
          (entryPath: string) => entryPath !== 'media/missing.jpg'
        ),
      getActivities: vi.fn().mockResolvedValue([
        {
          activityId: 'activity-1',
          activityName: 'Morning Ride',
          fitnessFilePath: 'activities/activity-1.fit',
          mediaPaths: ['media/missing.jpg', 'media/photo-2.jpg']
        }
      ]),
      readEntryBuffer: vi
        .fn()
        .mockResolvedValueOnce(Buffer.from('fitness-file'))
        .mockResolvedValueOnce(Buffer.from('media-file'))
    } as never)

    await importStravaArchiveJob(database as unknown as Database, {
      id: 'job-media-scan',
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

    expect(mockSaveMedia).toHaveBeenCalledTimes(1)
    expect(database.createAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        statusId: 'status-1',
        name: 'photo-2.jpg'
      })
    )
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

  it('removes temporary object-storage archive copy when streaming fails', async () => {
    mockGetConfig.mockReturnValue({
      fitnessStorage: {
        type: 's3',
        bucket: 'fitness-bucket',
        region: 'us-east-1',
        prefix: '',
        maxFileSize: 4
      }
    } as never)
    mockS3Send.mockResolvedValueOnce({
      Body: Readable.from([Buffer.from('partial-data')]),
      ContentLength: undefined
    })
    const unlinkSpy = vi.spyOn(fs, 'unlink')

    try {
      await importStravaArchiveJob(database as unknown as Database, {
        id: 'job-object-stream-fail',
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

      expect(unlinkSpy).toHaveBeenCalledWith(
        expect.stringContaining('strava-archive-archive-file-1-')
      )
    } finally {
      unlinkSpy.mockRestore()
    }

    expect(mockArchiveReaderOpen).not.toHaveBeenCalled()
    expect(database.updateStravaArchiveImport).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'import-1',
        status: 'failed',
        lastError: 'Archive object body exceeds byte limit of 4 bytes'
      })
    )
  })

  it('marks fully failed archive imports as failed and keeps source for retry', async () => {
    database.getFitnessFilesByIds.mockResolvedValueOnce([
      {
        id: 'activity-file-1',
        actorId: 'actor-1',
        statusId: null,
        importStatus: 'failed',
        importError: 'activity parsing failed'
      } as never
    ])

    await importStravaArchiveJob(database as unknown as Database, {
      id: 'job-all-failed',
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

    expect(mockDeleteFitnessFile).not.toHaveBeenCalledWith(
      database,
      'archive-file-1',
      expect.anything()
    )
    expect(database.updateStravaArchiveImport).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'import-1',
        status: 'failed',
        resolvedAt: null
      })
    )
    expect(database.updateStravaArchiveImport).not.toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'import-1',
        status: 'completed'
      })
    )
  })

  it('does not overwrite cancelled import state when in-flight job fails', async () => {
    const now = Date.now()
    database.getStravaArchiveImportById
      .mockResolvedValueOnce({
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
        createdAt: now,
        updatedAt: now
      } as never)
      .mockResolvedValueOnce({
        id: 'import-1',
        actorId: 'actor-1',
        archiveId: 'archive-1',
        archiveFitnessFileId: 'archive-file-1',
        batchId: 'strava-archive:archive-1',
        visibility: 'private',
        status: 'cancelled',
        nextActivityIndex: 0,
        pendingMediaActivities: [],
        mediaAttachmentRetry: 0,
        totalActivitiesCount: undefined,
        completedActivitiesCount: 0,
        failedActivitiesCount: 0,
        firstFailureMessage: undefined,
        lastError: 'Cancelled by user',
        resolvedAt: now,
        createdAt: now,
        updatedAt: now
      } as never)
    mockArchiveReaderOpen.mockRejectedValueOnce(
      new Error('archive read failed')
    )

    await importStravaArchiveJob(database as unknown as Database, {
      id: 'job-cancelled-mid-flight',
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

    expect(database.updateStravaArchiveImport).not.toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'import-1',
        status: 'failed'
      })
    )
  })

  it('rolls back staged fitness files when import enqueue fails', async () => {
    mockQueuePublish.mockRejectedValueOnce(new Error('queue unavailable'))

    await importStravaArchiveJob(database as unknown as Database, {
      id: 'job-queue-fail',
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

    expect(mockDeleteFitnessFile).toHaveBeenCalledTimes(1)
    expect(mockDeleteFitnessFile).toHaveBeenCalledWith(
      database,
      'activity-file-1'
    )
    expect(mockDeleteFitnessFile).not.toHaveBeenCalledWith(
      database,
      'archive-file-1',
      expect.anything()
    )
    expect(database.updateStravaArchiveImport).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'import-1',
        status: 'failed',
        lastError: 'queue unavailable'
      })
    )
  })

  it('rolls back staged fitness files sequentially when import enqueue fails', async () => {
    mockArchiveReaderOpen.mockResolvedValueOnce({
      close: vi.fn(),
      hasEntry: vi.fn().mockReturnValue(true),
      getActivities: vi.fn().mockResolvedValue([
        {
          activityId: 'activity-1',
          activityName: 'Morning Ride',
          fitnessFilePath: 'activities/activity-1.fit',
          mediaPaths: []
        },
        {
          activityId: 'activity-2',
          activityName: 'Evening Ride',
          fitnessFilePath: 'activities/activity-2.fit',
          mediaPaths: []
        }
      ]),
      readEntryBuffer: vi.fn().mockResolvedValue(Buffer.from('fitness-file'))
    } as never)
    mockSaveFitnessFile
      .mockResolvedValueOnce({
        id: 'activity-file-1',
        type: 'fitness',
        file_type: 'fit',
        mime_type: 'application/vnd.ant.fit',
        url: 'https://llun.test/api/v1/fitness-files/activity-file-1',
        fileName: 'activity-1.fit',
        size: 16
      })
      .mockResolvedValueOnce({
        id: 'activity-file-2',
        type: 'fitness',
        file_type: 'fit',
        mime_type: 'application/vnd.ant.fit',
        url: 'https://llun.test/api/v1/fitness-files/activity-file-2',
        fileName: 'activity-2.fit',
        size: 16
      })
    mockQueuePublish.mockRejectedValueOnce(new Error('queue unavailable'))

    let activeDeletes = 0
    let maxActiveDeletes = 0
    mockDeleteFitnessFile.mockImplementation(async () => {
      activeDeletes += 1
      maxActiveDeletes = Math.max(maxActiveDeletes, activeDeletes)
      await Promise.resolve()
      activeDeletes -= 1
      return true
    })

    await importStravaArchiveJob(database as unknown as Database, {
      id: 'job-queue-fail-sequential-rollback',
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
      'activity-file-1'
    )
    expect(mockDeleteFitnessFile).toHaveBeenCalledWith(
      database,
      'activity-file-2'
    )
    expect(maxActiveDeletes).toBe(1)
  })

  it('rolls back earlier batch fitness files when a continuation hits an archive limit', async () => {
    mockArchiveReaderOpen.mockResolvedValueOnce({
      close: vi.fn(),
      hasEntry: vi.fn().mockReturnValue(true),
      getActivities: vi.fn().mockResolvedValue([
        {
          activityId: 'activity-1',
          activityName: 'Earlier Ride',
          fitnessFilePath: 'activities/activity-1.fit',
          mediaPaths: []
        },
        {
          activityId: 'activity-2',
          activityName: 'Current Ride',
          fitnessFilePath: 'activities/activity-2.fit',
          mediaPaths: []
        },
        {
          activityId: 'activity-3',
          activityName: 'Oversized Ride',
          fitnessFilePath: 'activities/activity-3.fit',
          mediaPaths: []
        }
      ]),
      readEntryBuffer: vi
        .fn()
        .mockResolvedValueOnce(Buffer.from('fitness-file'))
        .mockRejectedValueOnce(
          new StravaArchiveLimitError(
            'Archive entry activities/activity-3.fit exceeds compressed size limit'
          )
        )
    } as never)
    mockSaveFitnessFile.mockResolvedValueOnce({
      id: 'activity-file-current',
      type: 'fitness',
      file_type: 'fit',
      mime_type: 'application/vnd.ant.fit',
      url: 'https://llun.test/api/v1/fitness-files/activity-file-current',
      fileName: 'activity-2.fit',
      size: 16
    })
    database.getFitnessFilesByBatchId.mockResolvedValueOnce([
      {
        id: 'activity-file-previous',
        actorId: 'actor-1',
        importBatchId: 'strava-archive:archive-1'
      } as never
    ])

    await importStravaArchiveJob(database as unknown as Database, {
      id: 'job-limit-continuation-rollback',
      name: IMPORT_STRAVA_ARCHIVE_JOB_NAME,
      data: {
        importId: 'import-1',
        actorId: 'actor-1',
        archiveId: 'archive-1',
        archiveFitnessFileId: 'archive-file-1',
        batchId: 'strava-archive:archive-1',
        visibility: 'private',
        nextActivityIndex: 1,
        completedActivitiesCount: 1
      }
    })

    expect(mockDeleteFitnessFile).toHaveBeenCalledWith(
      database,
      'activity-file-previous'
    )
    expect(mockDeleteFitnessFile).toHaveBeenCalledWith(
      database,
      'activity-file-current'
    )
    expect(mockDeleteFitnessFile).not.toHaveBeenCalledWith(
      database,
      'archive-file-1',
      expect.anything()
    )
    expect(database.updateStravaArchiveImport).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'import-1',
        status: 'failed',
        lastError:
          'Archive entry activities/activity-3.fit exceeds compressed size limit'
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
