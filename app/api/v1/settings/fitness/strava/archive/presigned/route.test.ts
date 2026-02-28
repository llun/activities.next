import { getPresignedFitnessFileUrl } from '@/lib/services/fitness-files'

import { POST } from './route'

const mockGetServerSession = jest.fn()
jest.mock('next-auth', () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args)
}))

jest.mock('@/app/api/auth/[...nextauth]/authOptions', () => ({
  getAuthOptions: jest.fn(() => ({}))
}))

const mockDatabase = {
  getActiveStravaArchiveImportByActor: jest.fn().mockResolvedValue(null)
}
jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

jest.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: jest.fn().mockResolvedValue({
    id: 'https://llun.test/users/llun',
    username: 'llun',
    domain: 'llun.test'
  })
}))

jest.mock('@/lib/services/fitness-files', () => ({
  getPresignedFitnessFileUrl: jest.fn()
}))

jest.mock('next/headers', () => ({
  cookies: jest.fn().mockResolvedValue({ get: () => undefined })
}))

jest.mock('@/lib/services/strava/archiveImport', () => ({
  getStravaArchiveSourceBatchId: jest.fn(
    (id: string) => `strava-archive-source:${id}`
  )
}))

const mockGetPresignedFitnessFileUrl =
  getPresignedFitnessFileUrl as jest.MockedFunction<
    typeof getPresignedFitnessFileUrl
  >

describe('Strava archive presigned URL endpoint', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: 'llun@activities.local' }
    })
  })

  it('returns 404 when ObjectStorage is not available (LocalFile)', async () => {
    mockGetPresignedFitnessFileUrl.mockResolvedValue(null)

    const req = new Request(
      'http://localhost/api/v1/settings/fitness/strava/archive/presigned',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: 'export.zip',
          contentType: 'application/zip',
          size: 1024
        })
      }
    )

    const response = await POST(req, { params: Promise.resolve({}) })
    expect(response.status).toBe(404)
  })

  it('returns presigned URL with archiveId when ObjectStorage is available', async () => {
    mockGetPresignedFitnessFileUrl.mockResolvedValue({
      url: 'https://s3.example.com/bucket',
      fields: {
        key: 'fitness/2024-01-01/abc.zip',
        'Content-Type': 'application/zip'
      },
      fitnessFileId: 'fitness-file-id-1'
    })

    const req = new Request(
      'http://localhost/api/v1/settings/fitness/strava/archive/presigned',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: 'export.zip',
          contentType: 'application/zip',
          size: 1024
        })
      }
    )

    const response = await POST(req, { params: Promise.resolve({}) })
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.presigned.url).toBe('https://s3.example.com/bucket')
    expect(body.presigned.fitnessFileId).toBe('fitness-file-id-1')
    expect(body.presigned.archiveId).toBeDefined()
    expect(typeof body.presigned.archiveId).toBe('string')
  })

  it('returns 422 on invalid input (non-zip file)', async () => {
    const req = new Request(
      'http://localhost/api/v1/settings/fitness/strava/archive/presigned',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: 'not-a-zip.txt', size: 1024 })
      }
    )

    const response = await POST(req, { params: Promise.resolve({}) })
    expect(response.status).toBe(422)
  })

  it('returns 413 when storage quota is exceeded', async () => {
    const { QuotaExceededError } = jest.requireActual(
      '@/lib/services/fitness-files/errors'
    ) as typeof import('@/lib/services/fitness-files/errors')

    mockGetPresignedFitnessFileUrl.mockRejectedValue(
      new QuotaExceededError('Quota exceeded', 1000, 500)
    )

    const req = new Request(
      'http://localhost/api/v1/settings/fitness/strava/archive/presigned',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: 'export.zip',
          contentType: 'application/zip',
          size: 1024
        })
      }
    )

    const response = await POST(req, { params: Promise.resolve({}) })
    expect(response.status).toBe(413)
  })

  it('returns 409 when actor already has an active archive import', async () => {
    mockDatabase.getActiveStravaArchiveImportByActor.mockResolvedValueOnce({
      id: 'import-active',
      actorId: 'https://llun.test/users/llun',
      archiveId: 'archive-active',
      status: 'importing'
    })

    const req = new Request(
      'http://localhost/api/v1/settings/fitness/strava/archive/presigned',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: 'export.zip',
          contentType: 'application/zip',
          size: 1024
        })
      }
    )

    const response = await POST(req, { params: Promise.resolve({}) })
    expect(response.status).toBe(409)
    expect(mockGetPresignedFitnessFileUrl).not.toHaveBeenCalled()
  })

  it('returns 401 when not authenticated', async () => {
    mockGetServerSession.mockResolvedValue(null)

    const req = new Request(
      'http://localhost/api/v1/settings/fitness/strava/archive/presigned',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: 'export.zip',
          contentType: 'application/zip',
          size: 1024
        })
      }
    )

    const response = await POST(req, { params: Promise.resolve({}) })
    expect(response.status).toBe(401)
  })
})
