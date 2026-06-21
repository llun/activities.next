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
    expect(database?.updateFitnessFilesImportStatus).not.toHaveBeenCalled()
  })
})
