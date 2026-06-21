import { getDatabase } from '@/lib/database'
import { importFitnessFilesJob } from '@/lib/jobs/importFitnessFilesJob'
import { importStravaActivityJob } from '@/lib/jobs/importStravaActivityJob'
import {
  IMPORT_FITNESS_FILES_JOB_NAME,
  IMPORT_STRAVA_ACTIVITY_JOB_NAME
} from '@/lib/jobs/names'

import { repairFailedFitnessImports } from './repairFailedFitnessImports'

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn()
}))

vi.mock('@/lib/jobs/importStravaActivityJob', () => ({
  importStravaActivityJob: vi.fn()
}))

vi.mock('@/lib/jobs/importFitnessFilesJob', () => ({
  importFitnessFilesJob: vi.fn()
}))

const mockGetDatabase = getDatabase as jest.MockedFunction<typeof getDatabase>
const mockImportStravaActivityJob =
  importStravaActivityJob as jest.MockedFunction<typeof importStravaActivityJob>
const mockImportFitnessFilesJob = importFitnessFilesJob as jest.MockedFunction<
  typeof importFitnessFilesJob
>

const actorId = 'https://llun.social/users/ride'

describe('repairFailedFitnessImports', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('re-runs the full Strava importer for a strava-activity batch', async () => {
    const database = {
      getFitnessFilesByBatchId: vi.fn().mockResolvedValue([
        {
          id: 'file-1',
          actorId,
          importBatchId: 'strava-activity:19007245213',
          importStatus: 'failed',
          processingStatus: 'failed',
          fileName: 'strava-19007245213.tcx'
        }
      ]),
      updateFitnessFilesImportStatus: vi.fn().mockResolvedValue(1),
      updateFitnessFilesProcessingStatus: vi.fn().mockResolvedValue(1)
    } as unknown as ReturnType<typeof getDatabase>

    mockGetDatabase.mockReturnValue(database)

    const exitCode = await repairFailedFitnessImports([
      '--actor-id',
      actorId,
      '--batch-id',
      'strava-activity:19007245213'
    ])

    expect(exitCode).toBe(0)
    expect(mockImportStravaActivityJob).toHaveBeenCalledWith(
      database,
      expect.objectContaining({
        name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
        data: { actorId, stravaActivityId: '19007245213' }
      })
    )
    expect(mockImportFitnessFilesJob).not.toHaveBeenCalled()
    expect(database?.updateFitnessFilesImportStatus).toHaveBeenCalledWith({
      fitnessFileIds: ['file-1'],
      importStatus: 'pending'
    })
  })

  it('re-runs the file importer for a manual upload batch with overlap context', async () => {
    const database = {
      getFitnessFilesByBatchId: vi.fn().mockResolvedValue([
        {
          id: 'file-failed',
          actorId,
          importBatchId: 'batch-1',
          importStatus: 'failed',
          processingStatus: 'failed',
          fileName: 'a.fit'
        },
        {
          id: 'file-done',
          actorId,
          importBatchId: 'batch-1',
          importStatus: 'completed',
          processingStatus: 'completed',
          statusId: `${actorId}/statuses/x`,
          fileName: 'b.fit'
        }
      ]),
      updateFitnessFilesImportStatus: vi.fn().mockResolvedValue(1),
      updateFitnessFilesProcessingStatus: vi.fn().mockResolvedValue(1)
    } as unknown as ReturnType<typeof getDatabase>

    mockGetDatabase.mockReturnValue(database)

    const exitCode = await repairFailedFitnessImports([
      '--actor-id',
      actorId,
      '--batch-id',
      'batch-1'
    ])

    expect(exitCode).toBe(0)
    expect(mockImportFitnessFilesJob).toHaveBeenCalledWith(
      database,
      expect.objectContaining({
        name: IMPORT_FITNESS_FILES_JOB_NAME,
        data: expect.objectContaining({
          actorId,
          batchId: 'batch-1',
          fitnessFileIds: ['file-failed'],
          overlapFitnessFileIds: ['file-done'],
          visibility: 'public'
        })
      })
    )
    expect(mockImportStravaActivityJob).not.toHaveBeenCalled()
  })

  it('changes nothing in dry-run mode', async () => {
    const database = {
      getFitnessFilesByBatchId: vi.fn().mockResolvedValue([
        {
          id: 'file-1',
          actorId,
          importBatchId: 'strava-activity:1',
          importStatus: 'failed',
          processingStatus: 'failed',
          fileName: 'a.tcx'
        }
      ]),
      updateFitnessFilesImportStatus: vi.fn().mockResolvedValue(1),
      updateFitnessFilesProcessingStatus: vi.fn().mockResolvedValue(1)
    } as unknown as ReturnType<typeof getDatabase>

    mockGetDatabase.mockReturnValue(database)

    const exitCode = await repairFailedFitnessImports([
      '--actor-id',
      actorId,
      '--batch-id',
      'strava-activity:1',
      '--dry-run'
    ])

    expect(exitCode).toBe(0)
    expect(mockImportStravaActivityJob).not.toHaveBeenCalled()
    expect(mockImportFitnessFilesJob).not.toHaveBeenCalled()
    expect(database?.updateFitnessFilesImportStatus).not.toHaveBeenCalled()
    expect(database?.updateFitnessFilesProcessingStatus).not.toHaveBeenCalled()
  })

  it('discovers failed batches for an actor across paginated pages and dedups them', async () => {
    const SCAN_PAGE_SIZE = 200
    // Page 1 is full (length === SCAN_PAGE_SIZE) so the scan must request a
    // second page; two of its files fail under the same batch (dedups to one).
    const firstPage = Array.from({ length: SCAN_PAGE_SIZE }, (_, index) => ({
      id: `p1-${index}`,
      actorId,
      importBatchId:
        index < 2 ? 'strava-activity:A' : `strava-activity:done-${index}`,
      importStatus: index < 2 ? 'failed' : 'completed',
      processingStatus: index < 2 ? 'failed' : 'completed',
      statusId: index < 2 ? undefined : `${actorId}/statuses/${index}`,
      fileName: `p1-${index}.tcx`
    }))
    // Page 2 is short (ends the scan) with one more failed batch and one failed
    // file that has no import batch (an orphan that cannot be auto-retried).
    const secondPage = [
      {
        id: 'p2-0',
        actorId,
        importBatchId: 'strava-activity:B',
        importStatus: 'failed',
        processingStatus: 'failed',
        fileName: 'p2-0.tcx'
      },
      {
        id: 'p2-orphan',
        actorId,
        importStatus: 'failed',
        processingStatus: 'failed',
        fileName: 'p2-orphan.tcx'
      }
    ]

    const filesByBatch: Record<string, unknown[]> = {
      'strava-activity:A': [
        {
          id: 'p1-0',
          actorId,
          importBatchId: 'strava-activity:A',
          importStatus: 'failed',
          processingStatus: 'failed',
          fileName: 'p1-0.tcx'
        }
      ],
      'strava-activity:B': [secondPage[0]]
    }

    const getFitnessFilesByActor = vi
      .fn()
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(secondPage)

    const database = {
      getFitnessFilesByActor,
      getFitnessFilesByBatchId: vi
        .fn()
        .mockImplementation(({ batchId }: { batchId: string }) =>
          Promise.resolve(filesByBatch[batchId] ?? [])
        ),
      updateFitnessFilesImportStatus: vi.fn().mockResolvedValue(1),
      updateFitnessFilesProcessingStatus: vi.fn().mockResolvedValue(1)
    } as unknown as ReturnType<typeof getDatabase>

    mockGetDatabase.mockReturnValue(database)

    const exitCode = await repairFailedFitnessImports(['--actor-id', actorId])

    expect(exitCode).toBe(0)
    // Scanned both pages, advancing the offset.
    expect(getFitnessFilesByActor).toHaveBeenNthCalledWith(1, {
      actorId,
      limit: SCAN_PAGE_SIZE,
      offset: 0
    })
    expect(getFitnessFilesByActor).toHaveBeenNthCalledWith(2, {
      actorId,
      limit: SCAN_PAGE_SIZE,
      offset: SCAN_PAGE_SIZE
    })
    // Two distinct failed batches discovered (the duplicate in page 1 deduped).
    expect(mockImportStravaActivityJob).toHaveBeenCalledTimes(2)
    expect(mockImportStravaActivityJob).toHaveBeenCalledWith(
      database,
      expect.objectContaining({
        data: { actorId, stravaActivityId: 'A' }
      })
    )
    expect(mockImportStravaActivityJob).toHaveBeenCalledWith(
      database,
      expect.objectContaining({
        data: { actorId, stravaActivityId: 'B' }
      })
    )
  })

  it('reports nothing to repair when an actor has no failed imports', async () => {
    const database = {
      getFitnessFilesByActor: vi.fn().mockResolvedValue([
        {
          id: 'done-1',
          actorId,
          importBatchId: 'strava-activity:1',
          importStatus: 'completed',
          processingStatus: 'completed',
          statusId: `${actorId}/statuses/1`,
          fileName: 'done-1.tcx'
        }
      ]),
      getFitnessFilesByBatchId: vi.fn(),
      updateFitnessFilesImportStatus: vi.fn(),
      updateFitnessFilesProcessingStatus: vi.fn()
    } as unknown as ReturnType<typeof getDatabase>

    mockGetDatabase.mockReturnValue(database)

    const exitCode = await repairFailedFitnessImports(['--actor-id', actorId])

    expect(exitCode).toBe(0)
    expect(mockImportStravaActivityJob).not.toHaveBeenCalled()
    expect(mockImportFitnessFilesJob).not.toHaveBeenCalled()
    expect(database?.getFitnessFilesByBatchId).not.toHaveBeenCalled()
  })

  it('skips a batch that has no failed files', async () => {
    const database = {
      getFitnessFilesByBatchId: vi.fn().mockResolvedValue([
        {
          id: 'done-1',
          actorId,
          importBatchId: 'batch-1',
          importStatus: 'completed',
          processingStatus: 'completed',
          statusId: `${actorId}/statuses/1`,
          fileName: 'done-1.fit'
        }
      ]),
      updateFitnessFilesImportStatus: vi.fn(),
      updateFitnessFilesProcessingStatus: vi.fn()
    } as unknown as ReturnType<typeof getDatabase>

    mockGetDatabase.mockReturnValue(database)

    const exitCode = await repairFailedFitnessImports([
      '--actor-id',
      actorId,
      '--batch-id',
      'batch-1'
    ])

    expect(exitCode).toBe(0)
    expect(mockImportFitnessFilesJob).not.toHaveBeenCalled()
    expect(mockImportStravaActivityJob).not.toHaveBeenCalled()
    expect(database?.updateFitnessFilesImportStatus).not.toHaveBeenCalled()
  })

  it('restores files to failed and exits non-zero when the importer throws', async () => {
    const database = {
      getFitnessFilesByBatchId: vi.fn().mockResolvedValue([
        {
          id: 'file-1',
          actorId,
          importBatchId: 'strava-activity:19007245213',
          importStatus: 'failed',
          processingStatus: 'failed',
          fileName: 'a.tcx'
        }
      ]),
      updateFitnessFilesImportStatus: vi.fn().mockResolvedValue(1),
      updateFitnessFilesProcessingStatus: vi.fn().mockResolvedValue(1),
      updateFitnessFileImportStatus: vi.fn().mockResolvedValue(true),
      updateFitnessFileProcessingStatus: vi.fn().mockResolvedValue(true)
    } as unknown as ReturnType<typeof getDatabase>

    mockGetDatabase.mockReturnValue(database)
    mockImportStravaActivityJob.mockRejectedValueOnce(new Error('strava down'))

    const exitCode = await repairFailedFitnessImports([
      '--actor-id',
      actorId,
      '--batch-id',
      'strava-activity:19007245213'
    ])

    expect(exitCode).toBe(1)
    expect(database?.updateFitnessFileImportStatus).toHaveBeenCalledWith(
      'file-1',
      'failed',
      'strava down'
    )
    expect(database?.updateFitnessFileProcessingStatus).toHaveBeenCalledWith(
      'file-1',
      'failed'
    )
  })
})
