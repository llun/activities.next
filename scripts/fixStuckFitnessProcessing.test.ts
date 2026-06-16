import { getDatabase } from '@/lib/database'
import { REGENERATE_FITNESS_MAPS_JOB_NAME } from '@/lib/jobs/names'
import { regenerateFitnessMapsJob } from '@/lib/jobs/regenerateFitnessMapsJob'

import { fixStuckFitnessProcessing } from './fixStuckFitnessProcessing'

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn()
}))

vi.mock('@/lib/jobs/regenerateFitnessMapsJob', () => ({
  regenerateFitnessMapsJob: vi.fn()
}))

const mockGetDatabase = getDatabase as jest.MockedFunction<typeof getDatabase>
const mockRegenerateFitnessMapsJob =
  regenerateFitnessMapsJob as jest.MockedFunction<
    typeof regenerateFitnessMapsJob
  >

describe('fixStuckFitnessProcessing', () => {
  const statusHash = 'a'.repeat(64)

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('regenerates the route map when completing parsed stuck files', async () => {
    const database = {
      getStatusFromUrlHash: vi.fn().mockResolvedValue({ id: 'status-1' }),
      getFitnessFileByStatus: vi.fn().mockResolvedValue({
        id: 'fitness-file-1',
        actorId: 'actor-1',
        statusId: 'status-1',
        fileName: 'run.fit',
        fileType: 'fit',
        mimeType: 'application/vnd.ant.fit',
        bytes: 1234,
        processingStatus: 'processing',
        totalDistanceMeters: 1200
      }),
      getFitnessFile: vi.fn().mockResolvedValue({
        id: 'fitness-file-1',
        processingStatus: 'completed'
      }),
      updateFitnessFileProcessingStatus: vi.fn()
    } as unknown as ReturnType<typeof getDatabase>

    mockGetDatabase.mockReturnValue(database)

    const exitCode = await fixStuckFitnessProcessing([
      '--status-hash',
      statusHash
    ])

    expect(exitCode).toBe(0)
    expect(mockRegenerateFitnessMapsJob).toHaveBeenCalledWith(database, {
      id: expect.stringContaining('fitness-file-1'),
      name: REGENERATE_FITNESS_MAPS_JOB_NAME,
      data: {
        actorId: 'actor-1',
        fitnessFileIds: ['fitness-file-1']
      }
    })
    expect(
      database?.updateFitnessFileProcessingStatus
    ).not.toHaveBeenCalledWith('fitness-file-1', 'completed')
  })
})
