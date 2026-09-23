import { WahooHistoryImport } from '@/lib/database/sql/wahooImport'
import { Database } from '@/lib/database/types'
import { importWahooHistoryJob } from '@/lib/jobs/importWahooHistoryJob'
import {
  IMPORT_WAHOO_ACTIVITY_JOB_NAME,
  IMPORT_WAHOO_HISTORY_JOB_NAME
} from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import { getWahooWorkoutsPage } from '@/lib/services/wahoo/api'

vi.mock('@/lib/services/queue', () => ({
  getQueue: vi.fn().mockReturnValue({
    publish: vi.fn().mockResolvedValue(undefined)
  })
}))

vi.mock('@/lib/services/wahoo/api', () => ({
  WahooRateLimitError: class WahooRateLimitError extends Error {
    constructor(public readonly retryAfterSeconds: number) {
      super('Wahoo rate limit reached')
    }
  },
  getWahooWorkoutsPage: vi.fn()
}))

const mockGetQueue = vi.mocked(getQueue)
const mockGetWahooWorkoutsPage = vi.mocked(getWahooWorkoutsPage)

type MockDatabase = Pick<
  Database,
  | 'getWahooHistoryImport'
  | 'getFitnessSettings'
  | 'upsertWahooImport'
  | 'countWahooHistoryItems'
  | 'updateWahooHistoryImport'
  | 'acquireImportLock'
  | 'releaseImportLock'
>

describe('importWahooHistoryJob', () => {
  const historyId = '22222222-2222-4222-8222-222222222222'
  const database: jest.Mocked<MockDatabase> = {
    getWahooHistoryImport: vi.fn(),
    getFitnessSettings: vi.fn(),
    upsertWahooImport: vi.fn(),
    countWahooHistoryItems: vi.fn(),
    updateWahooHistoryImport: vi.fn(),
    acquireImportLock: vi.fn(),
    releaseImportLock: vi.fn()
  }
  const queue = { publish: vi.fn().mockResolvedValue(undefined) }

  const history = (
    overrides: Partial<WahooHistoryImport> = {}
  ): WahooHistoryImport => ({
    id: historyId,
    actorId: 'actor-1',
    providerUserId: 'wahoo-user-1',
    fromDate: '2026-09-01',
    toDate: '2026-09-30',
    nextPage: 1,
    scanComplete: false,
    total: 0,
    completed: 0,
    failed: 0,
    status: 'running',
    ...overrides
  })

  beforeEach(() => {
    vi.clearAllMocks()
    queue.publish.mockResolvedValue(undefined)
    mockGetQueue.mockReturnValue({ publish: queue.publish } as never)
    database.getWahooHistoryImport.mockResolvedValue(history())
    database.getFitnessSettings.mockResolvedValue({
      id: 'settings-1',
      actorId: 'actor-1',
      serviceType: 'wahoo',
      accessToken: 'access-token',
      providerUserId: 'wahoo-user-1',
      createdAt: 1,
      updatedAt: 1
    })
    database.upsertWahooImport.mockResolvedValue({
      id: '33333333-3333-4333-8333-333333333333',
      actorId: 'actor-1',
      providerUserId: 'wahoo-user-1',
      workoutId: 'workout-1',
      status: 'pending',
      attempts: 0
    })
    database.countWahooHistoryItems.mockResolvedValue({
      total: 1,
      completed: 0,
      failed: 0,
      pending: 1
    })
    database.updateWahooHistoryImport.mockResolvedValue(undefined)
    database.acquireImportLock.mockResolvedValue({ token: 'lock-token' })
    database.releaseImportLock.mockResolvedValue(true)
    mockGetWahooWorkoutsPage.mockResolvedValue({
      workouts: [
        {
          id: 'workout-1',
          starts: '2026-09-10T10:00:00.000Z',
          workout_summary: { id: 'summary-1' }
        }
      ],
      total: 100,
      page: 1,
      per_page: 50
    } as never)
  })

  it('rejects a history scan when settings belong to a different Wahoo account', async () => {
    database.getFitnessSettings.mockResolvedValue({
      id: 'settings-1',
      actorId: 'actor-1',
      serviceType: 'wahoo',
      accessToken: 'access-token',
      providerUserId: 'different-wahoo-user',
      createdAt: 1,
      updatedAt: 1
    })

    await expect(
      importWahooHistoryJob(database as unknown as Database, {
        id: 'history-job',
        name: IMPORT_WAHOO_HISTORY_JOB_NAME,
        data: { historyId }
      })
    ).rejects.toThrow('Wahoo connection is unavailable for history import')

    expect(database.updateWahooHistoryImport).toHaveBeenCalledWith(historyId, {
      status: 'failed',
      lastError: 'Wahoo history scan failed. Retry to continue.'
    })
    expect(mockGetWahooWorkoutsPage).not.toHaveBeenCalled()
  })

  it('stops a cancelled history scan before calling Wahoo', async () => {
    database.getWahooHistoryImport.mockResolvedValue(
      history({ status: 'cancelled' })
    )

    await importWahooHistoryJob(database as unknown as Database, {
      id: 'cancelled-history-job',
      name: IMPORT_WAHOO_HISTORY_JOB_NAME,
      data: { historyId }
    })

    expect(mockGetWahooWorkoutsPage).not.toHaveBeenCalled()
    expect(database.upsertWahooImport).not.toHaveBeenCalled()
  })

  it('queues a discovered workout and the next history page', async () => {
    await importWahooHistoryJob(database as unknown as Database, {
      id: 'history-job',
      name: IMPORT_WAHOO_HISTORY_JOB_NAME,
      data: { historyId }
    })

    expect(database.upsertWahooImport).toHaveBeenCalledWith({
      actorId: 'actor-1',
      providerUserId: 'wahoo-user-1',
      workoutId: 'workout-1',
      summaryId: 'summary-1',
      historyImportId: historyId
    })
    expect(queue.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: IMPORT_WAHOO_ACTIVITY_JOB_NAME,
        data: {
          importId: '33333333-3333-4333-8333-333333333333',
          notifyOnComplete: false
        }
      })
    )
    expect(database.updateWahooHistoryImport).toHaveBeenCalledWith(historyId, {
      nextPage: 2,
      total: 1,
      scanComplete: false,
      status: 'running',
      lastError: null
    })
    expect(queue.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: IMPORT_WAHOO_HISTORY_JOB_NAME,
        data: { historyId }
      })
    )
  })
})
