import { IMPORT_STRAVA_ARCHIVE_JOB_NAME } from '@/lib/jobs/names'
import {
  deleteFitnessFile,
  saveFitnessFile
} from '@/lib/services/fitness-files'
import { getQueue } from '@/lib/services/queue'

import { GET, PATCH, POST } from './route'

const mockGetServerSession = jest.fn()
jest.mock('next-auth', () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args)
}))

jest.mock('@/app/api/auth/[...nextauth]/authOptions', () => ({
  getAuthOptions: jest.fn(() => ({}))
}))

type MockDatabase = {
  getActiveStravaArchiveImportByActor: jest.Mock
  createStravaArchiveImport: jest.Mock
  deleteStravaArchiveImport: jest.Mock
  getFitnessFile: jest.Mock
  updateStravaArchiveImport: jest.Mock
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

jest.mock('@/lib/services/fitness-files', () => ({
  saveFitnessFile: jest.fn(),
  deleteFitnessFile: jest.fn()
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

const mockSaveFitnessFile = saveFitnessFile as jest.MockedFunction<
  typeof saveFitnessFile
>
const mockDeleteFitnessFile = deleteFitnessFile as jest.MockedFunction<
  typeof deleteFitnessFile
>

describe('Strava archive import route', () => {
  const db: MockDatabase = {
    getActiveStravaArchiveImportByActor: jest.fn(),
    createStravaArchiveImport: jest.fn(),
    deleteStravaArchiveImport: jest.fn(),
    getFitnessFile: jest.fn(),
    updateStravaArchiveImport: jest.fn(),
    updateFitnessFileImportStatus: jest.fn(),
    updateFitnessFileProcessingStatus: jest.fn()
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: 'llun@activities.local' }
    })
    mockDatabase = db

    db.getActiveStravaArchiveImportByActor.mockResolvedValue(null)
    db.createStravaArchiveImport.mockResolvedValue({
      id: 'import-1',
      actorId: 'https://llun.test/users/llun',
      archiveId: 'archive-1',
      archiveFitnessFileId: 'archive-file-id',
      batchId: 'strava-archive:archive-1',
      visibility: 'private',
      status: 'importing',
      nextActivityIndex: 0,
      pendingMediaActivities: [],
      mediaAttachmentRetry: 0,
      totalActivitiesCount: undefined,
      completedActivitiesCount: 0,
      failedActivitiesCount: 0,
      firstFailureMessage: undefined,
      lastError: undefined,
      resolvedAt: undefined,
      createdAt: Date.now(),
      updatedAt: Date.now()
    })
    db.deleteStravaArchiveImport.mockResolvedValue(true)
    db.getFitnessFile.mockResolvedValue({
      id: 'archive-file-id',
      actorId: 'https://llun.test/users/llun',
      path: 'archive/path.zip'
    })
    db.updateStravaArchiveImport.mockResolvedValue({})
    db.updateFitnessFileImportStatus.mockResolvedValue(true)
    db.updateFitnessFileProcessingStatus.mockResolvedValue(true)

    mockSaveFitnessFile.mockResolvedValue({
      id: 'archive-file-id',
      type: 'fitness',
      file_type: 'zip',
      mime_type: 'application/zip',
      url: 'https://llun.test/api/v1/fitness-files/archive-file-id',
      fileName: 'export_1.zip',
      size: 1024
    })
    mockDeleteFitnessFile.mockResolvedValue(true)
  })

  it('GET returns current active archive import state', async () => {
    db.getActiveStravaArchiveImportByActor.mockResolvedValueOnce({
      id: 'import-1',
      actorId: 'https://llun.test/users/llun',
      archiveId: 'archive-1',
      archiveFitnessFileId: 'archive-file-id',
      batchId: 'strava-archive:archive-1',
      visibility: 'private',
      status: 'failed',
      nextActivityIndex: 4,
      pendingMediaActivities: [],
      mediaAttachmentRetry: 2,
      totalActivitiesCount: 10,
      completedActivitiesCount: 3,
      failedActivitiesCount: 1,
      firstFailureMessage: 'bad entry',
      lastError: 'queue down',
      resolvedAt: undefined,
      createdAt: Date.now(),
      updatedAt: Date.now()
    })

    const request = {
      headers: new Headers()
    } as unknown as Parameters<typeof GET>[0]

    const response = await GET(request, { params: Promise.resolve({}) })
    const data = (await response.json()) as {
      activeImport: { id: string; status: string; batchId: string }
    }

    expect(response.status).toBe(200)
    expect(data.activeImport).toEqual(
      expect.objectContaining({
        id: 'import-1',
        status: 'failed',
        batchId: 'strava-archive:archive-1'
      })
    )
  })

  it('POST stores archive file, creates import state, and queues import job', async () => {
    db.createStravaArchiveImport.mockResolvedValueOnce({
      id: 'import-1',
      actorId: 'https://llun.test/users/llun',
      archiveId: 'archive-1',
      archiveFitnessFileId: 'archive-file-id',
      batchId: 'strava-archive:archive-1',
      visibility: 'private',
      status: 'importing',
      nextActivityIndex: 0,
      pendingMediaActivities: [],
      mediaAttachmentRetry: 0,
      totalActivitiesCount: undefined,
      completedActivitiesCount: 0,
      failedActivitiesCount: 0,
      firstFailureMessage: undefined,
      lastError: undefined,
      resolvedAt: undefined,
      createdAt: Date.now(),
      updatedAt: Date.now()
    })

    const formData = new FormData()
    formData.append(
      'archive',
      new File([Buffer.from('zip-data')], 'export_1.zip', {
        type: 'application/zip'
      })
    )
    formData.append('visibility', 'private')

    const request = {
      headers: new Headers(),
      formData: async () => formData
    } as unknown as Parameters<typeof POST>[0]

    const response = await POST(request, { params: Promise.resolve({}) })
    const data = (await response.json()) as {
      archiveId: string
      batchId: string
      importId: string
    }

    expect(response.status).toBe(200)
    expect(data.batchId).toBeDefined()
    expect(data.importId).toBe('import-1')
    expect(mockSaveFitnessFile).toHaveBeenCalledTimes(1)
    expect(mockSaveFitnessFile).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        id: 'https://llun.test/users/llun'
      }),
      expect.objectContaining({
        file: expect.objectContaining({
          name: 'export_1.zip',
          type: 'application/zip'
        })
      })
    )
    expect(db.createStravaArchiveImport).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'https://llun.test/users/llun',
        archiveFitnessFileId: 'archive-file-id'
      })
    )
    expect(getQueue().publish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: IMPORT_STRAVA_ARCHIVE_JOB_NAME,
        data: expect.objectContaining({
          importId: 'import-1',
          actorId: 'https://llun.test/users/llun',
          archiveFitnessFileId: 'archive-file-id'
        })
      })
    )
  })

  it('POST rejects when actor already has active import', async () => {
    db.getActiveStravaArchiveImportByActor.mockResolvedValueOnce({
      id: 'import-active',
      actorId: 'https://llun.test/users/llun',
      archiveId: 'archive-active',
      archiveFitnessFileId: 'archive-file-id',
      batchId: 'strava-archive:archive-active',
      visibility: 'private',
      status: 'importing',
      nextActivityIndex: 0,
      pendingMediaActivities: [],
      mediaAttachmentRetry: 0,
      totalActivitiesCount: 10,
      completedActivitiesCount: 0,
      failedActivitiesCount: 0,
      firstFailureMessage: undefined,
      lastError: undefined,
      resolvedAt: undefined,
      createdAt: Date.now(),
      updatedAt: Date.now()
    })

    const formData = new FormData()
    formData.append(
      'archive',
      new File([Buffer.from('zip-data')], 'export_2.zip', {
        type: 'application/zip'
      })
    )

    const request = {
      headers: new Headers(),
      formData: async () => formData
    } as unknown as Parameters<typeof POST>[0]

    const response = await POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(409)
    expect(mockSaveFitnessFile).not.toHaveBeenCalled()
    expect(getQueue().publish).not.toHaveBeenCalled()
  })

  it('PATCH retry requeues failed archive import', async () => {
    db.getActiveStravaArchiveImportByActor.mockResolvedValue({
      id: 'import-1',
      actorId: 'https://llun.test/users/llun',
      archiveId: 'archive-1',
      archiveFitnessFileId: 'archive-file-id',
      batchId: 'strava-archive:archive-1',
      visibility: 'private',
      status: 'failed',
      nextActivityIndex: 2,
      pendingMediaActivities: [],
      mediaAttachmentRetry: 1,
      totalActivitiesCount: 10,
      completedActivitiesCount: 2,
      failedActivitiesCount: 1,
      firstFailureMessage: 'initial failure',
      lastError: 'queue failure',
      resolvedAt: undefined,
      createdAt: Date.now(),
      updatedAt: Date.now()
    })

    const request = {
      headers: new Headers(),
      json: async () => ({ action: 'retry' })
    } as unknown as Parameters<typeof PATCH>[0]

    const response = await PATCH(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(db.updateStravaArchiveImport).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'import-1',
        status: 'importing'
      })
    )
    expect(getQueue().publish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: IMPORT_STRAVA_ARCHIVE_JOB_NAME,
        data: expect.objectContaining({
          importId: 'import-1',
          archiveId: 'archive-1',
          nextActivityIndex: 2
        })
      })
    )
  })

  it('PATCH cancel removes archive file and resolves import', async () => {
    db.getActiveStravaArchiveImportByActor.mockResolvedValue({
      id: 'import-1',
      actorId: 'https://llun.test/users/llun',
      archiveId: 'archive-1',
      archiveFitnessFileId: 'archive-file-id',
      batchId: 'strava-archive:archive-1',
      visibility: 'private',
      status: 'failed',
      nextActivityIndex: 2,
      pendingMediaActivities: [],
      mediaAttachmentRetry: 1,
      totalActivitiesCount: 10,
      completedActivitiesCount: 2,
      failedActivitiesCount: 1,
      firstFailureMessage: 'initial failure',
      lastError: 'queue failure',
      resolvedAt: undefined,
      createdAt: Date.now(),
      updatedAt: Date.now()
    })

    const request = {
      headers: new Headers(),
      json: async () => ({ action: 'cancel' })
    } as unknown as Parameters<typeof PATCH>[0]

    const response = await PATCH(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(mockDeleteFitnessFile).toHaveBeenCalledWith(
      expect.any(Object),
      'archive-file-id',
      expect.objectContaining({ id: 'archive-file-id' })
    )
    expect(db.updateStravaArchiveImport).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'import-1',
        status: 'cancelled'
      })
    )
  })

  it('POST with presigned fitnessFileId starts import without re-uploading file', async () => {
    db.getFitnessFile.mockResolvedValueOnce({
      id: 'pre-created-fitness-file-id',
      actorId: 'https://llun.test/users/llun',
      path: 'fitness/2024-01-01/abc.zip',
      fileName: 'export.zip',
      fileType: 'zip',
      mimeType: 'application/zip',
      bytes: 2048
    })

    const req = new Request(
      'http://localhost/api/v1/settings/fitness/strava/archive',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fitnessFileId: 'pre-created-fitness-file-id',
          archiveId: '550e8400-e29b-41d4-a716-446655440001',
          visibility: 'private'
        })
      }
    )

    const response = await POST(req, { params: Promise.resolve({}) })
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.archiveId).toBe('550e8400-e29b-41d4-a716-446655440001')
    expect(body.batchId).toBe('strava-archive:550e8400-e29b-41d4-a716-446655440001')
    expect(mockSaveFitnessFile).not.toHaveBeenCalled()
    expect(body.importId).toBeDefined()

    const queue = getQueue()
    expect(queue.publish).toHaveBeenCalledTimes(1)
  })

  it('POST with presigned fitnessFileId returns 403 when file belongs to different actor', async () => {
    db.getFitnessFile.mockResolvedValueOnce({
      id: 'someone-elses-file',
      actorId: 'https://other.test/users/other',
      path: 'fitness/2024-01-01/xyz.zip'
    })

    const req = new Request(
      'http://localhost/api/v1/settings/fitness/strava/archive',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fitnessFileId: 'someone-elses-file',
          archiveId: '550e8400-e29b-41d4-a716-446655440002',
          visibility: 'private'
        })
      }
    )

    const response = await POST(req, { params: Promise.resolve({}) })
    expect(response.status).toBe(403)
  })

  it('POST attempts archive rollback even when delete returns false', async () => {
    getQueue().publish.mockRejectedValueOnce(new Error('queue unavailable'))
    mockDeleteFitnessFile.mockResolvedValueOnce(false)

    const formData = new FormData()
    formData.append(
      'archive',
      new File([Buffer.from('zip-data')], 'export_3.zip', {
        type: 'application/zip'
      })
    )
    formData.append('visibility', 'private')

    const request = {
      headers: new Headers(),
      formData: async () => formData
    } as unknown as Parameters<typeof POST>[0]

    const response = await POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(500)
    expect(mockDeleteFitnessFile).toHaveBeenCalledWith(
      expect.any(Object),
      'archive-file-id'
    )
    expect(db.deleteStravaArchiveImport).toHaveBeenCalledWith({
      id: 'import-1'
    })
  })
})
