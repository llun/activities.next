import { Database } from '@/lib/database/types'
import {
  IMPORT_FITNESS_FILES_JOB_NAME,
  IMPORT_STRAVA_ACTIVITY_JOB_NAME
} from '@/lib/jobs/names'
import { STUCK_PROCESSING_THRESHOLD_MS } from '@/lib/services/fitness-files/processingState'
import {
  isRetriableFitnessFile,
  retryFitnessImportBatch
} from '@/lib/services/fitness-files/retryImports'
import { getQueue } from '@/lib/services/queue'
import { FitnessFile } from '@/lib/types/database/fitnessFile'

vi.mock('@/lib/services/queue', () => ({
  getQueue: vi.fn().mockReturnValue({
    publish: vi.fn().mockResolvedValue(undefined)
  })
}))

const NOW = 1_900_000_000_000

const file = (overrides: Partial<FitnessFile>): FitnessFile =>
  ({
    id: 'file',
    actorId: 'actor-1',
    statusId: undefined,
    path: 'fitness/file.fit',
    fileName: 'file.fit',
    fileType: 'fit',
    mimeType: 'application/vnd.ant.fit',
    bytes: 1024,
    importBatchId: 'batch-1',
    importStatus: 'pending',
    processingStatus: 'pending',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  }) as FitnessFile

const makeDatabase = () => {
  const db = {
    updateFitnessFilesImportStatus: vi.fn().mockResolvedValue(1),
    updateFitnessFilesProcessingStatus: vi.fn().mockResolvedValue(1),
    updateFitnessFileImportStatus: vi.fn().mockResolvedValue(true),
    updateFitnessFileProcessingStatus: vi.fn().mockResolvedValue(true)
  }
  return db as unknown as Database & typeof db
}

describe('isRetriableFitnessFile', () => {
  it.each([
    {
      description: 'failed import',
      file: { importStatus: 'failed', processingStatus: 'pending' },
      expected: true
    },
    {
      description: 'failed processing',
      file: { importStatus: 'completed', processingStatus: 'failed' },
      expected: true
    },
    {
      description: 'stuck processing (old updatedAt)',
      file: {
        importStatus: 'completed',
        processingStatus: 'processing',
        updatedAt: NOW - STUCK_PROCESSING_THRESHOLD_MS - 1
      },
      expected: true
    },
    {
      description: 'fresh processing (recent updatedAt)',
      file: {
        importStatus: 'completed',
        processingStatus: 'processing',
        updatedAt: NOW
      },
      expected: false
    },
    {
      description: 'fully completed',
      file: { importStatus: 'completed', processingStatus: 'completed' },
      expected: false
    }
  ])('returns $expected for $description', ({ file: overrides, expected }) => {
    expect(isRetriableFitnessFile(file(overrides), NOW)).toBe(expected)
  })
})

describe('retryFitnessImportBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(getQueue().publish as jest.Mock).mockResolvedValue(undefined)
  })

  it('returns retried 0 and publishes nothing when no file is retriable', async () => {
    const database = makeDatabase()
    const result = await retryFitnessImportBatch({
      database,
      batchId: 'batch-1',
      batchActorId: 'actor-1',
      files: [
        file({ importStatus: 'completed', processingStatus: 'completed' })
      ],
      visibility: 'private',
      now: NOW
    })

    expect(result.retried).toBe(0)
    expect(getQueue().publish).not.toHaveBeenCalled()
  })

  it('resets only the columns that failed and requeues the Strava importer without visibility', async () => {
    const database = makeDatabase()
    const result = await retryFitnessImportBatch({
      database,
      batchId: 'strava-activity:777',
      batchActorId: 'actor-1',
      files: [
        // Import succeeded, processing failed: import status must NOT be reset.
        file({
          id: 'f1',
          statusId: 'actor-1/statuses/s1',
          importStatus: 'completed',
          processingStatus: 'failed'
        })
      ],
      visibility: 'private',
      now: NOW
    })

    expect(result.retried).toBe(1)
    expect(database.updateFitnessFilesImportStatus).not.toHaveBeenCalled()
    expect(database.updateFitnessFilesProcessingStatus).toHaveBeenCalledWith({
      fitnessFileIds: ['f1'],
      processingStatus: 'pending'
    })
    expect(getQueue().publish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
        data: { actorId: 'actor-1', stravaActivityId: '777' }
      })
    )
    // Strava retries re-derive visibility server-side, so it must be omitted.
    const job = (getQueue().publish as jest.Mock).mock.calls[0][0]
    expect(job.data).not.toHaveProperty('visibility')
  })

  it('requeues the file importer with completed overlap context for non-Strava batches', async () => {
    const database = makeDatabase()
    const result = await retryFitnessImportBatch({
      database,
      batchId: 'manual-batch',
      batchActorId: 'actor-1',
      files: [
        file({ id: 'failed', importStatus: 'failed' }),
        file({
          id: 'done',
          statusId: 'actor-1/statuses/s2',
          importStatus: 'completed',
          processingStatus: 'completed'
        })
      ],
      visibility: 'unlisted',
      now: NOW
    })

    expect(result.retried).toBe(1)
    expect(database.updateFitnessFilesImportStatus).toHaveBeenCalledWith({
      fitnessFileIds: ['failed'],
      importStatus: 'pending'
    })
    expect(getQueue().publish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: IMPORT_FITNESS_FILES_JOB_NAME,
        data: expect.objectContaining({
          actorId: 'actor-1',
          batchId: 'manual-batch',
          fitnessFileIds: ['failed'],
          overlapFitnessFileIds: ['done'],
          visibility: 'unlisted'
        })
      })
    )
  })

  it('retries a stuck-processing file by resetting it to pending', async () => {
    const database = makeDatabase()
    const result = await retryFitnessImportBatch({
      database,
      batchId: 'strava-activity:888',
      batchActorId: 'actor-1',
      files: [
        file({
          id: 'stuck',
          statusId: 'actor-1/statuses/s3',
          importStatus: 'completed',
          processingStatus: 'processing',
          updatedAt: NOW - STUCK_PROCESSING_THRESHOLD_MS - 1
        })
      ],
      visibility: 'private',
      now: NOW
    })

    expect(result.retried).toBe(1)
    expect(database.updateFitnessFilesProcessingStatus).toHaveBeenCalledWith({
      fitnessFileIds: ['stuck'],
      processingStatus: 'pending'
    })
  })

  it('restores pre-retry state and rethrows when the queue publish fails', async () => {
    const database = makeDatabase()
    ;(getQueue().publish as jest.Mock).mockRejectedValueOnce(
      new Error('queue down')
    )

    await expect(
      retryFitnessImportBatch({
        database,
        batchId: 'manual-batch',
        batchActorId: 'actor-1',
        files: [
          file({ id: 'failed', importStatus: 'failed', importError: 'x' })
        ],
        visibility: 'private',
        now: NOW
      })
    ).rejects.toThrow('queue down')

    expect(database.updateFitnessFileImportStatus).toHaveBeenCalledWith(
      'failed',
      'failed',
      'x'
    )
  })
})
