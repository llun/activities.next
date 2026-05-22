import { getDatabase } from '@/lib/database'
import { REGENERATE_FITNESS_MAPS_JOB_NAME } from '@/lib/jobs/names'
import { regenerateFitnessMapsJob } from '@/lib/jobs/regenerateFitnessMapsJob'

import { fixStuckFitnessProcessing } from './fixStuckFitnessProcessing'

jest.mock('@/lib/database', () => ({
  getDatabase: jest.fn()
}))

jest.mock('@/lib/jobs/regenerateFitnessMapsJob', () => ({
  regenerateFitnessMapsJob: jest.fn()
}))

const mockGetDatabase = getDatabase as jest.MockedFunction<typeof getDatabase>
const mockRegenerateFitnessMapsJob =
  regenerateFitnessMapsJob as jest.MockedFunction<
    typeof regenerateFitnessMapsJob
  >

describe('fixStuckFitnessProcessing', () => {
  const statusHash = 'a'.repeat(64)

  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(console, 'log').mockImplementation(() => undefined)
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('regenerates the route map when completing parsed stuck files', async () => {
    const database = {
      getStatusFromUrlHash: jest.fn().mockResolvedValue({ id: 'status-1' }),
      getFitnessFileByStatus: jest.fn().mockResolvedValue({
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
      getFitnessFile: jest.fn().mockResolvedValue({
        id: 'fitness-file-1',
        processingStatus: 'completed'
      }),
      updateFitnessFileProcessingStatus: jest.fn()
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
