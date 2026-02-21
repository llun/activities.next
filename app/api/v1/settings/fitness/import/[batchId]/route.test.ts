import { IMPORT_FITNESS_FILES_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'

import { GET, POST } from './route'

const mockGetServerSession = jest.fn()
jest.mock('next-auth', () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args)
}))

jest.mock('@/app/api/auth/[...nextauth]/authOptions', () => ({
  getAuthOptions: jest.fn(() => ({}))
}))

type MockDatabase = {
  getFitnessFilesByBatchId: jest.Mock
  updateFitnessFileImportStatus: jest.Mock
  updateFitnessFileProcessingStatus: jest.Mock
}

let mockDatabase: MockDatabase | null = null
jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

jest.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: jest.fn().mockResolvedValue({
    id: 'https://llun.test/users/llun',
    username: 'llun',
    domain: 'llun.test',
    followersUrl: 'https://llun.test/users/llun/followers',
    inboxUrl: 'https://llun.test/users/llun/inbox',
    sharedInboxUrl: 'https://llun.test/inbox',
    followingCount: 0,
    followersCount: 0,
    statusCount: 0,
    lastStatusAt: null,
    createdAt: Date.now(),
    updatedAt: Date.now()
  })
}))

jest.mock('@/lib/services/queue', () => ({
  getQueue: jest.fn().mockReturnValue({
    publish: jest.fn().mockResolvedValue(undefined)
  })
}))

jest.mock('next/headers', () => ({
  cookies: jest.fn().mockResolvedValue({
    get: () => undefined
  })
}))

describe('fitness import batch route', () => {
  const db: MockDatabase = {
    getFitnessFilesByBatchId: jest.fn(),
    updateFitnessFileImportStatus: jest.fn().mockResolvedValue(true),
    updateFitnessFileProcessingStatus: jest.fn().mockResolvedValue(true)
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: 'llun@activities.local' }
    })
    mockDatabase = db
  })

  it('returns aggregate import batch status', async () => {
    db.getFitnessFilesByBatchId.mockResolvedValue([
      {
        id: 'file-1',
        actorId: 'https://llun.test/users/llun',
        fileName: 'first.fit',
        fileType: 'fit',
        path: 'fitness/first.fit',
        mimeType: 'application/vnd.ant.fit',
        bytes: 1024,
        importStatus: 'completed',
        processingStatus: 'completed',
        isPrimary: true,
        createdAt: 1,
        updatedAt: 1
      },
      {
        id: 'file-2',
        actorId: 'https://llun.test/users/llun',
        fileName: 'second.fit',
        fileType: 'fit',
        path: 'fitness/second.fit',
        mimeType: 'application/vnd.ant.fit',
        bytes: 1024,
        importStatus: 'failed',
        importError: 'parse failed',
        processingStatus: 'failed',
        isPrimary: false,
        createdAt: 2,
        updatedAt: 2
      }
    ])

    const request = {
      headers: new Headers()
    } as unknown as Parameters<typeof GET>[0]

    const response = await GET(request, {
      params: Promise.resolve({ batchId: 'batch-1' })
    })
    const json = (await response.json()) as {
      status: string
      summary: {
        total: number
        completed: number
        failed: number
        pending: number
      }
    }

    expect(response.status).toBe(200)
    expect(json.status).toBe('partially_failed')
    expect(json.summary).toEqual({
      total: 2,
      completed: 1,
      failed: 1,
      pending: 0
    })
  })

  it('retries failed files and requeues import job', async () => {
    db.getFitnessFilesByBatchId.mockResolvedValue([
      {
        id: 'file-1',
        actorId: 'https://llun.test/users/llun',
        fileName: 'failed.fit',
        fileType: 'fit',
        path: 'fitness/failed.fit',
        mimeType: 'application/vnd.ant.fit',
        bytes: 1024,
        importStatus: 'failed',
        processingStatus: 'failed',
        createdAt: 1,
        updatedAt: 1
      }
    ])

    const request = {
      headers: new Headers(),
      json: async () => ({ visibility: 'private' })
    } as unknown as Parameters<typeof POST>[0]

    const response = await POST(request, {
      params: Promise.resolve({ batchId: 'batch-1' })
    })
    const json = (await response.json()) as { retried: number }

    expect(response.status).toBe(200)
    expect(json.retried).toBe(1)
    expect(db.updateFitnessFileImportStatus).toHaveBeenCalledWith(
      'file-1',
      'pending'
    )
    expect(db.updateFitnessFileProcessingStatus).toHaveBeenCalledWith(
      'file-1',
      'pending'
    )
    expect(getQueue().publish).toHaveBeenCalledWith({
      id: expect.any(String),
      name: IMPORT_FITNESS_FILES_JOB_NAME,
      data: {
        actorId: 'https://llun.test/users/llun',
        batchId: 'batch-1',
        fitnessFileIds: ['file-1'],
        visibility: 'private'
      }
    })
  })
})
