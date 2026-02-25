import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { REGENERATE_FITNESS_MAPS_JOB_NAME } from '@/lib/jobs/names'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { seedActor1 } from '@/lib/stub/seed/actor1'

import { POST } from './route'

const mockGetServerSession = jest.fn()
jest.mock('next-auth', () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args)
}))

jest.mock('@/app/api/auth/[...nextauth]/authOptions', () => ({
  getAuthOptions: jest.fn(() => ({}))
}))

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn().mockReturnValue({
    host: 'llun.test',
    secretPhase: 'test-secret-for-encryption',
    allowEmails: [],
    allowActorDomains: []
  })
}))

const mockPublish = jest.fn()
jest.mock('@/lib/services/queue', () => ({
  getQueue: jest.fn(() => ({
    publish: (...args: unknown[]) => mockPublish(...args)
  }))
}))

type MockDatabase = Pick<
  Database,
  | 'getFitnessFilesByActor'
  | 'updateFitnessFilesProcessingStatus'
  | 'updateFitnessFileProcessingStatus'
  | 'getAccountFromEmail'
  | 'getActorsForAccount'
  | 'getActorFromId'
>

let mockDatabase: MockDatabase | null = null
jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

jest.mock('next/headers', () => ({
  cookies: jest.fn().mockResolvedValue({
    get: () => undefined
  })
}))

describe('POST /api/v1/settings/fitness/general/regenerate-maps', () => {
  const mockDb: jest.Mocked<MockDatabase> = {
    getFitnessFilesByActor: jest.fn(),
    updateFitnessFilesProcessingStatus: jest.fn(),
    updateFitnessFileProcessingStatus: jest.fn(),
    getAccountFromEmail: jest.fn(),
    getActorsForAccount: jest.fn(),
    getActorFromId: jest.fn()
  }

  beforeAll(() => {
    mockDatabase = mockDb
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    mockDb.getAccountFromEmail.mockResolvedValue({
      id: 'account-1',
      email: seedActor1.email,
      defaultActorId: ACTOR1_ID
    })
    mockDb.getActorsForAccount.mockResolvedValue([
      {
        ...seedActor1,
        id: ACTOR1_ID,
        account: {
          id: 'account-1',
          email: seedActor1.email,
          defaultActorId: ACTOR1_ID
        }
      }
    ])
    mockDb.getActorFromId.mockResolvedValue({
      ...seedActor1,
      id: ACTOR1_ID,
      account: {
        id: 'account-1',
        email: seedActor1.email,
        defaultActorId: ACTOR1_ID
      }
    })
    mockDb.updateFitnessFilesProcessingStatus.mockResolvedValue(0)
    mockDb.updateFitnessFileProcessingStatus.mockResolvedValue(true)
    mockPublish.mockResolvedValue(undefined)
  })

  it('queues regeneration only for old statuses not already processing', async () => {
    mockDb.getFitnessFilesByActor
      .mockResolvedValueOnce([
        {
          id: 'fitness-1',
          actorId: ACTOR1_ID,
          statusId: `${ACTOR1_ID}/statuses/1`,
          fileName: 'one.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 1024,
          path: 'fitness/one.fit',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          processingStatus: 'completed'
        },
        {
          id: 'fitness-2',
          actorId: ACTOR1_ID,
          statusId: `${ACTOR1_ID}/statuses/2`,
          fileName: 'two.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 1024,
          path: 'fitness/two.fit',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          processingStatus: 'processing'
        },
        {
          id: 'fitness-3',
          actorId: ACTOR1_ID,
          statusId: undefined,
          fileName: 'three.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 1024,
          path: 'fitness/three.fit',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          processingStatus: 'completed'
        },
        {
          id: 'fitness-4',
          actorId: ACTOR1_ID,
          statusId: `${ACTOR1_ID}/statuses/4`,
          fileName: 'four.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 1024,
          path: 'fitness/four.fit',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          processingStatus: 'pending'
        }
      ])
      .mockResolvedValueOnce([])

    const request = new NextRequest(
      'http://llun.test/api/v1/settings/fitness/general/regenerate-maps',
      {
        method: 'POST'
      }
    )

    const response = await POST(request, { params: Promise.resolve({}) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.queuedCount).toBe(1)
    expect(mockDb.updateFitnessFilesProcessingStatus).toHaveBeenCalledWith({
      fitnessFileIds: ['fitness-1'],
      processingStatus: 'processing'
    })
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: REGENERATE_FITNESS_MAPS_JOB_NAME,
        data: expect.objectContaining({
          actorId: ACTOR1_ID,
          fitnessFileIds: ['fitness-1']
        })
      })
    )
  })

  it('returns zero when there are no eligible old statuses', async () => {
    mockDb.getFitnessFilesByActor.mockResolvedValueOnce([
      {
        id: 'fitness-2',
        actorId: ACTOR1_ID,
        statusId: `${ACTOR1_ID}/statuses/2`,
        fileName: 'two.fit',
        fileType: 'fit',
        mimeType: 'application/vnd.ant.fit',
        bytes: 1024,
        path: 'fitness/two.fit',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        processingStatus: 'processing'
      }
    ])
    mockDb.getFitnessFilesByActor.mockResolvedValueOnce([])

    const request = new NextRequest(
      'http://llun.test/api/v1/settings/fitness/general/regenerate-maps',
      {
        method: 'POST'
      }
    )

    const response = await POST(request, { params: Promise.resolve({}) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.queuedCount).toBe(0)
    expect(mockDb.updateFitnessFilesProcessingStatus).not.toHaveBeenCalled()
    expect(mockPublish).not.toHaveBeenCalled()
  })
})
