import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { deleteFitnessFile as deleteFitnessFileFromStorage } from '@/lib/services/fitness-files'

import { DELETE } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

const mockGetActorFromSession = vi.fn()
vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: (...args: unknown[]) => mockGetActorFromSession(...args)
}))

const mockPublish = vi.fn()
vi.mock('@/lib/services/queue', () => ({
  getQueue: () => ({ publish: mockPublish })
}))

vi.mock('@/lib/services/fitness-files', () => ({
  deleteFitnessFile: vi.fn()
}))

type MockDatabase = Pick<Database, 'getFitnessFile' | 'getActorFromId'>

let mockDatabase: MockDatabase | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

const mockDeleteFitnessFileFromStorage =
  deleteFitnessFileFromStorage as jest.MockedFunction<
    typeof deleteFitnessFileFromStorage
  >

describe('DELETE /api/v1/accounts/fitness-files/[fitnessFileId]', () => {
  const mockDb: jest.Mocked<MockDatabase> = {
    getFitnessFile: vi.fn(),
    getActorFromId: vi.fn()
  }

  beforeAll(() => {
    mockDatabase = mockDb
  })

  beforeEach(() => {
    vi.clearAllMocks()
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
    mockDeleteFitnessFileFromStorage.mockResolvedValue(true)
    mockPublish.mockResolvedValue(undefined)
  })

  it('deletes a fitness file without regenerating route heatmaps', async () => {
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
    expect(mockDeleteFitnessFileFromStorage).toHaveBeenCalledTimes(1)
    // Heatmap regeneration is decoupled from delete, so nothing is enqueued.
    expect(mockPublish).not.toHaveBeenCalled()
  })
})
