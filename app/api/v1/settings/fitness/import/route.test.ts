import { IMPORT_FITNESS_FILES_JOB_NAME } from '@/lib/jobs/names'
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
  deleteFitnessFile: jest.fn().mockResolvedValue(true)
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

describe('POST /api/v1/settings/fitness/import', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: 'llun@activities.local' }
    })
    mockDatabase = {}

    mockSaveFitnessFile.mockResolvedValue({
      id: 'fitness-file-id',
      type: 'fitness',
      file_type: 'fit',
      mime_type: 'application/vnd.ant.fit',
      url: 'https://llun.test/api/v1/fitness-files/fitness-file-id',
      fileName: 'workout.fit',
      size: 1024
    })
    mockDeleteFitnessFile.mockResolvedValue(true)
  })

  it('uploads files, creates import batch, and enqueues import job', async () => {
    const formData = new FormData()
    formData.append(
      'files',
      new File([Buffer.from('fit-data')], 'workout.fit', {
        type: 'application/vnd.ant.fit'
      })
    )
    formData.append('visibility', 'public')

    const request = {
      headers: new Headers(),
      formData: async () => formData
    } as unknown as Parameters<typeof POST>[0]

    const response = await POST(request, { params: Promise.resolve({}) })
    const json = (await response.json()) as {
      batchId: string
      fileCount: number
    }

    expect(response.status).toBe(200)
    expect(json.batchId).toBeDefined()
    expect(json.fileCount).toBe(1)
    expect(mockSaveFitnessFile).toHaveBeenCalledTimes(1)
    expect(mockSaveFitnessFile).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ id: 'https://llun.test/users/llun' }),
      expect.objectContaining({
        importBatchId: json.batchId
      })
    )
    expect(getQueue().publish).toHaveBeenCalledWith({
      id: expect.any(String),
      name: IMPORT_FITNESS_FILES_JOB_NAME,
      data: {
        actorId: 'https://llun.test/users/llun',
        batchId: json.batchId,
        fitnessFileIds: ['fitness-file-id'],
        visibility: 'public'
      }
    })
  })

  it('returns bad request when files are missing', async () => {
    const formData = new FormData()
    formData.append('visibility', 'public')

    const request = {
      headers: new Headers(),
      formData: async () => formData
    } as unknown as Parameters<typeof POST>[0]

    const response = await POST(request, { params: Promise.resolve({}) })
    expect(response.status).toBe(400)
    expect(mockSaveFitnessFile).not.toHaveBeenCalled()
    expect(getQueue().publish).not.toHaveBeenCalled()
  })

  it('rolls back persisted files when a later upload fails', async () => {
    mockSaveFitnessFile
      .mockResolvedValueOnce({
        id: 'fitness-file-id-1',
        type: 'fitness',
        file_type: 'fit',
        mime_type: 'application/vnd.ant.fit',
        url: 'https://llun.test/api/v1/fitness-files/fitness-file-id-1',
        fileName: 'workout-1.fit',
        size: 1024
      })
      .mockRejectedValueOnce(new Error('disk full'))

    const formData = new FormData()
    formData.append(
      'files',
      new File([Buffer.from('fit-data-1')], 'workout-1.fit', {
        type: 'application/vnd.ant.fit'
      })
    )
    formData.append(
      'files',
      new File([Buffer.from('fit-data-2')], 'workout-2.fit', {
        type: 'application/vnd.ant.fit'
      })
    )
    formData.append('visibility', 'public')

    const request = {
      headers: new Headers(),
      formData: async () => formData
    } as unknown as Parameters<typeof POST>[0]

    const response = await POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(500)
    expect(mockSaveFitnessFile).toHaveBeenCalledTimes(2)
    expect(mockDeleteFitnessFile).toHaveBeenCalledWith(
      expect.any(Object),
      'fitness-file-id-1'
    )
    expect(getQueue().publish).not.toHaveBeenCalled()
  })
})
