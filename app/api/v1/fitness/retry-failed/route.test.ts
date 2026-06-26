import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { IMPORT_STRAVA_ACTIVITY_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'

import { POST } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    host: 'llun.test',
    allowEmails: [],
    allowActorDomains: []
  })
}))

vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: vi.fn().mockResolvedValue({
    id: 'https://llun.test/users/llun',
    username: 'llun',
    domain: 'llun.test',
    account: {
      id: 'account-1',
      email: 'llun@activities.local',
      defaultActorId: 'https://llun.test/users/llun'
    },
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

vi.mock('@/lib/services/queue', () => ({
  getQueue: vi.fn().mockReturnValue({
    publish: vi.fn().mockResolvedValue(undefined)
  })
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: () => undefined
  })
}))

type MockDatabase = Pick<
  Database,
  | 'getFitnessFilesByActor'
  | 'getFitnessFilesByBatchId'
  | 'updateFitnessFilesImportStatus'
  | 'updateFitnessFilesProcessingStatus'
  | 'updateFitnessFileImportStatus'
  | 'updateFitnessFileProcessingStatus'
>

let mockDatabase: MockDatabase | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

const ACTOR_ID = 'https://llun.test/users/llun'

const fitnessFile = (overrides: Record<string, unknown>) => ({
  id: 'file',
  actorId: ACTOR_ID,
  statusId: null,
  importBatchId: null,
  importStatus: 'pending',
  processingStatus: 'pending',
  updatedAt: Date.now(),
  ...overrides
})

const buildRequest = () =>
  new NextRequest('https://llun.test/api/v1/fitness/retry-failed', {
    method: 'POST',
    headers: { Origin: 'https://llun.test' }
  })

const routeContext = { params: Promise.resolve({}) }

describe('POST /api/v1/fitness/retry-failed', () => {
  const db: jest.Mocked<MockDatabase> = {
    getFitnessFilesByActor: vi.fn(),
    getFitnessFilesByBatchId: vi.fn(),
    updateFitnessFilesImportStatus: vi.fn().mockResolvedValue(1),
    updateFitnessFilesProcessingStatus: vi.fn().mockResolvedValue(1),
    updateFitnessFileImportStatus: vi.fn().mockResolvedValue(true),
    updateFitnessFileProcessingStatus: vi.fn().mockResolvedValue(true)
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: 'llun@activities.local' }
    })
    db.updateFitnessFilesImportStatus.mockResolvedValue(1)
    db.updateFitnessFilesProcessingStatus.mockResolvedValue(1)
    db.updateFitnessFileImportStatus.mockResolvedValue(true)
    db.updateFitnessFileProcessingStatus.mockResolvedValue(true)
    mockDatabase = db
  })

  it('requeues every failed/stuck batch and reports the totals', async () => {
    db.getFitnessFilesByActor.mockResolvedValueOnce([
      fitnessFile({
        id: 'a',
        importBatchId: 'strava-activity:1',
        importStatus: 'failed'
      }),
      fitnessFile({
        id: 'b',
        importBatchId: 'strava-activity:2',
        statusId: `${ACTOR_ID}/statuses/2`,
        importStatus: 'completed',
        processingStatus: 'failed'
      }),
      // Healthy import — not retried, its batch is ignored.
      fitnessFile({
        id: 'c',
        importBatchId: 'strava-activity:3',
        statusId: `${ACTOR_ID}/statuses/3`,
        importStatus: 'completed',
        processingStatus: 'completed'
      })
    ] as never)
    db.getFitnessFilesByActor.mockResolvedValue([] as never)

    db.getFitnessFilesByBatchId.mockImplementation(
      async ({ batchId }: { batchId: string }) => {
        if (batchId === 'strava-activity:1') {
          return [
            fitnessFile({
              id: 'a',
              importBatchId: 'strava-activity:1',
              importStatus: 'failed'
            })
          ] as never
        }
        return [
          fitnessFile({
            id: 'b',
            importBatchId: 'strava-activity:2',
            statusId: `${ACTOR_ID}/statuses/2`,
            importStatus: 'completed',
            processingStatus: 'failed'
          })
        ] as never
      }
    )

    const response = await POST(buildRequest(), routeContext)
    const json = (await response.json()) as {
      retried: number
      batches: number
      failedBatches: number
    }

    expect(response.status).toBe(200)
    expect(json.retried).toBe(2)
    expect(json.batches).toBe(2)
    expect(json.failedBatches).toBe(0)

    const publish = getQueue().publish as jest.Mock
    expect(publish).toHaveBeenCalledTimes(2)
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ name: IMPORT_STRAVA_ACTIVITY_JOB_NAME })
    )
  })

  it('retries a batch whose file is stuck in processing', async () => {
    const stuckUpdatedAt = Date.now() - 60 * 60 * 1000
    db.getFitnessFilesByActor.mockResolvedValueOnce([
      fitnessFile({
        id: 'stuck',
        importBatchId: 'strava-activity:42',
        statusId: `${ACTOR_ID}/statuses/42`,
        importStatus: 'completed',
        processingStatus: 'processing',
        updatedAt: stuckUpdatedAt
      })
    ] as never)
    db.getFitnessFilesByActor.mockResolvedValue([] as never)
    db.getFitnessFilesByBatchId.mockResolvedValue([
      fitnessFile({
        id: 'stuck',
        importBatchId: 'strava-activity:42',
        statusId: `${ACTOR_ID}/statuses/42`,
        importStatus: 'completed',
        processingStatus: 'processing',
        updatedAt: stuckUpdatedAt
      })
    ] as never)

    const response = await POST(buildRequest(), routeContext)
    const json = (await response.json()) as { retried: number; batches: number }

    expect(response.status).toBe(200)
    expect(json.retried).toBe(1)
    expect(json.batches).toBe(1)
    expect(getQueue().publish).toHaveBeenCalledWith(
      expect.objectContaining({ name: IMPORT_STRAVA_ACTIVITY_JOB_NAME })
    )
  })

  it('returns zero when nothing is failed or stuck', async () => {
    db.getFitnessFilesByActor.mockResolvedValue([
      fitnessFile({
        id: 'a',
        importBatchId: 'strava-activity:1',
        statusId: `${ACTOR_ID}/statuses/1`,
        importStatus: 'completed',
        processingStatus: 'completed'
      })
    ] as never)

    const response = await POST(buildRequest(), routeContext)
    const json = (await response.json()) as { retried: number; batches: number }

    expect(response.status).toBe(200)
    expect(json.retried).toBe(0)
    expect(json.batches).toBe(0)
    expect(getQueue().publish).not.toHaveBeenCalled()
  })

  it('continues past a batch whose requeue fails', async () => {
    db.getFitnessFilesByActor.mockResolvedValueOnce([
      fitnessFile({
        id: 'a',
        importBatchId: 'batch-good',
        importStatus: 'failed'
      }),
      fitnessFile({
        id: 'b',
        importBatchId: 'batch-bad',
        importStatus: 'failed'
      })
    ] as never)
    db.getFitnessFilesByActor.mockResolvedValue([] as never)
    db.getFitnessFilesByBatchId.mockImplementation(
      async ({ batchId }: { batchId: string }) =>
        [
          fitnessFile({
            id: batchId === 'batch-good' ? 'a' : 'b',
            importBatchId: batchId,
            importStatus: 'failed'
          })
        ] as never
    )

    const publish = getQueue().publish as jest.Mock
    publish.mockImplementation(async () => {
      // Fail the second batch's publish; the first must still count as retried.
      if (publish.mock.calls.length === 2) {
        throw new Error('queue down')
      }
      return undefined
    })

    const response = await POST(buildRequest(), routeContext)
    const json = (await response.json()) as {
      retried: number
      batches: number
      failedBatches: number
    }

    expect(response.status).toBe(200)
    expect(json.batches).toBe(1)
    expect(json.failedBatches).toBe(1)
  })
})
