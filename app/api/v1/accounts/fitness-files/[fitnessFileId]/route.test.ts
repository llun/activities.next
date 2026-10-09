import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { deleteFitnessFile as deleteFitnessFileFromStorage } from '@/lib/services/fitness-files'
import { logger } from '@/lib/utils/logger'

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

const mockSpan = {
  setAttribute: vi.fn(),
  setStatus: vi.fn(),
  end: vi.fn(),
  recordException: vi.fn()
}

vi.mock('@/lib/utils/trace', () => ({
  getTracer: () => ({
    startActiveSpan: (_name: string, fn: (span: typeof mockSpan) => unknown) =>
      fn(mockSpan)
  })
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
    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      'fitnessFileId',
      'fitness-file-1'
    )
    expect(mockSpan.setAttribute).not.toHaveBeenCalledWith(
      'accountId',
      expect.anything()
    )
  })

  const callDelete = (
    fitnessFileId: string | undefined = 'fitness-file-1',
    origin = 'https://test.llun.dev'
  ) =>
    DELETE(
      new NextRequest(
        `http://llun.test/api/v1/accounts/fitness-files/${fitnessFileId}`,
        { method: 'DELETE', headers: { Origin: origin } }
      ),
      {
        params: Promise.resolve({
          fitnessFileId: fitnessFileId as string
        })
      }
    )

  it('removes the owner’s file from storage using the metadata it already loaded', async () => {
    const response = await callDelete()

    expect(await response.json()).toEqual({ success: true })
    expect(mockDb.getActorFromId).toHaveBeenCalledWith({ id: 'actor-1' })
    expect(mockDeleteFitnessFileFromStorage).toHaveBeenCalledWith(
      mockDb,
      'fitness-file-1',
      expect.objectContaining({
        id: 'fitness-file-1',
        path: 'fitness/file.fit'
      })
    )
  })

  it('answers 404 for an unknown file', async () => {
    mockDb.getFitnessFile.mockResolvedValue(null)

    const response = await callDelete('missing')

    expect(response.status).toBe(404)
    expect(mockDeleteFitnessFileFromStorage).not.toHaveBeenCalled()
  })

  // Same 404 as an unknown id, so a caller cannot learn that someone else's
  // file id exists.
  it.each([
    [
      'belongs to another account',
      { id: 'actor-2', account: { id: 'account-2' } }
    ],
    ['belongs to a remote actor with no account', { id: 'actor-3' }],
    ['has an owner that no longer exists', null]
  ])('answers 404 and deletes nothing when the file %s', async (_, owner) => {
    mockDb.getActorFromId.mockResolvedValue(
      owner as Awaited<ReturnType<Database['getActorFromId']>>
    )

    const response = await callDelete()

    expect(response.status).toBe(404)
    expect(mockDeleteFitnessFileFromStorage).not.toHaveBeenCalled()
  })

  it('lets a different actor of the same account delete the file', async () => {
    mockDb.getActorFromId.mockResolvedValue({
      id: 'actor-1b',
      account: { id: 'account-1' }
    } as Awaited<ReturnType<Database['getActorFromId']>>)

    const response = await callDelete()

    expect(response.status).toBe(200)
    expect(mockDeleteFitnessFileFromStorage).toHaveBeenCalledTimes(1)
  })

  it('answers 401 when the acting actor has no account', async () => {
    mockGetActorFromSession.mockResolvedValue({ id: 'actor-1' })

    const response = await callDelete()

    expect(response.status).toBe(401)
    expect(mockDb.getFitnessFile).not.toHaveBeenCalled()
  })

  it('answers 500 rather than reporting success when storage could not delete', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => logger)
    mockDeleteFitnessFileFromStorage.mockResolvedValue(false)

    const response = await callDelete()

    expect(response.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith({
      message: 'Failed to delete fitness file',
      fitnessFileId: 'fitness-file-1',
      accountId: 'account-1'
    })
  })

  it('answers 500 and logs when the lookup throws', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => logger)
    mockDb.getFitnessFile.mockRejectedValue(new Error('db down'))

    const response = await callDelete()

    expect(response.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Error deleting fitness file',
        error: 'db down'
      })
    )
  })

  it('rejects a cross-site request before touching the file', async () => {
    const response = await callDelete('fitness-file-1', 'https://evil.example')

    expect(response.status).toBe(403)
    expect(mockDb.getFitnessFile).not.toHaveBeenCalled()
    expect(mockDeleteFitnessFileFromStorage).not.toHaveBeenCalled()
  })

  it('redirects a signed-out caller to sign in', async () => {
    mockGetServerSession.mockResolvedValue(null)

    const response = await callDelete()

    expect(response.status).toBe(307)
    expect(mockDeleteFitnessFileFromStorage).not.toHaveBeenCalled()
  })
})
