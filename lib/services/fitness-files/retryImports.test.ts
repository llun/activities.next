import { Database } from '@/lib/database/types'
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
  it.each<{
    description: string
    file: Partial<FitnessFile>
    expected: boolean
  }>([
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
    },
    {
      description: 'stuck import (crash-orphan: old pending, no status)',
      file: {
        importStatus: 'pending',
        processingStatus: 'pending',
        statusId: undefined,
        updatedAt: NOW - STUCK_PROCESSING_THRESHOLD_MS - 1
      },
      expected: true
    },
    {
      description: 'fresh pending import (still in-flight)',
      file: {
        importStatus: 'pending',
        processingStatus: 'pending',
        updatedAt: NOW
      },
      expected: false
    },
    {
      description: 'old pending import that already has a status',
      file: {
        importStatus: 'pending',
        processingStatus: 'pending',
        statusId: 'status-1',
        updatedAt: NOW - STUCK_PROCESSING_THRESHOLD_MS - 1
      },
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

  it('gives different job ids for two successive retries of a Strava batch while redelivery stays stable', async () => {
    const database = makeDatabase()
    const generationId = 'strava-gen-fixed'

    await retryFitnessImportBatch({
      database,
      batchId: 'strava-activity:999',
      batchActorId: 'actor-1',
      files: [file({ id: 'failed', importStatus: 'failed' })],
      visibility: 'private',
      generationId,
      now: NOW
    })
    const fixedJobId1 = (getQueue().publish as jest.Mock).mock.calls[0][0].id

    vi.clearAllMocks()
    await retryFitnessImportBatch({
      database,
      batchId: 'strava-activity:999',
      batchActorId: 'actor-1',
      files: [file({ id: 'failed', importStatus: 'failed' })],
      visibility: 'private',
      generationId,
      now: NOW
    })
    const fixedJobId2 = (getQueue().publish as jest.Mock).mock.calls[0][0].id
    expect(fixedJobId2).toBe(fixedJobId1)

    vi.clearAllMocks()
    await retryFitnessImportBatch({
      database,
      batchId: 'strava-activity:999',
      batchActorId: 'actor-1',
      files: [file({ id: 'failed', importStatus: 'failed' })],
      visibility: 'private',
      now: NOW
    })
    const freshJobId = (getQueue().publish as jest.Mock).mock.calls[0][0].id
    expect(freshJobId).not.toBe(fixedJobId1)
  })
})
