import { NextRequest } from 'next/server'

import { getPresignedFitnessFileUrl } from '@/lib/services/fitness-files'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { POST } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', async () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

const mockDatabase = {
  getActiveStravaArchiveImportByActor: vi.fn().mockResolvedValue(null)
}
vi.mock('@/lib/database', async () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('@/lib/utils/getActorFromSession', async () => ({
  getActorFromSession: vi.fn().mockResolvedValue({
    id: 'https://llun.test/users/llun',
    username: 'llun',
    domain: 'llun.test'
  })
}))

vi.mock('@/lib/services/fitness-files', async () => ({
  getPresignedFitnessFileUrl: vi.fn()
}))

vi.mock('next/headers', async () => ({
  cookies: vi.fn().mockResolvedValue({ get: () => undefined })
}))

vi.mock('@/lib/services/strava/archiveImport', async () => ({
  getStravaArchiveSourceBatchId: vi.fn(
    (id: string) => `strava-archive-source:${id}`
  )
}))

const mockGetPresignedFitnessFileUrl =
  getPresignedFitnessFileUrl as jest.MockedFunction<
    typeof getPresignedFitnessFileUrl
  >

describe('Strava archive presigned URL endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: 'llun@activities.local' }
    })
  })

  it.each([
    ['suspended', { suspendedAt: Date.now() }],
    ['disabled', { account: { disabledAt: Date.now() } }],
    [
      'unconfirmed',
      { account: { verificationCode: 'code', emailVerified: false } }
    ]
  ])('refuses a %s actor before issuing an upload URL', async (_, state) => {
    vi.mocked(getActorFromSession).mockResolvedValueOnce({
      id: 'https://llun.test/users/llun',
      username: 'llun',
      domain: 'llun.test',
      ...state
    } as never)

    const req = new NextRequest(
      'http://localhost/api/v1/fitness/strava/archive/presigned',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://test.llun.dev'
        },
        body: JSON.stringify({ fileName: 'export.zip', size: 1024 })
      }
    )
    const res = await POST(req, { params: Promise.resolve({}) })

    expect(res.status).toBe(403)
    expect(mockGetPresignedFitnessFileUrl).not.toHaveBeenCalled()
  })

  it('returns 404 when ObjectStorage is not available (LocalFile)', async () => {
    mockGetPresignedFitnessFileUrl.mockResolvedValue(null)

    const req = new NextRequest(
      'http://localhost/api/v1/fitness/strava/archive/presigned',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://test.llun.dev'
        },
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
      fitnessFileId: 'fitness-file-id-1'
    })

    const req = new NextRequest(
      'http://localhost/api/v1/fitness/strava/archive/presigned',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://test.llun.dev'
        },
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

  // Browsers report a ZIP as any of these types, or as an empty string, so the
  // route accepts every alias and always hands the presigner application/zip —
  // the one type the presigned PUT signs.
  it.each([
    ['application/zip'],
    ['application/x-zip-compressed'],
    ['application/x-zip'],
    ['multipart/x-zip'],
    [''],
    [undefined]
  ])('normalises contentType %s to application/zip', async (contentType) => {
    mockGetPresignedFitnessFileUrl.mockResolvedValue({
      url: 'https://s3.example.com/bucket',
      fitnessFileId: 'fitness-file-id-1'
    })

    const body: Record<string, unknown> = {
      fileName: 'export.zip',
      size: 1024
    }
    if (contentType !== undefined) body.contentType = contentType

    const req = new NextRequest(
      'http://localhost/api/v1/fitness/strava/archive/presigned',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://test.llun.dev'
        },
        body: JSON.stringify(body)
      }
    )

    const response = await POST(req, { params: Promise.resolve({}) })
    expect(response.status).toBe(200)
    expect(mockGetPresignedFitnessFileUrl).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ contentType: 'application/zip' })
    )
  })

  it('returns 422 for a content type that is not a zip alias', async () => {
    const req = new NextRequest(
      'http://localhost/api/v1/fitness/strava/archive/presigned',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://test.llun.dev'
        },
        body: JSON.stringify({
          fileName: 'export.zip',
          contentType: 'text/html',
          size: 1024
        })
      }
    )

    const response = await POST(req, { params: Promise.resolve({}) })
    expect(response.status).toBe(422)
    expect(mockGetPresignedFitnessFileUrl).not.toHaveBeenCalled()
  })

  it('returns 422 on invalid input (non-zip file)', async () => {
    const req = new NextRequest(
      'http://localhost/api/v1/fitness/strava/archive/presigned',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://test.llun.dev'
        },
        body: JSON.stringify({ fileName: 'not-a-zip.txt', size: 1024 })
      }
    )

    const response = await POST(req, { params: Promise.resolve({}) })
    expect(response.status).toBe(422)
  })

  it('returns 413 when storage quota is exceeded', async () => {
    const { QuotaExceededError } = (await vi.importActual(
      '@/lib/services/fitness-files/errors'
    )) as typeof import('@/lib/services/fitness-files/errors')

    mockGetPresignedFitnessFileUrl.mockRejectedValue(
      new QuotaExceededError('Quota exceeded', 1000, 500)
    )

    const req = new NextRequest(
      'http://localhost/api/v1/fitness/strava/archive/presigned',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://test.llun.dev'
        },
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

    const req = new NextRequest(
      'http://localhost/api/v1/fitness/strava/archive/presigned',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://test.llun.dev'
        },
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

    const req = new NextRequest(
      'http://localhost/api/v1/fitness/strava/archive/presigned',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://test.llun.dev'
        },
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
