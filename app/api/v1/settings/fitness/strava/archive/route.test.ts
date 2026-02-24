import { IMPORT_STRAVA_ARCHIVE_JOB_NAME } from '@/lib/jobs/names'
import {
  deleteFitnessFile,
  saveFitnessFile
} from '@/lib/services/fitness-files'
import { getQueue } from '@/lib/services/queue'

import { POST } from './route'

const mockGetServerSession = jest.fn()
jest.mock('next-auth', () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args)
}))

jest.mock('@/app/api/auth/[...nextauth]/authOptions', () => ({
  getAuthOptions: jest.fn(() => ({}))
}))

let mockDatabase: Record<string, unknown> | null = {}
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

describe('POST /api/v1/settings/fitness/strava/archive', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: 'llun@activities.local' }
    })
    mockDatabase = {}

    mockSaveFitnessFile.mockResolvedValue({
      id: 'archive-file-id',
      type: 'fitness',
      file_type: 'fit',
      mime_type: 'application/vnd.ant.fit',
      url: 'https://llun.test/api/v1/fitness-files/archive-file-id',
      fileName: 'export_1.zip',
      size: 1024
    })
    mockDeleteFitnessFile.mockResolvedValue(true)
  })

  it('stores archive file and queues import job', async () => {
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
    }

    expect(response.status).toBe(200)
    expect(data.archiveId).toBeDefined()
    expect(data.batchId).toBe(`strava-archive:${data.archiveId}`)
    expect(mockSaveFitnessFile).toHaveBeenCalledTimes(1)
    const saveCallInput = mockSaveFitnessFile.mock.calls[0]?.[2]
    expect(saveCallInput?.file.name).toBe('export_1.fit')
    expect(saveCallInput?.file.type).toBe('application/zip')
    expect(mockSaveFitnessFile).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ id: 'https://llun.test/users/llun' }),
      expect.objectContaining({
        importBatchId: `strava-archive-source:${data.archiveId}`
      })
    )
    expect(getQueue().publish).toHaveBeenCalledWith({
      id: expect.any(String),
      name: IMPORT_STRAVA_ARCHIVE_JOB_NAME,
      data: {
        actorId: 'https://llun.test/users/llun',
        archiveId: data.archiveId,
        archiveFitnessFileId: 'archive-file-id',
        batchId: data.batchId,
        visibility: 'private'
      }
    })
  })

  it('returns forbidden when actorId differs from current actor', async () => {
    const formData = new FormData()
    formData.append(
      'archive',
      new File([Buffer.from('zip-data')], 'export_1.zip', {
        type: 'application/zip'
      })
    )
    formData.append('actorId', 'https://llun.test/users/llun-second')

    const request = {
      headers: new Headers(),
      formData: async () => formData
    } as unknown as Parameters<typeof POST>[0]

    const response = await POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(403)
    expect(mockSaveFitnessFile).not.toHaveBeenCalled()
    expect(getQueue().publish).not.toHaveBeenCalled()
  })

  it('allows actorId when it matches current actor id', async () => {
    const formData = new FormData()
    formData.append(
      'archive',
      new File([Buffer.from('zip-data')], 'export_1.zip', {
        type: 'application/zip'
      })
    )
    formData.append('actorId', 'https://llun.test/users/llun')

    const request = {
      headers: new Headers(),
      formData: async () => formData
    } as unknown as Parameters<typeof POST>[0]

    const response = await POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(mockSaveFitnessFile).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ id: 'https://llun.test/users/llun' }),
      expect.objectContaining({
        description: 'Strava archive import source'
      })
    )
  })

  it('returns bad request for non-zip archive files', async () => {
    const formData = new FormData()
    formData.append(
      'archive',
      new File([Buffer.from('not-zip')], 'archive.fit', {
        type: 'application/vnd.ant.fit'
      })
    )

    const request = {
      headers: new Headers(),
      formData: async () => formData
    } as unknown as Parameters<typeof POST>[0]

    const response = await POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(400)
    expect(mockSaveFitnessFile).not.toHaveBeenCalled()
    expect(getQueue().publish).not.toHaveBeenCalled()
  })

  it('rolls back archive file when queue publish fails', async () => {
    getQueue().publish.mockRejectedValueOnce(new Error('queue down'))

    const formData = new FormData()
    formData.append(
      'archive',
      new File([Buffer.from('zip-data')], 'export_1.zip', {
        type: 'application/zip'
      })
    )

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
  })
})
