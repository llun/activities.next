import {
  IMPORT_FITNESS_FILES_JOB_NAME,
  IMPORT_STRAVA_ACTIVITY_JOB_NAME
} from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'

import { GET, POST } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

type MockDatabase = {
  getFitnessFilesByBatchId: jest.Mock
  getStravaArchiveImportByBatchId: jest.Mock
  getActorsForAccount: jest.Mock
  updateFitnessFilesImportStatus: jest.Mock
  updateFitnessFilesProcessingStatus: jest.Mock
  updateFitnessFileImportStatus: jest.Mock
  updateFitnessFileProcessingStatus: jest.Mock
}

let mockDatabase: MockDatabase | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
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

describe('fitness import batch route', () => {
  const db: MockDatabase = {
    getFitnessFilesByBatchId: vi.fn(),
    getStravaArchiveImportByBatchId: vi.fn().mockResolvedValue(null),
    getActorsForAccount: vi.fn().mockResolvedValue([
      {
        id: 'https://llun.test/users/llun'
      },
      {
        id: 'https://llun.test/users/testactor2'
      }
    ]),
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
    db.getStravaArchiveImportByBatchId.mockResolvedValue(null)
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

  it('falls back to Strava archive source batch when import batch is empty', async () => {
    db.getFitnessFilesByBatchId
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'archive-file-1',
          actorId: 'https://llun.test/users/llun',
          fileName: 'export_1.fit',
          fileType: 'fit',
          path: 'fitness/export_1.fit',
          mimeType: 'application/zip',
          bytes: 2048,
          importStatus: 'completed',
          processingStatus: 'completed',
          isPrimary: true,
          createdAt: 1,
          updatedAt: 1
        }
      ])

    const request = {
      headers: new Headers()
    } as unknown as Parameters<typeof GET>[0]

    const response = await GET(request, {
      params: Promise.resolve({ batchId: 'strava-archive:archive-1' })
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
    expect(json.status).toBe('completed')
    expect(json.summary).toEqual({
      total: 1,
      completed: 1,
      failed: 0,
      pending: 0
    })
    expect(db.getFitnessFilesByBatchId).toHaveBeenNthCalledWith(1, {
      batchId: 'strava-archive:archive-1'
    })
    expect(db.getFitnessFilesByBatchId).toHaveBeenNthCalledWith(2, {
      batchId: 'strava-archive-source:archive-1'
    })
  })

  it('falls back to Strava archive import state when source batch was cleaned up', async () => {
    db.getFitnessFilesByBatchId.mockResolvedValue([])
    db.getStravaArchiveImportByBatchId.mockResolvedValueOnce({
      id: 'import-1',
      actorId: 'https://llun.test/users/llun',
      archiveId: 'archive-1',
      archiveFitnessFileId: 'archive-file-1',
      batchId: 'strava-archive:archive-1',
      visibility: 'private',
      status: 'completed',
      nextActivityIndex: 3,
      pendingMediaActivities: [],
      mediaAttachmentRetry: 0,
      totalActivitiesCount: 3,
      completedActivitiesCount: 3,
      failedActivitiesCount: 0,
      firstFailureMessage: undefined,
      lastError: undefined,
      resolvedAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now()
    })

    const request = {
      headers: new Headers()
    } as unknown as Parameters<typeof GET>[0]

    const response = await GET(request, {
      params: Promise.resolve({ batchId: 'strava-archive:archive-1' })
    })
    const json = (await response.json()) as {
      status: string
      summary: {
        total: number
        completed: number
        failed: number
        pending: number
      }
      files: unknown[]
    }

    expect(response.status).toBe(200)
    expect(json.status).toBe('completed')
    expect(json.summary).toEqual({
      total: 3,
      completed: 3,
      failed: 0,
      pending: 0
    })
    expect(json.files).toEqual([])
    expect(db.getStravaArchiveImportByBatchId).toHaveBeenCalledWith({
      batchId: 'strava-archive:archive-1'
    })
  })

  it('includes archive failure counters when file rows exist', async () => {
    db.getFitnessFilesByBatchId.mockResolvedValueOnce([
      {
        id: 'file-1',
        actorId: 'https://llun.test/users/llun',
        fileName: 'activity-1.fit',
        fileType: 'fit',
        path: 'fitness/activity-1.fit',
        mimeType: 'application/vnd.ant.fit',
        bytes: 1024,
        importStatus: 'completed',
        processingStatus: 'completed',
        isPrimary: true,
        createdAt: 1,
        updatedAt: 1
      }
    ])
    db.getStravaArchiveImportByBatchId.mockResolvedValueOnce({
      id: 'import-1',
      actorId: 'https://llun.test/users/llun',
      archiveId: 'archive-1',
      archiveFitnessFileId: 'archive-file-1',
      batchId: 'strava-archive:archive-1',
      visibility: 'private',
      status: 'completed',
      nextActivityIndex: 2,
      pendingMediaActivities: [],
      mediaAttachmentRetry: 0,
      totalActivitiesCount: 2,
      completedActivitiesCount: 1,
      failedActivitiesCount: 1,
      firstFailureMessage: 'corrupt activity row',
      lastError: undefined,
      resolvedAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now()
    })

    const request = {
      headers: new Headers()
    } as unknown as Parameters<typeof GET>[0]

    const response = await GET(request, {
      params: Promise.resolve({ batchId: 'strava-archive:archive-1' })
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

  it('keeps batch status pending while any files are still pending', async () => {
    db.getFitnessFilesByBatchId.mockResolvedValue([
      {
        id: 'file-1',
        actorId: 'https://llun.test/users/llun',
        fileName: 'first.fit',
        fileType: 'fit',
        path: 'fitness/first.fit',
        mimeType: 'application/vnd.ant.fit',
        bytes: 1024,
        importStatus: 'pending',
        processingStatus: 'pending',
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
    expect(json.status).toBe('pending')
    expect(json.summary).toEqual({
      total: 2,
      completed: 0,
      failed: 1,
      pending: 1
    })
  })

  it('keeps batch status pending while processing is still pending', async () => {
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
        processingStatus: 'pending',
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
        importStatus: 'completed',
        processingStatus: 'completed',
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
    expect(json.status).toBe('pending')
    expect(json.summary).toEqual({
      total: 2,
      completed: 1,
      failed: 0,
      pending: 1
    })
  })

  it('keeps batch status pending while processing is in progress', async () => {
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
        processingStatus: 'processing',
        isPrimary: true,
        createdAt: 1,
        updatedAt: 1
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
    expect(json.status).toBe('pending')
    expect(json.summary).toEqual({
      total: 1,
      completed: 0,
      failed: 0,
      pending: 1
    })
  })

  it('allows reading batch status for another actor in same account', async () => {
    db.getFitnessFilesByBatchId.mockResolvedValue([
      {
        id: 'file-1',
        actorId: 'https://llun.test/users/testactor2',
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
      }
    ])

    const request = {
      headers: new Headers()
    } as unknown as Parameters<typeof GET>[0]

    const response = await GET(request, {
      params: Promise.resolve({ batchId: 'batch-1' })
    })

    expect(response.status).toBe(200)
    expect(db.getActorsForAccount).toHaveBeenCalledWith({
      accountId: 'account-1'
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
    expect(db.updateFitnessFilesImportStatus).toHaveBeenCalledWith({
      fitnessFileIds: ['file-1'],
      importStatus: 'pending'
    })
    expect(db.updateFitnessFilesProcessingStatus).toHaveBeenCalledWith({
      fitnessFileIds: ['file-1'],
      processingStatus: 'pending'
    })
    expect(getQueue().publish).toHaveBeenCalledWith({
      id: expect.any(String),
      name: IMPORT_FITNESS_FILES_JOB_NAME,
      data: {
        actorId: 'https://llun.test/users/llun',
        batchId: 'batch-1',
        fitnessFileIds: ['file-1'],
        overlapFitnessFileIds: [],
        visibility: 'private'
      }
    })
  })

  it('re-runs the full Strava activity import for strava-activity batches', async () => {
    db.getFitnessFilesByBatchId.mockResolvedValue([
      {
        id: 'file-1',
        actorId: 'https://llun.test/users/llun',
        fileName: 'strava-19007245213.tcx',
        fileType: 'tcx',
        path: 'fitness/strava-19007245213.tcx',
        mimeType: 'application/vnd.garmin.tcx+xml',
        bytes: 1024,
        importBatchId: 'strava-activity:19007245213',
        importStatus: 'failed',
        processingStatus: 'failed',
        createdAt: 1,
        updatedAt: 1
      }
    ])

    const request = {
      headers: new Headers(),
      json: async () => ({ visibility: 'public' })
    } as unknown as Parameters<typeof POST>[0]

    const response = await POST(request, {
      params: Promise.resolve({ batchId: 'strava-activity:19007245213' })
    })
    const json = (await response.json()) as { retried: number }

    expect(response.status).toBe(200)
    expect(json.retried).toBe(1)
    // Failed files are still reset so the UI reflects the in-progress retry.
    expect(db.updateFitnessFilesImportStatus).toHaveBeenCalledWith({
      fitnessFileIds: ['file-1'],
      importStatus: 'pending'
    })
    // The full Strava importer runs (caption/photos/visibility), not just the
    // file importer. Visibility is intentionally omitted so the job re-derives
    // the activity's real Strava visibility.
    expect(getQueue().publish).toHaveBeenCalledWith({
      id: expect.any(String),
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: {
        actorId: 'https://llun.test/users/llun',
        stravaActivityId: '19007245213'
      }
    })
    expect(getQueue().publish).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: IMPORT_FITNESS_FILES_JOB_NAME })
    )
  })

  it('includes completed files as overlap context during retry', async () => {
    db.getFitnessFilesByBatchId.mockResolvedValue([
      {
        id: 'file-failed',
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
      },
      {
        id: 'file-completed',
        actorId: 'https://llun.test/users/llun',
        fileName: 'completed.fit',
        fileType: 'fit',
        path: 'fitness/completed.fit',
        mimeType: 'application/vnd.ant.fit',
        bytes: 1024,
        importStatus: 'completed',
        processingStatus: 'completed',
        statusId: 'https://llun.test/users/llun/statuses/existing',
        createdAt: 2,
        updatedAt: 2
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
    expect(getQueue().publish).toHaveBeenCalledWith({
      id: expect.any(String),
      name: IMPORT_FITNESS_FILES_JOB_NAME,
      data: {
        actorId: 'https://llun.test/users/llun',
        batchId: 'batch-1',
        fitnessFileIds: ['file-failed'],
        overlapFitnessFileIds: ['file-completed'],
        visibility: 'private'
      }
    })
  })

  it('retries failed files for another actor in same account', async () => {
    db.getFitnessFilesByBatchId.mockResolvedValue([
      {
        id: 'file-1',
        actorId: 'https://llun.test/users/testactor2',
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
    expect(getQueue().publish).toHaveBeenCalledWith({
      id: expect.any(String),
      name: IMPORT_FITNESS_FILES_JOB_NAME,
      data: {
        actorId: 'https://llun.test/users/testactor2',
        batchId: 'batch-1',
        fitnessFileIds: ['file-1'],
        overlapFitnessFileIds: [],
        visibility: 'private'
      }
    })
  })

  it('retries files with failed processing status', async () => {
    db.getFitnessFilesByBatchId.mockResolvedValue([
      {
        id: 'file-1',
        actorId: 'https://llun.test/users/llun',
        fileName: 'process-failed.fit',
        fileType: 'fit',
        path: 'fitness/process-failed.fit',
        mimeType: 'application/vnd.ant.fit',
        bytes: 1024,
        importStatus: 'completed',
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
    // The import already succeeded; only its processing failed, so its
    // importStatus must NOT be reset (a re-import would leave it stuck 'pending').
    expect(db.updateFitnessFilesImportStatus).not.toHaveBeenCalled()
    expect(db.updateFitnessFilesProcessingStatus).toHaveBeenCalledWith({
      fitnessFileIds: ['file-1'],
      processingStatus: 'pending'
    })
    expect(getQueue().publish).toHaveBeenCalledWith({
      id: expect.any(String),
      name: IMPORT_FITNESS_FILES_JOB_NAME,
      data: {
        actorId: 'https://llun.test/users/llun',
        batchId: 'batch-1',
        fitnessFileIds: ['file-1'],
        overlapFitnessFileIds: [],
        visibility: 'private'
      }
    })
  })

  it('does not reset import status for an already-imported file whose processing failed on a strava-activity retry', async () => {
    db.getFitnessFilesByBatchId.mockResolvedValue([
      {
        id: 'file-1',
        actorId: 'https://llun.test/users/llun',
        fileName: 'strava-99.tcx',
        fileType: 'tcx',
        path: 'fitness/strava-99.tcx',
        mimeType: 'application/vnd.garmin.tcx+xml',
        bytes: 1024,
        importBatchId: 'strava-activity:99',
        importStatus: 'completed',
        processingStatus: 'failed',
        statusId: 'https://llun.test/users/llun/statuses/existing',
        createdAt: 1,
        updatedAt: 1
      }
    ])

    const request = {
      headers: new Headers(),
      json: async () => ({ visibility: 'public' })
    } as unknown as Parameters<typeof POST>[0]

    const response = await POST(request, {
      params: Promise.resolve({ batchId: 'strava-activity:99' })
    })
    const json = (await response.json()) as { retried: number }

    expect(response.status).toBe(200)
    expect(json.retried).toBe(1)
    expect(db.updateFitnessFilesImportStatus).not.toHaveBeenCalled()
    expect(db.updateFitnessFilesProcessingStatus).toHaveBeenCalledWith({
      fitnessFileIds: ['file-1'],
      processingStatus: 'pending'
    })
    expect(getQueue().publish).toHaveBeenCalledWith({
      id: expect.any(String),
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: {
        actorId: 'https://llun.test/users/llun',
        stravaActivityId: '99'
      }
    })
  })

  it('restores failed state when retry queue publish fails', async () => {
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
        importError: 'parse failed',
        processingStatus: 'failed',
        createdAt: 1,
        updatedAt: 1
      }
    ])

    getQueue().publish.mockRejectedValueOnce(new Error('queue down'))

    const request = {
      headers: new Headers(),
      json: async () => ({ visibility: 'private' })
    } as unknown as Parameters<typeof POST>[0]

    const response = await POST(request, {
      params: Promise.resolve({ batchId: 'batch-1' })
    })

    expect(response.status).toBe(500)
    expect(db.updateFitnessFilesImportStatus).toHaveBeenCalledWith({
      fitnessFileIds: ['file-1'],
      importStatus: 'pending'
    })
    expect(db.updateFitnessFilesProcessingStatus).toHaveBeenCalledWith({
      fitnessFileIds: ['file-1'],
      processingStatus: 'pending'
    })
    expect(db.updateFitnessFileImportStatus).toHaveBeenCalledWith(
      'file-1',
      'failed',
      'parse failed'
    )
    expect(db.updateFitnessFileProcessingStatus).toHaveBeenCalledWith(
      'file-1',
      'failed'
    )
  })

  it('restores processing-failed state when retry queue publish fails', async () => {
    db.getFitnessFilesByBatchId.mockResolvedValue([
      {
        id: 'file-1',
        actorId: 'https://llun.test/users/llun',
        fileName: 'process-failed.fit',
        fileType: 'fit',
        path: 'fitness/process-failed.fit',
        mimeType: 'application/vnd.ant.fit',
        bytes: 1024,
        importStatus: 'completed',
        processingStatus: 'failed',
        createdAt: 1,
        updatedAt: 1
      }
    ])

    getQueue().publish.mockRejectedValueOnce(new Error('queue down'))

    const request = {
      headers: new Headers(),
      json: async () => ({ visibility: 'private' })
    } as unknown as Parameters<typeof POST>[0]

    const response = await POST(request, {
      params: Promise.resolve({ batchId: 'batch-1' })
    })

    expect(response.status).toBe(500)
    // importStatus was 'completed', so it was never reset to 'pending'.
    expect(db.updateFitnessFilesImportStatus).not.toHaveBeenCalled()
    expect(db.updateFitnessFilesProcessingStatus).toHaveBeenCalledWith({
      fitnessFileIds: ['file-1'],
      processingStatus: 'pending'
    })
    expect(db.updateFitnessFileImportStatus).toHaveBeenCalledWith(
      'file-1',
      'completed',
      undefined
    )
    expect(db.updateFitnessFileProcessingStatus).toHaveBeenCalledWith(
      'file-1',
      'failed'
    )
  })
})
