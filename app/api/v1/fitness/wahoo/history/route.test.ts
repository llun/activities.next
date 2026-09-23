import { NextRequest } from 'next/server'

import { WahooHistoryImport, WahooImport } from '@/lib/database/sql/wahooImport'
import { Database } from '@/lib/database/types'
import {
  IMPORT_WAHOO_ACTIVITY_JOB_NAME,
  IMPORT_WAHOO_HISTORY_JOB_NAME
} from '@/lib/jobs/names'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { FitnessSettings } from '@/lib/types/database/fitnessSettings'

import { DELETE, PATCH, POST } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://test.llun.dev'),
  getConfig: vi.fn().mockReturnValue({
    host: 'test.llun.dev',
    secretPhase: 'test-secret-for-encryption',
    allowEmails: [],
    allowActorDomains: []
  })
}))

const mockQueue = { runsInline: false, publish: vi.fn() }
vi.mock('@/lib/services/queue', () => ({
  getQueue: () => mockQueue
}))

type MockDatabase = Pick<
  Database,
  | 'getFitnessSettings'
  | 'getLatestWahooHistoryImport'
  | 'getWahooHistoryImport'
  | 'countWahooHistoryItems'
  | 'updateWahooHistoryImport'
  | 'createWahooHistoryImport'
  | 'getWahooImportsByHistory'
  | 'markWahooImportPending'
  | 'acquireImportLock'
  | 'releaseImportLock'
  | 'getAccountFromEmail'
  | 'getActorsForAccount'
  | 'getActorFromId'
>

let mockDatabase: MockDatabase | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: () => undefined })
}))

const history = (
  overrides: Partial<WahooHistoryImport> = {}
): WahooHistoryImport => ({
  id: 'history-1',
  actorId: ACTOR1_ID,
  providerUserId: 'wahoo-user-1',
  fromDate: '2026-01-01',
  toDate: '2026-01-31',
  nextPage: 2,
  scanComplete: false,
  total: 1,
  completed: 0,
  failed: 0,
  status: 'running',
  ...overrides
})

const importRecord = (overrides: Partial<WahooImport> = {}): WahooImport => ({
  id: 'import-1',
  actorId: ACTOR1_ID,
  providerUserId: 'wahoo-user-1',
  workoutId: 'workout-1',
  status: 'unsupported',
  attempts: 1,
  ...overrides
})

describe('Wahoo history API', () => {
  const mockDb: jest.Mocked<MockDatabase> = {
    getFitnessSettings: vi.fn(),
    getLatestWahooHistoryImport: vi.fn(),
    getWahooHistoryImport: vi.fn(),
    countWahooHistoryItems: vi.fn(),
    updateWahooHistoryImport: vi.fn(),
    createWahooHistoryImport: vi.fn(),
    getWahooImportsByHistory: vi.fn(),
    markWahooImportPending: vi.fn(),
    acquireImportLock: vi.fn(),
    releaseImportLock: vi.fn(),
    getAccountFromEmail: vi.fn(),
    getActorsForAccount: vi.fn(),
    getActorFromId: vi.fn()
  }

  beforeAll(() => {
    mockDatabase = mockDb
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockQueue.runsInline = false
    mockQueue.publish.mockResolvedValue(undefined)
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    const account = {
      id: 'account-1',
      email: seedActor1.email,
      defaultActorId: ACTOR1_ID,
      twoFactorEnabled: false,
      emailVerified: true,
      createdAt: 1,
      updatedAt: 1
    }
    const actor = {
      ...seedActor1,
      id: ACTOR1_ID,
      followersUrl: `${ACTOR1_ID}/followers`,
      inboxUrl: `${ACTOR1_ID}/inbox`,
      sharedInboxUrl: 'https://test.llun.dev/inbox',
      statusCount: 0,
      lastStatusAt: null,
      createdAt: 1,
      updatedAt: 1,
      account
    }
    mockDb.getAccountFromEmail.mockResolvedValue(account)
    mockDb.getActorsForAccount.mockResolvedValue([actor])
    mockDb.getActorFromId.mockResolvedValue(actor)
    mockDb.getFitnessSettings.mockResolvedValue({
      id: 'settings-1',
      actorId: ACTOR1_ID,
      serviceType: 'wahoo',
      accessToken: 'access-token',
      providerUserId: 'wahoo-user-1',
      createdAt: 1,
      updatedAt: 1
    } satisfies FitnessSettings)
    mockDb.getLatestWahooHistoryImport.mockResolvedValue(history())
    mockDb.getWahooHistoryImport.mockResolvedValue(history())
    mockDb.countWahooHistoryItems.mockResolvedValue({
      total: 1,
      completed: 0,
      failed: 0,
      pending: 1
    })
    mockDb.updateWahooHistoryImport.mockResolvedValue(undefined)
    mockDb.createWahooHistoryImport.mockResolvedValue(
      history({ status: 'pending' })
    )
    mockDb.getWahooImportsByHistory.mockResolvedValue([importRecord()])
    mockDb.markWahooImportPending.mockResolvedValue(true)
    mockDb.acquireImportLock.mockResolvedValue({ token: 'lock-token' })
    mockDb.releaseImportLock.mockResolvedValue(true)
  })

  it('rejects a second history run while an active scan still has pending items', async () => {
    const request = new NextRequest(
      'https://test.llun.dev/api/v1/fitness/wahoo/history',
      {
        method: 'POST',
        headers: { Origin: 'https://test.llun.dev' },
        body: JSON.stringify({ fromDate: '2026-02-01', toDate: '2026-02-28' })
      }
    )

    const response = await POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(409)
    expect(mockDb.createWahooHistoryImport).not.toHaveBeenCalled()
    expect(mockQueue.publish).not.toHaveBeenCalled()
  })

  it('marks the active history run cancelled', async () => {
    const request = new NextRequest(
      'https://test.llun.dev/api/v1/fitness/wahoo/history',
      {
        method: 'DELETE',
        headers: { Origin: 'https://test.llun.dev' }
      }
    )

    const response = await DELETE(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(mockDb.updateWahooHistoryImport).toHaveBeenCalledWith('history-1', {
      status: 'cancelled'
    })
  })

  it('requeues unsupported FIT imports and resumes an unfinished history scan', async () => {
    mockDb.getLatestWahooHistoryImport.mockResolvedValue(
      history({ status: 'failed', lastError: 'previous scan failed' })
    )
    mockDb.getWahooHistoryImport.mockResolvedValue(
      history({ status: 'failed', lastError: 'previous scan failed' })
    )
    mockDb.getWahooImportsByHistory.mockResolvedValue([
      importRecord({ id: 'unsupported-import', status: 'unsupported' }),
      importRecord({ id: 'failed-import', status: 'failed' })
    ])
    const request = new NextRequest(
      'https://test.llun.dev/api/v1/fitness/wahoo/history',
      {
        method: 'PATCH',
        headers: { Origin: 'https://test.llun.dev' }
      }
    )

    const response = await PATCH(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(mockDb.getWahooImportsByHistory).toHaveBeenCalledWith('history-1', [
      'failed',
      'unsupported',
      'pending'
    ])
    expect(mockDb.updateWahooHistoryImport).toHaveBeenCalledWith('history-1', {
      status: 'running',
      lastError: null
    })
    expect(mockDb.markWahooImportPending).toHaveBeenCalledWith(
      'unsupported-import'
    )
    expect(mockDb.markWahooImportPending).toHaveBeenCalledWith('failed-import')
    expect(mockQueue.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: IMPORT_WAHOO_ACTIVITY_JOB_NAME,
        data: { importId: 'unsupported-import', notifyOnComplete: false }
      })
    )
    expect(mockQueue.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: IMPORT_WAHOO_ACTIVITY_JOB_NAME,
        data: { importId: 'failed-import', notifyOnComplete: false }
      })
    )
    expect(mockQueue.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: IMPORT_WAHOO_HISTORY_JOB_NAME,
        data: { historyId: 'history-1' }
      })
    )
  })

  it('rejects retry after the connected Wahoo account changes', async () => {
    mockDb.getLatestWahooHistoryImport.mockResolvedValue(
      history({ status: 'failed' })
    )
    mockDb.getFitnessSettings.mockResolvedValue({
      id: 'settings-1',
      actorId: ACTOR1_ID,
      serviceType: 'wahoo',
      accessToken: 'access-token',
      providerUserId: 'different-wahoo-user',
      createdAt: 1,
      updatedAt: 1
    })
    const request = new NextRequest(
      'https://test.llun.dev/api/v1/fitness/wahoo/history',
      {
        method: 'PATCH',
        headers: { Origin: 'https://test.llun.dev' }
      }
    )

    const response = await PATCH(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(409)
    expect(mockDb.getWahooImportsByHistory).not.toHaveBeenCalled()
    expect(mockQueue.publish).not.toHaveBeenCalled()
  })
})
