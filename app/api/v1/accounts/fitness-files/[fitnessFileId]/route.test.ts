import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME } from '@/lib/jobs/names'
import { deleteFitnessFile as deleteFitnessFileFromStorage } from '@/lib/services/fitness-files'

import { DELETE } from './route'

const mockGetServerSession = jest.fn()
jest.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

const mockGetActorFromSession = jest.fn()
jest.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: (...args: unknown[]) => mockGetActorFromSession(...args)
}))

const mockPublish = jest.fn()
jest.mock('@/lib/services/queue', () => ({
  getQueue: () => ({ publish: mockPublish })
}))

jest.mock('@/lib/services/fitness-files', () => ({
  deleteFitnessFile: jest.fn()
}))

type MockDatabase = Pick<
  Database,
  | 'getFitnessFile'
  | 'getActorFromId'
  | 'getDistinctRouteHeatmapRegionsForActor'
  | 'getFitnessRouteHeatmapByKey'
>

let mockDatabase: MockDatabase | null = null
jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

const mockDeleteFitnessFileFromStorage =
  deleteFitnessFileFromStorage as jest.MockedFunction<
    typeof deleteFitnessFileFromStorage
  >

describe('DELETE /api/v1/accounts/fitness-files/[fitnessFileId]', () => {
  const mockDb: jest.Mocked<MockDatabase> = {
    getFitnessFile: jest.fn(),
    getActorFromId: jest.fn(),
    getDistinctRouteHeatmapRegionsForActor: jest.fn(),
    getFitnessRouteHeatmapByKey: jest.fn()
  }

  beforeAll(() => {
    mockDatabase = mockDb
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetServerSession.mockResolvedValue({ user: { email: 'owner@test' } })
    mockGetActorFromSession.mockResolvedValue({
      id: 'actor-1',
      account: { id: 'account-1' }
    })
    mockDb.getFitnessFile.mockResolvedValue({
      id: 'fitness-file-1',
      actorId: 'actor-1',
      path: 'fitness/file.fit',
      fileName: 'file.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1000,
      activityType: 'running',
      activityStartTime: Date.UTC(2026, 3, 15),
      processingStatus: 'completed',
      isPrimary: true,
      hasMapData: true,
      createdAt: 1,
      updatedAt: 2
    })
    mockDb.getActorFromId.mockResolvedValue({
      id: 'actor-1',
      account: { id: 'account-1' }
    } as Awaited<ReturnType<Database['getActorFromId']>>)
    mockDb.getDistinctRouteHeatmapRegionsForActor.mockResolvedValue([])
    mockDb.getFitnessRouteHeatmapByKey.mockResolvedValue(null)
    mockDeleteFitnessFileFromStorage.mockResolvedValue(true)
    mockPublish.mockResolvedValue(undefined)
  })

  it('enqueues route heatmap refresh jobs after deleting a fitness file', async () => {
    const response = await DELETE(
      new NextRequest(
        'http://llun.test/api/v1/accounts/fitness-files/fitness-file-1',
        { method: 'DELETE', headers: { Origin: 'https://test.llun.dev' } }
      ),
      {
        params: Promise.resolve({ fitnessFileId: 'fitness-file-1' })
      }
    )

    expect(response.status).toBe(200)
    expect(mockPublish).toHaveBeenCalledTimes(6)
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
        data: expect.objectContaining({
          actorId: 'actor-1',
          activityType: 'running',
          periodType: 'monthly',
          periodKey: '2026-04',
          requestedAt: expect.any(Number)
        })
      })
    )
  })
})
