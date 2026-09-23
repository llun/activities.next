import { Database } from '@/lib/database/types'
import { importFitnessFiles } from '@/lib/jobs/importFitnessFilesJob'
import { importWahooActivityJob } from '@/lib/jobs/importWahooActivityJob'
import { IMPORT_WAHOO_ACTIVITY_JOB_NAME } from '@/lib/jobs/names'
import { saveFitnessFile } from '@/lib/services/fitness-files'
import { getQueue } from '@/lib/services/queue'
import {
  getWahooWorkout,
  getWahooWorkoutSummary
} from '@/lib/services/wahoo/api'

vi.mock('@/lib/services/fitness-files', () => ({
  saveFitnessFile: vi.fn()
}))

vi.mock('@/lib/jobs/importFitnessFilesJob', () => ({
  importFitnessFiles: vi.fn()
}))

vi.mock('@/lib/services/queue', () => ({
  getQueue: vi
    .fn()
    .mockReturnValue({ publish: vi.fn().mockResolvedValue(undefined) })
}))

vi.mock('@/lib/services/wahoo/api', () => ({
  WahooRateLimitError: class WahooRateLimitError extends Error {
    constructor(public readonly retryAfterSeconds: number) {
      super('Wahoo rate limit reached')
    }
  },
  getWahooWorkout: vi.fn(),
  getWahooWorkoutSummary: vi.fn()
}))

vi.mock('@/lib/utils/safeImageDownload', () => ({
  safeImageFetch: vi.fn().mockResolvedValue({ ok: true })
}))

vi.mock('@/lib/utils/streamLimit', () => ({
  SAFE_DOWNLOAD_MAX_BYTES: 1_000_000,
  readResponseArrayBufferWithLimit: vi
    .fn()
    .mockResolvedValue(
      Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0, 46, 70, 73, 84, 0, 0, 0, 0])
    )
}))

vi.mock('@/lib/services/fitness-files/parseFitnessFile', () => ({
  parseFitnessFile: vi.fn().mockResolvedValue({})
}))

const mockImportFitnessFiles = vi.mocked(importFitnessFiles)
const mockSaveFitnessFile = vi.mocked(saveFitnessFile)
const mockGetWahooWorkout = vi.mocked(getWahooWorkout)
const mockGetWahooWorkoutSummary = vi.mocked(getWahooWorkoutSummary)
const mockGetQueue = vi.mocked(getQueue)

type MockDatabase = Pick<
  Database,
  | 'getWahooImport'
  | 'getWahooHistoryImport'
  | 'getFitnessSettings'
  | 'getActorFromId'
  | 'acquireImportLock'
  | 'releaseImportLock'
  | 'updateWahooImport'
  | 'markWahooImportFailed'
  | 'getFitnessFile'
  | 'getFitnessFilesByBatchId'
  | 'updateFitnessFileActivityData'
  | 'getFitnessFilesByActor'
  | 'updateFitnessSettings'
>

describe('importWahooActivityJob', () => {
  const importId = '11111111-1111-4111-8111-111111111111'
  const database: jest.Mocked<MockDatabase> = {
    getWahooImport: vi.fn(),
    getWahooHistoryImport: vi.fn(),
    getFitnessSettings: vi.fn(),
    getActorFromId: vi.fn(),
    acquireImportLock: vi.fn(),
    releaseImportLock: vi.fn(),
    updateWahooImport: vi.fn(),
    markWahooImportFailed: vi.fn(),
    getFitnessFile: vi.fn(),
    getFitnessFilesByBatchId: vi.fn(),
    updateFitnessFileActivityData: vi.fn(),
    getFitnessFilesByActor: vi.fn(),
    updateFitnessSettings: vi.fn()
  }
  const queue = { publish: vi.fn().mockResolvedValue(undefined) }

  const record = (overrides: Record<string, unknown> = {}) => ({
    id: importId,
    actorId: 'actor-1',
    providerUserId: 'wahoo-user-1',
    workoutId: 'workout-1',
    status: 'pending',
    attempts: 0,
    ...overrides
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(mockGetQueue).mockReturnValue({ publish: queue.publish } as never)
    queue.publish.mockResolvedValue(undefined)
    database.getWahooImport.mockResolvedValue(record() as never)
    database.getWahooHistoryImport.mockResolvedValue(null)
    database.getFitnessSettings.mockResolvedValue({
      id: 'settings-1',
      actorId: 'actor-1',
      serviceType: 'wahoo',
      accessToken: 'access-token',
      providerUserId: 'wahoo-user-1',
      defaultVisibility: 'private',
      createdAt: 1,
      updatedAt: 1
    })
    database.getActorFromId.mockResolvedValue({
      id: 'actor-1',
      username: 'testuser',
      domain: 'example.test'
    } as never)
    database.acquireImportLock.mockResolvedValue({ token: 'lock-token' })
    database.releaseImportLock.mockResolvedValue(true)
    database.updateWahooImport.mockResolvedValue(undefined)
    database.markWahooImportFailed.mockResolvedValue(undefined)
    database.getFitnessFile.mockResolvedValue({
      id: 'new-file',
      actorId: 'actor-1',
      statusId: 'status-new'
    } as never)
    database.getFitnessFilesByBatchId.mockResolvedValue([])
    database.updateFitnessFileActivityData.mockResolvedValue(true)
    database.getFitnessFilesByActor.mockResolvedValue([
      {
        id: 'strava-file',
        actorId: 'actor-1',
        statusId: 'strava-status',
        activityStartTime: Date.parse('2026-09-20T12:00:00.000Z'),
        totalDurationSeconds: 3600
      }
    ] as never)
    database.updateFitnessSettings.mockResolvedValue({} as never)
    mockSaveFitnessFile.mockResolvedValue({ id: 'new-file' } as never)
    mockImportFitnessFiles.mockResolvedValue([])
    mockGetWahooWorkout.mockResolvedValue({
      id: 'workout-1',
      starts: '2026-09-20T12:00:00.000Z',
      minutes: 60,
      name: 'Morning ride',
      workout_summary: {
        id: 'summary-1',
        updated_at: '2026-09-20T12:30:00.000Z',
        file: { url: 'https://files.example.test/ride.fit' }
      }
    } as never)
    mockGetWahooWorkoutSummary.mockResolvedValue({
      id: 'summary-1',
      file: { url: 'https://files.example.test/ride.fit' }
    } as never)
  })

  it('records missing FIT files as unsupported so history retry can pick them up', async () => {
    mockGetWahooWorkout.mockResolvedValue({
      id: 'workout-1',
      workout_summary: { id: 'summary-1' }
    } as never)
    mockGetWahooWorkoutSummary.mockResolvedValue({
      id: 'summary-1',
      file: null
    } as never)

    await expect(
      importWahooActivityJob(database as unknown as Database, {
        id: 'job-1',
        name: IMPORT_WAHOO_ACTIVITY_JOB_NAME,
        data: { importId, notifyOnComplete: false }
      })
    ).rejects.toThrow('Wahoo workout summary has no FIT file yet')

    expect(database.markWahooImportFailed).toHaveBeenCalledWith(
      importId,
      'unsupported',
      'Wahoo workout summary has no FIT file yet'
    )
    expect(mockImportFitnessFiles).not.toHaveBeenCalled()
  })

  it('does not create another post for a completed workout with the same summary revision', async () => {
    const completed = record({
      status: 'completed',
      statusId: 'existing-status',
      summaryId: 'summary-1',
      summaryUpdatedAt: Date.parse('2026-09-20T12:30:00.000Z')
    })
    database.getWahooImport.mockResolvedValue(completed as never)

    await importWahooActivityJob(database as unknown as Database, {
      id: 'duplicate-job',
      name: IMPORT_WAHOO_ACTIVITY_JOB_NAME,
      data: { importId, notifyOnComplete: true }
    })

    expect(mockImportFitnessFiles).not.toHaveBeenCalled()
    expect(mockSaveFitnessFile).not.toHaveBeenCalled()
    expect(database.updateWahooImport).not.toHaveBeenCalled()
  })

  it('reprocesses a timestamped summary when the stored summary timestamp is missing', async () => {
    database.getWahooImport.mockResolvedValue(
      record({
        status: 'completed',
        hadStatus: true,
        statusId: 'existing-status',
        summaryId: 'summary-1'
      }) as never
    )

    await importWahooActivityJob(database as unknown as Database, {
      id: 'timestamped-summary-job',
      name: IMPORT_WAHOO_ACTIVITY_JOB_NAME,
      data: { importId, notifyOnComplete: false }
    })

    expect(mockSaveFitnessFile).toHaveBeenCalledOnce()
    expect(mockImportFitnessFiles).toHaveBeenCalledWith(
      database,
      expect.objectContaining({
        expectedExistingStatusId: 'existing-status'
      }),
      { deferProcessJobPublishes: true }
    )
    expect(database.updateWahooImport).toHaveBeenCalledWith(
      importId,
      expect.objectContaining({
        summaryId: 'summary-1',
        summaryUpdatedAt: Date.parse('2026-09-20T12:30:00.000Z')
      })
    )
  })

  it('keeps a deleted completed workout as a tombstone after a newer revision', async () => {
    database.getWahooImport.mockResolvedValue(
      record({
        status: 'completed',
        hadStatus: true,
        summaryId: 'summary-1',
        summaryUpdatedAt: Date.parse('2026-09-20T12:00:00.000Z')
      }) as never
    )

    await importWahooActivityJob(database as unknown as Database, {
      id: 'deleted-workout-revision-job',
      name: IMPORT_WAHOO_ACTIVITY_JOB_NAME,
      data: { importId, notifyOnComplete: false }
    })

    expect(mockGetWahooWorkout).not.toHaveBeenCalled()
    expect(mockSaveFitnessFile).not.toHaveBeenCalled()
    expect(mockImportFitnessFiles).not.toHaveBeenCalled()
    expect(database.updateWahooImport).not.toHaveBeenCalled()
  })

  it('passes an existing Strava activity as overlap context when Wahoo arrives second', async () => {
    await importWahooActivityJob(database as unknown as Database, {
      id: 'job-overlap',
      name: IMPORT_WAHOO_ACTIVITY_JOB_NAME,
      data: { importId, notifyOnComplete: true }
    })

    expect(mockImportFitnessFiles).toHaveBeenCalledWith(
      database,
      expect.objectContaining({
        fitnessFileIds: ['new-file'],
        overlapFitnessFileIds: ['strava-file'],
        notifyOnComplete: true,
        postAtImportTime: true,
        preferRicherPrimary: true
      }),
      { deferProcessJobPublishes: true }
    )
  })
})
